import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sports } from '../config/sports'
import { useGame } from '../context/GameContext'
import { useSettings } from '../context/SettingsContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { teamInfoPath } from '../lib/teamInfo'
import { sportDashboardPath, sportTeamsPath } from '../lib/sportNavigation'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  getSportAvailabilityPolicy,
  isBasketballEventModelCreationAvailable,
} from '../lib/sportAvailability'
import { ensureSoccerReleaseCapabilities } from '../lib/soccer/releaseCapabilities'
import {
  ensureBasketballReleaseCapabilities,
  requiresBasketballEventCloudPreflight,
} from '../lib/basketball/releaseCapabilities'
import {
  hasStartedBasketballEventGame,
  isBasketballEventSetupIntent,
  setBasketballEventCreationIntent,
} from '../lib/basketball'
import {
  basketballSetupAccountScope,
  basketballSetupDraftMatchesRoute,
  buildBasketballSetupGameState,
  clearBasketballSetupDraft,
  createBasketballSetupDraft,
  createBasketballSetupDraftEvent,
  loadBasketballSetupDraft,
  parseBasketballSetupDraft,
  saveBasketballSetupDraft,
  type BasketballSetupDraftV1,
  type BasketballSetupSource,
} from '../lib/basketball/setupDraft'
import {
  DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
  DEFAULT_BASKETBALL_TEAM_SETTINGS,
} from '../lib/basketball/settings'
import {
  getParkedGameStorageInfo,
  parkedGameStorageErrorMessage,
} from '../lib/gameParking'
import {
  acceptedTeamRole,
  canManageTeam,
  canTrackGames,
  parseTeamRole,
  type TeamRole,
} from '../lib/teamPermissions'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface CloudTeam {
  id: string
  owner_id: string
  accessRole: TeamRole
  name: string
  season_id: string
  seasons: {
    id: string
    name: string
    sport: string
    team_stats_config?: unknown
  }
}

interface TournamentOption {
  id: string
  name: string
  url: string | null
}

export default function GameSetup() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedTeamId = searchParams.get('teamId')
  const requestedSportId = searchParams.get('sport')
  const {
    state,
    dispatch,
    activeLocalGameId,
    commitGameSetup,
    startNewGame,
    parkingError,
  } = useGame()
  const { isSportEnabled } = useSettings()
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const accountScope = basketballSetupAccountScope(userId)
  const explicitSport = requestedSportId
    ? sports.find(item => item.id === requestedSportId) ?? null
    : null
  const [resolvedRequestedSport, setResolvedRequestedSport] = useState<typeof state.sport>(null)
  const sport = requestedSportId
    ? explicitSport
    : resolvedRequestedSport ?? state.sport
  const initialBasketballRoute = Boolean(
    requestedSportId === 'basketball' ||
    (!requestedSportId && !requestedTeamId && state.sport?.id === 'basketball')
  )
  const initialBasketballDraft = initialBasketballRoute
    ? loadBasketballSetupDraft(accountScope)
    : null
  const matchingInitialBasketballDraft = initialBasketballDraft &&
    basketballSetupDraftMatchesRoute(initialBasketballDraft, requestedTeamId)
      ? initialBasketballDraft
      : null
  const basketballDraftRef = useRef<BasketballSetupDraftV1 | null>(matchingInitialBasketballDraft)
  const isBasketballSetup = sport?.id === 'basketball'
  const sportHomePath = sport ? sportDashboardPath(sport.id) : '/'
  const isCloudFlow = Boolean(isConfigured && user && supabase)
  const [basketballAuthority, setBasketballAuthority] = useState<'legacy' | 'sport_events'>(
    matchingInitialBasketballDraft?.authority ??
    (initialBasketballRoute && isBasketballEventSetupIntent(state) ? 'sport_events' : 'legacy')
  )
  const [basketballDisplayFlipped, setBasketballDisplayFlipped] = useState(
    matchingInitialBasketballDraft?.display.defaultCourtFlipped ?? false
  )
  const [committedLocalGameId, setCommittedLocalGameId] = useState(
    matchingInitialBasketballDraft?.committedLocalGameId ??
    (!requestedSportId && !requestedTeamId && state.sport?.id === 'basketball' && state.gameInfo
      ? activeLocalGameId
      : null)
  )
  const isBasketballEventIntent = isBasketballSetup
    ? basketballAuthority === 'sport_events'
    : isBasketballEventSetupIntent(state)

  useEffect(() => {
    if (
      !requestedSportId &&
      !requestedTeamId &&
      hasStartedBasketballEventGame(state)
    ) navigate('/game', { replace: true })
  }, [navigate, requestedSportId, requestedTeamId, state])

  const [teamName, setTeamName] = useState(
    matchingInitialBasketballDraft?.source.teamName ??
    (initialBasketballRoute ? '' : state.gameInfo?.teamName || '')
  )
  const [opponentName, setOpponentName] = useState(
    matchingInitialBasketballDraft?.gameInfo.opponentName ??
    (initialBasketballRoute ? '' : state.gameInfo?.opponentName || '')
  )
  const [tournamentName, setTournamentName] = useState(
    matchingInitialBasketballDraft?.gameInfo.tournamentName ??
    (initialBasketballRoute ? '' : state.gameInfo?.tournamentName || '')
  )
  const [date, setDate] = useState(
    matchingInitialBasketballDraft?.gameInfo.date ??
    ((initialBasketballRoute ? '' : state.gameInfo?.date) ||
      new Date().toISOString().split('T')[0])
  )
  const [teamMode, setTeamMode] = useState<'existing' | 'new'>(
    matchingInitialBasketballDraft?.source.kind === 'team' ||
    requestedTeamId || (!initialBasketballRoute && state.cloudSync.teamId)
      ? 'existing'
      : 'new'
  )
  const [teams, setTeams] = useState<CloudTeam[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState(
    requestedTeamId ||
    (matchingInitialBasketballDraft?.source.kind === 'team'
      ? matchingInitialBasketballDraft.source.teamId
      : '') ||
    (!initialBasketballRoute ? state.cloudSync.teamId || '' : '')
  )
  const [seasonFilter, setSeasonFilter] = useState<string>('')
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [teamsError, setTeamsError] = useState<string | null>(null)

  // Tournament state (cloud + existing-team flow only)
  const [tournaments, setTournaments] = useState<TournamentOption[]>([])
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(
    matchingInitialBasketballDraft?.gameInfo.tournamentMode === 'new'
      ? '__new__'
      : matchingInitialBasketballDraft?.gameInfo.tournamentId ??
        (!initialBasketballRoute ? state.gameInfo?.tournamentId ?? '' : '')
  )
  const [newTournamentName, setNewTournamentName] = useState(
    matchingInitialBasketballDraft?.gameInfo.tournamentMode === 'new'
      ? matchingInitialBasketballDraft.gameInfo.tournamentName
      : ''
  )
  const [newTournamentUrl, setNewTournamentUrl] = useState(
    matchingInitialBasketballDraft?.gameInfo.tournamentMode === 'new'
      ? matchingInitialBasketballDraft.gameInfo.tournamentUrl ?? ''
      : ''
  )
  /** Draft URL when an existing tournament is selected (saved on Next if changed). */
  const [existingTournamentUrlDraft, setExistingTournamentUrlDraft] = useState(
    matchingInitialBasketballDraft?.gameInfo.tournamentMode === 'existing'
      ? matchingInitialBasketballDraft.gameInfo.tournamentUrl ?? ''
      : ''
  )
  const [loadingTournaments, setLoadingTournaments] = useState(false)
  const [creatingTournament, setCreatingTournament] = useState(false)
  const [confirmDeleteTournament, setConfirmDeleteTournament] = useState<TournamentOption | null>(null)
  const [deletingTournamentId, setDeletingTournamentId] = useState<string | null>(null)

  /** When creating a new cloud team from setup, optional season to attach (else sync uses year-from-date). */
  const [seasonsForNewTeam, setSeasonsForNewTeam] = useState<
    Array<{ id: string; name: string; team_stats_config?: unknown }>
  >([])
  const [loadingSeasonsForNewTeam, setLoadingSeasonsForNewTeam] = useState(false)
  const [selectedNewTeamSeasonId, setSelectedNewTeamSeasonId] = useState(
    matchingInitialBasketballDraft?.source.kind === 'personal'
      ? matchingInitialBasketballDraft.source.seasonId ?? ''
      : ''
  )
  const [setupError, setSetupError] = useState<string | null>(null)
  const [checkingBasketballCapabilities, setCheckingBasketballCapabilities] = useState(false)
  const [loadingRequestedTeamSport, setLoadingRequestedTeamSport] = useState(false)
  const [requestedTeamSportError, setRequestedTeamSportError] = useState<string | null>(null)
  const [requestedLocalFallbackSportId, setRequestedLocalFallbackSportId] = useState<string | null>(null)

  useEffect(() => {
    if (!requestedTeamId || !isCloudFlow || !supabase) return

    const client = supabase
    let cancelled = false
    const loadRequestedTeamSport = async () => {
      setLoadingRequestedTeamSport(true)
      setRequestedTeamSportError(null)
      setRequestedLocalFallbackSportId(null)
      const [{ data, error }, { data: roleData, error: roleError }] = await Promise.all([
        client
          .from('teams')
          .select('id,seasons!inner(sport)')
          .eq('id', requestedTeamId)
          .single(),
        client.rpc('current_team_role', { p_team_id: requestedTeamId }),
      ])

      if (cancelled) return
      if (error || !data) {
        setRequestedTeamSportError(error?.message ?? 'Team not found')
        setLoadingRequestedTeamSport(false)
        return
      }
      const requestedRole = roleError ? null : parseTeamRole(roleData)
      if (!canTrackGames(requestedRole)) {
        setRequestedTeamSportError('Viewer access is read-only. A scorer, admin, or owner can start team games.')
        setLoadingRequestedTeamSport(false)
        return
      }

      const row = data as unknown as { seasons: { sport: string } }
      const requestedSport = sports.find(item => item.id === row.seasons.sport)
      if (!requestedSport) {
        setRequestedTeamSportError('This team uses a sport that is not available.')
        setLoadingRequestedTeamSport(false)
        return
      }
      setResolvedRequestedSport(requestedSport)
      if (requestedSportId && requestedSport.id !== requestedSportId) {
        setRequestedTeamSportError('This team does not match the requested sport.')
        setLoadingRequestedTeamSport(false)
        return
      }
      const availability = getSportAvailabilityPolicy(
        requestedSport.id,
        isSportEnabled(requestedSport.id)
      )
      if (!availability.canStartNewGame) {
        setRequestedTeamSportError(
          availability.releaseStage === 'unreleased'
            ? `${requestedSport.name} is coming soon.`
            : `Enable ${requestedSport.name} in Settings before starting a game.`
        )
        setLoadingRequestedTeamSport(false)
        return
      }
      if (requestedSport.id === 'soccer') {
        if (!userId) {
          setRequestedTeamSportError('Sign in before starting a cloud Soccer match.')
          setLoadingRequestedTeamSport(false)
          return
        }
        const capability = await ensureSoccerReleaseCapabilities(userId)
        if (cancelled) return
        if (capability.status !== 'ready') {
          setRequestedTeamSportError(capability.error)
          setRequestedLocalFallbackSportId(requestedSport.id)
          setLoadingRequestedTeamSport(false)
          return
        }
      }
      if (requestedSport.id === 'basketball') {
        setLoadingRequestedTeamSport(false)
        return
      }

      const hasActiveGame = Boolean(state.sport && state.players.length > 0)
      const sportMismatch = sport?.id !== requestedSport.id
      // Same-sport deep links to a *different* cloud team must also reset — otherwise
      // handleNext can re-home the prior gameId/roster onto the requested team.
      const teamMismatch = Boolean(
        requestedTeamId &&
          state.cloudSync.teamId &&
          requestedTeamId !== state.cloudSync.teamId
      )
      if (sportMismatch || (teamMismatch && hasActiveGame)) {
        if (
          hasActiveGame &&
          !window.confirm('Park your current game and start this team game?')
        ) {
          navigate(sportDashboardPath(requestedSport.id))
          return
        }

        if (!startNewGame(requestedSport)) {
          setLoadingRequestedTeamSport(false)
          return
        }
      }
      setLoadingRequestedTeamSport(false)
    }

    void loadRequestedTeamSport()
    return () => {
      cancelled = true
    }
    // Re-run on sport/team/roster identity only — not every local stat tick.
  }, [dispatch, isCloudFlow, isSportEnabled, navigate, requestedSportId, requestedTeamId, sport?.id, startNewGame, state.cloudSync.teamId, state.players.length, state.sport, userId])

  useEffect(() => {
    if (!sport || !isCloudFlow || !userId) return

    let isCancelled = false
    const loadTeams = async () => {
      setLoadingTeams(true)
      setTeamsError(null)
      const [{ data, error }, { data: memberships, error: membershipError }] =
        await Promise.all([
          supabase!
            .from('teams')
            .select('id,owner_id,name,season_id,seasons!inner(id,name,sport,team_stats_config)')
            .eq('seasons.sport', sport.id)
            .order('created_at', { ascending: false }),
          supabase!
            .from('team_members')
            .select('team_id,role,accepted_at')
            .eq('user_id', userId)
            .not('accepted_at', 'is', null),
        ])

      if (isCancelled) return
      if (error || membershipError) {
        setTeamsError(error?.message ?? membershipError?.message ?? 'Unable to load team access.')
        setLoadingTeams(false)
        return
      }

      const roleByTeamId = new Map<string, TeamRole>()
      for (const row of (memberships ?? []) as Array<{
        team_id: string
        role: string
        accepted_at: string | null
      }>) {
        const role = acceptedTeamRole(row.role, row.accepted_at)
        if (role) roleByTeamId.set(row.team_id, role)
      }
      type LoadedCloudTeam = Omit<CloudTeam, 'accessRole'>
      const loadedTeams = ((data ?? []) as unknown as LoadedCloudTeam[]).flatMap(team => {
        const accessRole = team.owner_id === userId ? 'owner' : roleByTeamId.get(team.id) ?? null
        return accessRole && canTrackGames(accessRole) ? [{ ...team, accessRole }] : []
      })
      setTeams(loadedTeams)

      const requestedTeam = requestedTeamId
        ? loadedTeams.find(team => team.id === requestedTeamId)
        : null
      if (requestedTeamId && !requestedTeam) {
        setTeamMode('existing')
        setSelectedTeamId('')
        setTeamName('')
        setSeasonFilter('')
        setTeamsError('That team is unavailable for tracking. Viewer access is read-only.')
        setLoadingTeams(false)
        return
      }
      if (loadedTeams.length === 0) {
        setTeamMode('new')
        setSelectedTeamId('')
        setLoadingTeams(false)
        return
      }

      const restoredPersonalDraft = isBasketballSetup &&
        basketballDraftRef.current?.source.kind === 'personal'
          ? basketballDraftRef.current
          : null
      if (restoredPersonalDraft && !requestedTeamId) {
        setTeamMode('new')
        setSelectedTeamId('')
        setTeamName(restoredPersonalDraft.source.teamName)
        setSelectedNewTeamSeasonId(restoredPersonalDraft.source.seasonId ?? '')
        setLoadingTeams(false)
        return
      }

      const matchedById = state.cloudSync.teamId
        ? loadedTeams.find(team => team.id === state.cloudSync.teamId)
        : null
      const matchedByName = state.gameInfo?.teamName
        ? loadedTeams.find(team => team.name === state.gameInfo?.teamName)
        : null
      const preferredTeam = requestedTeam || matchedById || matchedByName || loadedTeams[0]

      setTeamMode('existing')
      setSelectedTeamId(preferredTeam.id)
      setTeamName(preferredTeam.name)
      if (requestedTeam) setSeasonFilter(preferredTeam.season_id)
      setLoadingTeams(false)
    }

    void loadTeams()
    return () => {
      isCancelled = true
    }
  }, [isBasketballEventIntent, isBasketballSetup, isCloudFlow, requestedTeamId, sport, state.cloudSync.teamId, state.gameInfo?.teamName, userId])

  useEffect(() => {
    if (!isCloudFlow || !userId || !sport || !supabase) return
    const client = supabase
    let cancelled = false
    const load = async () => {
      setLoadingSeasonsForNewTeam(true)
      const { data, error } = await client
        .from('seasons')
        .select('id,name,team_stats_config')
        .eq('owner_id', userId)
        .eq('sport', sport.id)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (!error) {
        setSeasonsForNewTeam(
          (data ?? []) as Array<{ id: string; name: string; team_stats_config?: unknown }>
        )
      }
      setLoadingSeasonsForNewTeam(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isCloudFlow, userId, sport])

  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId]
  )
  const mayManageSelectedTeam = canManageTeam(selectedTeam?.accessRole ?? null)
  const selectedNewTeamSeasonRow = useMemo(
    () => seasonsForNewTeam.find(s => s.id === selectedNewTeamSeasonId) ?? null,
    [seasonsForNewTeam, selectedNewTeamSeasonId]
  )

  const restoredBasketballDraftRef = useRef(Boolean(matchingInitialBasketballDraft))

  useEffect(() => {
    if (!isBasketballSetup || restoredBasketballDraftRef.current) return
    if (requestedTeamId && !selectedTeam) return
    const restored = loadBasketballSetupDraft(accountScope)
    if (!restored || !basketballSetupDraftMatchesRoute(restored, requestedTeamId)) {
      restoredBasketballDraftRef.current = true
      return
    }
    basketballDraftRef.current = restored
    restoredBasketballDraftRef.current = true
    setBasketballAuthority(restored.authority)
    setBasketballDisplayFlipped(restored.display.defaultCourtFlipped)
    setCommittedLocalGameId(restored.committedLocalGameId)
    setTeamName(restored.source.teamName)
    setOpponentName(restored.gameInfo.opponentName)
    setTournamentName(restored.gameInfo.tournamentName)
    setDate(restored.gameInfo.date)
    setTeamMode(restored.source.kind === 'team' ? 'existing' : 'new')
    setSelectedTeamId(restored.source.kind === 'team' ? restored.source.teamId : '')
    setSelectedNewTeamSeasonId(
      restored.source.kind === 'personal' ? restored.source.seasonId ?? '' : ''
    )
    setSelectedTournamentId(
      restored.gameInfo.tournamentMode === 'new'
        ? '__new__'
        : restored.gameInfo.tournamentId ?? ''
    )
    setNewTournamentName(
      restored.gameInfo.tournamentMode === 'new' ? restored.gameInfo.tournamentName : ''
    )
    setNewTournamentUrl(
      restored.gameInfo.tournamentMode === 'new' ? restored.gameInfo.tournamentUrl ?? '' : ''
    )
    setExistingTournamentUrlDraft(
      restored.gameInfo.tournamentMode === 'existing'
        ? restored.gameInfo.tournamentUrl ?? ''
        : ''
    )
  }, [accountScope, isBasketballSetup, requestedTeamId, selectedTeam])

  // Push raw `seasons.team_stats_config` into game state for resolveTeamStatsConfig (e.g. GameTracker).
  useEffect(() => {
    if (isBasketballSetup) return
    if (!isCloudFlow) {
      dispatch({ type: 'SET_TEAM_STATS_CONFIG', config: null })
      return
    }
    let raw: unknown = null
    if (teamMode === 'existing' && selectedTeam?.seasons) {
      raw = selectedTeam.seasons.team_stats_config
    } else if (teamMode === 'new' && selectedNewTeamSeasonId) {
      raw = selectedNewTeamSeasonRow?.team_stats_config
    }
    const next =
      raw != null && isRecord(raw) && Object.keys(raw).length > 0 ? raw : null
    dispatch({ type: 'SET_TEAM_STATS_CONFIG', config: next })
  }, [
    dispatch,
    isCloudFlow,
    teamMode,
    selectedTeam,
    selectedNewTeamSeasonId,
    selectedNewTeamSeasonRow,
    isBasketballSetup,
  ])

  // Stable snapshot of the current tournament selection (avoids effect dep on full gameInfo object)
  const existingTournamentId = isBasketballSetup
    ? basketballDraftRef.current?.gameInfo.tournamentId ?? null
    : state.gameInfo?.tournamentId ?? null

  // Load tournaments for the currently selected cloud team
  useEffect(() => {
    if (!isCloudFlow || teamMode !== 'existing' || !selectedTeamId || !supabase) {
      setTournaments([])
      return
    }

    let cancelled = false
    const loadTournaments = async () => {
      setLoadingTournaments(true)
      const { data, error } = await supabase!
        .from('tournaments')
        .select('id,name,url')
        .eq('team_id', selectedTeamId)
        .order('name', { ascending: true })

      if (cancelled) return
      if (!error) {
        const loaded = (data ?? []) as TournamentOption[]
        setTournaments(loaded)
        // Restore prior selection if the tournament still exists for this team
        if (existingTournamentId && loaded.some(t => t.id === existingTournamentId)) {
          setSelectedTournamentId(existingTournamentId)
        }
      }
      setLoadingTournaments(false)
    }

    void loadTournaments()
    return () => { cancelled = true }
  }, [isCloudFlow, teamMode, selectedTeamId, existingTournamentId])

  // Keep URL draft in sync when user picks a different existing tournament
  useEffect(() => {
    if (selectedTournamentId === '' || selectedTournamentId === '__new__') {
      setExistingTournamentUrlDraft('')
      return
    }
    const t = tournaments.find(x => x.id === selectedTournamentId)
    const restoredUrl = isBasketballSetup &&
      basketballDraftRef.current?.gameInfo.tournamentId === selectedTournamentId
        ? basketballDraftRef.current.gameInfo.tournamentUrl
        : null
    setExistingTournamentUrlDraft(
      restoredUrl?.trim() ? restoredUrl : t?.url?.trim() ? t.url : ''
    )
  }, [isBasketballSetup, selectedTournamentId, tournaments])

  const currentBasketballDraft = useMemo((): BasketballSetupDraftV1 | null => {
    if (!isBasketballSetup) return null
    let source: BasketballSetupSource
    if (teamMode === 'existing') {
      if (!selectedTeam ||
          (selectedTeam.accessRole !== 'owner' &&
           selectedTeam.accessRole !== 'admin' &&
           selectedTeam.accessRole !== 'scorer')) return null
      source = {
        kind: 'team',
        teamId: selectedTeam.id,
        seasonId: selectedTeam.season_id,
        teamName: selectedTeam.name,
        seasonName: selectedTeam.seasons.name,
        accessRole: selectedTeam.accessRole,
      }
    } else {
      source = {
        kind: 'personal',
        teamName,
        seasonId: selectedNewTeamSeasonId || null,
        seasonName: selectedNewTeamSeasonRow?.name ?? '',
      }
    }

    const previous = basketballDraftRef.current
    const base = previous &&
      previous.accountScope === accountScope &&
      basketballSetupDraftMatchesRoute(previous, requestedTeamId)
      ? previous
      : createBasketballSetupDraft({ accountScope, source })
    const tournamentMode = teamMode === 'existing'
      ? selectedTournamentId === '__new__'
        ? 'new'
        : selectedTournamentId
          ? 'existing'
          : 'none'
      : tournamentName.trim()
        ? 'text'
        : 'none'
    const selectedTournament = tournaments.find(item => item.id === selectedTournamentId)
    const tournamentDraftName = tournamentMode === 'new'
      ? newTournamentName
      : tournamentMode === 'existing'
        ? selectedTournament?.name ?? base.gameInfo.tournamentName
        : tournamentName
    const tournamentUrl = tournamentMode === 'new'
      ? newTournamentUrl.trim() || null
      : tournamentMode === 'existing'
        ? existingTournamentUrlDraft.trim() || null
        : null
    const rawTeamStatsConfig = teamMode === 'existing'
      ? selectedTeam?.seasons.team_stats_config
      : selectedNewTeamSeasonRow?.team_stats_config
    const legacyTeamStatsConfig = rawTeamStatsConfig != null &&
      isRecord(rawTeamStatsConfig) &&
      Object.keys(rawTeamStatsConfig).length > 0
        ? structuredClone(rawTeamStatsConfig)
        : null

    let event: BasketballSetupDraftV1['event'] = null
    if (basketballAuthority === 'sport_events') {
      const existingEvent = previous?.event
      const existingMatchesSource = existingEvent?.settingsAuthority.kind === source.kind &&
        (source.kind !== 'team' || previous?.source.kind !== 'team' ||
          previous.source.teamId === source.teamId)
      event = existingMatchesSource
        ? structuredClone(existingEvent)
        : createBasketballSetupDraftEvent({
            authority: source.kind,
            revision: null,
            settings: source.kind === 'team'
              ? DEFAULT_BASKETBALL_TEAM_SETTINGS
              : DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
            cloudIntent: source.kind === 'team' ? 'automatic' : 'local_only',
          })
      if (!event) return null
    }

    const next: BasketballSetupDraftV1 = {
      ...base,
      accountScope,
      updatedAt: new Date().toISOString(),
      source,
      authority: basketballAuthority,
      gameInfo: {
        opponentName,
        tournamentMode,
        tournamentId: tournamentMode === 'existing' ? selectedTournamentId : null,
        tournamentName: tournamentDraftName,
        tournamentUrl,
        date,
      },
      display: { defaultCourtFlipped: basketballDisplayFlipped },
      event,
      legacyTeamStatsConfig,
      committedLocalGameId,
    }
    const parsed = parseBasketballSetupDraft(next, accountScope)
    return parsed.ok ? parsed.value : null
  }, [
    accountScope,
    basketballAuthority,
    basketballDisplayFlipped,
    committedLocalGameId,
    date,
    existingTournamentUrlDraft,
    isBasketballSetup,
    newTournamentName,
    newTournamentUrl,
    opponentName,
    requestedTeamId,
    selectedNewTeamSeasonId,
    selectedNewTeamSeasonRow,
    selectedTeam,
    selectedTournamentId,
    teamMode,
    teamName,
    tournamentName,
    tournaments,
  ])

  useEffect(() => {
    if (!currentBasketballDraft) return
    basketballDraftRef.current = currentBasketballDraft
    const saved = saveBasketballSetupDraft(currentBasketballDraft)
    if (!saved.ok) setSetupError(saved.error)
  }, [currentBasketballDraft])

  const handleDeleteTournament = async (tournament: TournamentOption) => {
    if (!supabase || !mayManageSelectedTeam) return
    setDeletingTournamentId(tournament.id)
    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', tournament.id)
    setDeletingTournamentId(null)
    if (error) return
    setTournaments(prev => prev.filter(t => t.id !== tournament.id))
    if (selectedTournamentId === tournament.id) {
      setSelectedTournamentId('')
    }
  }

  const availableSeasons = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of teams) {
      if (t.seasons && !map.has(t.seasons.id)) {
        map.set(t.seasons.id, t.seasons.name)
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [teams])
  const filteredTeams = useMemo(
    () => seasonFilter ? teams.filter(t => t.season_id === seasonFilter) : teams,
    [teams, seasonFilter]
  )
  const resolvedTeamName = teamMode === 'existing'
    ? selectedTeam?.name ?? ''
    : teamName.trim()
  const canProceed = Boolean(resolvedTeamName && opponentName.trim())
  const requestedTeamUnavailable = Boolean(
    requestedTeamId && !loadingTeams && !selectedTeam
  )
  const showBasketballEventToggle = Boolean(
    isBasketballEventModelCreationAvailable() &&
      sport?.id === 'basketball' &&
      (isBasketballSetup || isBasketballEventIntent || !state.gameInfo)
  )

  const updateBasketballEventIntent = (enabled: boolean): boolean => {
    if (isBasketballSetup) {
      setBasketballAuthority(enabled ? 'sport_events' : 'legacy')
      if (enabled) setSelectedNewTeamSeasonId('')
      setSetupError(null)
      return true
    }
    const result = setBasketballEventCreationIntent(state, enabled)
    if (!result.ok) {
      setSetupError(result.message)
      return false
    }
    if (enabled) setSelectedNewTeamSeasonId('')
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    setSetupError(null)
    return true
  }

  const updateTeamMode = (nextMode: 'existing' | 'new') => {
    setTeamMode(nextMode)
  }

  const startRequestedTeamLocally = () => {
    const requestedSport = sports.find(item => item.id === requestedLocalFallbackSportId)
    if (!requestedSport) return
    const hasActiveGame = Boolean(state.sport && state.players.length > 0)
    if (
      hasActiveGame &&
      !window.confirm(`Park your current game and start a local ${requestedSport.name} match?`)
    ) {
      return
    }
    if (!startNewGame(requestedSport)) return
    setRequestedLocalFallbackSportId(null)
    navigate('/setup', { replace: true })
  }

  if (!sport) {
    if (requestedTeamId && isCloudFlow) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center px-4">
          <div className="card max-w-md w-full text-center space-y-3">
            <p className="font-semibold text-slate-700">Loading team setup</p>
            <p className="text-sm text-slate-500">
              {loadingRequestedTeamSport
                ? 'Finding this team sport...'
                : parkingError ?? requestedTeamSportError ?? 'Preparing game setup...'}
            </p>
            {requestedTeamSportError && (
              <div className="space-y-2">
                {requestedLocalFallbackSportId && (
                  <button
                    type="button"
                    onClick={startRequestedTeamLocally}
                    className="btn-primary w-full"
                  >
                    Start Local Match
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate('/teams')}
                  className="btn-secondary w-full"
                >
                  Back to Cloud Teams
                </button>
              </div>
            )}
          </div>
        </div>
      )
    }
    navigate('/')
    return null
  }

  const handleNext = async () => {
    if (!canProceed) return
    if (isCloudFlow && teamMode === 'existing' && !canTrackGames(selectedTeam?.accessRole ?? null)) {
      setSetupError('Viewer access is read-only. Choose a team you can track.')
      return
    }
    setSetupError(null)

    const basketballDraft = isBasketballSetup ? currentBasketballDraft : null
    const matchingCommittedBasketballSetup = Boolean(
      basketballDraft?.committedLocalGameId &&
      basketballDraft.committedLocalGameId === activeLocalGameId
    )

    if (isBasketballSetup) {
      if (!basketballDraft) {
        setSetupError('Basketball setup is still loading or contains invalid fields.')
        return
      }
      const validation = buildBasketballSetupGameState({
        draft: basketballDraft,
        sport,
        cloudStatus: state.cloudSync.status === 'offline' ? 'offline' : 'idle',
      })
      if (!validation.ok) {
        setSetupError(validation.error)
        return
      }
    }

    if (requiresBasketballEventCloudPreflight({
      eventIntent: isBasketballEventIntent,
      cloudAvailable: isCloudFlow,
      teamMode,
      selectedTeamId,
    })) {
      if (!userId) {
        setSetupError('Sign in before starting a Basketball event cloud game.')
        return
      }
      setCheckingBasketballCapabilities(true)
      const capability = await ensureBasketballReleaseCapabilities(userId)
      setCheckingBasketballCapabilities(false)
      if (capability.status !== 'ready') {
        setSetupError(capability.error)
        return
      }
    }

    const hasActiveGame = Boolean(state.sport && state.players.length > 0)

    if (isBasketballSetup && !matchingCommittedBasketballSetup) {
      let capacity: ReturnType<typeof getParkedGameStorageInfo>
      try {
        capacity = getParkedGameStorageInfo(userId)
      } catch (error) {
        setSetupError(parkedGameStorageErrorMessage(error))
        return
      }
      if (!capacity.canCreateParkedGame) {
        setSetupError(
          `This device can park up to ${capacity.maxParkedGames} games. ` +
          'Resume, export, or discard one before starting another.'
        )
        return
      }
      if (
        hasActiveGame &&
        !window.confirm('Park your current game and continue with this Basketball setup?')
      ) {
        return
      }
    }

    const nextTeamId = teamMode === 'existing' ? selectedTeamId || null : null
    const teamIdChanging = nextTeamId !== state.cloudSync.teamId
    // Switching cloud teams must not keep the prior gameId/roster (same-name teams
    // previously slipped past SET_GAME_INFO's teamName-only clear).
    if (!isBasketballSetup && teamIdChanging && (hasActiveGame || state.cloudSync.gameId)) {
      if (
        hasActiveGame &&
        !window.confirm('Park your current game and switch teams?')
      ) {
        return
      }
      if (!startNewGame(sport)) {
        return
      }
    }

    // Resolve tournament: existing selection, create new, or free-text
    let resolvedTournamentId: string | null = null
    let resolvedTournamentName = tournamentName.trim()
    let insertedTournamentId: string | null = null
    let updatedTournamentUrl: { id: string; previousUrl: string | null } | null = null

    if (isCloudFlow && teamMode === 'existing' && selectedTeamId) {
      if (selectedTournamentId === '__new__') {
        const trimmed = newTournamentName.trim()
        if (!trimmed) {
          setSetupError('Enter a tournament name or choose another option.')
          return
        }
        if (supabase) {
          setCreatingTournament(true)
          const urlTrimmed = newTournamentUrl.trim()
          let data: { id: string } | null = null
          let error: { message: string } | null = null
          if (isBasketballSetup) {
            const existing = await supabase
              .from('tournaments')
              .select('id')
              .eq('team_id', selectedTeamId)
              .eq('name', trimmed)
              .maybeSingle()
            if (existing.error) {
              error = existing.error
            } else if (existing.data) {
              data = existing.data as { id: string }
            } else {
              const inserted = await supabase
                .from('tournaments')
                .insert({
                  team_id: selectedTeamId,
                  name: trimmed,
                  url: urlTrimmed === '' ? null : urlTrimmed,
                })
                .select('id')
                .single()
              if (inserted.error) {
                const raced = await supabase
                  .from('tournaments')
                  .select('id')
                  .eq('team_id', selectedTeamId)
                  .eq('name', trimmed)
                  .maybeSingle()
                if (raced.error || !raced.data) error = inserted.error
                else data = raced.data as { id: string }
              } else if (inserted.data) {
                data = inserted.data as { id: string }
                insertedTournamentId = data.id
              }
            }
          } else {
            const upserted = await supabase
              .from('tournaments')
              .upsert(
                {
                  team_id: selectedTeamId,
                  name: trimmed,
                  url: urlTrimmed === '' ? null : urlTrimmed,
                },
                { onConflict: 'team_id,name' }
              )
              .select('id')
              .single()
            data = upserted.data as { id: string } | null
            error = upserted.error
          }
          setCreatingTournament(false)
          if (error) {
            setSetupError(error.message)
            return
          }
          if (data) {
            resolvedTournamentId = data.id
            resolvedTournamentName = trimmed
          }
        }
      } else if (selectedTournamentId) {
        const found = tournaments.find(t => t.id === selectedTournamentId)
        resolvedTournamentId = selectedTournamentId
        resolvedTournamentName = found?.name ?? ''
        if (supabase) {
          const canonical = (found?.url ?? '').trim()
          const draft = existingTournamentUrlDraft.trim()
          if (mayManageSelectedTeam && draft !== canonical) {
            setCreatingTournament(true)
            const { error: urlErr } = await supabase
              .from('tournaments')
              .update({ url: draft === '' ? null : draft })
              .eq('id', selectedTournamentId)
            setCreatingTournament(false)
            if (urlErr) {
              setSetupError(urlErr.message)
              return
            }
            if (isBasketballSetup) {
              updatedTournamentUrl = {
                id: selectedTournamentId,
                previousUrl: found?.url ?? null,
              }
            }
            setTournaments(prev =>
              prev.map(row =>
                row.id === selectedTournamentId ? { ...row, url: draft === '' ? null : draft } : row
              )
            )
          }
        }
      }
      // selectedTournamentId === '' means no tournament — both stay null/empty
    }

    const resolvedSeasonIdForSync =
      teamMode === 'existing' && selectedTeam
        ? selectedTeam.season_id
        : teamMode === 'new' && selectedNewTeamSeasonId
          ? selectedNewTeamSeasonId
          : null

    if (isBasketballSetup && basketballDraft) {
      const resolvedDraft: BasketballSetupDraftV1 = {
        ...basketballDraft,
        updatedAt: new Date().toISOString(),
        gameInfo: {
          ...basketballDraft.gameInfo,
          tournamentMode: resolvedTournamentId
            ? 'existing'
            : resolvedTournamentName
              ? 'text'
              : 'none',
          tournamentId: resolvedTournamentId,
          tournamentName: resolvedTournamentName,
        },
      }
      const built = buildBasketballSetupGameState({
        draft: resolvedDraft,
        sport,
        cloudStatus: state.cloudSync.status === 'offline' ? 'offline' : 'idle',
      })
      if (!built.ok) {
        const compensationError = await compensateBasketballTournamentChange(
          insertedTournamentId,
          updatedTournamentUrl
        )
        setSetupError(
          compensationError ? `${built.error} ${compensationError}` : built.error
        )
        return
      }
      const committed = commitGameSetup(
        built.state,
        matchingCommittedBasketballSetup ? committedLocalGameId : null
      )
      if (!committed.ok) {
        const compensationError = await compensateBasketballTournamentChange(
          insertedTournamentId,
          updatedTournamentUrl
        )
        setSetupError(
          compensationError ? `${committed.reason} ${compensationError}` : committed.reason
        )
        return
      }
      const committedDraft = {
        ...resolvedDraft,
        committedLocalGameId: committed.localGameId,
        updatedAt: new Date().toISOString(),
      }
      basketballDraftRef.current = committedDraft
      setCommittedLocalGameId(committed.localGameId)
      const saved = saveBasketballSetupDraft(committedDraft)
      if (!saved.ok) {
        setSetupError(saved.error)
        return
      }
      navigate('/players')
      return
    }

    // Only update season/team here. Preserve gameId/playerIdMap/fingerprint when the user
    // returns from player setup for the same game; SET_GAME_INFO clears them on team change.
    dispatch({
      type: 'SET_CLOUD_SYNC_STATE',
      cloudSync: {
        seasonId: resolvedSeasonIdForSync,
        teamId: teamMode === 'existing' ? selectedTeamId || null : null,
      },
    })
    dispatch({
      type: 'SET_GAME_INFO',
      gameInfo: {
        teamName: resolvedTeamName,
        opponentName: opponentName.trim(),
        tournamentName: resolvedTournamentName,
        tournamentId: resolvedTournamentId,
        date,
      },
    })
    navigate('/players')
  }

  async function compensateBasketballTournamentChange(
    insertedId: string | null,
    updatedUrl: { id: string; previousUrl: string | null } | null
  ): Promise<string | null> {
    if (!supabase) return null
    const failures: string[] = []
    if (insertedId) {
      const { error } = await supabase.from('tournaments').delete().eq('id', insertedId)
      if (error) failures.push('The newly created tournament could not be rolled back.')
    }
    if (updatedUrl) {
      const { error } = await supabase
        .from('tournaments')
        .update({ url: updatedUrl.previousUrl })
        .eq('id', updatedUrl.id)
      if (error) failures.push('The prior tournament URL could not be restored.')
    }
    return failures.length > 0 ? failures.join(' ') : null
  }

  const handleCancelSetup = () => {
    if (!isBasketballSetup) {
      navigate(sportHomePath)
      return
    }
    const source = basketballDraftRef.current?.source
    clearBasketballSetupDraft(accountScope)
    navigate(source?.kind === 'team' ? teamInfoPath(source.teamId) : sportHomePath)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-4`}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={handleCancelSetup}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">{sport.icon} {sport.name}</h1>
            <p className="text-sm opacity-80">Game Setup</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <div className="space-y-4">
          {isCloudFlow ? (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">Team Source</p>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      requestedTeamId && selectedTeam
                        ? teamInfoPath(selectedTeam.id)
                        : sportTeamsPath(sport.id)
                    )
                  }
                  className="text-xs text-blue-600 font-medium underline"
                >
                  {requestedTeamId && selectedTeam ? 'Back to Team' : 'Manage Teams'}
                </button>
              </div>

              {teamsError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                  {teamsError}
                </p>
              )}
              {(setupError || parkingError) && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                  {setupError ?? parkingError}
                </p>
              )}

              {teams.length > 0 && (
                <div className="flex rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => updateTeamMode('existing')}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      teamMode === 'existing' ? 'bg-white shadow text-slate-800' : 'text-slate-500'
                    }`}
                  >
                    Existing Team
                  </button>
                  <button
                    type="button"
                    onClick={() => updateTeamMode('new')}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      teamMode === 'new' ? 'bg-white shadow text-slate-800' : 'text-slate-500'
                    }`}
                  >
                    {isBasketballEventIntent ? 'Local Team' : 'New Team'}
                  </button>
                </div>
              )}

              {loadingTeams ? (
                <p className="text-sm text-slate-500 animate-pulse">Loading teams...</p>
              ) : requestedTeamUnavailable ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-semibold text-amber-900">Team unavailable</p>
                  <p className="text-xs text-amber-800 mt-1">
                    Choose another team from Cloud Teams before starting this game.
                  </p>
                </div>
              ) : teamMode === 'existing' && teams.length > 0 ? (
                <div className="space-y-2">
                  {availableSeasons.length > 1 && (
                    <>
                      <label className="block text-sm font-medium text-slate-600 mb-1">
                        Season
                      </label>
                      <select
                        value={seasonFilter}
                        onChange={e => {
                          const nextFilter = e.target.value
                          setSeasonFilter(nextFilter)
                          const filtered = nextFilter ? teams.filter(t => t.season_id === nextFilter) : teams
                          if (filtered.length > 0 && !filtered.some(t => t.id === selectedTeamId)) {
                            setSelectedTeamId(filtered[0].id)
                            setTeamName(filtered[0].name)
                          }
                        }}
                        className="input-field"
                      >
                        <option value="">All seasons</option>
                        {availableSeasons.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </>
                  )}
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Select Team *
                  </label>
                  <select
                    value={selectedTeamId}
                    onChange={e => {
                      const nextTeamId = e.target.value
                      setSelectedTeamId(nextTeamId)
                      const team = teams.find(item => item.id === nextTeamId)
                      if (team) setTeamName(team.name)
                    }}
                    className="input-field"
                  >
                    {filteredTeams.map(team => (
                      <option key={team.id} value={team.id}>
                        {team.name}{team.seasons?.name ? ` (${team.seasons.name})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Your Team Name *
                  </label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={e => setTeamName(e.target.value)}
                    placeholder="e.g., Eagles"
                    className="input-field"
                    autoFocus
                  />
                  {!isBasketballEventIntent && loadingSeasonsForNewTeam ? (
                    <p className="text-xs text-slate-400 animate-pulse">Loading seasons...</p>
                  ) : !isBasketballEventIntent && seasonsForNewTeam.length > 0 ? (
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">
                        Season for new team
                      </label>
                      <select
                        value={selectedNewTeamSeasonId}
                        onChange={e => setSelectedNewTeamSeasonId(e.target.value)}
                        className="input-field"
                      >
                        <option value="">Auto (use year from game date)</option>
                        {seasonsForNewTeam.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 mt-1">
                        Pick an existing season to match Teams you already created, or leave on Auto.
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Your Team Name *
              </label>
              <input
                type="text"
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                placeholder="e.g., Eagles"
                className="input-field"
                autoFocus
              />
            </div>
          )}

          {showBasketballEventToggle && (
            <label className="flex items-start justify-between gap-4 border-y border-amber-200 bg-amber-50 px-3 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-amber-950">Event Model</span>
                <span className="block text-xs text-amber-800">
                  Internal Basketball event tracking preview
                </span>
              </span>
              <input
                type="checkbox"
                checked={isBasketballEventIntent}
                disabled={loadingTeams}
                onChange={event => updateBasketballEventIntent(event.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
              />
            </label>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Opponent *
            </label>
            <input
              type="text"
              value={opponentName}
              onChange={e => setOpponentName(e.target.value)}
              placeholder="e.g., Tigers"
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Tournament / League
            </label>
            {isCloudFlow && teamMode === 'existing' && selectedTeamId ? (
              <div className="space-y-2">
                {loadingTournaments ? (
                  <p className="text-xs text-slate-400 animate-pulse">Loading tournaments...</p>
                ) : (
                  <>
                    <select
                      value={selectedTournamentId}
                      onChange={e => {
                        setSelectedTournamentId(e.target.value)
                        if (e.target.value !== '__new__') {
                          setNewTournamentName('')
                          setNewTournamentUrl('')
                        }
                      }}
                      className="input-field"
                    >
                      <option value="">No tournament</option>
                      {tournaments.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                      <option value="__new__">+ Add new tournament…</option>
                    </select>
                    {selectedTournamentId && selectedTournamentId !== '__new__' && (
                      <>
                        <div>
                          <label
                            htmlFor="existing-tournament-url"
                            className="block text-xs font-medium text-slate-500 mb-1"
                          >
                            Tournament URL (optional)
                          </label>
                          <input
                            id="existing-tournament-url"
                            type="url"
                            inputMode="url"
                            value={existingTournamentUrlDraft}
                            onChange={e => setExistingTournamentUrlDraft(e.target.value)}
                            placeholder="https://…"
                            className="input-field"
                            autoComplete="off"
                            disabled={!mayManageSelectedTeam}
                          />
                          {mayManageSelectedTeam && (
                            <p className="text-xs text-slate-400 mt-1">
                              Saved when you continue to add players.
                            </p>
                          )}
                        </div>
                        {mayManageSelectedTeam && (
                          <button
                            type="button"
                            onClick={() => {
                              const t = tournaments.find(item => item.id === selectedTournamentId)
                              if (t) setConfirmDeleteTournament(t)
                            }}
                            disabled={deletingTournamentId === selectedTournamentId}
                            className="text-xs text-red-600 underline disabled:opacity-40"
                          >
                            {deletingTournamentId === selectedTournamentId ? 'Deleting...' : 'Delete this tournament'}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
                {selectedTournamentId === '__new__' && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newTournamentName}
                      onChange={e => setNewTournamentName(e.target.value)}
                      placeholder="Tournament name"
                      className="input-field"
                      autoFocus
                    />
                    <input
                      type="url"
                      inputMode="url"
                      value={newTournamentUrl}
                      onChange={e => setNewTournamentUrl(e.target.value)}
                      placeholder="Tournament URL (optional)"
                      className="input-field"
                      autoComplete="off"
                    />
                  </div>
                )}

                <ConfirmDialog
                  open={confirmDeleteTournament !== null}
                  title="Delete Tournament"
                  message={
                    confirmDeleteTournament
                      ? `Delete "${confirmDeleteTournament.name}"? Games linked to this tournament will keep their data but lose the tournament association.`
                      : ''
                  }
                  confirmLabel="Yes, Delete"
                  onConfirm={() => {
                    if (confirmDeleteTournament) void handleDeleteTournament(confirmDeleteTournament)
                    setConfirmDeleteTournament(null)
                  }}
                  onCancel={() => setConfirmDeleteTournament(null)}
                />
              </div>
            ) : (
              <input
                type="text"
                value={tournamentName}
                onChange={e => setTournamentName(e.target.value)}
                placeholder="e.g., Spring League 2026"
                className="input-field"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="input-field"
            />
          </div>
        </div>

        <button
          onClick={() => { void handleNext() }}
          disabled={!canProceed || creatingTournament || checkingBasketballCapabilities}
          className="btn-primary w-full mt-8"
        >
          {checkingBasketballCapabilities
            ? 'Checking cloud support...'
            : creatingTournament
              ? 'Saving tournament...'
              : 'Next: Add Players →'}
        </button>
      </div>
    </div>
  )
}
