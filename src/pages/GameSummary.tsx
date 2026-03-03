import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame, GAME_STORAGE_KEY } from '../context/GameContext'
import { computePlayerScore, computeCategoryTotal } from '../config/sports'
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
  const { state, dispatch } = useGame()
  const { user, isConfigured } = useAuth()
  const { sport, gameInfo, players, opponentScore } = state
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
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
  const [allSubmissions, setAllSubmissions] = useState<AllSubmissionsMap | null>(null)
  const [checkoutsByPlayer, setCheckoutsByPlayer] = useState<CheckoutsByPlayerMap | null>(null)
  const [settingPrimaryFor, setSettingPrimaryFor] = useState<string | null>(null)

  const isFinalCloudGame = state.cloudSync.gameStatus === 'final'
  const gameId = state.cloudSync.gameId
  const teamId = state.cloudSync.teamId
  const playerIdMap = state.cloudSync.playerIdMap

  const loadResolved = useCallback(async () => {
    const client = supabase
    if (!gameId || !client) return null

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
      if (!byPlayer[row.player_id]) byPlayer[row.player_id] = {}
      byPlayer[row.player_id][row.stat_id] = {
        value: row.value,
        source: row.source ?? undefined,
        recorder_count: row.recorder_count ?? undefined,
      }
    }
    return byPlayer
  }, [gameId])

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
      if (!byPlayer[row.player_id]) byPlayer[row.player_id] = {}
      if (!byPlayer[row.player_id][row.stat_id]) byPlayer[row.player_id][row.stat_id] = []
      byPlayer[row.player_id][row.stat_id].push({
        recorded_by: row.recorded_by,
        display_name: nameByUserId[row.recorded_by] ?? 'Unknown',
        value: row.value,
      })
    }
    return byPlayer
  }, [gameId])

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
      if (!byPlayer[row.player_id]) byPlayer[row.player_id] = []
      byPlayer[row.player_id].push({
        user_id: row.user_id,
        display_name: nameByUserId[row.user_id] ?? 'Unknown',
        is_primary: row.is_primary,
      })
    }
    return byPlayer
  }, [gameId])

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
    const { error } = await supabase.rpc('set_primary_recorder', {
      p_game_id: gameId,
      p_player_id: remotePlayerId,
      p_user_id: userId,
    })
    setSettingPrimaryFor(null)
    if (error) return
    setResolvedKey(k => k + 1)
    loadCheckouts().then(data => setCheckoutsByPlayer(data ?? null))
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
    for (const player of players) {
      const remoteId = playerIdMap[player.id] ?? player.id
      const entries = resolvedStats[remoteId]
      if (!entries) continue
      for (const [statId, entry] of Object.entries(entries)) {
        const needsReview =
          entry.source === 'averaged' || (entry.recorder_count ?? 0) > 1
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
  }, [sport, isFinalCloudGame, resolvedStats, players, playerIdMap])

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

  const teamScore = players.reduce(
    (total, player) => total + computePlayerScore(sport, getPlayerStats(player.id)),
    0
  )

  const allStatIds = sport.categories.flatMap(c => c.actions.map(a => a.id))

  const teamTotals: Record<string, number> = {}
  for (const statId of allStatIds) {
    teamTotals[statId] = players.reduce(
      (sum, p) => sum + (getPlayerStats(p.id)[statId] || 0),
      0
    )
  }

  const handleNewGame = () => {
    dispatch({ type: 'RESET_GAME' })
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

  const canFinalizeCloudGame = Boolean(
    isConfigured && user && supabase && state.cloudSync.gameId && !isFinalCloudGame
  )
  const handleFinalizeCloudGame = async () => {
    if (!canFinalizeCloudGame || !state.cloudSync.gameId) return
    setFinalizeError(null)
    setFinalizing(true)

    const { error } = await supabase!
      .from('games')
      .update({
        status: 'final',
        opponent_score: opponentScore,
      })
      .eq('id', state.cloudSync.gameId)

    setFinalizing(false)
    if (error) {
      setFinalizeError(error.message)
      return
    }

    // Clear persisted game so this game no longer appears as in progress (fixes
    // "completed game appears as both final and in progress").
    try {
      localStorage.removeItem(GAME_STORAGE_KEY)
    } catch {
      // ignore
    }
    dispatch({ type: 'RESET_GAME' })
    navigate('/games')
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
          <div id="primary-recorder-section" className="card mb-4">
            <h3 className="text-sm font-semibold text-slate-600 mb-2">Primary recorder</h3>
            <p className="text-xs text-slate-500 mb-3">Whose stats count as official for each player. Change to fix discrepancies.</p>
            <div className="space-y-2">
              {players.map(player => {
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
        )}

        {isFinalCloudGame && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
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
          </div>
        )}

        {sport.categories.map(category => (
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
                    {category.actions.map(action => (
                      <th
                        key={action.id}
                        className="text-center py-2 px-2 font-semibold text-slate-600 min-w-[40px]"
                      >
                        {action.shortLabel}
                      </th>
                    ))}
                    {category.showTotal && (
                      <th className="text-center py-2 px-2 font-bold text-slate-700 min-w-[50px]">
                        TOT
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {players.map(player => {
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
                        {category.actions.map(action => {
                          const meta = getResolvedMeta(player.id, action.id)
                          const needsReview = meta && (meta.source === 'averaged' || (meta.recorder_count ?? 0) > 1)
                          const submissions = getCellSubmissions(player.id, action.id)

                          return (
                            <td key={action.id} className="text-center py-2 px-2 tabular-nums">
                              <span className="inline-flex flex-wrap items-center justify-center gap-1">
                                {viewMode === 'primary' ? (
                                  <>
                                    {stats[action.id] || 0}
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
                    {category.actions.map(action => (
                      <td key={action.id} className="text-center py-2 px-2 tabular-nums">
                        {teamTotals[action.id] || 0}
                      </td>
                    ))}
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
        ))}

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
              className="btn-secondary w-full"
            >
              ← Back to Cloud Games
            </button>
          ) : (
            <button
              onClick={() => navigate('/game')}
              className="btn-primary w-full"
            >
              ← Back to Game
            </button>
          )}
          <button
            onClick={handleNewGame}
            className="btn-secondary w-full"
          >
            New Game
          </button>
        </div>

        {correcting && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-10"
            onClick={handleCloseCorrect}
            role="dialog"
            aria-modal="true"
            aria-labelledby="correct-stat-title"
          >
            <div
              className="card max-w-sm w-full"
              onClick={e => e.stopPropagation()}
            >
              <h3 id="correct-stat-title" className="font-semibold text-slate-700 mb-3">
                Correct stat
              </h3>
              <p className="text-sm text-slate-600 mb-2">
                {correcting.playerName} — {correcting.statLabel}
              </p>
              <p className="text-xs text-slate-500 mb-3">
                Current value: {correcting.currentValue}
              </p>
              {correctError && (
                <div className="mb-3 text-sm text-red-600">{correctError}</div>
              )}
              <input
                type="number"
                min={0}
                value={correctValue}
                onChange={e => setCorrectValue(e.target.value)}
                className="input-field mb-3"
                placeholder="New value"
              />
              <input
                type="text"
                value={correctReason}
                onChange={e => setCorrectReason(e.target.value)}
                className="input-field mb-4"
                placeholder="Reason (optional)"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveCorrection}
                  disabled={savingCorrection}
                  className="btn-primary flex-1"
                >
                  {savingCorrection ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={handleCloseCorrect}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
