import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { supabase } from '../lib/supabase'
import { playersWithTeamPlaceholders, TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../lib/teamPlayers'
import { sportDashboardPath } from '../lib/sportNavigation'
import {
  hasStartedBasketballEventGame,
  isBasketballMatchRulesV2,
  isBasketballEventSetupIntent,
  prepareBasketballGameStart,
} from '../lib/basketball'
import {
  basketballSetupAccountScope,
  basketballSetupEventMatchesAuthority,
  basketballSetupRuleDifferences,
  clearBasketballSetupDraft,
  loadBasketballSetupDraft,
  refreshBasketballSetupDraftEvent,
  saveBasketballSetupDraft,
  type BasketballSetupAuthoritySnapshot,
  type BasketballSetupDraft,
} from '../lib/basketball/setupDraft'
import { loadLatestBasketballSetupAuthority } from '../lib/basketball/setupAuthority'
import { basketballRuleFieldLabel } from '../lib/basketball/profileDiffPresentation'
import BasketballSetupRulesReview from '../components/basketball/BasketballSetupRulesReview'
import type { BasketballRulesField } from '../lib/basketball/types'

function generateLocalId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function splitName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return { firstName: 'Player', lastName: '' }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

export default function PlayerSetup() {
  const navigate = useNavigate()
  const { state, dispatch, activeLocalGameId } = useGame()
  const { user, isConfigured } = useAuth()
  const { basketballSettings, basketballSettingsSync } = useSettings()
  const sport = state.sport
  const cloudTeamId = state.cloudSync.teamId
  const isCloudRoster = Boolean(cloudTeamId && isConfigured && user && supabase)
  const isBasketballEventIntent = isBasketballEventSetupIntent(state)
  const individualPlayers = state.players.filter(
    player => player.id !== TEAM_PLAYER_HOME_ID && player.id !== TEAM_PLAYER_OPP_ID
  )
  const displayedPlayers = isBasketballEventIntent ? individualPlayers : state.players

  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [rosterLoading, setRosterLoading] = useState(Boolean(cloudTeamId && state.players.length === 0))
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const accountScope = basketballSetupAccountScope(user?.id ?? null)
  const [basketballSetupDraft, setBasketballSetupDraft] = useState<BasketballSetupDraft | null>(
    () => loadBasketballSetupDraft(accountScope)
  )
  const [staleAuthority, setStaleAuthority] = useState<{
    latest: BasketballSetupAuthoritySnapshot
    differences: BasketballRulesField[]
  } | null>(null)
  const [rulesNotice, setRulesNotice] = useState<string | null>(null)
  const cloudRosterLoadedRef = useRef(false)
  /** Latest roster for merging when a cloud fetch completes (effect deps omit `players` on purpose). */
  const playersRef = useRef(state.players)
  playersRef.current = state.players
  /** Same for `gameInfo`: async roster load must not use a stale null from the effect closure. */
  const gameInfoRef = useRef(state.gameInfo)
  gameInfoRef.current = state.gameInfo

  useEffect(() => {
    if (hasStartedBasketballEventGame(state)) navigate('/game', { replace: true })
  }, [navigate, state])

  useEffect(() => {
    setBasketballSetupDraft(loadBasketballSetupDraft(accountScope))
    setStaleAuthority(null)
    setRulesNotice(null)
  }, [accountScope])

  useEffect(() => {
    if (!sport?.teamCategories?.length || !state.gameInfo) return
    const nextPlayers = playersWithTeamPlaceholders(
      state.players,
      state.gameInfo.teamName,
      state.gameInfo.opponentName
    )
    if (!nextPlayers) return
    dispatch({ type: 'SET_PLAYERS', players: nextPlayers })
  }, [sport, state.gameInfo, state.players, dispatch])

  useEffect(() => {
    if (!isCloudRoster || !cloudTeamId || cloudRosterLoadedRef.current) return
    const hasRosterRows = state.players.some(
      p => p.id !== TEAM_PLAYER_HOME_ID && p.id !== TEAM_PLAYER_OPP_ID
    )
    if (hasRosterRows) {
      cloudRosterLoadedRef.current = true
      setRosterLoading(false)
      return
    }

    let cancelled = false
    const loadRoster = async () => {
      setRosterLoading(true)
      setRosterError(null)
      const { data, error } = await supabase!
        .from('team_players')
        .select('player_id, jersey_number, players!inner(id, first_name, last_name)')
        .eq('team_id', cloudTeamId)
        .eq('is_active', true)
        .order('joined_at', { ascending: true })

      if (cancelled) return
      if (error) {
        setRosterError(error.message)
        setRosterLoading(false)
        return
      }

      type RosterRow = { player_id: string; jersey_number: string | null; players: { id: string; first_name: string; last_name: string | null } }
      let loadedPlayers = ((data ?? []) as unknown as RosterRow[]).map(row => ({
        id: row.player_id,
        name: `${row.players.first_name ?? ''} ${row.players.last_name ?? ''}`.trim(),
        number: row.jersey_number ?? '',
        stats: {},
      }))

      const gameInfoNow = gameInfoRef.current
      if (sport?.teamCategories?.length && gameInfoNow) {
        const snapshot = playersRef.current
        const mergedForTeams = [
          ...snapshot.filter(
            p => p.id === TEAM_PLAYER_HOME_ID || p.id === TEAM_PLAYER_OPP_ID
          ),
          ...loadedPlayers.filter(
            p => p.id !== TEAM_PLAYER_HOME_ID && p.id !== TEAM_PLAYER_OPP_ID
          ),
        ]
        loadedPlayers =
          playersWithTeamPlaceholders(
            mergedForTeams,
            gameInfoNow.teamName,
            gameInfoNow.opponentName
          ) ?? loadedPlayers
      }

      const snapshot = playersRef.current
      const apiIds = new Set(loadedPlayers.map(p => p.id))
      const extraFromLocal = snapshot.filter(
        p =>
          p.id !== TEAM_PLAYER_HOME_ID &&
          p.id !== TEAM_PLAYER_OPP_ID &&
          !apiIds.has(p.id)
      )
      if (extraFromLocal.length > 0) {
        loadedPlayers = [...loadedPlayers, ...extraFromLocal]
      }

      const idMap = loadedPlayers.reduce<Record<string, string>>((map, player) => {
        map[player.id] = player.id
        return map
      }, {})

      dispatch({ type: 'SET_PLAYERS', players: loadedPlayers })
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          playerIdMap: idMap,
          lastError: null,
        },
      })
      if (loadedPlayers.length > 0 && !state.activePlayerId) {
        dispatch({ type: 'SET_ACTIVE_PLAYER', playerId: loadedPlayers[0].id })
      }

      cloudRosterLoadedRef.current = true
      setRosterLoading(false)
    }

    void loadRoster()
    return () => {
      cancelled = true
    }
    // Intentionally omit state.players: we only need initial cloud roster fetch when list is empty of roster rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [
    cloudTeamId,
    dispatch,
    isCloudRoster,
    sport?.teamCategories?.length,
    state.activePlayerId,
    state.gameInfo,
  ])

  const handleAddPlayer = async () => {
    if (!name.trim()) return

    setRosterError(null)
    let playerId = generateLocalId()
    if (isCloudRoster && cloudTeamId && user) {
      setSaving(true)
      const { firstName, lastName } = splitName(name)

      const { data: playerData, error: playerError } = await supabase!
        .from('players')
        .insert({
          first_name: firstName,
          last_name: lastName || null,
          created_by: user.id,
        })
        .select('id')
        .single()

      if (playerError || !playerData) {
        setSaving(false)
        setRosterError(playerError?.message ?? 'Could not save player')
        return
      }

      playerId = playerData.id as string

      const { error: rosterError } = await supabase!
        .from('team_players')
        .upsert(
          { team_id: cloudTeamId, player_id: playerId, jersey_number: number.trim() || null, is_active: true },
          { onConflict: 'team_id,player_id' }
        )

      setSaving(false)
      if (rosterError) {
        setRosterError(rosterError.message)
        return
      }

      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          playerIdMap: {
            ...state.cloudSync.playerIdMap,
            [playerId]: playerId,
          },
          lastError: null,
        },
      })
    }

    dispatch({
      type: 'ADD_PLAYER',
      player: {
        id: playerId,
        name: name.trim(),
        number: number.trim(),
        stats: {},
      },
    })
    if (!state.activePlayerId) {
      dispatch({ type: 'SET_ACTIVE_PLAYER', playerId })
    }
    setName('')
    setNumber('')
  }

  const handleRemovePlayer = async (playerId: string) => {
    setRosterError(null)
    if (isCloudRoster && cloudTeamId) {
      const remotePlayerId = state.cloudSync.playerIdMap[playerId] ?? playerId
      setSaving(true)
      const { error } = await supabase!
        .from('team_players')
        .update({ is_active: false })
        .eq('team_id', cloudTeamId)
        .eq('player_id', remotePlayerId)
      setSaving(false)
      if (error) {
        setRosterError(error.message)
        return
      }
    }

    dispatch({ type: 'REMOVE_PLAYER', playerId })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void handleAddPlayer()
    }
  }

  const canStart = isBasketballEventIntent
    ? individualPlayers.length > 0
    : state.players.length > 0

  if (!sport || !state.gameInfo) {
    navigate(sport ? sportDashboardPath(sport.id) : '/')
    return null
  }

  const startBasketballEventGame = (draft: BasketballSetupDraft) => {
    if (!draft.event) return
    if (!isBasketballMatchRulesV2(draft.event.reviewedRules)) {
      setRosterError('Clock and lineup Basketball games require the upcoming setup workflow.')
      return
    }
    const result = prepareBasketballGameStart(state, {
      recorderUserId: user?.id ?? null,
      reviewedSetup: {
        rulesSnapshot: draft.event.reviewedRules,
        rulesSource: draft.event.reviewedRulesSource,
        sourceTeamId: draft.source.kind === 'team' ? draft.source.teamId : null,
        sourceSeasonId: draft.source.kind === 'team' ? draft.source.seasonId : null,
        courtOrientation: draft.display.defaultCourtFlipped ? 'flipped' : 'standard',
      },
    })
    if (!result.ok) {
      setRosterError(result.message)
      return
    }
    clearBasketballSetupDraft(accountScope)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    navigate('/game')
  }

  const handleStart = async () => {
    if (!canStart) return
    if (isBasketballEventIntent) {
      const draft = basketballSetupDraft
      if (
        !draft?.event ||
        draft.authority !== 'sport_events' ||
        draft.committedLocalGameId !== activeLocalGameId
      ) {
        setRosterError('The reviewed Basketball setup is missing or belongs to another game.')
        return
      }
      setStarting(true)
      setRosterError(null)
      setRulesNotice(null)
      const latest = await loadLatestBasketballSetupAuthority({
        source: draft.source,
        personalSettings: basketballSettings,
        personalRevision: basketballSettingsSync.revision,
        cloudEnabled: Boolean(
          isConfigured &&
          user &&
          supabase &&
          typeof navigator !== 'undefined' &&
          navigator.onLine
        ),
      })
      setStarting(false)
      if (!latest.ok) {
        setRosterError(latest.error)
        return
      }
      if (!basketballSetupEventMatchesAuthority(draft.event, latest.authority)) {
        const refreshed = refreshBasketballSetupDraftEvent(draft.event, latest.authority)
        setStaleAuthority({
          latest: latest.authority,
          differences: refreshed.ok
            ? basketballSetupRuleDifferences(
                draft.event.reviewedRules,
                refreshed.event.reviewedRules
              )
            : [],
        })
        setRosterError(refreshed.ok ? null : refreshed.error)
        return
      }
      startBasketballEventGame(draft)
      return
    }
    if (!state.activePlayerId && state.players.length > 0) {
      dispatch({ type: 'SET_ACTIVE_PLAYER', playerId: state.players[0].id })
    }
    if (state.cloudSync.teamId) {
      navigate('/checkout')
    } else {
      navigate('/game')
    }
  }

  const refreshReviewedDefaults = () => {
    if (!basketballSetupDraft?.event || !staleAuthority) return
    const refreshed = refreshBasketballSetupDraftEvent(
      basketballSetupDraft.event,
      staleAuthority.latest
    )
    if (!refreshed.ok) {
      setRosterError(refreshed.error)
      return
    }
    const next: BasketballSetupDraft = {
      ...basketballSetupDraft,
      updatedAt: new Date().toISOString(),
      event: refreshed.event,
    }
    const saved = saveBasketballSetupDraft(next)
    if (!saved.ok) {
      setRosterError(saved.error)
      return
    }
    setBasketballSetupDraft(next)
    setStaleAuthority(null)
    setRosterError(null)
    setRulesNotice('Defaults refreshed. Review the rules below, then start the game again.')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-4`}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/setup')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">{sport.icon} {sport.name}</h1>
            <p className="text-sm opacity-80">
              {state.gameInfo.teamName} vs {state.gameInfo.opponentName}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">Add Players</h2>

        {isBasketballEventIntent && basketballSetupDraft?.event && (
          <div className="mb-5">
            <BasketballSetupRulesReview event={basketballSetupDraft.event} readOnly />
          </div>
        )}
        {rulesNotice && (
          <p role="status" className="mb-4 border-y border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            {rulesNotice}
          </p>
        )}
        {staleAuthority && basketballSetupDraft?.event && (
          <section className="mb-5 space-y-3 border-y border-amber-300 bg-amber-50 px-3 py-3">
            <div>
              <h3 className="text-sm font-semibold text-amber-950">Basketball defaults changed</h3>
              <p className="mt-1 text-xs text-amber-800">
                {staleAuthority.differences.length > 0
                  ? `Changed fields: ${staleAuthority.differences.map(basketballRuleFieldLabel).join(', ')}.`
                  : 'The source revision changed, but the effective game rules are unchanged.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary" onClick={refreshReviewedDefaults}>
                Refresh Defaults
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => startBasketballEventGame(basketballSetupDraft)}
              >
                Keep Reviewed Draft
              </button>
            </div>
          </section>
        )}

        {isCloudRoster && (
          <div className="card mb-3 bg-blue-50 border-blue-200 text-blue-800 text-xs">
            Roster is synced with your selected cloud team.
          </div>
        )}
        {rosterLoading && (
          <div className="card mb-3 text-sm text-slate-500 animate-pulse">
            Loading saved roster...
          </div>
        )}
        {rosterError && (
          <div className="card mb-3 bg-red-50 border-red-200 text-red-700 text-sm">
            {rosterError}
          </div>
        )}

        <div className="card mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={number}
              onChange={e => setNumber(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="#"
              className="input-field w-16 text-center"
              inputMode="numeric"
            />
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Player name"
              className="input-field flex-1"
            />
            <button
              onClick={() => { void handleAddPlayer() }}
              disabled={!name.trim() || saving || rosterLoading}
              className="btn-primary px-4 py-2"
            >
              {saving ? 'Saving...' : 'Add'}
            </button>
          </div>
        </div>

        {displayedPlayers.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="text-4xl mb-2">👥</p>
            <p>Add at least one player to start</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayedPlayers.map(player => (
              <div key={player.id} className="card flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className={`
                    ${sport.theme.bg} text-white w-10 h-10 rounded-full
                    flex items-center justify-center font-bold text-sm
                  `}>
                    {player.number || '—'}
                  </span>
                  <span className="font-medium text-slate-700">{player.name}</span>
                </div>
                <button
                  onClick={() => { void handleRemovePlayer(player.id) }}
                  disabled={saving || rosterLoading}
                  className="text-slate-400 hover:text-red-500 transition-colors px-2 py-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 space-y-3">
          {starting && (
            <p role="status" className="text-center text-sm font-semibold text-slate-600">
              Checking the latest Basketball rules...
            </p>
          )}
          <button
            onClick={() => { void handleStart() }}
            disabled={!canStart || rosterLoading || saving || starting}
            className="btn-primary w-full"
          >
            Start Game ({displayedPlayers.length} player{displayedPlayers.length !== 1 ? 's' : ''}) →
          </button>
          <p className="text-center text-xs text-slate-400">
            {isBasketballEventIntent
              ? 'The event-game roster is fixed after start'
              : 'You can add more players during the game'}
          </p>
        </div>
      </div>
    </div>
  )
}
