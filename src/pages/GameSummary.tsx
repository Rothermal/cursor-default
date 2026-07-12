import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { computeCategoryTotal } from '../config/sports'
import { getDisplayedHomeScore } from '../lib/gameScore'
import { isTeamPseudoPlayer, TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../lib/teamPlayers'
import { resolveTeamStatsConfig } from '../config/teamStatsDefaults'
import { hasTrackedTeamSide } from '../lib/teamStatsSummary'
import TeamStatSummary from '../components/team-stats/TeamStatSummary'
import GameSummaryShotChartPanel from './game-summary/GameSummaryShotChartPanel'
import StatCorrectionModal from './game-summary/StatCorrectionModal'
import { useFinalizeGame } from '../hooks/useFinalizeGame'
import { useReviewShotChart } from '../hooks/useReviewShotChart'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

/** Per-stat resolved value plus metadata for conflict indicator (Part 1) */
type ResolvedEntry = { value: number; source?: string; recorder_count?: number }

/** Resolved stats by remote player id -> stat id -> entry (for final cloud games) */
type ResolvedStatsMap = Record<string, Record<string, ResolvedEntry>>

/** One recorder's submission for a (player, stat) in All Submissions view */
type SubmissionEntry = { recorded_by: string; display_name: string; value: number }

/** All submissions: player id -> stat id -> list of submissions (Part 2) */
type AllSubmissionsMap = Record<string, Record<string, SubmissionEntry[]>>

/** Checkout option for Primary recorder dropdown (Part 3) */
type CheckoutOption = { user_id: string; display_name: string; is_primary: boolean }

/** Checkouts per player (remote player id -> options) for reassign primary */
type CheckoutsByPlayerMap = Record<string, CheckoutOption[]>

export default function GameSummary() {
  const navigate = useNavigate()
  const { state, parkCurrentGame } = useGame()
  const { user } = useAuth()
  const { sport, gameInfo, players, opponentScore, homeTeamScore, homeScoreAdjustment, shotChart } = state
  const {
    finalizing,
    finalizeError,
    canFinalizeCloudGame,
    handleFinalizeCloudGame,
  } = useFinalizeGame()
  const [resolvedStats, setResolvedStats] = useState<ResolvedStatsMap | null>(null)
  const [isTeamAdmin, setIsTeamAdmin] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [correcting, setCorrecting] = useState<{
    playerId: string
    playerName: string
    statId: string
    statLabel: string
    currentValue: number
  } | null>(null)
  const [correctValue, setCorrectValue] = useState('')
  const [correctReason, setCorrectReason] = useState('')
  const [correctError, setCorrectError] = useState<string | null>(null)
  const [savingCorrection, setSavingCorrection] = useState(false)
  const [resolvedKey, setResolvedKey] = useState(0)
  const [viewMode, setViewMode] = useState<'primary' | 'all'>('primary')
  /** Players vs scores vs team-level stat summary (fouls, timeouts) vs shot chart (basketball). */
  const [summaryTab, setSummaryTab] = useState<'players' | 'team' | 'team_stats' | 'shot_chart'>('players')
  /** Final games: overlay from get_game_team_stats (resolved placeholder stats). */
  const [teamTrackedStatsByRemoteId, setTeamTrackedStatsByRemoteId] = useState<
    Record<string, Record<string, number>> | null
  >(null)
  const [allSubmissions, setAllSubmissions] = useState<AllSubmissionsMap | null>(null)
  const [checkoutsByPlayer, setCheckoutsByPlayer] = useState<CheckoutsByPlayerMap | null>(null)
  const [settingPrimaryFor, setSettingPrimaryFor] = useState<string | null>(null)
  const [primaryError, setPrimaryError] = useState<string | null>(null)
  const [newGameError, setNewGameError] = useState<string | null>(null)

  const isFinalCloudGame = state.cloudSync.gameStatus === 'final'
  const gameId = state.cloudSync.gameId
  const teamId = state.cloudSync.teamId
  const playerIdMap = state.cloudSync.playerIdMap

  const {
    summaryShotChart,
    isReviewShotChart,
    showShotChartTab,
    shotViewSelection,
    setShotViewSelection,
  } = useReviewShotChart({
    gameId,
    sportId: sport?.id,
    playerIdMap,
    localShotChart: shotChart,
    resolvedKey,
  })

  const summaryPlayers = useMemo(
    () => players.filter(p => !isTeamPseudoPlayer(p)),
    [players]
  )

  const homeTeamPseudo = useMemo(
    () =>
      players.find(
        p => p.id === TEAM_PLAYER_HOME_ID || (p.isTeamPlayer && p.teamSide === 'home')
      ),
    [players]
  )
  const oppTeamPseudo = useMemo(
    () =>
      players.find(
        p => p.id === TEAM_PLAYER_OPP_ID || (p.isTeamPlayer && p.teamSide === 'opponent')
      ),
    [players]
  )

  const teamStatHomeStats = useMemo(() => {
    const local = homeTeamPseudo?.stats ?? {}
    const remote = playerIdMap[TEAM_PLAYER_HOME_ID]
    if (isFinalCloudGame && remote && teamTrackedStatsByRemoteId?.[remote]) {
      return teamTrackedStatsByRemoteId[remote]
    }
    if (isFinalCloudGame && remote && resolvedStats?.[remote]) {
      return Object.fromEntries(
        Object.entries(resolvedStats[remote]).map(([k, e]) => [k, e.value])
      )
    }
    return local
  }, [
    homeTeamPseudo?.stats,
    isFinalCloudGame,
    playerIdMap,
    resolvedStats,
    teamTrackedStatsByRemoteId,
  ])

  const teamStatOppStats = useMemo(() => {
    const local = oppTeamPseudo?.stats ?? {}
    const remote = playerIdMap[TEAM_PLAYER_OPP_ID]
    if (isFinalCloudGame && remote && teamTrackedStatsByRemoteId?.[remote]) {
      return teamTrackedStatsByRemoteId[remote]
    }
    if (isFinalCloudGame && remote && resolvedStats?.[remote]) {
      return Object.fromEntries(
        Object.entries(resolvedStats[remote]).map(([k, e]) => [k, e.value])
      )
    }
    return local
  }, [
    oppTeamPseudo?.stats,
    isFinalCloudGame,
    playerIdMap,
    resolvedStats,
    teamTrackedStatsByRemoteId,
  ])

  const showTeamStatsTab = Boolean(
    sport?.teamCategories?.length &&
      (hasTrackedTeamSide(teamStatHomeStats, sport) || hasTrackedTeamSide(teamStatOppStats, sport))
  )

  useEffect(() => {
    if (!showTeamStatsTab && summaryTab === 'team_stats') {
      setSummaryTab('players')
    }
  }, [showTeamStatsTab, summaryTab])

  useEffect(() => {
    if (!showShotChartTab && summaryTab === 'shot_chart') {
      setSummaryTab('players')
    }
  }, [showShotChartTab, summaryTab])

  const teamStatsSummaryEl = useMemo(() => {
    if (!sport || !gameInfo || !showTeamStatsTab || summaryTab !== 'team_stats') return null
    const foulBase = sport.teamFoulBaseStatId
    if (!foulBase) return null
    const cfg = resolveTeamStatsConfig(sport, state.teamStatsConfig)
    if (!cfg) return null
    const homeP =
      homeTeamPseudo != null
        ? { ...homeTeamPseudo, stats: teamStatHomeStats }
        : {
            id: TEAM_PLAYER_HOME_ID,
            name: gameInfo.teamName,
            number: '★',
            stats: teamStatHomeStats,
            isTeamPlayer: true as const,
            teamSide: 'home' as const,
          }
    const oppP =
      oppTeamPseudo != null
        ? { ...oppTeamPseudo, stats: teamStatOppStats }
        : {
            id: TEAM_PLAYER_OPP_ID,
            name: gameInfo.opponentName,
            number: '★',
            stats: teamStatOppStats,
            isTeamPlayer: true as const,
            teamSide: 'opponent' as const,
          }
    return (
      <TeamStatSummary
        homeTeamPlayer={homeP}
        oppTeamPlayer={oppP}
        homeTeamName={gameInfo.teamName}
        oppTeamName={gameInfo.opponentName}
        config={cfg}
        sport={sport}
        foulBaseStatId={foulBase}
      />
    )
  }, [
    sport,
    gameInfo,
    showTeamStatsTab,
    summaryTab,
    state.teamStatsConfig,
    homeTeamPseudo,
    oppTeamPseudo,
    teamStatHomeStats,
    teamStatOppStats,
  ])

  useEffect(() => {
    const client = supabase
    if (!isFinalCloudGame || !gameId || !client) {
      setTeamTrackedStatsByRemoteId(null)
      return
    }
    let cancelled = false
    const load = async () => {
      const { data, error } = await client.rpc('get_game_team_stats', {
        p_game_id: gameId,
      })
      if (cancelled) return
      if (error) {
        setTeamTrackedStatsByRemoteId(null)
        return
      }
      const byPlayer: Record<string, Record<string, number>> = {}
      for (const row of (data ?? []) as Array<{
        player_id: string
        stat_id: string
        value: number
      }>) {
        if (!byPlayer[row.player_id]) byPlayer[row.player_id] = {}
        byPlayer[row.player_id][row.stat_id] = row.value
      }
      setTeamTrackedStatsByRemoteId(byPlayer)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isFinalCloudGame, gameId, resolvedKey])

  const loadResolved = useCallback(async () => {
    const client = supabase
    if (!gameId || !client) return null

    const skipRemote = new Set(
      state.players.filter(isTeamPseudoPlayer).map(p => playerIdMap[p.id] ?? p.id)
    )

    const { data, error } = await client.rpc('get_game_stats_resolved', {
      p_game_id: gameId,
    })
    if (error) return null

    const byPlayer: ResolvedStatsMap = {}
    for (const row of (data ?? []) as Array<{
      player_id: string
      stat_id: string
      value: number
      source?: string
      recorder_count?: number
    }>) {
      if (skipRemote.has(row.player_id)) continue
      if (!byPlayer[row.player_id]) byPlayer[row.player_id] = {}
      byPlayer[row.player_id][row.stat_id] = {
        value: row.value,
        source: row.source ?? undefined,
        recorder_count: row.recorder_count ?? undefined,
      }
    }
    return byPlayer
  }, [gameId, state.players, playerIdMap])

  useEffect(() => {
    if (!isFinalCloudGame || !gameId || !supabase) return

    let cancelled = false
    const load = async () => {
      const byPlayer = await loadResolved()
      if (cancelled || !byPlayer) return
      setResolvedStats(byPlayer)
    }

    void load()
    return () => { cancelled = true }
  }, [isFinalCloudGame, gameId, resolvedKey, loadResolved])

  const loadAllSubmissions = useCallback(async () => {
    const client = supabase
    if (!gameId || !client) return null

    const skipRemote = new Set(
      state.players.filter(isTeamPseudoPlayer).map(p => playerIdMap[p.id] ?? p.id)
    )

    const { data: statsRows, error: statsError } = await client
      .from('game_stats')
      .select('player_id, stat_id, recorded_by, value')
      .eq('game_id', gameId)

    if (statsError || !statsRows?.length) return {}

    const recorderIds = [...new Set((statsRows as Array<{ recorded_by: string }>).map(r => r.recorded_by))]
    const { data: profilesRows } = await client
      .from('profiles')
      .select('id, display_name')
      .in('id', recorderIds)

    const nameByUserId: Record<string, string> = {}
    for (const p of (profilesRows ?? []) as Array<{ id: string; display_name: string | null }>) {
      nameByUserId[p.id] = p.display_name?.trim() || 'Unknown'
    }

    const byPlayer: AllSubmissionsMap = {}
    for (const row of statsRows as Array<{ player_id: string; stat_id: string; recorded_by: string; value: number }>) {
      if (skipRemote.has(row.player_id)) continue
      if (!byPlayer[row.player_id]) byPlayer[row.player_id] = {}
      if (!byPlayer[row.player_id][row.stat_id]) byPlayer[row.player_id][row.stat_id] = []
      byPlayer[row.player_id][row.stat_id].push({
        recorded_by: row.recorded_by,
        display_name: nameByUserId[row.recorded_by] ?? 'Unknown',
        value: row.value,
      })
    }
    return byPlayer
  }, [gameId, state.players, playerIdMap])

  useEffect(() => {
    if (!isFinalCloudGame || !gameId || viewMode !== 'all') return
    let cancelled = false
    loadAllSubmissions().then(data => {
      if (!cancelled) setAllSubmissions(data)
    })
    return () => { cancelled = true }
  }, [isFinalCloudGame, gameId, viewMode, loadAllSubmissions])

  const loadCheckouts = useCallback(async () => {
    const client = supabase
    if (!gameId || !client) return null

    const skipRemote = new Set(
      state.players.filter(isTeamPseudoPlayer).map(p => playerIdMap[p.id] ?? p.id)
    )

    const { data: rows, error } = await client
      .from('player_checkouts')
      .select('player_id, user_id, is_primary')
      .eq('game_id', gameId)

    if (error || !rows?.length) return {}

    const userIds = [...new Set((rows as Array<{ user_id: string }>).map(r => r.user_id))]
    const { data: profilesRows } = await client
      .from('profiles')
      .select('id, display_name')
      .in('id', userIds)

    const nameByUserId: Record<string, string> = {}
    for (const p of (profilesRows ?? []) as Array<{ id: string; display_name: string | null }>) {
      nameByUserId[p.id] = p.display_name?.trim() || 'Unknown'
    }

    const byPlayer: CheckoutsByPlayerMap = {}
    for (const row of rows as Array<{ player_id: string; user_id: string; is_primary: boolean }>) {
      if (skipRemote.has(row.player_id)) continue
      if (!byPlayer[row.player_id]) byPlayer[row.player_id] = []
      byPlayer[row.player_id].push({
        user_id: row.user_id,
        display_name: nameByUserId[row.user_id] ?? 'Unknown',
        is_primary: row.is_primary,
      })
    }
    return byPlayer
  }, [gameId, state.players, playerIdMap])

  useEffect(() => {
    if (!isFinalCloudGame || !gameId || !isTeamAdmin) return
    let cancelled = false
    loadCheckouts().then(data => {
      if (!cancelled) setCheckoutsByPlayer(data ?? null)
    })
    return () => { cancelled = true }
  }, [isFinalCloudGame, gameId, isTeamAdmin, resolvedKey, loadCheckouts])

  const handleSetPrimaryRecorder = async (remotePlayerId: string, userId: string) => {
    if (!gameId || !supabase) return
    setSettingPrimaryFor(remotePlayerId)
    setPrimaryError(null)
    const { error } = await supabase.rpc('set_primary_recorder', {
      p_game_id: gameId,
      p_player_id: remotePlayerId,
      p_user_id: userId,
    })
    setSettingPrimaryFor(null)
    if (error) {
      setPrimaryError(error.message)
      return
    }
    setResolvedKey(k => k + 1)
  }

  useEffect(() => {
    const client = supabase
    if (!isFinalCloudGame || !teamId || !user || !client) return

    let cancelled = false
    const loadRole = async () => {
      const { data } = await client
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (cancelled) return
      const role = (data as { role?: string } | null)?.role
      setIsTeamAdmin(role === 'owner' || role === 'admin')
    }

    void loadRole()
    return () => { cancelled = true }
  }, [isFinalCloudGame, teamId, user])

  /** Stats needing review: averaged or multiple recorders (Part 4). Must be before early return (hooks rule). */
  const reviewItems = useMemo(() => {
    if (!sport || !isFinalCloudGame || !resolvedStats) return []
    const items: Array<{
      playerId: string
      playerName: string
      statId: string
      statLabel: string
      value: number
      source: string
      recorder_count: number
    }> = []
    const getStatLabel = (statId: string) =>
      sport.categories.flatMap(c => c.actions).find(a => a.id === statId)?.shortLabel ?? statId
    for (const player of summaryPlayers) {
      const remoteId = playerIdMap[player.id] ?? player.id
      const entries = resolvedStats[remoteId]
      if (!entries) continue
      for (const [statId, entry] of Object.entries(entries)) {
        const needsReview =
          entry.source === 'averaged' ||
          (((entry.recorder_count ?? 0) > 1) &&
            entry.source !== 'correction' &&
            entry.source !== 'primary')
        if (!needsReview) continue
        items.push({
          playerId: player.id,
          playerName: player.name,
          statId,
          statLabel: getStatLabel(statId),
          value: entry.value,
          source: entry.source ?? 'unknown',
          recorder_count: entry.recorder_count ?? 0,
        })
      }
    }
    return items
  }, [sport, isFinalCloudGame, resolvedStats, summaryPlayers, playerIdMap])

  if (!sport || !gameInfo) {
    navigate('/')
    return null
  }

  const getPlayerStats = (playerId: string): Record<string, number> => {
    const remoteId = playerIdMap[playerId] ?? playerId
    const player = players.find(p => p.id === playerId)
    if (isFinalCloudGame && resolvedStats && resolvedStats[remoteId]) {
      const entries = resolvedStats[remoteId]
      return Object.fromEntries(
        Object.entries(entries).map(([statId, entry]) => [statId, entry.value])
      )
    }
    return player?.stats ?? {}
  }

  /** Metadata for conflict indicator (Part 1): averaged or multiple recorders */
  const getResolvedMeta = (playerId: string, statId: string): { source?: string; recorder_count?: number } | null => {
    if (!isFinalCloudGame || !resolvedStats) return null
    const remoteId = playerIdMap[playerId] ?? playerId
    const entry = resolvedStats[remoteId]?.[statId]
    if (!entry?.source && entry?.recorder_count == null) return null
    return { source: entry.source, recorder_count: entry.recorder_count }
  }

  /** Submissions for one (player, stat) in All Submissions view */
  const getCellSubmissions = (playerId: string, statId: string): SubmissionEntry[] => {
    if (viewMode !== 'all' || !allSubmissions) return []
    const remoteId = playerIdMap[playerId] ?? playerId
    return allSubmissions[remoteId]?.[statId] ?? []
  }

  const teamScore = getDisplayedHomeScore(
    sport,
    summaryPlayers.map(p => ({ stats: getPlayerStats(p.id) })),
    homeTeamScore,
    homeScoreAdjustment
  )

  const allStatIds = sport.categories.flatMap(c => c.actions.map(a => a.id))

  const teamTotals: Record<string, number> = {}
  for (const statId of allStatIds) {
    teamTotals[statId] = summaryPlayers.reduce(
      (sum, p) => sum + (getPlayerStats(p.id)[statId] || 0),
      0
    )
  }

  const handleNewGame = () => {
    setNewGameError(null)
    if (!window.confirm('Park this game and start another?')) {
      return
    }
    parkCurrentGame()
    navigate('/')
  }

  const handleOpenCorrect = (
    playerId: string,
    playerName: string,
    statId: string,
    statLabel: string,
    currentValue: number
  ) => {
    setCorrecting({ playerId, playerName, statId, statLabel, currentValue })
    setCorrectValue(String(currentValue))
    setCorrectReason('')
    setCorrectError(null)
  }

  const handleCloseCorrect = () => {
    setCorrecting(null)
    setCorrectError(null)
  }

  const handleSaveCorrection = async () => {
    if (!correcting || !gameId || !user || !supabase) return
    const client = supabase
    const value = parseInt(correctValue, 10)
    if (Number.isNaN(value) || value < 0) {
      setCorrectError('Enter a valid number (0 or more)')
      return
    }

    setSavingCorrection(true)
    setCorrectError(null)
    const remotePlayerId = playerIdMap[correcting.playerId] ?? correcting.playerId

    const { error } = await client
      .from('stat_corrections')
      .upsert(
        {
          game_id: gameId,
          player_id: remotePlayerId,
          stat_id: correcting.statId,
          corrected_value: value,
          corrected_by: user.id,
          reason: correctReason.trim() || null,
          original_primary_value: correcting.currentValue,
        },
        { onConflict: 'game_id,player_id,stat_id' }
      )

    setSavingCorrection(false)
    if (error) {
      setCorrectError(error.message)
      return
    }
    setResolvedKey(k => k + 1)
    handleCloseCorrect()
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-6`}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate(isFinalCloudGame ? '/games' : '/game')}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                         active:scale-90 transition-transform"
            >
              ←
            </button>
            <h1 className="text-lg font-bold">Game Summary</h1>
          </div>

          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <p className="text-sm opacity-80">{gameInfo.teamName}</p>
              <p className="text-4xl font-bold">{teamScore}</p>
            </div>
            <p className="text-xl opacity-60">vs</p>
            <div className="text-center">
              <p className="text-sm opacity-80">{gameInfo.opponentName}</p>
              <p className="text-4xl font-bold">{opponentScore}</p>
            </div>
          </div>

          {gameInfo.tournamentName && (
            <p className="text-center text-sm opacity-60 mt-2">{gameInfo.tournamentName}</p>
          )}
          <p className="text-center text-xs opacity-40 mt-1">{gameInfo.date}</p>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        {finalizeError && (
          <div className="card bg-red-50 border-red-200 text-red-700 text-sm mb-4">
            {finalizeError}
          </div>
        )}

        {isFinalCloudGame && isTeamAdmin && viewMode === 'primary' && reviewItems.length > 0 && (
          <div className="card mb-4 border-amber-200 bg-amber-50/50">
            <h3 className="text-sm font-semibold text-amber-800 mb-1">Stats needing review</h3>
            <p className="text-xs text-amber-700/80 mb-3">Multiple recorders or averaged values. Correct the stat or set primary recorder below.</p>
            <ul className="space-y-2">
              {reviewItems.map(item => (
                <li key={`${item.playerId}-${item.statId}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-slate-700">
                    {item.playerName} — {item.statLabel}: {item.value}
                    {item.source === 'averaged' && (
                      <span className="text-amber-600 ml-1">(averaged)</span>
                    )}
                    {item.source !== 'averaged' && item.recorder_count > 1 && (
                      <span className="text-amber-600 ml-1">({item.recorder_count} recorders)</span>
                    )}
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenCorrect(
                          item.playerId,
                          item.playerName,
                          item.statId,
                          item.statLabel,
                          item.value
                        )
                      }
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 underline"
                    >
                      Correct
                    </button>
                    <a
                      href="#primary-recorder-section"
                      className="text-xs font-medium text-slate-600 hover:text-slate-700 underline"
                      onClick={e => {
                        e.preventDefault()
                        document.getElementById('primary-recorder-section')?.scrollIntoView({ behavior: 'smooth' })
                      }}
                    >
                      Set primary recorder
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isFinalCloudGame && isTeamAdmin && viewMode === 'primary' && checkoutsByPlayer && Object.keys(checkoutsByPlayer).length > 0 && (
          <>
            {primaryError && (
              <div className="card bg-red-50 border-red-200 text-red-700 text-sm mb-4">
                {primaryError}
              </div>
            )}
            <div id="primary-recorder-section" className="card mb-4">
            <h3 className="text-sm font-semibold text-slate-600 mb-2">Primary recorder</h3>
            <p className="text-xs text-slate-500 mb-3">Whose stats count as official for each player. Change to fix discrepancies.</p>
            <div className="space-y-2">
              {summaryPlayers.map(player => {
                const remoteId = playerIdMap[player.id] ?? player.id
                const options = checkoutsByPlayer[remoteId] ?? []
                const primaryOption = options.find(o => o.is_primary)

                return (
                  <div key={player.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-700 truncate">
                      #{player.number || '?'} {player.name}
                    </span>
                    {options.length === 0 ? (
                      <span className="text-slate-400 text-xs">No checkouts</span>
                    ) : options.length === 1 ? (
                      <span className="text-slate-600">{options[0].display_name}</span>
                    ) : (
                      <select
                        value={primaryOption?.user_id ?? options[0]?.user_id ?? ''}
                        onChange={e => {
                          const uid = e.target.value
                          if (uid) void handleSetPrimaryRecorder(remoteId, uid)
                        }}
                        disabled={settingPrimaryFor === remoteId}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 text-sm min-w-0 max-w-[140px]"
                      >
                        {options.map(opt => (
                          <option key={opt.user_id} value={opt.user_id}>
                            {opt.display_name}{opt.is_primary ? ' ✓' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )
              })}
            </div>
            {settingPrimaryFor && (
              <p className="text-xs text-slate-500 mt-2">Updating…</p>
            )}
            </div>
          </>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 flex-wrap">
            <button
              type="button"
              onClick={() => setSummaryTab('players')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                summaryTab === 'players' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Players
            </button>
            <button
              type="button"
              onClick={() => setSummaryTab('team')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                summaryTab === 'team' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Scores
            </button>
            {showTeamStatsTab && (
              <button
                type="button"
                onClick={() => setSummaryTab('team_stats')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  summaryTab === 'team_stats' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Team stats
              </button>
            )}
            {showShotChartTab && (
              <button
                type="button"
                onClick={() => setSummaryTab('shot_chart')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  summaryTab === 'shot_chart' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Shot chart
              </button>
            )}
          </div>
        {isFinalCloudGame && summaryTab === 'players' && (
          <>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('primary')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'primary' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Primary
              </button>
              <button
                type="button"
                onClick={() => setViewMode('all')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'all' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                All submissions
              </button>
            </div>
            {isTeamAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setReviewMode(!reviewMode)}
                  className={reviewMode ? 'btn-primary py-2' : 'btn-secondary py-2'}
                >
                  {reviewMode ? 'Done reviewing' : 'Review / Correct stats'}
                </button>
                {reviewMode && (
                  <span className="text-xs text-slate-500">Tap a stat to correct it</span>
                )}
              </>
            )}
          </>
        )}
        </div>

        {teamStatsSummaryEl}

        {summaryTab === 'shot_chart' && (
          <GameSummaryShotChartPanel
            players={players}
            summaryShotChart={summaryShotChart}
            isReviewShotChart={isReviewShotChart}
            shotViewSelection={shotViewSelection}
            onShotViewSelectionChange={setShotViewSelection}
            activeBgClass={sport?.theme.bg ?? 'bg-orange-500'}
          />
        )}

        {summaryTab === 'team' && (
          <div className="card mb-6 border-slate-200">
            <h3 className="text-sm font-semibold text-slate-600 mb-3">Team vs opponent</h3>
            <div className="flex items-center justify-center gap-6 mb-4">
              <div className="text-center">
                <p className="text-xs text-slate-500">{gameInfo.teamName}</p>
                <p className="text-2xl font-bold text-slate-800">{teamScore}</p>
              </div>
              <span className="text-slate-400">vs</span>
              <div className="text-center">
                <p className="text-xs text-slate-500">{gameInfo.opponentName}</p>
                <p className="text-2xl font-bold text-slate-800">{opponentScore}</p>
              </div>
            </div>
            {homeTeamScore != null && (
              <p className="text-xs text-slate-500 text-center mb-2">
                Scoreboard total (not from player stats)
              </p>
            )}
            {homeTeamScore == null && homeScoreAdjustment !== 0 && (
              <p className="text-xs text-slate-500 text-center mb-2">
                Score adjustment: {homeScoreAdjustment >= 0 ? '+' : ''}{homeScoreAdjustment}
              </p>
            )}
          </div>
        )}

        {summaryTab === 'players' && sport.categories.map(category => {
          // Map madeStatId → miss action for this category (used in Primary view)
          const missActionMap: Record<string, typeof category.actions[0]> = {}
          for (const action of category.actions) {
            if (action.madeStatId) missActionMap[action.madeStatId] = action
          }

          // Primary view: merge made+miss columns; All Submissions: show all separately
          const visibleActions = viewMode === 'primary'
            ? category.actions.filter(a => !a.madeStatId)
            : category.actions

          const renderMadeCell = (
            action: typeof category.actions[0],
            made: number,
            missVal: number,
            extra?: React.ReactNode
          ) => {
            const miss = missActionMap[action.id]
            if (!miss) return <>{made}{extra}</>
            const total = made + missVal
            const pct = total > 0 ? Math.round((made / total) * 100) : null
            return (
              <>
                <span>{made}/{total}</span>
                {pct !== null && (
                  <span className="text-slate-400 ml-1 text-xs">({pct}%)</span>
                )}
                {extra}
              </>
            )
          }

          return (
            <div key={category.id} className="mb-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {category.name}
                {category.showTotal && (
                  <span className="text-slate-400 ml-2 normal-case">
                    — {category.totalLabel}
                  </span>
                )}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 pr-3 font-semibold text-slate-600">Player</th>
                      {visibleActions.map(action => {
                        const hasMiss = !!missActionMap[action.id]
                        return (
                          <th
                            key={action.id}
                            className="text-center py-2 px-2 font-semibold text-slate-600 min-w-[48px]"
                          >
                            {hasMiss ? `${action.shortLabel} M/A` : action.shortLabel}
                          </th>
                        )
                      })}
                      {category.showTotal && (
                        <th className="text-center py-2 px-2 font-bold text-slate-700 min-w-[50px]">
                          TOT
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {summaryPlayers.map(player => {
                      const stats = getPlayerStats(player.id)
                      const catTotal = category.showTotal
                        ? category.actions.some(a => a.pointValue)
                          ? category.actions.reduce(
                              (sum, a) => sum + (stats[a.id] || 0) * (a.pointValue || 0),
                              0
                            )
                          : computeCategoryTotal(category, stats)
                        : null

                      return (
                        <tr key={player.id} className="border-b border-slate-100">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <span className="text-slate-400 mr-1">#{player.number || '?'}</span>
                            <span className="font-medium">{player.name}</span>
                          </td>
                          {visibleActions.map(action => {
                            const meta = getResolvedMeta(player.id, action.id)
                            const needsReview =
                              !!meta &&
                              (meta.source === 'averaged' ||
                                (((meta.recorder_count ?? 0) > 1) &&
                                  meta.source !== 'correction' &&
                                  meta.source !== 'primary'))
                            const submissions = getCellSubmissions(player.id, action.id)
                            const missAction = missActionMap[action.id]

                            return (
                              <td key={action.id} className="text-center py-2 px-2 tabular-nums">
                                <span className="inline-flex flex-wrap items-center justify-center gap-1">
                                  {viewMode === 'primary' ? (
                                    renderMadeCell(
                                      action,
                                      stats[action.id] || 0,
                                      missAction ? (stats[missAction.id] || 0) : 0,
                                      <>
                                        {isFinalCloudGame && needsReview && (
                                          <span
                                            className="text-amber-600"
                                            title="Multiple recorders – review"
                                            aria-label="Multiple recorders"
                                          >
                                            ⚠️
                                          </span>
                                        )}
                                        {reviewMode && isFinalCloudGame && isTeamAdmin && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleOpenCorrect(
                                                player.id,
                                                player.name,
                                                action.id,
                                                action.shortLabel,
                                                stats[action.id] || 0
                                              )
                                            }
                                            className="text-slate-400 hover:text-blue-600 p-0.5"
                                            title="Correct this stat"
                                            aria-label="Correct stat"
                                          >
                                            ✏️
                                          </button>
                                        )}
                                      </>
                                    )
                                  ) : (
                                    submissions.length > 0 ? (
                                      <span className="text-xs">
                                        {submissions.map((s, i) => (
                                          <span key={s.recorded_by}>
                                            {i > 0 && ', '}
                                            {s.value} ({s.display_name})
                                          </span>
                                        ))}
                                      </span>
                                    ) : (
                                      '—'
                                    )
                                  )}
                                </span>
                              </td>
                            )
                          })}
                          {category.showTotal && (
                            <td className="text-center py-2 px-2 font-bold tabular-nums">
                              {catTotal}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                    <tr className="bg-slate-50 font-semibold">
                      <td className="py-2 pr-3">Team</td>
                      {visibleActions.map(action => {
                        const missAction = missActionMap[action.id]
                        const made = teamTotals[action.id] || 0
                        const missVal = missAction ? (teamTotals[missAction.id] || 0) : 0
                        return (
                          <td key={action.id} className="text-center py-2 px-2 tabular-nums">
                            {missAction ? (
                              <>
                                {made}/{made + missVal}
                                {(made + missVal) > 0 && (
                                  <span className="text-slate-400 ml-1 text-xs">
                                    ({Math.round((made / (made + missVal)) * 100)}%)
                                  </span>
                                )}
                              </>
                            ) : (
                              made
                            )}
                          </td>
                        )
                      })}
                      {category.showTotal && (
                        <td className="text-center py-2 px-2 font-bold tabular-nums">
                          {category.actions.some(a => a.pointValue)
                            ? category.actions.reduce(
                                (sum, a) => sum + (teamTotals[a.id] || 0) * (a.pointValue || 0),
                                0
                              )
                            : computeCategoryTotal(category, teamTotals)
                          }
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

        {summaryTab === 'team' &&
          sport.categories.map(category => {
            const missActionMap: Record<string, typeof category.actions[0]> = {}
            for (const action of category.actions) {
              if (action.madeStatId) missActionMap[action.madeStatId] = action
            }
            const visibleActions =
              viewMode === 'primary'
                ? category.actions.filter(a => !a.madeStatId)
                : category.actions

            return (
              <div key={`team-${category.id}`} className="mb-6">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  {category.name}
                  {category.showTotal && (
                    <span className="text-slate-400 ml-2 normal-case">— {category.totalLabel}</span>
                  )}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 pr-3 font-semibold text-slate-600">Team</th>
                        {visibleActions.map(action => {
                          const hasMiss = !!missActionMap[action.id]
                          return (
                            <th
                              key={action.id}
                              className="text-center py-2 px-2 font-semibold text-slate-600 min-w-[48px]"
                            >
                              {hasMiss ? `${action.shortLabel} M/A` : action.shortLabel}
                            </th>
                          )
                        })}
                        {category.showTotal && (
                          <th className="text-center py-2 px-2 font-bold text-slate-700 min-w-[50px]">
                            TOT
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-slate-50 font-semibold border-b border-slate-100">
                        <td className="py-2 pr-3">Totals</td>
                        {visibleActions.map(action => {
                          const missAction = missActionMap[action.id]
                          const made = teamTotals[action.id] || 0
                          const missVal = missAction ? teamTotals[missAction.id] || 0 : 0
                          return (
                            <td key={action.id} className="text-center py-2 px-2 tabular-nums">
                              {missAction ? (
                                <>
                                  {made}/{made + missVal}
                                  {made + missVal > 0 && (
                                    <span className="text-slate-400 ml-1 text-xs">
                                      ({Math.round((made / (made + missVal)) * 100)}%)
                                    </span>
                                  )}
                                </>
                              ) : (
                                made
                              )}
                            </td>
                          )
                        })}
                        {category.showTotal && (
                          <td className="text-center py-2 px-2 font-bold tabular-nums">
                            {category.actions.some(a => a.pointValue)
                              ? category.actions.reduce(
                                  (sum, a) => sum + (teamTotals[a.id] || 0) * (a.pointValue || 0),
                                  0
                                )
                              : computeCategoryTotal(category, teamTotals)}
                          </td>
                        )}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

        {state.notes && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Game Notes
            </h3>
            <div className="card bg-slate-50 text-sm text-slate-700 whitespace-pre-wrap">
              {state.notes}
            </div>
          </div>
        )}

        <div className="mt-8 space-y-3">
          {canFinalizeCloudGame && (
            <button
              onClick={() => { void handleFinalizeCloudGame() }}
              disabled={finalizing}
              className="btn-primary w-full"
            >
              {finalizing ? 'Finalizing...' : 'Finalize Game & Save to History'}
            </button>
          )}
          {isFinalCloudGame ? (
            <button
              onClick={() => navigate('/games')}
              disabled={finalizing}
              className="btn-secondary w-full disabled:opacity-50"
            >
              ← Back to Cloud Games
            </button>
          ) : (
            <button
              onClick={() => navigate('/game')}
              disabled={finalizing}
              className="btn-primary w-full disabled:opacity-50"
            >
              ← Back to Game
            </button>
          )}
          <button
            onClick={handleNewGame}
            disabled={finalizing}
            className="btn-secondary w-full disabled:opacity-50"
          >
            New Game
          </button>
          {newGameError && (
            <p className="text-sm text-red-600 text-center">{newGameError}</p>
          )}
        </div>

        {correcting && (
          <StatCorrectionModal
            playerName={correcting.playerName}
            statLabel={correcting.statLabel}
            currentValue={correcting.currentValue}
            correctValue={correctValue}
            correctReason={correctReason}
            correctError={correctError}
            savingCorrection={savingCorrection}
            onCorrectValueChange={setCorrectValue}
            onCorrectReasonChange={setCorrectReason}
            onSave={() => { void handleSaveCorrection() }}
            onClose={handleCloseCorrect}
          />
        )}
      </div>
    </div>
  )
}
