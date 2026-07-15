import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useSettings } from '../context/SettingsContext'
import { supabase } from '../lib/supabase'
import { teamDisplayName, playerDisplayName, playerRosterSelectLabel } from '../lib/display'
import { teamInfoPath, teamLeaderboardPath, teamManagementPath } from '../lib/teamInfo'
import { sportDashboardPath } from '../lib/sportNavigation'
import ConfirmDialog from '../components/ConfirmDialog'
import AccessUnavailable from '../components/AccessUnavailable'
import MergePlayerWizard, { type MergePlayerOption } from '../components/MergePlayerWizard'
import { fetchMergePlayerScope } from '../lib/mergePlayerScope'
import { resolveTeamsPageSelectedTeamId } from '../lib/teamsPageSelection'
import { shouldBlockDiscardUnsyncedGame } from '../lib/gameSyncFingerprint'
import { getPendingSyncFlag } from '../lib/gameStorageKeys'
import {
  acceptedTeamRole,
  canChangeTeamMemberRole,
  canDeleteTeam,
  canEditPlayerIdentity,
  canInviteMembers,
  canInviteTeamRole,
  canLeaveTeam,
  canManageMembers,
  canManageRoster,
  canMergePlayers,
  canRemoveTeamMember,
  type TeamRole,
} from '../lib/teamPermissions'

interface TeamRow {
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

interface PlayerRow {
  id: string
  created_by: string | null
  first_name: string
  last_name: string | null
  jersey_number: string | null
  nickname: string | null
}

interface TeamMemberRow {
  id: string
  team_id?: string
  user_id: string
  role: string
  accepted_at: string | null
  display_name: string | null
  email: string | null
}

interface SeasonRow {
  id: string
  name: string
  sport: string
}

interface PoolPlayer {
  id: string
  created_by: string | null
  first_name: string
  last_name: string | null
  nickname: string | null
}

interface PendingTeamInvite {
  id: string
  team_id: string
  role: TeamRole
  invited_at: string
  team_name: string
  team_nickname: string | null
  season_name: string
  sport: string
}

export type TeamsPageMode = 'list' | 'manage'

export default function TeamsPage({ mode }: { mode: TeamsPageMode }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, isConfigured } = useAuth()
  const { state: gameState, dispatch: gameDispatch } = useGame()
  const { isSportEnabled } = useSettings()
  const userId = user?.id ?? null
  const requestedTeamId = searchParams.get('teamId')
  const requestedSportId = searchParams.get('sport')
  const isManagementRoute = mode === 'manage'
  const supabaseClient = supabase
  const enabledSports = useMemo(() => sports.filter(s => isSportEnabled(s.id)), [isSportEnabled])
  const scopedSport = useMemo(
    () => sports.find(sport => sport.id === requestedSportId) ?? null,
    [requestedSportId]
  )
  const scopedSportEnabled = Boolean(
    scopedSport && enabledSports.some(sport => sport.id === scopedSport.id)
  )
  const scopedSportDisabled = Boolean(scopedSport && !scopedSportEnabled)
  const formSports = useMemo(
    () =>
      scopedSport && scopedSportEnabled
        ? enabledSports.filter(sport => sport.id === scopedSport.id)
        : scopedSport
          ? []
        : enabledSports,
    [enabledSports, scopedSport, scopedSportEnabled]
  )

  const [teams, setTeams] = useState<TeamRow[]>([])
  const [teamRolesById, setTeamRolesById] = useState<Record<string, TeamRole>>({})
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [players, setPlayers] = useState<PlayerRow[]>([])

  const [loadingTeams, setLoadingTeams] = useState(false)
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [savingPlayer, setSavingPlayer] = useState(false)
  const [deletingPlayerId, setDeletingPlayerId] = useState<string | null>(null)
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState<TeamRow | null>(null)
  const [confirmDeletePlayer, setConfirmDeletePlayer] = useState<PlayerRow | null>(null)

  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamSport, setNewTeamSport] = useState('basketball')
  const [newTeamSeason, setNewTeamSeason] = useState(new Date().getFullYear().toString())

  useEffect(() => {
    if (formSports.length === 0) return
    if (!formSports.some(s => s.id === newTeamSport)) {
      setNewTeamSport(formSports[0]!.id)
    }
  }, [formSports, newTeamSport])

  const [newPlayerFirst, setNewPlayerFirst] = useState('')
  const [newPlayerLast, setNewPlayerLast] = useState('')
  const [newPlayerNumber, setNewPlayerNumber] = useState('')

  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [editingTeamName, setEditingTeamName] = useState('')
  const [editingTeamNickname, setEditingTeamNickname] = useState('')
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null)
  const [editingPlayerFirst, setEditingPlayerFirst] = useState('')
  const [editingPlayerLast, setEditingPlayerLast] = useState('')
  const [editingPlayerNumber, setEditingPlayerNumber] = useState('')
  const [editingPlayerNickname, setEditingPlayerNickname] = useState('')
  const [savingNickname, setSavingNickname] = useState(false)

  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([])
  const [pendingInvitesList, setPendingInvitesList] = useState<PendingTeamInvite[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'scorer' | 'admin'>('scorer')
  const [inviting, setInviting] = useState(false)
  const [lookupResult, setLookupResult] = useState<{ id: string; display_name: string } | null>(null)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [changingMemberId, setChangingMemberId] = useState<string | null>(null)
  const [leavingTeam, setLeavingTeam] = useState(false)
  const [acceptingTeamId, setAcceptingTeamId] = useState<string | null>(null)
  const [decliningTeamId, setDecliningTeamId] = useState<string | null>(null)

  const [existingSeasons, setExistingSeasons] = useState<SeasonRow[]>([])
  const [seasonMode, setSeasonMode] = useState<'new' | 'existing'>('new')
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('')

  const [playerPool, setPlayerPool] = useState<PoolPlayer[]>([])
  const [playerAddMode, setPlayerAddMode] = useState<'new' | 'existing'>('new')
  const [selectedExistingPlayerId, setSelectedExistingPlayerId] = useState<string>('')
  const [existingPlayerNumber, setExistingPlayerNumber] = useState('')
  const [addingExistingPlayer, setAddingExistingPlayer] = useState(false)

  const [guardianMap, setGuardianMap] = useState<Record<string, boolean>>({})
  const [claimingPlayerId, setClaimingPlayerId] = useState<string | null>(null)

  const [mergeWizardOpen, setMergeWizardOpen] = useState(false)
  const [mergeCandidates, setMergeCandidates] = useState<MergePlayerOption[]>([])
  const [mergeEligibleTeamIds, setMergeEligibleTeamIds] = useState<string[]>([])
  const [mergeScopeRefresh, setMergeScopeRefresh] = useState(0)
  const [rosterTick, setRosterTick] = useState(0)

  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId]
  )
  const visibleTeams = useMemo(
    () =>
      !isManagementRoute && scopedSport
        ? teams.filter(team => team.seasons.sport === scopedSport.id)
        : teams,
    [isManagementRoute, scopedSport, teams]
  )
  const visibleExistingSeasons = useMemo(
    () =>
      !isManagementRoute && scopedSport
        ? existingSeasons.filter(season => season.sport === scopedSport.id)
        : existingSeasons,
    [existingSeasons, isManagementRoute, scopedSport]
  )

  useEffect(() => {
    if (seasonMode !== 'existing' || !selectedSeasonId) return
    if (!visibleExistingSeasons.some(season => season.id === selectedSeasonId)) {
      setSeasonMode('new')
      setSelectedSeasonId('')
    }
  }, [seasonMode, selectedSeasonId, visibleExistingSeasons])

  const managementRouteMessage = useMemo(() => {
    if (!isManagementRoute || loadingTeams || selectedTeam) return null
    if (!requestedTeamId) return 'Choose a team from Cloud Teams before opening management.'
    return 'That team could not be found or you no longer have access to it.'
  }, [isManagementRoute, loadingTeams, requestedTeamId, selectedTeam])
  const backPath = isManagementRoute
    ? selectedTeam ? teamInfoPath(selectedTeam.id) : '/teams'
    : scopedSport ? sportDashboardPath(scopedSport.id) : '/settings'

  useEffect(() => {
    if (!isManagementRoute && requestedTeamId) {
      navigate(teamManagementPath(requestedTeamId), { replace: true })
    }
  }, [isManagementRoute, navigate, requestedTeamId])

  useEffect(() => {
    if (isManagementRoute && selectedTeamId && selectedTeamId !== requestedTeamId) {
      setSelectedTeamId('')
    }
  }, [isManagementRoute, requestedTeamId, selectedTeamId])

  useEffect(() => {
    if (!isConfigured || !userId || !supabaseClient) return

    let cancelled = false
    const loadTeams = async () => {
      setLoadingTeams(true)
      setError(null)
      const [{ data, error: queryError }, { data: membershipData, error: membershipError }] =
        await Promise.all([
          supabaseClient
            .from('teams')
            .select('id,owner_id,name,nickname,season_id,seasons!inner(id,name,sport)')
            .order('created_at', { ascending: false }),
          supabaseClient
            .from('team_members')
            .select('team_id,role,accepted_at')
            .eq('user_id', userId)
            .not('accepted_at', 'is', null),
        ])

      if (cancelled) return
      if (queryError || membershipError) {
        setError(queryError?.message ?? membershipError?.message ?? 'Unable to load teams.')
        setLoadingTeams(false)
        return
      }

      const loadedTeams = (data ?? []) as unknown as TeamRow[]
      const roles: Record<string, TeamRole> = {}
      for (const team of loadedTeams) {
        if (team.owner_id === userId) roles[team.id] = 'owner'
      }
      for (const row of (membershipData ?? []) as Array<{
        team_id: string
        role: string
        accepted_at: string | null
      }>) {
        const role = acceptedTeamRole(row.role, row.accepted_at)
        if (role) roles[row.team_id] = role
      }
      setTeams(loadedTeams)
      setTeamRolesById(roles)
      // List mode never selects a team (avoids roster/member fetches the list UI does not show).
      // Manage mode only selects the requested teamId — never falls back to the first team.
      setSelectedTeamId(
        resolveTeamsPageSelectedTeamId({
          isManagementRoute,
          requestedTeamId,
          loadedTeamIds: loadedTeams.map(team => team.id),
        })
      )
      setLoadingTeams(false)
    }

    void loadTeams()
    return () => {
      cancelled = true
    }
  }, [isConfigured, isManagementRoute, requestedTeamId, supabaseClient, userId])

  useEffect(() => {
    if (!isManagementRoute || !isConfigured || !userId || !supabaseClient) {
      setMergeEligibleTeamIds([])
      setMergeCandidates([])
      return
    }
    let cancelled = false
    const loadMergeScope = async () => {
      const { teamIds, candidates } = await fetchMergePlayerScope(supabaseClient, userId)
      if (cancelled) return
      setMergeEligibleTeamIds(teamIds)
      setMergeCandidates(candidates as MergePlayerOption[])
    }
    void loadMergeScope()
    return () => {
      cancelled = true
    }
  }, [isConfigured, isManagementRoute, supabaseClient, userId, mergeScopeRefresh])

  useEffect(() => {
    if (!isManagementRoute || !selectedTeamId || !isConfigured || !userId || !supabaseClient) {
      setPlayers([])
      return
    }

    let cancelled = false
    const loadPlayers = async () => {
      setLoadingPlayers(true)
      setError(null)
      const { data, error: queryError } = await supabaseClient
        .from('team_players')
        .select('jersey_number,players!inner(id,created_by,first_name,last_name,nickname)')
        .eq('team_id', selectedTeamId)
        .eq('is_active', true)
        .order('joined_at', { ascending: true })

      if (cancelled) return
      if (queryError) {
        setError(queryError.message)
        setLoadingPlayers(false)
        return
      }

      type TeamPlayerJoin = { jersey_number: string | null; players: { id: string; created_by: string | null; first_name: string; last_name: string | null; nickname: string | null } }
      setPlayers(((data ?? []) as unknown as TeamPlayerJoin[]).map(row => ({
        id: row.players.id,
        created_by: row.players.created_by,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        jersey_number: row.jersey_number,
        nickname: row.players.nickname,
      })))
      setLoadingPlayers(false)
    }

    void loadPlayers()
    return () => {
      cancelled = true
    }
  }, [isConfigured, isManagementRoute, selectedTeamId, supabaseClient, userId, rosterTick])

  const myRole = useMemo(() => {
    const member = teamMembers.find(m => m.user_id === userId)
    return member
      ? acceptedTeamRole(member.role, member.accepted_at)
      : selectedTeamId
        ? teamRolesById[selectedTeamId] ?? null
        : null
  }, [selectedTeamId, teamMembers, teamRolesById, userId])
  const mayManageRoster = canManageRoster(myRole)
  const mayManageMembers = canManageMembers(myRole)
  const canOpenMergeWizard =
    canMergePlayers(myRole) &&
    Boolean(supabaseClient && userId) &&
    mergeCandidates.length >= 2 &&
    Boolean(selectedTeamId && mergeEligibleTeamIds.includes(selectedTeamId))

  useEffect(() => {
    if (!supabaseClient || !userId) {
      setPendingInvitesList([])
      return
    }
    let cancelled = false
    const load = async () => {
      const { data, error: rpcError } = await supabaseClient.rpc('get_my_pending_team_invites')
      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message)
        return
      }
      setPendingInvitesList((data ?? []) as PendingTeamInvite[])
    }
    void load()
    return () => { cancelled = true }
  }, [supabaseClient, userId])

  useEffect(() => {
    if (!isManagementRoute || !selectedTeamId || !supabaseClient || !userId) {
      setTeamMembers([])
      return
    }

    let cancelled = false
    const loadMembers = async () => {
      setLoadingMembers(true)
      setError(null)
      setLookupResult(null)

      const { data, error: rpcError } = await supabaseClient.rpc('get_team_members_with_profiles', {
        p_team_id: selectedTeamId,
      })

      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message)
        setLoadingMembers(false)
        return
      }

      const rows = (data ?? []) as Array<TeamMemberRow & { team_id?: string }>
      setTeamMembers(rows.map(r => ({ ...r, team_id: r.team_id ?? selectedTeamId })))
      setLoadingMembers(false)
    }

    void loadMembers()
    return () => { cancelled = true }
  }, [isManagementRoute, selectedTeamId, supabaseClient, userId])

  useEffect(() => {
    if (!isConfigured || !userId || !supabaseClient) return
    let cancelled = false
    const loadSeasons = async () => {
      const { data } = await supabaseClient
        .from('seasons')
        .select('id,name,sport')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      setExistingSeasons((data ?? []) as SeasonRow[])
    }
    void loadSeasons()
    return () => { cancelled = true }
  }, [isConfigured, supabaseClient, userId])

  useEffect(() => {
    if (!isConfigured || !userId || !supabaseClient) {
      setPlayerPool([])
      return
    }
    let cancelled = false
    const loadPool = async () => {
      const { data: createdPlayers } = await supabaseClient
        .from('players')
        .select('id,created_by,first_name,last_name,nickname')
        .eq('created_by', userId)
      const { data: guardedLinks } = await supabaseClient
        .from('player_guardians')
        .select('player_id')
        .eq('user_id', userId)
      if (cancelled) return
      const pool = [...((createdPlayers ?? []) as PoolPlayer[])]
      const createdIds = new Set(pool.map(p => p.id))
      const guardedIds = ((guardedLinks ?? []) as { player_id: string }[])
        .map(g => g.player_id)
        .filter(id => !createdIds.has(id))
      if (guardedIds.length > 0) {
        const { data: guardedPlayers } = await supabaseClient
          .from('players')
          .select('id,created_by,first_name,last_name,nickname')
          .in('id', guardedIds)
        if (!cancelled && guardedPlayers) {
          pool.push(...(guardedPlayers as PoolPlayer[]))
        }
      }
      if (!cancelled) setPlayerPool(pool)
    }
    void loadPool()
    return () => { cancelled = true }
  }, [isConfigured, supabaseClient, userId])

  useEffect(() => {
    if (!isManagementRoute || !selectedTeamId || !userId || !supabaseClient || players.length === 0) {
      setGuardianMap({})
      return
    }
    let cancelled = false
    const loadGuardians = async () => {
      const playerIds = players.map(p => p.id)
      const { data } = await supabaseClient
        .from('player_guardians')
        .select('player_id')
        .eq('user_id', userId)
        .in('player_id', playerIds)
      if (cancelled) return
      const map: Record<string, boolean> = {}
      for (const row of (data ?? []) as { player_id: string }[]) {
        map[row.player_id] = true
      }
      setGuardianMap(map)
    }
    void loadGuardians()
    return () => { cancelled = true }
  }, [isManagementRoute, selectedTeamId, supabaseClient, userId, players])

  const handleLookupInvitee = async () => {
    if (!supabaseClient || !selectedTeamId || !inviteEmail.trim() || !canInviteMembers(myRole)) return
    setError(null)
    setLookupResult(null)
    const { data, error: rpcError } = await supabaseClient.rpc('lookup_user_by_email', {
      p_team_id: selectedTeamId,
      p_email: inviteEmail.trim(),
    })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const rows = (data ?? []) as { id: string; display_name: string }[]
    if (rows.length === 0) {
      setError('No user found with that email.')
      return
    }
    setLookupResult(rows[0])
  }

  const handleInvite = async () => {
    if (
      !supabaseClient ||
      !selectedTeamId ||
      !lookupResult ||
      !canInviteTeamRole(myRole, inviteRole)
    ) return
    setError(null)
    setInviting(true)
    const { error: rpcError } = await supabaseClient.rpc('invite_team_member', {
      p_team_id: selectedTeamId,
      p_user_id: lookupResult.id,
      p_role: inviteRole,
    })
    setInviting(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setInviteEmail('')
    setLookupResult(null)
    setInviteRole('scorer')
    const { data } = await supabaseClient.rpc('get_team_members_with_profiles', {
      p_team_id: selectedTeamId,
    })
    const rows = (data ?? []) as Array<TeamMemberRow & { team_id?: string }>
    setTeamMembers(rows.map(r => ({ ...r, team_id: r.team_id ?? selectedTeamId })))
  }

  const handleRemoveMember = async (memberId: string) => {
    const member = teamMembers.find(candidate => candidate.id === memberId)
    const targetRole = member ? acceptedTeamRole(member.role, member.accepted_at) : null
    if (
      !supabaseClient ||
      !selectedTeamId ||
      !member ||
      !canRemoveTeamMember(myRole, targetRole, member.user_id === userId)
    ) return
    setError(null)
    setRemovingMemberId(memberId)
    const { error: delError } = await supabaseClient.rpc('remove_team_member', {
      p_team_id: selectedTeamId,
      p_member_id: memberId,
    })
    setRemovingMemberId(null)
    if (delError) {
      setError(delError.message)
      return
    }
    setTeamMembers(prev => prev.filter(m => m.id !== memberId))
  }

  const handleChangeMemberRole = async (member: TeamMemberRow, nextRole: TeamRole) => {
    const targetRole = acceptedTeamRole(member.role, member.accepted_at) ??
      (member.role === 'admin' || member.role === 'scorer' ? member.role : null)
    if (
      !supabaseClient ||
      !selectedTeamId ||
      !canChangeTeamMemberRole(myRole, targetRole, nextRole)
    ) return

    setError(null)
    setChangingMemberId(member.id)
    const { error: rpcError } = await supabaseClient.rpc('set_team_member_role', {
      p_team_id: selectedTeamId,
      p_member_id: member.id,
      p_role: nextRole,
    })
    setChangingMemberId(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setTeamMembers(prev =>
      prev.map(candidate => candidate.id === member.id ? { ...candidate, role: nextRole } : candidate)
    )
  }

  const handleLeaveTeam = async () => {
    if (!supabaseClient || !selectedTeamId || !canLeaveTeam(myRole)) return
    if (!window.confirm('Leave this team and remove your access?')) return

    setError(null)
    setLeavingTeam(true)
    const { error: rpcError } = await supabaseClient.rpc('leave_team', {
      p_team_id: selectedTeamId,
    })
    setLeavingTeam(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setTeams(prev => prev.filter(team => team.id !== selectedTeamId))
    setTeamRolesById(prev => {
      const next = { ...prev }
      delete next[selectedTeamId]
      return next
    })
    navigate('/teams')
  }

  const handleAcceptInvite = async (teamId: string) => {
    if (!supabaseClient) return
    setError(null)
    setAcceptingTeamId(teamId)
    const pending = pendingInvitesList.find(p => p.team_id === teamId)
    if (!pending) {
      setAcceptingTeamId(null)
      return
    }
    const { error: updError } = await supabaseClient.rpc('accept_team_invite', {
      p_team_id: teamId,
    })
    setAcceptingTeamId(null)
    if (updError) {
      setError(updError.message)
      return
    }
    setPendingInvitesList(prev => prev.filter(p => p.team_id !== teamId))
    setTeamRolesById(prev => ({ ...prev, [teamId]: pending.role }))
    const { data: acceptedTeam } = await supabaseClient
      .from('teams')
      .select('id,owner_id,name,nickname,season_id,seasons!inner(id,name,sport)')
      .eq('id', teamId)
      .maybeSingle()
    if (acceptedTeam) {
      setTeams(prev => [
        acceptedTeam as unknown as TeamRow,
        ...prev.filter(team => team.id !== teamId),
      ])
    }
    if (selectedTeamId === teamId) {
      const { data } = await supabaseClient.rpc('get_team_members_with_profiles', {
        p_team_id: teamId,
      })
      const rows = (data ?? []) as Array<TeamMemberRow & { team_id?: string }>
      setTeamMembers(rows.map(r => ({ ...r, team_id: r.team_id ?? teamId })))
    }
  }

  const handleDeclineInvite = async (teamId: string) => {
    if (!supabaseClient) return
    setError(null)
    setDecliningTeamId(teamId)
    if (!pendingInvitesList.some(p => p.team_id === teamId)) {
      setDecliningTeamId(null)
      return
    }
    const { error: delError } = await supabaseClient.rpc('decline_team_invite', {
      p_team_id: teamId,
    })
    setDecliningTeamId(null)
    if (delError) {
      setError(delError.message)
      return
    }
    setPendingInvitesList(prev => prev.filter(p => p.team_id !== teamId))
    setTeams(prev => prev.filter(t => t.id !== teamId))
    if (selectedTeamId === teamId) {
      setSelectedTeamId('')
    }
  }

  function memberDisplayName(m: TeamMemberRow): string {
    if (m.display_name?.trim()) return m.display_name.trim()
    if (m.email) return m.email
    return 'Unknown'
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <p className="text-sm text-slate-500 mb-4">
            Configure Supabase credentials to manage cloud teams and rosters.
          </p>
          <button onClick={() => navigate('/settings/data')} className="btn-primary w-full">
            Back to Settings
          </button>
        </div>
      </div>
    )
  }

  const handleCreateTeam = async () => {
    if (!userId || !supabaseClient || !newTeamName.trim()) return
    setError(null)
    if (scopedSportDisabled) {
      setError(`${scopedSport!.name} is disabled. Enable it in Settings before creating teams.`)
      return
    }
    setCreatingTeam(true)

    let seasonData: SeasonRow

    if (seasonMode === 'existing' && selectedSeasonId) {
      const found = existingSeasons.find(s => s.id === selectedSeasonId)
      if (!found) {
        setError('Selected season not found')
        setCreatingTeam(false)
        return
      }
      seasonData = found
    } else {
      if (!newTeamSeason.trim()) {
        setError('Season name is required')
        setCreatingTeam(false)
        return
      }
      const { data: newSeason, error: seasonError } = await supabaseClient
        .from('seasons')
        .insert({
          owner_id: userId,
          name: newTeamSeason.trim(),
          sport: newTeamSport,
        })
        .select('id,name,sport')
        .single()

      if (seasonError || !newSeason) {
        setError(seasonError?.message ?? 'Could not create season')
        setCreatingTeam(false)
        return
      }
      seasonData = newSeason as SeasonRow
      setExistingSeasons(prev => [seasonData, ...prev])
    }

    const { data, error: createError } = await supabaseClient
      .from('teams')
      .insert({
        owner_id: userId,
        name: newTeamName.trim(),
        season_id: seasonData.id,
      })
      .select('id,name,nickname,season_id')
      .single()

    setCreatingTeam(false)
    if (createError || !data) {
      if (createError?.code === '23505') {
        setError('A team with this name already exists in this season.')
      } else {
        setError(createError?.message ?? 'Could not create team')
      }
      return
    }

    const createdTeam: TeamRow = {
      id: data.id as string,
      owner_id: userId,
      name: data.name as string,
      nickname: (data.nickname as string | null) ?? null,
      season_id: seasonData.id as string,
      seasons: {
        id: seasonData.id as string,
        name: seasonData.name as string,
        sport: seasonData.sport as string,
      },
    }
    setTeams(prev => [createdTeam, ...prev])
    setTeamRolesById(prev => ({ ...prev, [createdTeam.id]: 'owner' }))
    setSelectedTeamId(createdTeam.id)
    setNewTeamName('')
    setNewPlayerFirst('')
    setNewPlayerLast('')
    setNewPlayerNumber('')
    navigate(teamManagementPath(createdTeam.id))
  }

  const handleAddPlayer = async () => {
    if (!supabaseClient || !selectedTeamId || !newPlayerFirst.trim() || !userId || !mayManageRoster) return
    setError(null)
    setSavingPlayer(true)

    const { data: playerData, error: insertError } = await supabaseClient
      .from('players')
      .insert({
        created_by: userId,
        first_name: newPlayerFirst.trim(),
        last_name: newPlayerLast.trim() || null,
      })
      .select('id,first_name,last_name,nickname')
      .single()

    if (insertError || !playerData) {
      setError(insertError?.message ?? 'Could not add player')
      setSavingPlayer(false)
      return
    }

    const jerseyNumber = newPlayerNumber.trim() || null
    const { error: junctionError } = await supabaseClient
      .from('team_players')
      .insert({
        team_id: selectedTeamId,
        player_id: playerData.id,
        jersey_number: jerseyNumber,
        is_active: true,
      })

    setSavingPlayer(false)
    if (junctionError) {
      if (junctionError.code === '23505') {
        setError('That jersey number is already used on this team.')
      } else {
        setError(junctionError.message)
      }
      return
    }

    setPlayers(prev => [...prev, {
      id: playerData.id as string,
      created_by: userId,
      first_name: playerData.first_name as string,
      last_name: (playerData.last_name as string | null) ?? null,
      jersey_number: jerseyNumber,
      nickname: (playerData.nickname as string | null) ?? null,
    }])
    setNewPlayerFirst('')
    setNewPlayerLast('')
    setNewPlayerNumber('')
  }

  const handleAddExistingPlayer = async () => {
    if (!supabaseClient || !selectedTeamId || !selectedExistingPlayerId || !userId || !mayManageRoster) return
    setError(null)
    setAddingExistingPlayer(true)

    const jerseyNumber = existingPlayerNumber.trim() || null
    const { error: junctionError } = await supabaseClient
      .from('team_players')
      .insert({
        team_id: selectedTeamId,
        player_id: selectedExistingPlayerId,
        jersey_number: jerseyNumber,
        is_active: true,
      })

    setAddingExistingPlayer(false)
    if (junctionError) {
      if (junctionError.code === '23505') {
        setError('That jersey number is already used on this team.')
      } else {
        setError(junctionError.message)
      }
      return
    }

    const poolPlayer = playerPool.find(p => p.id === selectedExistingPlayerId)
    if (poolPlayer) {
      setPlayers(prev => [...prev, {
        id: poolPlayer.id,
        created_by: poolPlayer.created_by,
        first_name: poolPlayer.first_name,
        last_name: poolPlayer.last_name,
        jersey_number: jerseyNumber,
        nickname: poolPlayer.nickname,
      }])
    }
    setSelectedExistingPlayerId('')
    setExistingPlayerNumber('')
  }

  const handleClaimGuardian = async (playerId: string) => {
    if (!supabaseClient || !userId) return
    setError(null)
    setClaimingPlayerId(playerId)

    const { error: insertError } = await supabaseClient
      .from('player_guardians')
      .insert({
        player_id: playerId,
        user_id: userId,
        relationship: 'parent',
      })

    setClaimingPlayerId(null)
    if (insertError) {
      if (insertError.code === '23505') {
        setGuardianMap(prev => ({ ...prev, [playerId]: true }))
        return
      }
      setError(insertError.message)
      return
    }

    setGuardianMap(prev => ({ ...prev, [playerId]: true }))
  }

  const handleDeactivatePlayer = async (playerId: string) => {
    if (!supabaseClient || !selectedTeamId || !mayManageRoster) return
    setError(null)
    setDeletingPlayerId(playerId)

    const { error: updateError } = await supabaseClient
      .from('team_players')
      .update({ is_active: false })
      .eq('team_id', selectedTeamId)
      .eq('player_id', playerId)

    setDeletingPlayerId(null)
    if (updateError) {
      setError(updateError.message)
      return
    }

    setPlayers(prev => prev.filter(player => player.id !== playerId))
  }

  const handleDeleteTeam = async (team: TeamRow) => {
    if (!supabaseClient || !canDeleteTeam(teamRolesById[team.id] ?? null)) return
    setError(null)
    if (
      gameState.cloudSync.teamId === team.id &&
      shouldBlockDiscardUnsyncedGame(gameState, getPendingSyncFlag())
    ) {
      setError(
        'The active local game for this team has unsynced stats. Sync or park them before deleting the team.'
      )
      return
    }
    setDeletingTeamId(team.id)

    const { error: deleteError } = await supabaseClient
      .from('teams')
      .delete()
      .eq('id', team.id)

    setDeletingTeamId(null)
    if (deleteError) {
      setError(deleteError.message)
      return
    }

    if (gameState.cloudSync.teamId === team.id) {
      gameDispatch({ type: 'RESET_GAME' })
    }

    setTeams(prev => prev.filter(t => t.id !== team.id))
    if (selectedTeamId === team.id) {
      setSelectedTeamId('')
      setPlayers([])
    }
  }

  const handleDeletePlayer = async (player: PlayerRow) => {
    if (!supabaseClient || player.created_by !== userId) return
    setError(null)
    setDeletingPlayerId(player.id)

    const { error: deleteError } = await supabaseClient
      .from('players')
      .delete()
      .eq('id', player.id)

    setDeletingPlayerId(null)
    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setPlayers(prev => prev.filter(p => p.id !== player.id))
  }

  const startEditTeam = (team: TeamRow) => {
    setEditingTeamId(team.id)
    setEditingTeamName(team.name)
    setEditingTeamNickname(team.nickname?.trim() ?? '')
  }

  const cancelEditTeam = () => {
    setEditingTeamId(null)
    setEditingTeamName('')
    setEditingTeamNickname('')
  }

  const handleSaveTeam = async () => {
    if (
      !supabaseClient ||
      !editingTeamId ||
      !editingTeamName.trim() ||
      !canManageRoster(teamRolesById[editingTeamId] ?? null)
    ) return
    setError(null)
    setSavingNickname(true)
    const name = editingTeamName.trim()
    const nickname = editingTeamNickname.trim() || null
    const { error: updateError } = await supabaseClient
      .from('teams')
      .update({ name, nickname })
      .eq('id', editingTeamId)
    setSavingNickname(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setTeams(prev =>
      prev.map(t => (t.id === editingTeamId ? { ...t, name, nickname } : t))
    )
    cancelEditTeam()
  }

  const startEditPlayer = (player: PlayerRow) => {
    setEditingPlayerId(player.id)
    setEditingPlayerFirst(player.first_name)
    setEditingPlayerLast(player.last_name?.trim() ?? '')
    setEditingPlayerNumber(player.jersey_number?.trim() ?? '')
    setEditingPlayerNickname(player.nickname?.trim() ?? '')
  }

  const cancelEditPlayer = () => {
    setEditingPlayerId(null)
    setEditingPlayerFirst('')
    setEditingPlayerLast('')
    setEditingPlayerNumber('')
    setEditingPlayerNickname('')
  }

  const handleSavePlayer = async () => {
    const player = players.find(candidate => candidate.id === editingPlayerId)
    if (!supabaseClient || !editingPlayerId || !selectedTeamId || !player || !mayManageRoster) return
    const mayEditIdentity = canEditPlayerIdentity(userId, player.created_by, Boolean(guardianMap[player.id]))
    if (mayEditIdentity && !editingPlayerFirst.trim()) return
    setError(null)
    setSavingNickname(true)
    const first_name = editingPlayerFirst.trim()
    const last_name = editingPlayerLast.trim() || null
    const jersey_number = editingPlayerNumber.trim() || null
    const nickname = editingPlayerNickname.trim() || null
    const playerRes = mayEditIdentity
      ? await supabaseClient
          .from('players')
          .update({ first_name, last_name, nickname })
          .eq('id', editingPlayerId)
      : { error: null }
    const junctionRes = await supabaseClient
      .from('team_players')
      .update({ jersey_number })
      .eq('team_id', selectedTeamId)
      .eq('player_id', editingPlayerId)
    setSavingNickname(false)
    const updateError = playerRes.error || junctionRes.error
    if (updateError) {
      setError(updateError.message)
      return
    }
    setPlayers(prev =>
      prev.map(p =>
        p.id === editingPlayerId
          ? {
              ...p,
              ...(mayEditIdentity ? { first_name, last_name, nickname } : {}),
              jersey_number,
            }
          : p
      )
    )
    cancelEditPlayer()
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate(backPath)}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">{isManagementRoute ? 'Manage Team' : 'Cloud Teams'}</h1>
            <p className="text-sm opacity-80">
              {isManagementRoute && selectedTeam
                ? teamDisplayName(selectedTeam)
                : scopedSport
                  ? `${scopedSport.name} teams`
                  : 'Create teams and review your cloud teams'}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {pendingInvitesList.length > 0 && (
          <div className="card bg-blue-50 border-blue-200 space-y-2">
            <p className="font-semibold text-blue-800">Pending invites</p>
            {pendingInvitesList.map(inv => {
              const inviteTeamName = inv.team_nickname?.trim() || inv.team_name
              return (
                <div key={inv.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-blue-700">
                    {inviteTeamName} <span className="text-blue-500">({inv.role})</span>
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleAcceptInvite(inv.team_id)}
                      disabled={acceptingTeamId === inv.team_id}
                      className="btn-primary py-1 px-3 text-xs"
                    >
                      {acceptingTeamId === inv.team_id ? 'Accepting...' : 'Accept'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeclineInvite(inv.team_id)}
                      disabled={decliningTeamId === inv.team_id}
                      className="border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-600"
                    >
                      {decliningTeamId === inv.team_id ? 'Declining...' : 'Decline'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error && (
          <div className="card bg-red-50 border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {managementRouteMessage && (
          <section className="card space-y-3">
            <p className="font-semibold text-slate-700">Team unavailable</p>
            <p className="text-sm text-slate-500">{managementRouteMessage}</p>
            <button type="button" onClick={() => navigate('/teams')} className="btn-primary w-full">
              Back to Cloud Teams
            </button>
          </section>
        )}

        {!isManagementRoute && (
          <>
            <section className="card space-y-3">
              <h2 className="font-semibold text-slate-700">Create Team</h2>
              <input
                type="text"
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                placeholder="Team name"
                className="input-field"
              />
              {scopedSportDisabled && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center justify-between gap-2">
                  <span>{scopedSport!.name} is disabled. Enable it before creating teams in this sport.</span>
                  <button
                    type="button"
                    onClick={() => navigate('/settings/app')}
                    className="font-semibold underline shrink-0"
                  >
                    Settings
                  </button>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Season</label>
                <select
                  value={seasonMode === 'existing' ? selectedSeasonId : '__new__'}
                  onChange={e => {
                    if (e.target.value === '__new__') {
                      setSeasonMode('new')
                      setSelectedSeasonId('')
                    } else {
                      setSeasonMode('existing')
                      setSelectedSeasonId(e.target.value)
                    }
                  }}
                  className="input-field"
                >
                  <option value="__new__">Create new season...</option>
                  {visibleExistingSeasons.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.sport})
                    </option>
                  ))}
                </select>
              </div>
              {seasonMode === 'new' && (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newTeamSport}
                    onChange={e => setNewTeamSport(e.target.value)}
                    className="input-field"
                  >
                    {formSports.map(sport => (
                      <option key={sport.id} value={sport.id}>
                        {sport.icon} {sport.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newTeamSeason}
                    onChange={e => setNewTeamSeason(e.target.value)}
                    placeholder="Season name (required)"
                    className="input-field"
                    required
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => { void handleCreateTeam() }}
                disabled={
                  !newTeamName.trim()
                  || creatingTeam
                  || formSports.length === 0
                  || scopedSportDisabled
                  || (seasonMode === 'existing' && !selectedSeasonId)
                  || (seasonMode === 'new' && !newTeamSeason.trim())
                }
                className="btn-primary w-full"
              >
                {creatingTeam ? 'Creating...' : 'Create Team'}
              </button>
            </section>

            <section className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">Teams</h2>
                {loadingTeams && <span className="text-xs text-slate-400 animate-pulse">Loading...</span>}
              </div>

          {visibleTeams.length === 0 && !loadingTeams ? (
            <p className="text-sm text-slate-500">No teams yet. Create one above.</p>
          ) : (
            <div className="space-y-2">
              {visibleTeams.map(team => {
                const sport = sports.find(item => item.id === team.seasons.sport)
                const isEditing = editingTeamId === team.id
                const teamRole = teamRolesById[team.id] ?? null
                const mayManageThisTeam = canManageRoster(teamRole)
                return (
                  <div
                    key={team.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors"
                  >
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Team name *</label>
                          <input
                            type="text"
                            value={editingTeamName}
                            onChange={e => setEditingTeamName(e.target.value)}
                            placeholder="Team name"
                            className="input-field text-sm"
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Display name (optional)</label>
                          <input
                            type="text"
                            value={editingTeamNickname}
                            onChange={e => setEditingTeamNickname(e.target.value)}
                            placeholder="Short nickname override"
                            className="input-field text-sm"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { void handleSaveTeam() }}
                            disabled={savingNickname || !editingTeamName.trim()}
                            className="btn-primary flex-1 text-sm py-1"
                          >
                            {savingNickname ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditTeam}
                            className="border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(teamInfoPath(team.id))}
                          className="flex-1 text-left"
                        >
                          <p className="font-medium text-slate-700">
                            {sport?.icon ?? '🏟️'} {teamDisplayName(team)}
                            {team.nickname?.trim() && (
                              <span className="text-slate-400 font-normal text-xs ml-1">
                                ({team.name})
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500">
                            {sport?.name ?? team.seasons.sport}{team.seasons.name ? ` • ${team.seasons.name}` : ''}
                          </p>
                        </button>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation()
                              navigate(teamManagementPath(team.id))
                            }}
                            className="text-xs font-semibold text-blue-600 px-1.5 py-1"
                            title="Manage roster and members"
                          >
                            {mayManageThisTeam ? 'Manage' : 'View'}
                          </button>
                          {mayManageThisTeam && (
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); startEditTeam(team) }}
                              className="text-slate-400 hover:text-slate-600 p-1"
                              title="Edit team name"
                              aria-label="Edit team name"
                            >
                              ✏️
                            </button>
                          )}
                          {canDeleteTeam(teamRole) && (
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); setConfirmDeleteTeam(team) }}
                              disabled={deletingTeamId === team.id}
                              className="text-slate-400 hover:text-red-500 p-1"
                              title="Delete team"
                              aria-label="Delete team"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
            </section>
          </>
        )}

        {isManagementRoute && !managementRouteMessage && selectedTeam && !mayManageRoster && (
          <AccessUnavailable
            title="Roster is read-only"
            message="Scorers can review this team and track games, but roster and member management require an owner or admin."
          />
        )}

        {isManagementRoute && !managementRouteMessage && selectedTeam && (
          <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Roster</h2>
            <div className="flex items-center gap-2">
              {selectedTeam && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(teamLeaderboardPath(selectedTeam.id, selectedTeam.season_id, true))
                    }
                    className="text-xs text-blue-600 font-medium hover:underline"
                  >
                    Season Stats
                  </button>
                  {canOpenMergeWizard && (
                    <button
                      type="button"
                      onClick={() => setMergeWizardOpen(true)}
                      className="text-xs text-amber-700 font-medium hover:underline"
                    >
                      Merge players
                    </button>
                  )}
                </>
              )}
              <span className="text-xs text-slate-400">
                {selectedTeam ? teamDisplayName(selectedTeam) : 'Select a team'}
              </span>
            </div>
          </div>

          {selectedTeam ? (
            <>
              {mayManageRoster && (
                <div className="space-y-2">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPlayerAddMode('new')}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${
                    playerAddMode === 'new'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  New Player
                </button>
                <button
                  type="button"
                  onClick={() => setPlayerAddMode('existing')}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${
                    playerAddMode === 'existing'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  Add Existing
                </button>
              </div>

              {playerAddMode === 'new' ? (
                <>
                  <div className="grid grid-cols-12 gap-2">
                    <input
                      type="text"
                      value={newPlayerNumber}
                      onChange={e => setNewPlayerNumber(e.target.value)}
                      placeholder="#"
                      className="input-field col-span-2 text-center"
                    />
                    <input
                      type="text"
                      value={newPlayerFirst}
                      onChange={e => setNewPlayerFirst(e.target.value)}
                      placeholder="First name"
                      className="input-field col-span-5"
                    />
                    <input
                      type="text"
                      value={newPlayerLast}
                      onChange={e => setNewPlayerLast(e.target.value)}
                      placeholder="Last name"
                      className="input-field col-span-5"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { void handleAddPlayer() }}
                    disabled={!newPlayerFirst.trim() || savingPlayer}
                    className="btn-primary w-full"
                  >
                    {savingPlayer ? 'Saving...' : 'Add Player'}
                  </button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-12 gap-2">
                    <input
                      type="text"
                      value={existingPlayerNumber}
                      onChange={e => setExistingPlayerNumber(e.target.value)}
                      placeholder="#"
                      className="input-field col-span-2 text-center"
                    />
                    <select
                      value={selectedExistingPlayerId}
                      onChange={e => setSelectedExistingPlayerId(e.target.value)}
                      className="input-field col-span-10"
                    >
                      <option value="">Select a player...</option>
                      {playerPool
                        .filter(pp => !players.some(rp => rp.id === pp.id))
                        .map(pp => (
                          <option key={pp.id} value={pp.id}>
                            {playerRosterSelectLabel(pp)}
                          </option>
                        ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void handleAddExistingPlayer() }}
                    disabled={!selectedExistingPlayerId || addingExistingPlayer}
                    className="btn-primary w-full"
                  >
                    {addingExistingPlayer ? 'Adding...' : 'Add to Roster'}
                  </button>
                </>
              )}
                </div>
              )}

              {loadingPlayers ? (
                <p className="text-sm text-slate-500 animate-pulse">Loading roster...</p>
              ) : players.length === 0 ? (
                <p className="text-sm text-slate-500">No active players yet.</p>
              ) : (
                <div className="space-y-2">
                  {players.map(player => {
                    const isEditing = editingPlayerId === player.id
                    const mayEditIdentity = canEditPlayerIdentity(
                      userId,
                      player.created_by,
                      Boolean(guardianMap[player.id])
                    )
                    return (
                      <div key={player.id} className="border border-slate-100 rounded-xl px-3 py-2">
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <div className="grid grid-cols-12 gap-2">
                              <input
                                type="text"
                                value={editingPlayerNumber}
                                onChange={e => setEditingPlayerNumber(e.target.value)}
                                placeholder="#"
                                className="input-field col-span-2 text-center text-sm"
                                autoFocus
                              />
                              <input
                                type="text"
                                value={editingPlayerFirst}
                                onChange={e => setEditingPlayerFirst(e.target.value)}
                                placeholder="First name *"
                                className="input-field col-span-5 text-sm"
                                disabled={!mayEditIdentity}
                              />
                              <input
                                type="text"
                                value={editingPlayerLast}
                                onChange={e => setEditingPlayerLast(e.target.value)}
                                placeholder="Last name"
                                className="input-field col-span-5 text-sm"
                                disabled={!mayEditIdentity}
                              />
                            </div>
                            <input
                              type="text"
                              value={editingPlayerNickname}
                              onChange={e => setEditingPlayerNickname(e.target.value)}
                              placeholder="Display name (optional)"
                              className="input-field text-sm"
                              disabled={!mayEditIdentity}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => { void handleSavePlayer() }}
                                disabled={savingNickname || (mayEditIdentity && !editingPlayerFirst.trim())}
                                className="btn-primary flex-1 text-sm py-1"
                              >
                                {savingNickname ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditPlayer}
                                className="border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-600"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-slate-500 shrink-0">
                                #{player.jersey_number || '—'}
                              </span>
                              <p className="font-medium text-slate-700 truncate">
                                {playerDisplayName(player)}
                                {player.nickname?.trim() && (
                                  <span className="text-slate-400 font-normal text-xs ml-1">
                                    ({[player.first_name, player.last_name].filter(Boolean).join(' ')})
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {selectedTeam && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    navigate(
                                      `/career?playerId=${encodeURIComponent(player.id)}&sport=${encodeURIComponent(selectedTeam.seasons.sport)}`
                                    )
                                  }
                                  className="text-xs font-semibold text-blue-600 px-1.5 py-0.5"
                                >
                                  Career
                                </button>
                              )}
                              {mayManageRoster && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEditPlayer(player)}
                                    className="text-slate-400 hover:text-slate-600 p-1"
                                    title={mayEditIdentity ? 'Edit player' : 'Edit jersey number'}
                                    aria-label={mayEditIdentity ? 'Edit player' : 'Edit jersey number'}
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { void handleDeactivatePlayer(player.id) }}
                                    disabled={deletingPlayerId === player.id}
                                    className="text-xs text-slate-500 underline disabled:opacity-40"
                                  >
                                    {deletingPlayerId === player.id ? 'Removing...' : 'Remove'}
                                  </button>
                                </>
                              )}
                              {player.created_by === userId && (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeletePlayer(player)}
                                  disabled={deletingPlayerId === player.id}
                                  className="text-slate-400 hover:text-red-500 p-1"
                                  title="Delete player permanently"
                                  aria-label="Delete player permanently"
                                >
                                  🗑️
                                </button>
                              )}
                              {guardianMap[player.id] ? (
                                <span className="text-xs text-green-600 ml-1" title="You are a guardian">
                                  Guardian ✓
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => { void handleClaimGuardian(player.id) }}
                                  disabled={claimingPlayerId === player.id}
                                  className="text-xs text-blue-600 underline ml-1 disabled:opacity-40"
                                  title="Claim guardianship"
                                >
                                  {claimingPlayerId === player.id ? 'Claiming...' : 'Claim'}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">Select a team to manage its roster.</p>
          )}
          </section>
        )}

        <ConfirmDialog
          open={confirmDeleteTeam !== null}
          title="Delete Team"
          message={
            confirmDeleteTeam
              ? `Permanently delete "${teamDisplayName(confirmDeleteTeam)}" and all its players, games, stats, and tournaments? This cannot be undone.`
              : ''
          }
          confirmLabel="Yes, Delete"
          onConfirm={() => {
            if (confirmDeleteTeam) void handleDeleteTeam(confirmDeleteTeam)
            setConfirmDeleteTeam(null)
          }}
          onCancel={() => setConfirmDeleteTeam(null)}
        />

        <ConfirmDialog
          open={confirmDeletePlayer !== null}
          title="Delete Player"
          message={
            confirmDeletePlayer
              ? `Permanently delete "${playerDisplayName(confirmDeletePlayer)}" and all their game stats? This cannot be undone. To keep history, use "Remove" instead.`
              : ''
          }
          confirmLabel="Yes, Delete"
          onConfirm={() => {
            if (confirmDeletePlayer) void handleDeletePlayer(confirmDeletePlayer)
            setConfirmDeletePlayer(null)
          }}
          onCancel={() => setConfirmDeletePlayer(null)}
        />

        {isManagementRoute && selectedTeam && (
          <section className="card space-y-3">
            <h2 className="font-semibold text-slate-700">Team Members</h2>
            {loadingMembers ? (
              <p className="text-sm text-slate-500 animate-pulse">Loading...</p>
            ) : (
              <>
                <div className="space-y-2">
                  {teamMembers.map(m => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2"
                    >
                      <div>
                        <p className="font-medium text-slate-700">
                          {memberDisplayName(m)}
                          {m.user_id === userId && (
                            <span className="text-slate-400 font-normal text-xs ml-1">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          {m.role}
                          {m.accepted_at ? ' · Accepted' : ' · Pending'}
                        </p>
                      </div>
                      {myRole === 'owner' && m.role !== 'owner' && m.user_id !== userId && (
                        <select
                          value={m.role}
                          onChange={event => {
                            void handleChangeMemberRole(m, event.target.value as TeamRole)
                          }}
                          disabled={changingMemberId === m.id}
                          className="input-field w-auto py-1 text-xs"
                          aria-label={`Role for ${memberDisplayName(m)}`}
                        >
                          <option value="scorer">Scorer</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                      {canRemoveTeamMember(
                        myRole,
                        acceptedTeamRole(m.role, m.accepted_at),
                        m.user_id === userId
                      ) && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.id)}
                          disabled={removingMemberId === m.id}
                          className="text-xs text-red-600 underline disabled:opacity-40"
                        >
                          {removingMemberId === m.id ? 'Removing...' : 'Remove'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {canLeaveTeam(myRole) && (
                  <button
                    type="button"
                    onClick={() => { void handleLeaveTeam() }}
                    disabled={leavingTeam}
                    className="text-sm text-red-600 font-semibold underline disabled:opacity-40"
                  >
                    {leavingTeam ? 'Leaving...' : 'Leave team'}
                  </button>
                )}

                {mayManageMembers && (
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <p className="text-sm font-medium text-slate-600">Invite by email</p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={e => { setInviteEmail(e.target.value); setLookupResult(null) }}
                        placeholder="Email address"
                        className="input-field flex-1 text-sm py-2"
                      />
                      <button
                        type="button"
                        onClick={() => void handleLookupInvitee()}
                        disabled={!inviteEmail.trim()}
                        className="btn-secondary py-2 px-3 text-sm"
                      >
                        Lookup
                      </button>
                    </div>
                    {lookupResult && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-2">
                        <p className="text-sm text-slate-700">
                          Invite <strong>{lookupResult.display_name || inviteEmail}</strong> as
                        </p>
                        <div className="flex gap-2 items-center">
                          <select
                            value={inviteRole}
                            onChange={e => setInviteRole(e.target.value as 'scorer' | 'admin')}
                            className="input-field text-sm py-2 w-auto"
                          >
                            <option value="scorer">Scorer</option>
                            {canInviteTeamRole(myRole, 'admin') && (
                              <option value="admin">Admin</option>
                            )}
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleInvite()}
                            disabled={inviting}
                            className="btn-primary py-2 px-4 text-sm"
                          >
                            {inviting ? 'Sending...' : 'Send Invite'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>

      {isManagementRoute && mergeWizardOpen && supabaseClient && (
        <MergePlayerWizard
          supabase={supabaseClient}
          candidates={mergeCandidates}
          onClose={() => setMergeWizardOpen(false)}
          onMerged={() => {
            setMergeScopeRefresh(k => k + 1)
            setRosterTick(k => k + 1)
          }}
        />
      )}
    </div>
  )
}
