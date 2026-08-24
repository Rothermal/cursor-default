import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import SegmentedControl from '../components/SegmentedControl'
import TeamHero from '../components/team-info/TeamHero'
import RecentResultsCard, { type TeamInfoResultGame } from '../components/team-info/RecentResultsCard'
import RosterPreviewCard, { type TeamInfoRosterPlayer } from '../components/team-info/RosterPreviewCard'
import SchedulePreviewCard, { type TeamInfoScheduleGame } from '../components/team-info/SchedulePreviewCard'
import TeamMembersCard, { type TeamInfoMember } from '../components/team-info/TeamMembersCard'
import TeamOverviewCards from '../components/team-info/TeamOverviewCards'
import TournamentCard, { type TeamInfoTournament } from '../components/team-info/TournamentCard'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useSettings } from '../context/SettingsContext'
import { teamDisplayName } from '../lib/display'
import { loadLegacyFinalStatsTotals } from '../lib/legacyFinalStats'
import { supabase } from '../lib/supabase'
import {
  computeTeamRecord,
  gameSetupPath,
  resolveTeamInfoHomeScore,
  splitTeamGames,
  teamGameResult,
  teamSeasonPath,
  type TeamInfoGame,
} from '../lib/teamInfo'
import { acceptedTeamRole, canTrackGames } from '../lib/teamPermissions'
import { getSportAvailabilityPolicy } from '../lib/sportAvailability'
import {
  basketballSetupAccountScope,
  basketballSetupDraftHasMeaningfulEdits,
  basketballSetupDraftMatchesRoute,
  clearBasketballSetupDraft,
  loadBasketballSetupDraft,
} from '../lib/basketball/setupDraft'
import { ensureSoccerReleaseCapabilities } from '../lib/soccer/releaseCapabilities'

interface TeamRow {
  id: string
  name: string
  nickname: string | null
  season_id: string
  seasons: {
    id: string
    name: string
    sport: string
  }
}

interface GameRow extends TeamInfoGame {
  game_date: string
  opponent_name: string
  tournament_name: string | null
  tournament_id: string | null
}

type TeamInfoSegment = 'overview' | 'roster' | 'schedule'

const segmentOptions: Array<{ value: TeamInfoSegment; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'roster', label: 'Roster' },
  { value: 'schedule', label: 'Schedule' },
]

export default function TeamInfo() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teamId = searchParams.get('teamId')
  const { user, isConfigured } = useAuth()
  const { isSportEnabled } = useSettings()
  const {
    state: gameState,
    startNewGame,
    parkingError,
  } = useGame()
  const supabaseClient = supabase

  const [team, setTeam] = useState<TeamRow | null>(null)
  const [rosterPlayers, setRosterPlayers] = useState<TeamInfoRosterPlayer[]>([])
  const [games, setGames] = useState<GameRow[]>([])
  const [tournaments, setTournaments] = useState<TeamInfoTournament[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamInfoMember[]>([])
  const [tournamentError, setTournamentError] = useState<string | null>(null)
  const [membersError, setMembersError] = useState<string | null>(null)
  const [statsTotalsByGameId, setStatsTotalsByGameId] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startGameError, setStartGameError] = useState<string | null>(null)
  const [startingGame, setStartingGame] = useState(false)
  const [offerLocalSoccer, setOfferLocalSoccer] = useState(false)
  const [activeSegment, setActiveSegment] = useState<TeamInfoSegment>('overview')
  const myRole = useMemo(() => {
    const member = teamMembers.find(candidate => candidate.user_id === user?.id)
    return member ? acceptedTeamRole(member.role, member.accepted_at) : null
  }, [teamMembers, user?.id])

  const sport = useMemo(
    () => (team ? sports.find(item => item.id === team.seasons.sport) ?? null : null),
    [team]
  )
  const sportAvailability = sport
    ? getSportAvailabilityPolicy(sport.id, isSportEnabled(sport.id))
    : null
  const sportAvailable = Boolean(sportAvailability?.canStartNewGame)

  const record = useMemo(
    () => computeTeamRecord(sport, games, statsTotalsByGameId),
    [games, sport, statsTotalsByGameId]
  )

  const gameGroups = useMemo(() => splitTeamGames(games), [games])

  const gamesWithScores = useMemo(
    () =>
      games.map(game => {
        const homeScore = resolveTeamInfoHomeScore(sport, game, statsTotalsByGameId)
        const scoreLine =
          homeScore != null && game.opponent_score != null
            ? `${homeScore}-${game.opponent_score}`
            : null
        const result =
          game.status === 'final' && homeScore != null && game.opponent_score != null
            ? teamGameResult(homeScore, game.opponent_score)
            : null
        return { ...game, scoreLine, result }
      }),
    [games, sport, statsTotalsByGameId]
  )

  const upcomingPreviewGames = useMemo<TeamInfoScheduleGame[]>(() => {
    const active = gameGroups.inProgress
    const upcoming = [...gameGroups.upcoming].sort((a, b) => a.game_date.localeCompare(b.game_date))
    return [...active, ...upcoming]
  }, [gameGroups])

  const recentResults = useMemo<TeamInfoResultGame[]>(
    () =>
      gamesWithScores
        .filter(game => game.status === 'final')
        .sort((a, b) => b.game_date.localeCompare(a.game_date))
        .map(game => ({
          id: game.id,
          game_date: game.game_date,
          opponent_name: game.opponent_name,
          tournament_name: game.tournament_name,
          scoreLine: game.scoreLine,
          result: game.result,
        })),
    [gamesWithScores]
  )

  const startLocalSoccerGame = () => {
    if (!sport || sport.id !== 'soccer') return
    setStartGameError(null)
    setOfferLocalSoccer(false)
    const hasActiveGame = Boolean(gameState.sport && gameState.players.length > 0)
    if (
      hasActiveGame &&
      !window.confirm('Park your current game and start a local Soccer match?')
    ) {
      return
    }
    if (!startNewGame(sport)) return
    navigate('/setup')
  }

  const handleStartGame = async () => {
    if (!team || !sport || !canTrackGames(myRole)) return
    setStartGameError(null)
    setOfferLocalSoccer(false)
    if (!sportAvailable) {
      setStartGameError(
        sportAvailability?.releaseStage === 'unreleased'
          ? `${sport.name} is coming soon.`
          : `Enable ${sport.name} in Settings before starting a game.`
      )
      return
    }
    if (sport.id === 'soccer') {
      if (!user) return
      setStartingGame(true)
      const capability = await ensureSoccerReleaseCapabilities(user.id)
      setStartingGame(false)
      if (capability.status !== 'ready') {
        setStartGameError(capability.error)
        setOfferLocalSoccer(true)
        return
      }
    }
    if (sport.id === 'basketball') {
      const scope = basketballSetupAccountScope(user?.id ?? null)
      const existingDraft = loadBasketballSetupDraft(scope)
      if (
        existingDraft &&
        !basketballSetupDraftMatchesRoute(existingDraft, team.id) &&
        basketballSetupDraftHasMeaningfulEdits(existingDraft) &&
        !window.confirm('Discard the unfinished Basketball setup and start this team game?')
      ) {
        return
      }
      if (existingDraft && !basketballSetupDraftMatchesRoute(existingDraft, team.id)) {
        clearBasketballSetupDraft(scope)
      }
      navigate(gameSetupPath(team.id, sport.id))
      return
    }
    const hasActiveGame = Boolean(gameState.sport && gameState.players.length > 0)
    if (
      hasActiveGame &&
      !window.confirm('Park your current game and start this team game?')
    ) {
      return
    }

    if (!startNewGame(sport)) {
      return
    }
    navigate(gameSetupPath(team.id, sport.id))
  }

  useEffect(() => {
    if (!teamId || !isConfigured || !supabaseClient) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      setTeam(null)
      setRosterPlayers([])
      setGames([])
      setTournaments([])
      setTeamMembers([])
      setTournamentError(null)
      setMembersError(null)
      setStatsTotalsByGameId({})

      const [teamRes, rosterRes, gamesRes, tournamentsRes, membersRes] = await Promise.all([
        supabaseClient
          .from('teams')
          .select('id,name,nickname,season_id,seasons!inner(id,name,sport)')
          .eq('id', teamId)
          .single(),
        supabaseClient
          .from('team_players')
          .select('jersey_number,players!inner(id,first_name,last_name,nickname)')
          .eq('team_id', teamId)
          .eq('is_active', true)
          .order('joined_at', { ascending: true }),
        supabaseClient
          .from('games')
          .select(
            'id,game_date,opponent_name,opponent_score,home_team_score,home_score_adjustment,status,tournament_name,tournament_id'
          )
          .eq('team_id', teamId)
          .order('game_date', { ascending: false }),
        supabaseClient
          .from('tournaments')
          .select('id,name,placement,url')
          .eq('team_id', teamId),
        supabaseClient.rpc('get_team_members_with_profiles', {
          p_team_id: teamId,
        }),
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
      if (gamesRes.error) {
        setError(gamesRes.error.message)
        setLoading(false)
        return
      }

      const loadedTeam = teamRes.data as unknown as TeamRow
      type TeamPlayerJoin = {
        jersey_number: string | null
        players: {
          id: string
          first_name: string
          last_name: string | null
          nickname: string | null
        }
      }
      const loadedGames = (gamesRes.data ?? []) as GameRow[]
      setTeam(loadedTeam)
      setRosterPlayers(((rosterRes.data ?? []) as unknown as TeamPlayerJoin[]).map(row => ({
        id: row.players.id,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        nickname: row.players.nickname,
        jersey_number: row.jersey_number,
      })))
      setGames(loadedGames)
      if (tournamentsRes.error) {
        setTournamentError(tournamentsRes.error.message)
      } else {
        setTournaments((tournamentsRes.data ?? []) as TeamInfoTournament[])
      }
      if (membersRes.error) {
        setMembersError(membersRes.error.message)
      } else {
        const rows = (membersRes.data ?? []) as Array<TeamInfoMember & { team_id?: string }>
        setTeamMembers(rows)
      }

      const totals = await loadLegacyFinalStatsTotals(supabaseClient, loadedGames)
      if (!cancelled && Object.keys(totals).length > 0) {
        setStatsTotalsByGameId(totals)
      }

      if (!cancelled) setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [teamId, isConfigured, supabaseClient])

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <p className="text-sm text-slate-500 mb-4">
            Configure Supabase credentials to view cloud team info.
          </p>
          <button type="button" onClick={() => navigate('/settings/data')} className="btn-primary w-full">
            Back to Settings
          </button>
        </div>
      </div>
    )
  }

  if (!teamId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Missing team</p>
          <p className="text-sm text-slate-500 mb-4">Choose a team before opening Team Info.</p>
          <button type="button" onClick={() => navigate('/teams')} className="btn-primary w-full">
            Teams
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate('/teams')}
            className="text-sm font-semibold text-blue-600"
          >
            Back to Teams
          </button>
          <div className="flex items-center gap-3">
            {team && sport && !loading && canTrackGames(myRole) && (
              <button
                type="button"
                onClick={() => void handleStartGame()}
                disabled={startingGame}
                className="btn-primary py-2 px-3 text-sm disabled:opacity-50"
              >
                {startingGame ? 'Checking...' : 'Start Game'}
              </button>
            )}
            {(startGameError || parkingError) && (
              <div className="max-w-[14rem] text-right">
                <p className="text-xs text-red-600">
                  {startGameError ?? parkingError}
                </p>
                {offerLocalSoccer && (
                  <button
                    type="button"
                    onClick={startLocalSoccerGame}
                    className="mt-1 text-xs font-semibold text-blue-600 underline"
                  >
                    Start Local Match
                  </button>
                )}
              </div>
            )}
            {loading && <span className="text-xs text-slate-400 animate-pulse">Loading...</span>}
          </div>
        </div>

        {error ? (
          <section className="card text-center space-y-3">
            <p className="font-semibold text-slate-700">Team Info unavailable</p>
            <p className="text-sm text-slate-500">{error}</p>
            <button type="button" onClick={() => navigate('/teams')} className="btn-primary w-full">
              Teams
            </button>
          </section>
        ) : team && !loading ? (
          <>
            <TeamHero
              teamName={teamDisplayName(team)}
              legalName={team.name}
              seasonName={team.seasons.name}
              seasonHref={teamSeasonPath(team.season_id, team.id)}
              sportName={sport?.name ?? team.seasons.sport}
              sportIcon={sport?.icon ?? ''}
              record={record}
              rosterCount={rosterPlayers.length}
              gameCount={games.length}
            />

            <SegmentedControl
              label="Team Info sections"
              options={segmentOptions}
              value={activeSegment}
              onChange={setActiveSegment}
            />

            {activeSegment === 'overview' && (
              <TeamOverviewCards
                teamId={team.id}
                seasonId={team.season_id}
                roster={rosterPlayers}
                upcomingGames={upcomingPreviewGames}
                recentResults={recentResults}
                tournaments={tournaments}
                members={teamMembers}
                tournamentError={tournamentError}
                membersError={membersError}
              />
            )}

            {activeSegment === 'roster' && (
              <div className="space-y-4">
                <RosterPreviewCard teamId={team.id} players={rosterPlayers} />
                <TeamMembersCard members={teamMembers} error={membersError} />
              </div>
            )}

            {activeSegment === 'schedule' && (
              <div className="space-y-4">
                <SchedulePreviewCard teamId={team.id} games={upcomingPreviewGames} />
                <RecentResultsCard teamId={team.id} games={recentResults} />
                <TournamentCard
                  teamId={team.id}
                  tournaments={tournaments}
                  error={tournamentError}
                />
              </div>
            )}
          </>
        ) : loading ? (
          <section className="card">
            <p className="text-sm text-slate-500 animate-pulse">Loading Team Info...</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}
