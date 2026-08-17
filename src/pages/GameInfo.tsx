import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import ResultBadge from '../components/team-info/ResultBadge'
import BasketballFinalizationPanel from '../components/basketball/BasketballFinalizationPanel'
import BasketballRecorderManager from '../components/basketball/BasketballRecorderManager'
import { computePlayerScore, sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { loadCloudGameById, touchCloudGameLastOpened } from '../lib/cloudSync'
import { loadSoccerCloudGameById } from '../lib/soccer/cloudSync'
import {
  createBasketballIndependentRecorderState,
  loadBasketballCloudGameById,
} from '../lib/basketball/cloudSync'
import {
  resolveEventRecorderOpenSource,
  type EventRecorderOpenSource,
} from '../lib/gameEvents/cloudOpen'
import {
  resolveSoccerRecorderOpenSource,
  type SoccerRecorderOpenSource,
} from '../lib/soccer/cloudOpen'
import { createSoccerIndependentRecorderState } from '../lib/soccer/recorders'
import { soccerSummaryPath } from '../lib/soccer/summary'
import { teamDisplayName, playerDisplayName } from '../lib/display'
import {
  currentPeriodForCloudHydrate,
  withLastSyncedGameFingerprint,
} from '../lib/gameSyncFingerprint'
import { supabase } from '../lib/supabase'
import {
  resolveTeamInfoHomeScore,
  teamGameResult,
  teamInfoPath,
  type TeamInfoGame,
} from '../lib/teamInfo'
import {
  acceptedTeamRole,
  canManageTeam,
  canTrackGames,
  type TeamRole,
} from '../lib/teamPermissions'
import type { GameState, SportConfig, StatAction } from '../types'

interface GameInfoGameRow extends TeamInfoGame {
  id: string
  team_id: string | null
  created_by: string
  tracked_team_name: string
  game_date: string
  opponent_name: string
  tournament_name: string | null
  tournament_id: string | null
  notes: string | null
  sport_id: string | null
}

interface GameInfoTeamRow {
  id: string
  owner_id: string
  name: string
  nickname: string | null
  season_id: string
  seasons: {
    id: string
    name: string
    sport: string
  }
}

interface GameInfoRosterPlayer {
  id: string
  first_name: string
  last_name: string | null
  nickname: string | null
}

interface GameStatRow {
  player_id: string
  stat_id: string
  value: number
}

interface StatLeader {
  key: string
  label: string
  playerName: string
  value: number
}

function statusLabel(status: string): string {
  switch (status) {
    case 'final':
      return 'Final'
    case 'in_progress':
      return 'Live'
    case 'scheduled':
      return 'Scheduled'
    default:
      return status
  }
}

function findAction(sport: SportConfig, statId: string): StatAction | null {
  for (const category of sport.categories) {
    const action = category.actions.find(item => item.id === statId)
    if (action) return action
  }
  return null
}

function buildStatLeaders(
  sport: SportConfig,
  roster: GameInfoRosterPlayer[],
  rows: GameStatRow[]
): StatLeader[] {
  const playerNames = new Map(roster.map(player => [player.id, playerDisplayName(player)]))
  const statsByPlayer = new Map<string, Record<string, number>>()

  for (const row of rows) {
    if (!playerNames.has(row.player_id)) continue
    const stats = statsByPlayer.get(row.player_id) ?? {}
    stats[row.stat_id] = (stats[row.stat_id] ?? 0) + Number(row.value)
    statsByPlayer.set(row.player_id, stats)
  }

  const leaders: StatLeader[] = []
  let topScore: StatLeader | null = null
  for (const [playerId, stats] of statsByPlayer) {
    const value = computePlayerScore(sport, stats)
    if (value <= 0) continue
    if (!topScore || value > topScore.value) {
      topScore = {
        key: 'score',
        label: sport.scoreLabel,
        playerName: playerNames.get(playerId) ?? 'Unknown player',
        value,
      }
    }
  }
  if (topScore) leaders.push(topScore)

  const statIds = sport.keyStatIds ?? []
  for (const statId of statIds) {
    const action = findAction(sport, statId)
    if (action?.pointValue) continue

    let top: StatLeader | null = null
    for (const [playerId, stats] of statsByPlayer) {
      const value = stats[statId] ?? 0
      if (value <= 0) continue
      if (!top || value > top.value) {
        top = {
          key: statId,
          label: action?.shortLabel ?? statId,
          playerName: playerNames.get(playerId) ?? 'Unknown player',
          value,
        }
      }
    }
    if (top) leaders.push(top)
  }

  return leaders.slice(0, 6)
}

export default function GameInfo() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const gameId = searchParams.get('gameId')
  const fallbackTeamId = searchParams.get('teamId')
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const {
    state,
    dispatch,
    activeLocalGameId,
    parkedGames,
    openGameSnapshot,
    resumeParkedGame,
    flushCloudGameSync,
    markEventCloudGameReopened,
    parkingError,
  } = useGame()
  const supabaseClient = supabase

  const [game, setGame] = useState<GameInfoGameRow | null>(null)
  const [team, setTeam] = useState<GameInfoTeamRow | null>(null)
  const [teamRole, setTeamRole] = useState<TeamRole | null>(null)
  const [leaders, setLeaders] = useState<StatLeader[]>([])
  const [statTotals, setStatTotals] = useState<Record<string, number>>({})
  const [statsError, setStatsError] = useState<string | null>(null)
  const [openingGame, setOpeningGame] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sport = useMemo(
    () => {
      const sportId = team?.seasons.sport ?? game?.sport_id
      return sports.find(item => item.id === sportId) ?? null
    },
    [game?.sport_id, team]
  )

  const score = useMemo(() => {
    if (!game) return { scoreLine: null, result: null }
    const homeScore = resolveTeamInfoHomeScore(sport, game, {
      [game.id]: statTotals,
    })
    const scoreLine =
      homeScore != null && game.opponent_score != null
        ? `${homeScore}-${game.opponent_score}`
        : null
    const result =
      game.status === 'final' && homeScore != null && game.opponent_score != null
        ? teamGameResult(homeScore, game.opponent_score)
        : null
    return { scoreLine, result }
  }, [game, sport, statTotals])

  useEffect(() => {
    if (!gameId || !isConfigured || !supabaseClient) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      setStatsError(null)
      setGame(null)
      setTeam(null)
      setTeamRole(null)
      setLeaders([])
      setStatTotals({})

      const { data: gameData, error: gameError } = await supabaseClient
        .from('games')
        .select(
          'id,team_id,created_by,tracked_team_name,game_date,opponent_name,opponent_score,home_team_score,home_score_adjustment,status,tournament_name,tournament_id,notes,sport_id'
        )
        .eq('id', gameId)
        .single()

      if (cancelled) return

      if (gameError || !gameData) {
        setError(gameError?.message ?? 'Game not found')
        setLoading(false)
        return
      }

      const loadedGame = gameData as GameInfoGameRow
      if (!loadedGame.team_id) {
        const statsRes = await supabaseClient.rpc('get_game_stats_resolved', {
          p_game_id: loadedGame.id,
        })
        if (cancelled) return

        const statRows = ((statsRes.data ?? []) as GameStatRow[]).map(row => ({
          ...row,
          value: Number(row.value),
        }))
        const nextStatTotals: Record<string, number> = {}
        for (const row of statRows) {
          nextStatTotals[row.stat_id] = (nextStatTotals[row.stat_id] ?? 0) + row.value
        }
        setGame(loadedGame)
        setStatTotals(nextStatTotals)
        if (statsRes.error) setStatsError(statsRes.error.message)
        setLoading(false)
        return
      }

      const loadedTeamId = loadedGame.team_id
      const [teamRes, rosterRes, statsRes, membershipRes] = await Promise.all([
        supabaseClient
          .from('teams')
          .select('id,owner_id,name,nickname,season_id,seasons!inner(id,name,sport)')
          .eq('id', loadedTeamId)
          .single(),
        supabaseClient
          .from('team_players')
          .select('players!inner(id,first_name,last_name,nickname)')
          .eq('team_id', loadedTeamId)
          .eq('is_active', true),
        supabaseClient.rpc('get_game_stats_resolved', {
          p_game_id: loadedGame.id,
        }),
        userId
          ? supabaseClient
              .from('team_members')
              .select('role,accepted_at')
              .eq('team_id', loadedTeamId)
              .eq('user_id', userId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])

      if (cancelled) return

      if (teamRes.error || !teamRes.data) {
        setError(teamRes.error?.message ?? 'Team not found')
        setLoading(false)
        return
      }
      if (rosterRes.error) {
        setError(rosterRes.error.message)
        setLoading(false)
        return
      }

      const loadedTeam = teamRes.data as unknown as GameInfoTeamRow
      const membership = membershipRes.data as { role: string; accepted_at: string | null } | null
      const loadedSport = sports.find(item => item.id === loadedTeam.seasons.sport) ?? null
      type TeamPlayerJoin = {
        players: GameInfoRosterPlayer
      }
      const roster = ((rosterRes.data ?? []) as unknown as TeamPlayerJoin[]).map(row => row.players)
      const statRows = ((statsRes.data ?? []) as GameStatRow[]).map(row => ({
        ...row,
        value: Number(row.value),
      }))
      const nextStatTotals: Record<string, number> = {}
      for (const row of statRows) {
        nextStatTotals[row.stat_id] = (nextStatTotals[row.stat_id] ?? 0) + row.value
      }

      setGame(loadedGame)
      setTeam(loadedTeam)
      setTeamRole(
        loadedTeam.owner_id === userId
          ? 'owner'
          : acceptedTeamRole(membership?.role, membership?.accepted_at)
      )
      setStatTotals(nextStatTotals)
      if (statsRes.error) {
        setStatsError(statsRes.error.message)
      } else if (loadedSport) {
        setLeaders(buildStatLeaders(loadedSport, roster, statRows))
      }
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [gameId, isConfigured, supabaseClient, userId])

  const openFullGame = async () => {
    if (!game || !user) return
    const canTrackCurrentGame = game.team_id
      ? canTrackGames(teamRole)
      : game.created_by === user.id
    if (
      game.status !== 'final' &&
      !canTrackCurrentGame &&
      sport?.id !== 'soccer'
    ) return
    if (sport?.id === 'soccer') {
      if (game.status === 'final' || !canTrackGames(teamRole)) {
        navigate(soccerSummaryPath({
          gameId: game.id,
          from: 'game-info',
          teamId: team?.id ?? fallbackTeamId,
        }))
        return
      }

      setOpeningGame(true)
      setError(null)
      let source: SoccerRecorderOpenSource<GameState>
      try {
        source = await resolveSoccerRecorderOpenSource(
          game.id,
          activeLocalGameId,
          parkedGames,
          () => loadSoccerCloudGameById(user.id, game.id)
        )
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load soccer game')
        setOpeningGame(false)
        return
      }

      const hasActiveGame = Boolean(state.sport && (state.gameInfo || state.players.length > 0))
      if (source.kind === 'local') {
        if (
          hasActiveGame &&
          activeLocalGameId !== source.localGameId &&
          !window.confirm('Park your current game and resume this local recorder stream?')
        ) {
          setOpeningGame(false)
          return
        }
        if (!resumeParkedGame(source.localGameId)) {
          setOpeningGame(false)
          return
        }
        setOpeningGame(false)
        navigate('/game')
        return
      }

      let soccerGame = source.kind === 'cloud' ? source.state : null
      if (source.kind === 'empty') {
        const startIndependent = window.confirm(
          'Start your own independent recorder stream for this game? Select Cancel to open read-only review.'
        )
        if (!startIndependent) {
          setOpeningGame(false)
          navigate(soccerSummaryPath({
            gameId: game.id,
            from: 'game-info',
            teamId: team?.id ?? fallbackTeamId,
          }))
          return
        }
        soccerGame = await createSoccerIndependentRecorderState(user.id, game.id).catch(caught => {
          setError(caught instanceof Error ? caught.message : 'Could not start recorder stream')
          return null
        })
      }
      if (!soccerGame) {
        setOpeningGame(false)
        return
      }
      if (hasActiveGame && !window.confirm('Park your current game and open this cloud game?')) {
        setOpeningGame(false)
        return
      }
      if (!openGameSnapshot(soccerGame)) {
        setOpeningGame(false)
        return
      }
      setOpeningGame(false)
      navigate('/game')
      return
    }
    if (game.sport_id === 'basketball') {
      if (game.status === 'final') {
        setError('Basketball event-game final review is not available until BKE-4D.')
        return
      }
      if (!canTrackCurrentGame) return

      setOpeningGame(true)
      setError(null)
      let source: EventRecorderOpenSource<GameState>
      try {
        source = await resolveEventRecorderOpenSource(
          'basketball',
          game.id,
          activeLocalGameId,
          parkedGames,
          () => loadBasketballCloudGameById(user.id, game.id)
        )
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load Basketball game')
        setOpeningGame(false)
        return
      }

      const hasActiveGame = Boolean(state.sport && (state.gameInfo || state.players.length > 0))
      if (source.kind === 'local') {
        if (
          hasActiveGame &&
          activeLocalGameId !== source.localGameId &&
          !window.confirm('Park your current game and resume this local recorder stream?')
        ) {
          setOpeningGame(false)
          return
        }
        if (!resumeParkedGame(source.localGameId)) {
          setOpeningGame(false)
          return
        }
        setOpeningGame(false)
        navigate('/game')
        return
      }

      let basketballGame = source.kind === 'cloud' ? source.state : null
      if (source.kind === 'empty') {
        const startIndependent = window.confirm(
          'Start your own independent recorder stream for this game? Select Cancel to stay on Game Info.'
        )
        if (!startIndependent) {
          setOpeningGame(false)
          return
        }
        basketballGame = await createBasketballIndependentRecorderState(user.id, game.id).catch(caught => {
          setError(caught instanceof Error ? caught.message : 'Could not start recorder stream')
          return null
        })
      }
      if (!basketballGame) {
        setOpeningGame(false)
        return
      }
      if (hasActiveGame && !window.confirm('Park your current game and open this cloud game?')) {
        setOpeningGame(false)
        return
      }
      if (!openGameSnapshot(basketballGame)) {
        setOpeningGame(false)
        return
      }
      setOpeningGame(false)
      navigate('/game')
      return
    }

    const hasActiveGame = Boolean(state.sport && (state.gameInfo || state.players.length > 0))
    if (hasActiveGame && !window.confirm('Park your current game and open this cloud game?')) {
      return
    }

    setOpeningGame(true)
    setError(null)

    const cloudGame = await loadCloudGameById(user.id, game.id).catch(err => {
      setError(err instanceof Error ? err.message : 'Could not load game')
      setOpeningGame(false)
      return null
    })

    if (!cloudGame) {
      setOpeningGame(false)
      return
    }

    await touchCloudGameLastOpened(cloudGame.gameId).catch(() => {})

    const loadedSport = sports.find(item => item.id === cloudGame.sportId)
    if (!loadedSport) {
      setError(`Unsupported sport: ${cloudGame.sportId}`)
      setOpeningGame(false)
      return
    }

    const nextState: GameState = {
      sport: loadedSport,
      gameInfo: cloudGame.gameInfo,
      players: cloudGame.players,
      activePlayerId: cloudGame.activePlayerId,
      opponentScore: cloudGame.opponentScore,
      homeTeamScore: cloudGame.homeTeamScore,
      homeScoreAdjustment: cloudGame.homeScoreAdjustment,
      notes: cloudGame.notes,
      currentPeriod: currentPeriodForCloudHydrate(state, cloudGame.gameId),
      teamStatsConfig: cloudGame.teamStatsConfig ?? null,
      actionLog: [],
      shotChart: cloudGame.shotChart ?? [],
      eventStream: null,
      sportGameState: null,
      cloudSync: {
        seasonId: cloudGame.seasonId ?? null,
        teamId: cloudGame.teamId,
        gameId: cloudGame.gameId,
        gameStatus: cloudGame.status,
        playerIdMap: cloudGame.playerIdMap,
        status: 'synced',
        lastSyncedAt: cloudGame.hydratedAt,
        lastError: null,
        shotChartHydrationDroppedRows: cloudGame.shotChartHydrationDroppedRows ?? 0,
        lastSyncedGameFingerprint: null,
      },
    }

    if (!openGameSnapshot(withLastSyncedGameFingerprint(nextState))) {
      setOpeningGame(false)
      return
    }
    setOpeningGame(false)
    navigate(cloudGame.status === 'final' ? '/summary' : '/game')
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <p className="text-sm text-slate-500 mb-4">
            Configure Supabase credentials to view cloud game info.
          </p>
          <button type="button" onClick={() => navigate('/settings/data')} className="btn-primary w-full">
            Back to Settings
          </button>
        </div>
      </div>
    )
  }

  if (!gameId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Missing game</p>
          <p className="text-sm text-slate-500 mb-4">Choose a game before opening Game Info.</p>
          <button type="button" onClick={() => navigate('/games')} className="btn-primary w-full">
            Cloud Games
          </button>
        </div>
      </div>
    )
  }

  const backTeamId = game?.team_id ?? fallbackTeamId
  const trackedTeamName = team
    ? teamDisplayName(team)
    : game?.tracked_team_name ?? 'My Team'
  const canTrackCurrentGame = Boolean(
    game && userId && (game.team_id ? canTrackGames(teamRole) : game.created_by === userId)
  )
  const canManageRecorderAuthority = Boolean(
    game && userId && (game.team_id ? canManageTeam(teamRole) : game.created_by === userId)
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          {backTeamId ? (
            <Link to={teamInfoPath(backTeamId)} className="text-sm font-semibold text-blue-600">
              Back to Team
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/games')}
              className="text-sm font-semibold text-blue-600"
            >
              Cloud Games
            </button>
          )}
          {loading && <span className="text-xs text-slate-400 animate-pulse">Loading...</span>}
        </div>

        {error && (!game || loading) ? (
          <section className="card text-center space-y-3">
            <p className="font-semibold text-slate-700">Game Info unavailable</p>
            <p className="text-sm text-slate-500">{error}</p>
          </section>
        ) : game && !loading ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">
                {sport?.icon ? `${sport.icon} ` : ''}
                {sport?.name ?? game.sport_id ?? 'Sport'} / {team?.seasons.name ?? 'Personal game'}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 break-words">
                {trackedTeamName} vs {game.opponent_name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {game.status === 'final' ? (
                  <ResultBadge result={score.result} scoreLine={score.scoreLine} />
                ) : (
                  <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                    {statusLabel(game.status)}
                  </span>
                )}
                <span className="text-sm text-slate-500">{game.game_date}</span>
              </div>
            </section>

            <section className="card space-y-3">
              <div>
                <h2 className="font-semibold text-slate-800">Game Details</h2>
                <p className="text-xs text-slate-500">{statusLabel(game.status)}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Team
                  </p>
                  <p className="font-semibold text-slate-800">{trackedTeamName}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Opponent
                  </p>
                  <p className="font-semibold text-slate-800">{game.opponent_name}</p>
                </div>
              </div>
              {game.tournament_name && (
                <p className="text-sm text-slate-600">{game.tournament_name}</p>
              )}
              {game.notes?.trim() && <p className="text-sm text-slate-600">{game.notes}</p>}
            </section>

            {sport?.id === 'basketball' && (
              <>
                <BasketballRecorderManager
                  gameId={game.id}
                  currentUserId={userId}
                  canManage={canManageRecorderAuthority}
                />
                <BasketballFinalizationPanel
                  gameId={game.id}
                  gameStatus={game.status}
                  currentUserId={userId}
                  canManage={canManageRecorderAuthority}
                  trackedScore={game.home_team_score ?? null}
                  opponentScore={game.opponent_score ?? null}
                  ownedLocalTerminal={Boolean(
                    state.cloudSync.gameId === game.id &&
                    state.sportGameState?.sportId === 'basketball' &&
                    state.sportGameState.projection.status === 'ended'
                  )}
                  flushCloudSync={() => flushCloudGameSync(game.id)}
                  onFinalized={result => {
                    setGame(current => current ? {
                      ...current,
                      status: 'final',
                      home_team_score: result.score.tracked,
                      opponent_score: result.score.opponent,
                      home_score_adjustment: 0,
                    } : current)
                    if (state.cloudSync.gameId === game.id) {
                      dispatch({
                        type: 'SET_CLOUD_SYNC_STATE',
                        cloudSync: { gameStatus: 'final' },
                      })
                    }
                  }}
                  onReopened={() => {
                    setGame(current => current ? {
                      ...current,
                      status: 'in_progress',
                      home_team_score: null,
                      opponent_score: 0,
                      home_score_adjustment: 0,
                    } : current)
                    markEventCloudGameReopened(game.id)
                  }}
                />
              </>
            )}

            <section className="card space-y-3">
              <div>
                <h2 className="font-semibold text-slate-800">Stat Leaders</h2>
                <p className="text-xs text-slate-500">Resolved game stats</p>
              </div>
              {statsError ? (
                <p className="text-sm text-slate-500">{statsError}</p>
              ) : leaders.length === 0 ? (
                <p className="text-sm text-slate-500">No stat leaders yet.</p>
              ) : (
                <div className="space-y-2">
                  {leaders.map(leader => (
                    <div
                      key={leader.key}
                      className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">
                          {leader.playerName}
                        </p>
                        <p className="text-xs text-slate-500">{leader.label}</p>
                      </div>
                      <p className="text-lg font-bold text-slate-800">{leader.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {(error || parkingError) && (
              <section className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
                <p className="text-sm font-medium text-rose-700">{error ?? parkingError}</p>
              </section>
            )}

            {sport?.id === 'soccer' || game.status === 'final' || canTrackCurrentGame ? (
              <button
                type="button"
                onClick={openFullGame}
                disabled={openingGame}
                className="btn-primary w-full disabled:opacity-60"
              >
                {openingGame
                  ? 'Opening...'
                  : game.status === 'final' ||
                      (sport?.id === 'soccer' && !canTrackGames(teamRole))
                    ? 'View full summary'
                    : 'Open game'}
              </button>
            ) : (
              <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm font-medium text-slate-600">
                  Viewer access is read-only. Live game tracking is available to scorers, admins, and owners.
                </p>
              </section>
            )}
          </>
        ) : loading ? (
          <section className="card">
            <p className="text-sm text-slate-500 animate-pulse">Loading Game Info...</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}
