import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { supabase } from '../lib/supabase'
import { loadCloudGameById, touchCloudGameLastOpened } from '../lib/cloudSync'
import { withLastSyncedGameFingerprint, currentPeriodForCloudHydrate, shouldBlockDiscardUnsyncedGame } from '../lib/gameSyncFingerprint'
import { getPendingSyncFlag } from '../lib/gameStorageKeys'
import { hasUnsyncedParkedBindingForCloudGame } from '../lib/gameParking'
import { sports } from '../config/sports'
import { resolveFinalHomeScoreFromGameRow } from '../lib/gameScore'
import type { GameState } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import { teamDisplayName } from '../lib/display'
import { sportDashboardPath } from '../lib/sportNavigation'
import { gameInfoPath } from '../lib/teamInfo'
import {
  acceptedTeamRole,
  canDeleteGame,
  canTrackGames,
  type TeamRole,
} from '../lib/teamPermissions'

interface GameRow {
  id: string
  team_id: string
  opponent_name: string
  opponent_score: number
  tournament_name: string | null
  tournament_id: string | null
  home_team_score: number | null
  home_score_adjustment: number | null
  game_date: string
  status: string
  created_at: string
}

interface TeamRow {
  id: string
  owner_id: string
  name: string
  nickname: string | null
  season_id: string
  seasons: { sport: string }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'final':
      return 'Final'
    case 'in_progress':
      return 'In Progress'
    case 'scheduled':
      return 'Scheduled'
    default:
      return status
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case 'final':
      return 'bg-emerald-100 text-emerald-700'
    case 'in_progress':
      return 'bg-blue-100 text-blue-700'
    case 'scheduled':
      return 'bg-amber-100 text-amber-700'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

export default function Games() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, isConfigured } = useAuth()
  const { state, dispatch, openGameSnapshot, parkingError } = useGame()
  const userId = user?.id ?? null
  const supabaseClient = supabase
  const requestedSportId = searchParams.get('sport')
  const scopedSport = useMemo(
    () => sports.find(sport => sport.id === requestedSportId) ?? null,
    [requestedSportId]
  )

  const [games, setGames] = useState<GameRow[]>([])
  const [teamMap, setTeamMap] = useState<Record<string, TeamRow>>({})
  const [teamRolesById, setTeamRolesById] = useState<Record<string, TeamRole>>({})
  /** Score line per game id, all statuses (F4): synced row snapshot or stats aggregate. */
  const [scoreLines, setScoreLines] = useState<Record<string, string>>({})
  /** Basketball games that have any `shot_chart` rows (F3 discoverability pill). */
  const [chartGameIds, setChartGameIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [editingGameId, setEditingGameId] = useState<string | null>(null)
  const [editingOpponentName, setEditingOpponentName] = useState('')
  const [savingOpponentName, setSavingOpponentName] = useState(false)
  const [confirmDeleteGame, setConfirmDeleteGame] = useState<GameRow | null>(null)
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null)
  const visibleGames = useMemo(
    () =>
      scopedSport
        ? games.filter(game => teamMap[game.team_id]?.seasons?.sport === scopedSport.id)
        : games,
    [games, scopedSport, teamMap]
  )

  useEffect(() => {
    if (!isConfigured || !userId || !supabaseClient) return

    let cancelled = false
    const loadGames = async () => {
      setLoading(true)
      setError(null)

      const { data: gameRows, error: gamesError } = await supabaseClient
        .from('games')
        .select(
          'id,team_id,opponent_name,opponent_score,tournament_name,tournament_id,home_team_score,home_score_adjustment,game_date,status,created_at'
        )
        .not('team_id', 'is', null)
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (gamesError) {
        setError(gamesError.message)
        setLoading(false)
        return
      }

      const loadedGames = (gameRows ?? []) as GameRow[]
      setGames(loadedGames)

      const teamIds = [...new Set(loadedGames.map(game => game.team_id))]
      if (teamIds.length === 0) {
        setTeamMap({})
        setLoading(false)
        return
      }

      const [{ data: teams, error: teamsError }, { data: memberships, error: membershipsError }] =
        await Promise.all([
          supabaseClient
            .from('teams')
            .select('id,owner_id,name,nickname,season_id,seasons!inner(sport)')
            .in('id', teamIds),
          supabaseClient
            .from('team_members')
            .select('team_id,role,accepted_at')
            .eq('user_id', userId)
            .in('team_id', teamIds)
            .not('accepted_at', 'is', null),
        ])

      if (cancelled) return
      if (teamsError || membershipsError) {
        setError(teamsError?.message ?? membershipsError?.message ?? 'Unable to load team access.')
        setLoading(false)
        return
      }

      type RawTeam = TeamRow & { seasons?: TeamRow['seasons'] | TeamRow['seasons'][] }
      const nextTeamMap = ((teams ?? []) as unknown as RawTeam[]).reduce<Record<string, TeamRow>>((map, row) => {
        const seasons = Array.isArray(row.seasons) ? row.seasons[0] : row.seasons
        map[row.id] = {
          id: row.id,
          owner_id: row.owner_id,
          name: row.name,
          nickname: row.nickname ?? null,
          season_id: row.season_id,
          seasons: seasons ?? { sport: '' },
        }
        return map
      }, {})
      const nextRoles: Record<string, TeamRole> = {}
      for (const team of Object.values(nextTeamMap)) {
        if (team.owner_id === userId) nextRoles[team.id] = 'owner'
      }
      for (const membership of (memberships ?? []) as Array<{
        team_id: string
        role: string
        accepted_at: string | null
      }>) {
        const role = acceptedTeamRole(membership.role, membership.accepted_at)
        if (role) nextRoles[membership.team_id] = role
      }
      setTeamMap(nextTeamMap)
      setTeamRolesById(nextRoles)
      setLoading(false)
    }

    void loadGames()
    return () => {
      cancelled = true
    }
  }, [isConfigured, supabaseClient, userId])

  // Score lines for all statuses (F4). Precedence per D5: the synced `games` row
  // (`home_team_score`) is authoritative and needs no query; only legacy null-home games
  // fall back to a stats aggregate: resolved RPC for finals, current-recorder
  // `game_stats` rows otherwise.
  useEffect(() => {
    if (!supabaseClient) return
    if (visibleGames.length === 0) {
      setScoreLines({})
      return
    }

    let cancelled = false
    const loadScores = async () => {
      const next: Record<string, string> = {}
      for (const g of visibleGames) {
        if (g.home_team_score != null) {
          next[g.id] = `${g.home_team_score}–${g.opponent_score}`
          continue
        }

        const team = teamMap[g.team_id]
        const sport = sports.find(s => s.id === team?.seasons?.sport)
        if (!sport) continue

        const byStat: Record<string, number> = {}
        if (g.status === 'final') {
          const { data, error: rpcError } = await supabaseClient.rpc('get_game_stats_resolved', {
            p_game_id: g.id,
          })
          if (cancelled || rpcError) continue
          for (const row of (data ?? []) as { stat_id: string; value: number }[]) {
            byStat[row.stat_id] = (byStat[row.stat_id] ?? 0) + Number(row.value)
          }
        } else {
          if (!userId) continue
          const { data, error: statsError } = await supabaseClient
            .from('game_stats')
            .select('stat_id, value')
            .eq('game_id', g.id)
            .eq('recorded_by', userId)
          if (cancelled || statsError) continue
          for (const row of (data ?? []) as { stat_id: string; value: number }[]) {
            byStat[row.stat_id] = (byStat[row.stat_id] ?? 0) + Number(row.value)
          }
        }
        const home = resolveFinalHomeScoreFromGameRow(sport, byStat, g)
        next[g.id] = `${home}–${g.opponent_score}`
      }
      if (!cancelled) setScoreLines(next)
    }

    void loadScores()
    return () => {
      cancelled = true
    }
  }, [teamMap, supabaseClient, userId, visibleGames])

  // One batched existence check for shot-chart availability on basketball games (F3 D12).
  useEffect(() => {
    if (!supabaseClient) return
    const basketballIds = visibleGames
      .filter(g => teamMap[g.team_id]?.seasons?.sport === 'basketball')
      .map(g => g.id)
    if (basketballIds.length === 0) {
      setChartGameIds(new Set())
      return
    }

    let cancelled = false
    const loadChartPresence = async () => {
      const { data, error: chartError } = await supabaseClient
        .from('shot_chart')
        .select('game_id')
        .in('game_id', basketballIds)
      // Missing table / RLS errors: indicator is optional, degrade silently.
      if (cancelled || chartError) return
      setChartGameIds(new Set((data ?? []).map(row => (row as { game_id: string }).game_id)))
    }

    void loadChartPresence()
    return () => {
      cancelled = true
    }
  }, [teamMap, supabaseClient, visibleGames])

  const grouped = useMemo(() => {
    const finalGames = visibleGames.filter(game => game.status === 'final')
    const activeGames = visibleGames.filter(game => game.status !== 'final')
    return { activeGames, finalGames }
  }, [visibleGames])

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <button
            onClick={() => navigate(scopedSport ? sportDashboardPath(scopedSport.id) : '/')}
            className="btn-primary w-full mt-3"
          >
            Back Home
          </button>
        </div>
      </div>
    )
  }

  const handleOpenGame = async (game: GameRow) => {
    if (!userId) return
    if (teamMap[game.team_id]?.seasons?.sport === 'soccer') {
      setError('Resume this soccer match from its parked game on the Soccer dashboard.')
      return
    }
    const teamRole = teamRolesById[game.team_id] ?? null
    if (game.status !== 'final' && !canTrackGames(teamRole)) {
      navigate(gameInfoPath(game.id, game.team_id))
      return
    }
    const hasActiveGame = Boolean(state.sport && (state.gameInfo || state.players.length > 0))
    if (hasActiveGame && !window.confirm('Park your current game and open this cloud game?')) {
      return
    }
    setError(null)
    setLoadingGameId(game.id)
    const cloudGame = await loadCloudGameById(userId, game.id).catch(err => {
      setError(err instanceof Error ? err.message : 'Could not load game')
      setLoadingGameId(null)
      return null
    })

    if (!cloudGame) {
      setLoadingGameId(null)
      return
    }
    await touchCloudGameLastOpened(cloudGame.gameId).catch(() => {})

    const sport = sports.find(item => item.id === cloudGame.sportId)
    if (!sport) {
      setError(`Unsupported sport: ${cloudGame.sportId}`)
      setLoadingGameId(null)
      return
    }

    const nextState: GameState = {
      sport,
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
      setLoadingGameId(null)
      return
    }
    setLoadingGameId(null)
    navigate(cloudGame.status === 'final' ? '/summary' : '/game')
  }

  const startEditOpponentName = (game: GameRow) => {
    setEditingGameId(game.id)
    setEditingOpponentName(game.opponent_name)
  }

  const cancelEditOpponentName = () => {
    setEditingGameId(null)
    setEditingOpponentName('')
  }

  const handleSaveOpponentName = async () => {
    const game = games.find(candidate => candidate.id === editingGameId)
    if (
      !supabaseClient ||
      !game ||
      game.status === 'final' ||
      !canTrackGames(teamRolesById[game.team_id] ?? null) ||
      !editingOpponentName.trim()
    ) return
    setError(null)
    setSavingOpponentName(true)
    const name = editingOpponentName.trim()
    const { error: updateError } = await supabaseClient
      .from('games')
      .update({ opponent_name: name })
      .eq('id', editingGameId)
    setSavingOpponentName(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setGames(prev =>
      prev.map(g => (g.id === editingGameId ? { ...g, opponent_name: name } : g))
    )
    cancelEditOpponentName()
  }

  const handleDeleteGame = async (game: GameRow) => {
    if (!supabaseClient || !canDeleteGame(teamRolesById[game.team_id] ?? null)) return
    setError(null)

    if (
      (state.cloudSync.gameId === game.id &&
        shouldBlockDiscardUnsyncedGame(state, getPendingSyncFlag())) ||
      hasUnsyncedParkedBindingForCloudGame(userId, game.id)
    ) {
      setError(
        'This game has unsynced local stats. Sync them before deleting the cloud game.'
      )
      return
    }

    setDeletingGameId(game.id)

    const { error: deleteError } = await supabaseClient
      .from('games')
      .delete()
      .eq('id', game.id)

    setDeletingGameId(null)
    if (deleteError) {
      setError(deleteError.message)
      return
    }

    if (state.cloudSync.gameId === game.id) {
      dispatch({ type: 'RESET_GAME' })
    }

    setGames(prev => prev.filter(g => g.id !== game.id))
  }

  const renderGameCard = (game: GameRow) => {
    const team = teamMap[game.team_id]
    const teamRole = teamRolesById[game.team_id] ?? null
    const sport = sports.find(item => item.id === team?.seasons?.sport)
    // All statuses show a score (F4 D7), except a scheduled game still at 0–0.
    const scoreLine = scoreLines[game.id] ?? null
    const scoreHint =
      game.status === 'scheduled' && scoreLine === '0–0' ? null : scoreLine

    return (
      <div key={game.id} className="card">
        <div className="flex items-center justify-between mb-2">
          <p className="font-semibold text-slate-700">
            {sport?.icon ?? '🏟️'} {team ? teamDisplayName(team) : 'Unknown Team'}
          </p>
          <span className={`text-[11px] px-2 py-1 rounded-full font-semibold ${statusBadge(game.status)}`}>
            {statusLabel(game.status)}
          </span>
        </div>
        {editingGameId === game.id ? (
          <div className="flex gap-2 items-center mt-1">
            <span className="text-sm text-slate-500 shrink-0">vs</span>
            <input
              type="text"
              value={editingOpponentName}
              onChange={e => setEditingOpponentName(e.target.value)}
              className="input-field flex-1 text-sm py-1"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') void handleSaveOpponentName()
                if (e.key === 'Escape') cancelEditOpponentName()
              }}
            />
            <button
              onClick={() => { void handleSaveOpponentName() }}
              disabled={savingOpponentName || !editingOpponentName.trim()}
              className="btn-primary py-1 px-3 text-sm shrink-0"
            >
              {savingOpponentName ? '...' : 'Save'}
            </button>
            <button
              onClick={cancelEditOpponentName}
              className="border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-600 shrink-0"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <p className="text-sm text-slate-600">vs {game.opponent_name}</p>
            {scoreHint && (
              <span className="text-sm font-semibold text-slate-800 tabular-nums">{scoreHint}</span>
            )}
            {game.status !== 'final' && canTrackGames(teamRole) && (
              <button
                onClick={() => startEditOpponentName(game)}
                className="text-slate-300 hover:text-slate-500 transition-colors p-0.5"
                title="Edit opponent name"
                aria-label="Edit opponent name"
              >
                ✏️
              </button>
            )}
          </div>
        )}
        {game.tournament_name && (
          <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
            <span>🏆 {game.tournament_name}</span>
            {game.tournament_id && team && (
              <Link
                to={`/tournament-stats?tournamentId=${encodeURIComponent(game.tournament_id)}&teamId=${encodeURIComponent(game.team_id)}`}
                className="text-blue-600 font-semibold underline"
              >
                Tournament stats
              </Link>
            )}
          </div>
        )}
        <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
          <span>{game.game_date}</span>
          {chartGameIds.has(game.id) && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 font-semibold"
              title="This game has a shot chart"
            >
              🏀 chart
            </span>
          )}
        </p>
        <div className="flex gap-2 mt-3">
          {sport?.id === 'soccer' ? (
            <button
              onClick={() => navigate(sportDashboardPath('soccer'))}
              className="btn-secondary flex-1 py-2"
            >
              Soccer Dashboard
            </button>
          ) : (
            <button
              onClick={() => { void handleOpenGame(game) }}
              disabled={loadingGameId === game.id}
              className="btn-primary flex-1 py-2"
            >
              {loadingGameId === game.id
                ? 'Loading...'
                : game.status === 'final'
                  ? 'View Summary'
                  : canTrackGames(teamRole)
                    ? 'Resume Game'
                    : 'View Details'}
            </button>
          )}
          {canDeleteGame(teamRole) && (
            <button
              onClick={() => setConfirmDeleteGame(game)}
              disabled={deletingGameId === game.id}
              className="border border-red-200 text-red-600 rounded-xl px-3 py-2 text-sm font-semibold
                         hover:bg-red-50 active:scale-95 transition-all disabled:opacity-40"
              title="Delete game"
              aria-label="Delete game"
            >
              {deletingGameId === game.id ? '...' : '🗑️'}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate(scopedSport ? sportDashboardPath(scopedSport.id) : '/')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">
              {scopedSport ? `${scopedSport.name} Cloud Games` : 'Cloud Games'}
            </h1>
            <p className="text-sm opacity-80">Resume or review saved games</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {(error || parkingError) && (
          <div className="card bg-red-50 border-red-200 text-red-700 text-sm">
            {error ?? parkingError}
          </div>
        )}

        {loading ? (
          <div className="card text-sm text-slate-500 animate-pulse">Loading games...</div>
        ) : visibleGames.length === 0 ? (
          <div className="card text-center py-10">
            <p className="text-3xl mb-2">📚</p>
            <p className="text-slate-500">
              {scopedSport ? `No ${scopedSport.name} cloud games yet.` : 'No cloud games yet.'}
            </p>
          </div>
        ) : (
          <>
            {grouped.activeGames.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Active / Scheduled
                </h2>
                <div className="space-y-2">
                  {grouped.activeGames.map(renderGameCard)}
                </div>
              </section>
            )}

            {grouped.finalGames.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Final Games
                </h2>
                <div className="space-y-2">
                  {grouped.finalGames.map(renderGameCard)}
                </div>
              </section>
            )}
          </>
        )}

        <ConfirmDialog
          open={confirmDeleteGame !== null}
          title="Delete Game"
          message={
            confirmDeleteGame
              ? `Permanently delete the game vs ${confirmDeleteGame.opponent_name} (${confirmDeleteGame.game_date})? All stats for this game will be lost. This cannot be undone.`
              : ''
          }
          confirmLabel="Yes, Delete"
          onConfirm={() => {
            if (confirmDeleteGame) void handleDeleteGame(confirmDeleteGame)
            setConfirmDeleteGame(null)
          }}
          onCancel={() => setConfirmDeleteGame(null)}
        />
      </div>
    </div>
  )
}
