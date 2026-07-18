import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { sports } from '../config/sports'
import type { BasketballTeamStatsConfig } from '../types'
import {
  BASKETBALL_TEAM_STATS_DEFAULTS,
  resolveTeamStatsConfig,
  seasonTeamStatsConfigToJson,
} from '../config/teamStatsDefaults'
import SeasonTeamStatsEditor from '../components/SeasonTeamStatsEditor'
import { useSettings } from '../context/SettingsContext'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { supabase } from '../lib/supabase'
import { teamDisplayName } from '../lib/display'
import ConfirmDialog from '../components/ConfirmDialog'
import MergePlayerWizard from '../components/MergePlayerWizard'
import AccountSettings from '../components/settings/AccountSettings'
import AppAccessPanel from '../components/settings/AppAccessPanel'
import AuditTrailPanel from '../components/AuditTrailPanel'
import { fetchMergePlayerScope, type MergePlayerCandidate } from '../lib/mergePlayerScope'
import { shouldBlockDiscardUnsyncedGame } from '../lib/gameSyncFingerprint'
import { getPendingSyncFlag } from '../lib/gameStorageKeys'
import { isMissingTeamStatsConfigColumnError } from '../lib/cloudSyncHelpers'
import { isSportWorkspaceAvailable } from '../lib/sportAvailability'
import {
  exportParkedGames,
  getParkedGameStorageInfo,
  hasUnsyncedParkedBindingForCloudGame,
  hasUnsyncedParkedBindingForCloudTeam,
  importParkedGames,
  parkedGameStorageErrorMessage,
} from '../lib/gameParking'
import {
  formatParkedImportMessage,
  formatStorageBytes,
} from '../lib/parkedImportMessages'
import {
  resolveSettingsSection,
  settingsNavItems,
  settingsPath,
  settingsSportIdFromPath,
  sportSettingsPath,
} from '../lib/settingsNavigation'
import {
  acceptedTeamRole,
  canDeleteGame,
  canDeleteTeam,
  canManageTeam,
  type TeamRole,
} from '../lib/teamPermissions'

interface AdminSeasonInfo {
  name: string
  sport: string
}

interface AdminTeamRow {
  id: string
  owner_id: string
  accessRole: TeamRole
  name: string
  nickname: string | null
  season_id: string
  seasons: AdminSeasonInfo
}


interface AdminGameRow {
  id: string
  team_id: string
  opponent_name: string
  game_date: string
  status: string
}

interface AdminTournamentRow {
  id: string
  team_id: string
  name: string
}

interface AdminPlayerRow {
  id: string
  player_id: string
  first_name: string
  last_name: string | null
  jersey_number: string | null
  is_active: boolean
  created_by: string | null
}

interface AdminSeasonRow {
  id: string
  name: string
  sport: string
  start_date: string | null
  end_date: string | null
  team_stats_config?: unknown
}


interface MergeAuditListRow {
  id: string
  merged_at: string
  duplicate_player_id: string
  survivor_player_id: string
  merged_by: string | null
}

export default function Admin() {
  const navigate = useNavigate()
  const location = useLocation()
  const { settings, isSportEnabled, toggleSport, setReboundPromptAfterMissEnabled } = useSettings()
  const { appAccess, isConfigured, user } = useAuth()
  const { state: gameState, dispatch: gameDispatch } = useGame()
  const supabaseClient = supabase
  const userId = user?.id ?? null

  const enabledSports = useMemo(
    () => sports.filter(s => isSportWorkspaceAvailable(s.id, isSportEnabled(s.id))),
    [isSportEnabled]
  )
  const enabledCount = enabledSports.length
  const settingsSection = resolveSettingsSection(location.pathname)
  const settingsSportId = settingsSportIdFromPath(location.pathname)
  const selectedSettingsSport = sports.find(s => s.id === settingsSportId) ?? null
  const sectionTitle =
    settingsSection === 'sport' && selectedSettingsSport
      ? selectedSettingsSport.name
      : settingsNavItems.find(item => item.id === settingsSection)?.label ?? 'Settings'

  const [adminTeams, setAdminTeams] = useState<AdminTeamRow[]>([])
  const [adminGames, setAdminGames] = useState<AdminGameRow[]>([])
  const [adminTournaments, setAdminTournaments] = useState<AdminTournamentRow[]>([])
  const [adminPlayers, setAdminPlayers] = useState<AdminPlayerRow[]>([])
  const [selectedAdminTeamId, setSelectedAdminTeamId] = useState('')
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [localDataMessage, setLocalDataMessage] = useState<string | null>(null)
  const [localDataError, setLocalDataError] = useState<string | null>(null)

  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState<AdminTeamRow | null>(null)
  const [confirmDeleteGame, setConfirmDeleteGame] = useState<AdminGameRow | null>(null)
  const [confirmDeleteTournament, setConfirmDeleteTournament] = useState<AdminTournamentRow | null>(null)
  const [confirmDeletePlayer, setConfirmDeletePlayer] = useState<AdminPlayerRow | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [seasonsList, setSeasonsList] = useState<AdminSeasonRow[]>([])
  const [loadingSeasons, setLoadingSeasons] = useState(false)
  const [seasonsError, setSeasonsError] = useState<string | null>(null)
  const [newSeasonName, setNewSeasonName] = useState('')
  const [newSeasonSport, setNewSeasonSport] = useState(
    () => sports.find(s => isSportWorkspaceAvailable(s.id, isSportEnabled(s.id)))?.id ?? sports[0]?.id ?? ''
  )
  const [newSeasonStartDate, setNewSeasonStartDate] = useState('')
  const [newSeasonEndDate, setNewSeasonEndDate] = useState('')
  const [creatingSeason, setCreatingSeason] = useState(false)

  useEffect(() => {
    if (enabledSports.length === 0) return
    if (!enabledSports.some(s => s.id === newSeasonSport)) {
      setNewSeasonSport(enabledSports[0]!.id)
    }
  }, [enabledSports, newSeasonSport])
  const [editingSeasonId, setEditingSeasonId] = useState<string | null>(null)
  const [editSeasonName, setEditSeasonName] = useState('')
  const [editSeasonStartDate, setEditSeasonStartDate] = useState('')
  const [editSeasonEndDate, setEditSeasonEndDate] = useState('')
  const [confirmDeleteSeason, setConfirmDeleteSeason] = useState<AdminSeasonRow | null>(null)
  const [seasonsTeamStatsColumnMissing, setSeasonsTeamStatsColumnMissing] = useState(false)
  const [teamStatsSeasonId, setTeamStatsSeasonId] = useState<string | null>(null)
  const [teamStatsDraft, setTeamStatsDraft] = useState<BasketballTeamStatsConfig | null>(null)
  const [savingTeamStatsId, setSavingTeamStatsId] = useState<string | null>(null)

  const basketballSport = sports.find(s => s.id === 'basketball') ?? null
  const parkedStorageInfo = getParkedGameStorageInfo(userId)

  const [mergeWizardOpen, setMergeWizardOpen] = useState(false)
  const [mergeCandidates, setMergeCandidates] = useState<MergePlayerCandidate[]>([])
  const [mergeAuditRefresh, setMergeAuditRefresh] = useState(0)
  const [mergeAuditRows, setMergeAuditRows] = useState<MergeAuditListRow[]>([])
  const [loadingMergeAudit, setLoadingMergeAudit] = useState(false)
  const [mergeAuditError, setMergeAuditError] = useState<string | null>(null)
  const [accessAuditRefresh, setAccessAuditRefresh] = useState(0)
  const seasonsActive = settingsSection === 'data'
  const mergeToolsActive = settingsSection === 'advanced'
  const dataMgmtActive = settingsSection === 'advanced'

  useEffect(() => {
    if (!dataMgmtActive || !isConfigured || !userId || !supabaseClient) return
    let cancelled = false
    const load = async () => {
      setLoadingAdmin(true)
      setAdminError(null)
      const [{ data: teams, error: tErr }, { data: memberships, error: membershipError }] =
        await Promise.all([
          supabaseClient
            .from('teams')
            .select('id,owner_id,name,nickname,season_id,seasons!inner(name,sport)')
            .order('created_at', { ascending: false }),
          supabaseClient
            .from('team_members')
            .select('team_id,role,accepted_at')
            .eq('user_id', userId)
            .not('accepted_at', 'is', null),
        ])
      if (cancelled) return
      if (tErr || membershipError) {
        setAdminError(tErr?.message ?? membershipError?.message ?? 'Unable to load team access.')
        setLoadingAdmin(false)
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
      type RawTeamRow = { id: string; owner_id: string; name: string; nickname: string | null; season_id: string; seasons: AdminSeasonInfo | AdminSeasonInfo[] }
      const loaded = ((teams ?? []) as unknown as RawTeamRow[])
        .map(t => {
          const accessRole = t.owner_id === userId ? 'owner' : roleByTeamId.get(t.id) ?? null
          return {
            ...t,
            accessRole,
            seasons: Array.isArray(t.seasons) ? t.seasons[0] : t.seasons,
          }
        })
        .filter((team): team is AdminTeamRow => canManageTeam(team.accessRole))
      setAdminTeams(loaded)
      setSelectedAdminTeamId(prev => {
        if (prev && loaded.some(t => t.id === prev)) return prev
        return loaded[0]?.id ?? ''
      })
      setLoadingAdmin(false)
    }
    void load()
    return () => { cancelled = true }
  }, [dataMgmtActive, isConfigured, userId, supabaseClient])

  useEffect(() => {
    if (!mergeToolsActive || !isConfigured || !userId || !supabaseClient) return
    let cancelled = false
    const load = async () => {
      const { candidates } = await fetchMergePlayerScope(supabaseClient, userId)
      if (cancelled) return
      setMergeCandidates(candidates)
    }
    void load()
    return () => { cancelled = true }
  }, [mergeToolsActive, isConfigured, userId, supabaseClient, mergeAuditRefresh])

  useEffect(() => {
    if (!mergeToolsActive || !isConfigured || !userId || !supabaseClient) return
    let cancelled = false
    const loadAudit = async () => {
      setLoadingMergeAudit(true)
      setMergeAuditError(null)
      const { data, error } = await supabaseClient
        .from('player_merge_audit')
        .select('id,merged_at,duplicate_player_id,survivor_player_id,merged_by')
        .order('merged_at', { ascending: false })
        .limit(25)
      if (cancelled) return
      if (error) {
        if (error.message.includes('does not exist') || error.code === '42P01') {
          setMergeAuditError('Run migration 025 (or ensure player_merge_audit exists) to see merge history.')
        } else if (error.code === '42501' || error.message.toLowerCase().includes('policy')) {
          setMergeAuditError('Cannot read merge history (RLS). Apply migration 025_player_merge_audit_select_policy.sql.')
        } else {
          setMergeAuditError(error.message)
        }
        setMergeAuditRows([])
      } else {
        setMergeAuditRows((data ?? []) as MergeAuditListRow[])
      }
      setLoadingMergeAudit(false)
    }
    void loadAudit()
    return () => { cancelled = true }
  }, [mergeToolsActive, isConfigured, userId, supabaseClient, mergeAuditRefresh])

  useEffect(() => {
    if (!dataMgmtActive || !selectedAdminTeamId || !supabaseClient) {
      setAdminGames([])
      setAdminTournaments([])
      setAdminPlayers([])
      return
    }
    let cancelled = false
    const load = async () => {
      const [gamesRes, tournamentsRes, playersRes] = await Promise.all([
        supabaseClient.from('games').select('id,team_id,opponent_name,game_date,status')
          .eq('team_id', selectedAdminTeamId).order('created_at', { ascending: false }),
        supabaseClient.from('tournaments').select('id,team_id,name')
          .eq('team_id', selectedAdminTeamId).order('name', { ascending: true }),
        supabaseClient.from('team_players').select('id,player_id,jersey_number,is_active,players!inner(id,created_by,first_name,last_name)')
          .eq('team_id', selectedAdminTeamId).order('joined_at', { ascending: true }),
      ])
      if (cancelled) return
      setAdminGames((gamesRes.data ?? []) as AdminGameRow[])
      setAdminTournaments((tournamentsRes.data ?? []) as AdminTournamentRow[])
      setAdminPlayers(
        ((playersRes.data ?? []) as unknown as Array<{
          id: string; player_id: string; jersey_number: string | null; is_active: boolean;
          players: { id: string; created_by: string | null; first_name: string; last_name: string | null }
        }>).map(r => ({
          id: r.id,
          player_id: r.player_id,
          first_name: r.players.first_name,
          last_name: r.players.last_name,
          jersey_number: r.jersey_number,
          is_active: r.is_active,
          created_by: r.players.created_by,
        }))
      )
    }
    void load()
    return () => { cancelled = true }
  }, [dataMgmtActive, selectedAdminTeamId, supabaseClient])

  const handleAdminDeleteTeam = async (team: AdminTeamRow) => {
    if (!supabaseClient || !canDeleteTeam(team.accessRole)) return
    setAdminError(null)
    if (
      (gameState.cloudSync.teamId === team.id &&
        shouldBlockDiscardUnsyncedGame(gameState, getPendingSyncFlag())) ||
      hasUnsyncedParkedBindingForCloudTeam(user?.id ?? null, team.id)
    ) {
      setAdminError(
        'A local game for this team has unsynced stats. Sync or park them before deleting the team.'
      )
      return
    }
    setDeletingId(team.id)
    const { error } = await supabaseClient.from('teams').delete().eq('id', team.id)
    setDeletingId(null)
    if (error) { setAdminError(error.message); return }
    if (gameState.cloudSync.teamId === team.id) gameDispatch({ type: 'RESET_GAME' })
    setAdminTeams(prev => {
      const next = prev.filter(t => t.id !== team.id)
      if (selectedAdminTeamId === team.id) {
        setSelectedAdminTeamId(next[0]?.id ?? '')
      }
      return next
    })
  }

  const handleAdminDeleteGame = async (game: AdminGameRow) => {
    const team = adminTeams.find(candidate => candidate.id === game.team_id)
    if (!supabaseClient || !canDeleteGame(team?.accessRole ?? null)) return
    setAdminError(null)
    if (
      (gameState.cloudSync.gameId === game.id &&
        shouldBlockDiscardUnsyncedGame(gameState, getPendingSyncFlag())) ||
      hasUnsyncedParkedBindingForCloudGame(user?.id ?? null, game.id)
    ) {
      setAdminError(
        'This game has unsynced local stats. Sync or park them before deleting the cloud game.'
      )
      return
    }
    setDeletingId(game.id)
    const { error } = await supabaseClient.from('games').delete().eq('id', game.id)
    setDeletingId(null)
    if (error) { setAdminError(error.message); return }
    if (gameState.cloudSync.gameId === game.id) gameDispatch({ type: 'RESET_GAME' })
    setAdminGames(prev => prev.filter(g => g.id !== game.id))
  }

  const handleAdminDeleteTournament = async (tournament: AdminTournamentRow) => {
    const team = adminTeams.find(candidate => candidate.id === tournament.team_id)
    if (!supabaseClient || !canManageTeam(team?.accessRole ?? null)) return
    setAdminError(null)
    setDeletingId(tournament.id)
    const { error } = await supabaseClient.from('tournaments').delete().eq('id', tournament.id)
    setDeletingId(null)
    if (error) { setAdminError(error.message); return }
    setAdminTournaments(prev => prev.filter(t => t.id !== tournament.id))
  }

  const handleAdminDeletePlayer = async (player: AdminPlayerRow) => {
    if (!supabaseClient || player.created_by !== userId) return
    setAdminError(null)
    setDeletingId(player.id)
    const { error } = await supabaseClient.from('players').delete().eq('id', player.player_id)
    setDeletingId(null)
    if (error) { setAdminError(error.message); return }
    setAdminPlayers(prev => prev.filter(p => p.id !== player.id))
  }

  const loadSeasons = async () => {
    if (!supabaseClient) return
    setLoadingSeasons(true)
    setSeasonsError(null)
    const withConfig = await supabaseClient
      .from('seasons')
      .select('id,name,sport,start_date,end_date,team_stats_config')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
    if (withConfig.error && isMissingTeamStatsConfigColumnError(withConfig.error)) {
      setSeasonsTeamStatsColumnMissing(true)
      const { data, error } = await supabaseClient
        .from('seasons')
        .select('id,name,sport,start_date,end_date')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      setLoadingSeasons(false)
      if (error) {
        setSeasonsError(error.message)
        return
      }
      setSeasonsList((data ?? []) as AdminSeasonRow[])
      return
    }
    setLoadingSeasons(false)
    if (withConfig.error) {
      setSeasonsError(withConfig.error.message)
      return
    }
    setSeasonsTeamStatsColumnMissing(false)
    setSeasonsList((withConfig.data ?? []) as AdminSeasonRow[])
  }

  useEffect(() => {
    if (!seasonsActive || !isConfigured || !userId || !supabaseClient) return
    void loadSeasons()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonsActive, isConfigured, userId, supabaseClient])

  const handleCreateSeason = async () => {
    if (!supabaseClient || !newSeasonName.trim()) return
    setCreatingSeason(true)
    setSeasonsError(null)
    const { error } = await supabaseClient.from('seasons').insert({
      owner_id: userId,
      name: newSeasonName.trim(),
      sport: newSeasonSport,
      start_date: newSeasonStartDate || null,
      end_date: newSeasonEndDate || null,
    })
    setCreatingSeason(false)
    if (error) { setSeasonsError(error.message); return }
    setNewSeasonName('')
    setNewSeasonStartDate('')
    setNewSeasonEndDate('')
    void loadSeasons()
  }

  const handleSaveSeasonEdit = async (season: AdminSeasonRow) => {
    if (!supabaseClient || !editSeasonName.trim()) return
    setSeasonsError(null)
    setDeletingId(season.id)
    const { error } = await supabaseClient.from('seasons').update({
      name: editSeasonName.trim(),
      start_date: editSeasonStartDate || null,
      end_date: editSeasonEndDate || null,
    }).eq('id', season.id)
    setDeletingId(null)
    if (error) { setSeasonsError(error.message); return }
    setEditingSeasonId(null)
    void loadSeasons()
  }

  const handleDeleteSeason = async (season: AdminSeasonRow) => {
    if (!supabaseClient) return
    setSeasonsError(null)
    setDeletingId(season.id)
    const { error } = await supabaseClient.from('seasons').delete().eq('id', season.id)
    setDeletingId(null)
    if (error) { setSeasonsError(error.message); return }
    setSeasonsList(prev => prev.filter(s => s.id !== season.id))
    if (teamStatsSeasonId === season.id) {
      setTeamStatsSeasonId(null)
      setTeamStatsDraft(null)
    }
  }

  const openTeamStatsEditor = (season: AdminSeasonRow) => {
    if (!basketballSport) return
    const resolved = resolveTeamStatsConfig(basketballSport, season.team_stats_config)
    setTeamStatsDraft(resolved ?? { ...BASKETBALL_TEAM_STATS_DEFAULTS })
    setTeamStatsSeasonId(season.id)
  }

  const handleSaveTeamStatsConfig = async () => {
    if (!supabaseClient || !teamStatsSeasonId || !teamStatsDraft) return
    setSeasonsError(null)
    setSavingTeamStatsId(teamStatsSeasonId)
    const json = seasonTeamStatsConfigToJson(teamStatsDraft)
    const { error } = await supabaseClient
      .from('seasons')
      .update({ team_stats_config: json })
      .eq('id', teamStatsSeasonId)
    setSavingTeamStatsId(null)
    if (error) {
      if (isMissingTeamStatsConfigColumnError(error)) {
        setSeasonsError(
          'Database is missing seasons.team_stats_config. Apply Supabase migration 030 (team stats schema).'
        )
      } else {
        setSeasonsError(error.message)
      }
      return
    }
    if (gameState.cloudSync.seasonId === teamStatsSeasonId) {
      gameDispatch({ type: 'SET_TEAM_STATS_CONFIG', config: json })
    }
    setTeamStatsSeasonId(null)
    setTeamStatsDraft(null)
    void loadSeasons()
  }

  const handleExportParkedGames = () => {
    setLocalDataError(null)
    try {
      const json = exportParkedGames(userId)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `statkeeper-parked-games-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setLocalDataMessage('Parked games export created.')
    } catch (error) {
      setLocalDataError(parkedGameStorageErrorMessage(error))
    }
  }

  const handleImportParkedGames = async (file: File | undefined) => {
    if (!file) return
    setLocalDataError(null)
    setLocalDataMessage(null)
    try {
      const result = importParkedGames(await file.text(), userId)
      setLocalDataMessage(formatParkedImportMessage(result))
      window.setTimeout(() => window.location.reload(), 700)
    } catch (error) {
      setLocalDataError(parkedGameStorageErrorMessage(error))
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">Settings</h1>
            <p className="text-sm opacity-80">{sectionTitle}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-5">
        <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Settings sections">
          {settingsNavItems.map(item => {
            const active =
              item.id === settingsSection ||
              (item.id === 'sports' && settingsSection === 'sport')
            return (
              <Link
                key={item.id}
                to={item.path}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {settingsSection === 'account' && <AccountSettings />}

        {settingsSection === 'app' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-700">Enabled sports</h2>
              <span className="text-sm text-slate-400">
                {enabledCount} of {sports.length} enabled
              </span>
            </div>

            <div className="space-y-2">
              {sports.map(sport => {
                const isSoccerPreview = sport.id === 'soccer'
                const enabled = isSportWorkspaceAvailable(sport.id, isSportEnabled(sport.id))
                return (
                  <div
                    key={sport.id}
                    className={`
                      card flex items-center justify-between py-3 transition-colors
                      ${enabled ? '' : 'opacity-60'}
                    `}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{sport.icon}</span>
                      <div>
                        <span className="font-medium text-slate-700">{sport.name}</span>
                        <p className="text-xs text-slate-400">
                          {isSoccerPreview
                            ? import.meta.env.DEV ? 'Development preview' : 'Coming soon'
                            : `${sport.categories.reduce((n, c) => n + c.actions.length, 0)} stats across ${sport.categories.length} categories`}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleSport(sport.id)}
                      disabled={isSoccerPreview}
                      className={`
                        relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0
                        ${enabled ? 'bg-blue-600' : 'bg-slate-300'}
                        ${isSoccerPreview ? 'cursor-not-allowed opacity-70' : ''}
                      `}
                      role="switch"
                      aria-checked={enabled}
                      aria-label={isSoccerPreview ? `${sport.name} preview availability` : `Toggle ${sport.name}`}
                    >
                      <span
                        className={`
                          absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow
                          transition-transform duration-200
                          ${enabled ? 'translate-x-5' : 'translate-x-0'}
                        `}
                      />
                    </button>
                  </div>
                )
              })}
            </div>

            {enabledCount === 0 && (
              <p className="text-center text-sm text-amber-600 mt-4 bg-amber-50 rounded-xl p-3">
                Enable at least one sport to start tracking games.
              </p>
            )}
          </section>
        )}

        {settingsSection === 'sports' && (
          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-700">Sports</h2>
              <p className="text-sm text-slate-500">Sport-specific settings and future configuration.</p>
            </div>
            <div className="space-y-2">
              {sports.map(sport => {
                const hasSettings = sport.id === 'basketball'
                const enabled = isSportWorkspaceAvailable(sport.id, isSportEnabled(sport.id))
                return (
                  <Link
                    key={sport.id}
                    to={sportSettingsPath(sport.id)}
                    className={`card flex items-center justify-between py-3 transition-colors ${
                      hasSettings ? 'hover:border-blue-200' : 'opacity-70'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-2xl">{sport.icon}</span>
                      <span>
                        <span className="block font-medium text-slate-700">{sport.name}</span>
                        <span className="block text-xs text-slate-400">
                          {hasSettings ? 'Settings available' : 'No sport-specific settings yet'}
                        </span>
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-slate-400">
                      {sport.id === 'soccer' && import.meta.env.DEV
                        ? 'Preview'
                        : enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {settingsSection === 'sport' && selectedSettingsSport?.id !== 'basketball' && (
          <section className="card space-y-2">
            <p className="text-lg font-semibold text-slate-700">
              {selectedSettingsSport ? `${selectedSettingsSport.icon} ${selectedSettingsSport.name}` : 'Sport'} settings
            </p>
            <p className="text-sm text-slate-500">
              {selectedSettingsSport
                ? 'No sport-specific settings are defined for this sport yet.'
                : 'That sport settings route is not recognized.'}
            </p>
            <Link to={settingsPath('sports')} className="btn-secondary inline-block text-center">
              Back to Sports
            </Link>
          </section>
        )}

        {settingsSection === 'sport' && selectedSettingsSport?.id === 'basketball' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-700">Basketball</h2>
            </div>

            <div className="card flex items-center justify-between gap-3 py-3">
              <div>
                <span className="font-medium text-slate-700">Missed-shot rebound prompt</span>
                <p className="text-xs text-slate-400">
                  After a court miss, ask whether to add an offensive or defensive rebound.
                </p>
              </div>

              <button
                onClick={() =>
                  setReboundPromptAfterMissEnabled(
                    !settings.courtCapture.reboundPromptAfterMiss
                  )
                }
                className={`
                  relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0
                  ${settings.courtCapture.reboundPromptAfterMiss ? 'bg-blue-600' : 'bg-slate-300'}
                `}
                role="switch"
                aria-checked={settings.courtCapture.reboundPromptAfterMiss}
                aria-label="Toggle missed-shot rebound prompt"
              >
                <span
                  className={`
                    absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow
                    transition-transform duration-200
                    ${settings.courtCapture.reboundPromptAfterMiss ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 mt-3">
              <p className="text-sm font-semibold text-slate-700">Team stat rules</p>
              <p className="text-sm text-slate-500 mt-1">
                Basketball team fouls, timeouts, and bonus rules are configured per season.
              </p>
              <Link
                to={settingsPath('data')}
                className="text-sm font-semibold text-blue-600 underline mt-2 inline-block"
              >
                Open Seasons
              </Link>
            </div>

            <Link to={settingsPath('sports')} className="btn-secondary inline-block text-center mt-3">
              Back to Sports
            </Link>
          </section>
        )}

        {settingsSection === 'data' && (
          <>
        <section className="card">
          <h2 className="text-lg font-semibold text-slate-700 mb-2">Local parked games</h2>
          <p className="text-sm text-slate-500 mb-3">
            {parkedStorageInfo.parkedCount} of {parkedStorageInfo.maxParkedGames} slots used ·{' '}
            {formatStorageBytes(parkedStorageInfo.estimatedBytes)} local storage
          </p>
          {localDataError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
              {localDataError}
            </p>
          )}
          {localDataMessage && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 mb-3">
              {localDataMessage}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" onClick={handleExportParkedGames}>
              Export
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => importInputRef.current?.click()}
            >
              Import
            </button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={event => void handleImportParkedGames(event.target.files?.[0])}
          />
        </section>

        {isConfigured && user && (
          <section className="card mt-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-2">Cloud Teams</h2>
            <p className="text-sm text-slate-500 mb-4">
              Create teams and manage player rosters saved to Supabase.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => navigate('/teams')}
                className="btn-primary w-full"
              >
                Manage Teams & Rosters →
              </button>
              <button
                onClick={() => navigate('/games')}
                className="btn-secondary w-full"
              >
                View Cloud Games →
              </button>
            </div>
          </section>
        )}

        {isConfigured && user && (
          <section className="mt-6">
            <div className="card w-full text-left">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-700">Seasons</h2>
                  <p className="text-sm text-slate-500">Create & manage seasons</p>
                </div>
              </div>
            </div>

            {seasonsActive && (
              <div className="mt-3 space-y-3">
                {seasonsError && (
                  <div className="card bg-red-50 border-red-200 text-red-700 text-sm">{seasonsError}</div>
                )}

                <div className="card space-y-3">
                  <h3 className="text-sm font-semibold text-slate-700">New Season</h3>
                  <input
                    type="text"
                    placeholder="Season name"
                    value={newSeasonName}
                    onChange={e => setNewSeasonName(e.target.value)}
                    className="input-field"
                  />
                  <select
                    value={newSeasonSport}
                    onChange={e => setNewSeasonSport(e.target.value)}
                    className="input-field"
                  >
                    {enabledSports.map(s => (
                      <option key={s.id} value={s.id}>{s.icon} {s.name}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Start date</label>
                      <input
                        type="date"
                        value={newSeasonStartDate}
                        onChange={e => setNewSeasonStartDate(e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">End date</label>
                      <input
                        type="date"
                        value={newSeasonEndDate}
                        onChange={e => setNewSeasonEndDate(e.target.value)}
                        className="input-field"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCreateSeason()}
                    disabled={!newSeasonName.trim() || creatingSeason || enabledSports.length === 0}
                    className="btn-primary w-full"
                  >
                    {creatingSeason ? 'Creating…' : 'Create Season'}
                  </button>
                </div>

                {loadingSeasons ? (
                  <p className="text-sm text-slate-500 animate-pulse card">Loading…</p>
                ) : seasonsList.length === 0 ? (
                  <p className="text-sm text-slate-500 card">No seasons yet.</p>
                ) : (
                  <div className="space-y-2">
                    {seasonsTeamStatsColumnMissing && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        Team stat rules need migration 030 (
                        <code className="text-[10px]">seasons.team_stats_config</code>). Season list still
                        loads without it.
                      </p>
                    )}
                    {seasonsList.map(season => {
                      const sportCfg = sports.find(s => s.id === season.sport)
                      const isEditing = editingSeasonId === season.id
                      const isBasketballSeason = season.sport === 'basketball'
                      const teamStatsOpen = teamStatsSeasonId === season.id && teamStatsDraft !== null

                      if (isEditing) {
                        return (
                          <div key={season.id} className="card space-y-2">
                            <input
                              type="text"
                              value={editSeasonName}
                              onChange={e => setEditSeasonName(e.target.value)}
                              className="input-field"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Start date</label>
                                <input
                                  type="date"
                                  value={editSeasonStartDate}
                                  onChange={e => setEditSeasonStartDate(e.target.value)}
                                  className="input-field"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">End date</label>
                                <input
                                  type="date"
                                  value={editSeasonEndDate}
                                  onChange={e => setEditSeasonEndDate(e.target.value)}
                                  className="input-field"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void handleSaveSeasonEdit(season)}
                                disabled={!editSeasonName.trim() || deletingId === season.id}
                                className="btn-primary flex-1"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingSeasonId(null)}
                                className="btn-secondary flex-1"
                              >
                                Cancel
                              </button>
                            </div>
                            {isBasketballSeason && !seasonsTeamStatsColumnMissing && (
                              <button
                                type="button"
                                onClick={() => openTeamStatsEditor(season)}
                                className="btn-secondary w-full text-sm"
                              >
                                Team stat rules (basketball)…
                              </button>
                            )}
                          </div>
                        )
                      }

                      return (
                        <div key={season.id} className="space-y-2">
                          <div className="card flex items-center justify-between py-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{sportCfg?.icon ?? '🏟️'}</span>
                                <span className="font-medium text-slate-700 truncate">{season.name}</span>
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {sportCfg?.name ?? season.sport}
                                {(season.start_date || season.end_date) && ' · '}
                                {season.start_date ?? ''}
                                {season.start_date && season.end_date && ' → '}
                                {season.end_date ?? ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {isBasketballSeason && !seasonsTeamStatsColumnMissing && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (teamStatsOpen) {
                                      setTeamStatsSeasonId(null)
                                      setTeamStatsDraft(null)
                                    } else {
                                      openTeamStatsEditor(season)
                                    }
                                  }}
                                  className="text-slate-400 hover:text-blue-500 p-1 text-xs font-medium px-2"
                                  title="Team stat rules"
                                >
                                  🏀
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSeasonId(season.id)
                                  setEditSeasonName(season.name)
                                  setEditSeasonStartDate(season.start_date ?? '')
                                  setEditSeasonEndDate(season.end_date ?? '')
                                }}
                                className="text-slate-400 hover:text-blue-500 p-1"
                                title="Edit season"
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteSeason(season)}
                                disabled={deletingId === season.id}
                                className="text-slate-400 hover:text-red-500 p-1"
                                title="Delete season"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                          {teamStatsOpen && (
                            <div className="card space-y-3 border-blue-100 bg-slate-50/80">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="text-sm font-semibold text-slate-700">
                                  Basketball team stat rules
                                </h4>
                                <button
                                  type="button"
                                  className="text-xs text-slate-500 underline"
                                  onClick={() => {
                                    setTeamStatsSeasonId(null)
                                    setTeamStatsDraft(null)
                                  }}
                                >
                                  Close
                                </button>
                              </div>
                              <SeasonTeamStatsEditor value={teamStatsDraft} onChange={setTeamStatsDraft} />
                              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                <button
                                  type="button"
                                  className="btn-primary flex-1"
                                  disabled={savingTeamStatsId === season.id}
                                  onClick={() => void handleSaveTeamStatsConfig()}
                                >
                                  {savingTeamStatsId === season.id ? 'Saving…' : 'Save rules'}
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary flex-1"
                                  onClick={() => setTeamStatsDraft({ ...BASKETBALL_TEAM_STATS_DEFAULTS })}
                                >
                                  Reset form to defaults
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary flex-1"
                                  onClick={() => openTeamStatsEditor(season)}
                                >
                                  Revert to saved
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary flex-1 text-red-700 border-red-100"
                                  disabled={savingTeamStatsId === season.id}
                                  onClick={async () => {
                                    if (!supabaseClient) return
                                    setSeasonsError(null)
                                    setSavingTeamStatsId(season.id)
                                    const { error } = await supabaseClient
                                      .from('seasons')
                                      .update({ team_stats_config: {} })
                                      .eq('id', season.id)
                                    setSavingTeamStatsId(null)
                                    if (error) {
                                      if (isMissingTeamStatsConfigColumnError(error)) {
                                        setSeasonsError(
                                          'Missing seasons.team_stats_config column (migration 030).'
                                        )
                                      } else {
                                        setSeasonsError(error.message)
                                      }
                                      return
                                    }
                                    if (gameState.cloudSync.seasonId === season.id) {
                                      gameDispatch({ type: 'SET_TEAM_STATS_CONFIG', config: null })
                                    }
                                    setTeamStatsSeasonId(null)
                                    setTeamStatsDraft(null)
                                    void loadSeasons()
                                  }}
                                >
                                  Clear saved rules
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <ConfirmDialog
              open={confirmDeleteSeason !== null}
              title="Delete Season"
              message={
                confirmDeleteSeason
                  ? `Permanently delete "${confirmDeleteSeason.name}" and ALL its teams, games, and stats? This cannot be undone.`
                  : ''
              }
              confirmLabel="Yes, Delete"
              onConfirm={() => {
                if (confirmDeleteSeason) void handleDeleteSeason(confirmDeleteSeason)
                setConfirmDeleteSeason(null)
              }}
              onCancel={() => setConfirmDeleteSeason(null)}
            />
          </section>
        )}
          </>
        )}

        {settingsSection === 'advanced' && isConfigured && user && appAccess?.appRole === 'app_admin' && (
          <>
            <AppAccessPanel
              currentUserId={user.id}
              onAccessChanged={() => setAccessAuditRefresh(value => value + 1)}
            />
            <div className="mt-6">
              <AuditTrailPanel
                refreshKey={accessAuditRefresh}
                title="Audit activity"
              />
            </div>
          </>
        )}

        {settingsSection === 'advanced' && isConfigured && user && (
          <section className="mt-6">
            <div className="card w-full text-left border-amber-100 bg-amber-50/40">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-700">Player merge (advanced)</h2>
                  <p className="text-sm text-slate-500">
                    Combine duplicate player profiles (same flow as Teams). View merges you performed.
                  </p>
                </div>
              </div>
            </div>

            {mergeToolsActive && (
              <div className="mt-3 space-y-4">
                <p className="text-sm text-slate-600 card">
                  You must be owner or admin on every team both players are on. Irreversible — use test data when
                  learning the flow.
                </p>
                <button
                  type="button"
                  onClick={() => setMergeWizardOpen(true)}
                  disabled={mergeCandidates.length < 2}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  Open merge wizard
                </button>
                {mergeCandidates.length < 2 && (
                  <p className="text-xs text-slate-500 px-1">
                    Need at least two players on teams where you are owner or admin. Add teams under Teams or become
                    admin on another team.
                  </p>
                )}

                <div className="card space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700">Your recent merges</h3>
                  {loadingMergeAudit ? (
                    <p className="text-sm text-slate-500 animate-pulse">Loading history…</p>
                  ) : mergeAuditError ? (
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      {mergeAuditError}
                    </p>
                  ) : mergeAuditRows.length === 0 ? (
                    <p className="text-sm text-slate-500">No merge records yet (or none you performed).</p>
                  ) : (
                    <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
                      {mergeAuditRows.map(row => (
                        <li
                          key={row.id}
                          className="border border-slate-100 rounded-lg px-3 py-2 flex flex-col gap-0.5"
                        >
                          <span className="text-xs text-slate-400">
                            {new Date(row.merged_at).toLocaleString()}
                          </span>
                          <span className="text-slate-700">
                            Kept <code className="text-xs bg-slate-100 px-1 rounded">{row.survivor_player_id.slice(0, 8)}…</code>
                            {' · '}
                            removed{' '}
                            <code className="text-xs bg-slate-100 px-1 rounded">{row.duplicate_player_id.slice(0, 8)}…</code>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {mergeWizardOpen && supabaseClient && userId && (
              <MergePlayerWizard
                supabase={supabaseClient}
                candidates={mergeCandidates}
                onClose={() => setMergeWizardOpen(false)}
                onMerged={() => {
                  setMergeAuditRefresh(k => k + 1)
                }}
              />
            )}
          </section>
        )}

        {settingsSection === 'advanced' && isConfigured && user && (
          <section className="mt-6">
            <div className="card w-full text-left">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-700">Data Management</h2>
                  <p className="text-sm text-slate-500">Delete teams, games, players, tournaments</p>
                </div>
              </div>
            </div>

            {dataMgmtActive && (
              <div className="mt-3 space-y-3">
                {adminError && (
                  <div className="card bg-red-50 border-red-200 text-red-700 text-sm">{adminError}</div>
                )}

                {loadingAdmin ? (
                  <p className="text-sm text-slate-500 animate-pulse card">Loading...</p>
                ) : adminTeams.length === 0 ? (
                  <p className="text-sm text-slate-500 card">No teams found.</p>
                ) : (
                  <>
                    <div className="card space-y-2">
                      <label className="block text-sm font-semibold text-slate-700">Select Team</label>
                      <select
                        value={selectedAdminTeamId}
                        onChange={e => setSelectedAdminTeamId(e.target.value)}
                        className="input-field"
                      >
                        {adminTeams.map(t => {
                          const sport = sports.find(s => s.id === t.seasons.sport)
                          return (
                            <option key={t.id} value={t.id}>
                              {sport?.icon ?? '🏟️'} {teamDisplayName(t)}{t.seasons.name ? ` (${t.seasons.name})` : ''}
                            </option>
                          )
                        })}
                      </select>
                      {canDeleteTeam(
                        adminTeams.find(team => team.id === selectedAdminTeamId)?.accessRole ?? null
                      ) && (
                        <button
                          type="button"
                          onClick={() => {
                            const team = adminTeams.find(t => t.id === selectedAdminTeamId)
                            if (team) setConfirmDeleteTeam(team)
                          }}
                          disabled={!selectedAdminTeamId || deletingId === selectedAdminTeamId}
                          className="text-sm text-red-600 font-semibold underline disabled:opacity-40"
                        >
                          Delete this team (and all its data)
                        </button>
                      )}
                    </div>

                    {selectedAdminTeamId && (
                      <>
                        {adminGames.length > 0 && (
                          <div className="card space-y-2">
                            <h3 className="text-sm font-semibold text-slate-700">
                              Games ({adminGames.length})
                            </h3>
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                              {adminGames.map(g => (
                                <div key={g.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-2 py-1.5">
                                  <div className="min-w-0">
                                    <p className="text-sm text-slate-700 truncate">vs {g.opponent_name}</p>
                                    <p className="text-xs text-slate-400">{g.game_date} · {g.status}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteGame(g)}
                                    disabled={deletingId === g.id}
                                    className="text-slate-400 hover:text-red-500 p-1 shrink-0"
                                    title="Delete game"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {adminPlayers.length > 0 && (
                          <div className="card space-y-2">
                            <h3 className="text-sm font-semibold text-slate-700">
                              Players ({adminPlayers.length})
                            </h3>
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                              {adminPlayers.map(p => (
                                <div key={p.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-2 py-1.5">
                                  <div className="min-w-0">
                                    <p className="text-sm text-slate-700 truncate">
                                      #{p.jersey_number || '—'} {[p.first_name, p.last_name].filter(Boolean).join(' ')}
                                    </p>
                                    <p className="text-xs text-slate-400">{p.is_active ? 'Active' : 'Inactive'}</p>
                                  </div>
                                  {p.created_by === userId && (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeletePlayer(p)}
                                      disabled={deletingId === p.id}
                                      className="text-slate-400 hover:text-red-500 p-1 shrink-0"
                                      title="Delete player"
                                    >
                                      🗑️
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {adminTournaments.length > 0 && (
                          <div className="card space-y-2">
                            <h3 className="text-sm font-semibold text-slate-700">
                              Tournaments ({adminTournaments.length})
                            </h3>
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                              {adminTournaments.map(t => (
                                <div key={t.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-2 py-1.5">
                                  <p className="text-sm text-slate-700 truncate">{t.name}</p>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteTournament(t)}
                                    disabled={deletingId === t.id}
                                    className="text-slate-400 hover:text-red-500 p-1 shrink-0"
                                    title="Delete tournament"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            <ConfirmDialog
              open={confirmDeleteTeam !== null}
              title="Delete Team"
              message={
                confirmDeleteTeam
                  ? `Permanently delete "${teamDisplayName(confirmDeleteTeam)}" and ALL its players, games, stats, and tournaments? This cannot be undone.`
                  : ''
              }
              confirmLabel="Yes, Delete"
              onConfirm={() => {
                if (confirmDeleteTeam) void handleAdminDeleteTeam(confirmDeleteTeam)
                setConfirmDeleteTeam(null)
              }}
              onCancel={() => setConfirmDeleteTeam(null)}
            />

            <ConfirmDialog
              open={confirmDeleteGame !== null}
              title="Delete Game"
              message={
                confirmDeleteGame
                  ? `Permanently delete the game vs ${confirmDeleteGame.opponent_name} (${confirmDeleteGame.game_date})? All stats for this game will be lost.`
                  : ''
              }
              confirmLabel="Yes, Delete"
              onConfirm={() => {
                if (confirmDeleteGame) void handleAdminDeleteGame(confirmDeleteGame)
                setConfirmDeleteGame(null)
              }}
              onCancel={() => setConfirmDeleteGame(null)}
            />

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
                if (confirmDeleteTournament) void handleAdminDeleteTournament(confirmDeleteTournament)
                setConfirmDeleteTournament(null)
              }}
              onCancel={() => setConfirmDeleteTournament(null)}
            />

            <ConfirmDialog
              open={confirmDeletePlayer !== null}
              title="Delete Player"
              message={
                confirmDeletePlayer
                  ? `Permanently delete "${[confirmDeletePlayer.first_name, confirmDeletePlayer.last_name].filter(Boolean).join(' ')}" and all their game stats? This cannot be undone.`
                  : ''
              }
              confirmLabel="Yes, Delete"
              onConfirm={() => {
                if (confirmDeletePlayer) void handleAdminDeletePlayer(confirmDeletePlayer)
                setConfirmDeletePlayer(null)
              }}
              onCancel={() => setConfirmDeletePlayer(null)}
            />
          </section>
        )}

        {settingsSection === 'advanced' && (!isConfigured || !user) && (
          <section className="card space-y-2">
            <h2 className="text-lg font-semibold text-slate-700">Advanced</h2>
            <p className="text-sm text-slate-500">
              Advanced cloud tools require a configured Supabase project and signed-in account.
            </p>
          </section>
        )}

        <button
          onClick={() => navigate('/')}
          className="btn-primary w-full mt-8"
        >
          Back to Sports
        </button>
      </div>
    </div>
  )
}
