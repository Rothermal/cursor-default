import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../../context/GameContext'
import { useSettings } from '../../context/SettingsContext'
import { useAuth } from '../../context/AuthContext'
import BasketballCourt from './BasketballCourt'
import ShootingSummary from './ShootingSummary'
import ConfirmDialog from '../ConfirmDialog'
import CourtEventPopup, { type CourtEvent } from './CourtEventPopup'
import { isThreePointer, zoneForForcedShotType } from './courtGeometry'
import { formatCompactGameStatLine } from '../../lib/statDisplay'
import { isTeamPseudoPlayer, sortTeamPlayersFirst } from '../../lib/teamPlayers'
import {
  shootingLine,
  shotsForSelection,
  shotViewEmptyCopy,
  shotViewLabel,
  type ShotChartSelection,
} from '../../lib/shotChartViews'
import type { ActionLogEntry, Player, ShotRecord } from '../../types'
import {
  basketballCaptureTargetForPlayerId,
  basketballPlayerIdForCapturePreferences,
  captureBasketballCourtEvent,
  hasStartedBasketballEventGame,
} from '../../lib/basketball/commands'

function newShotId(): string {
  return `shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

/** Court tap awaiting resolution in the event popup. */
interface PendingCourtTap {
  x: number
  y: number
  shotType: '2pt' | '3pt'
  /** Locked logging target; only changes via in-popup player picker (F6). */
  playerId: string
}

function popupPlayerLabel(player: Player | undefined): string {
  if (!player) return 'Player'
  if (isTeamPseudoPlayer(player)) return `★ ${player.name}`
  return `#${player.number || '?'} ${player.name.split(' ')[0]}`
}


function shotLabelFromLogEntry(
  entry: ActionLogEntry | undefined,
  players: Player[]
): string | null {
  if (!entry?.shotId || entry.type !== 'increment' || !entry.playerId || !entry.statId) {
    return null
  }
  const player = players.find(p => p.id === entry.playerId)
  const num = player?.number?.trim()
  const who = num ? `#${num}` : player?.name?.split(' ')[0] ?? 'Player'
  const sid = entry.statId
  let kind = sid.toUpperCase()
  if (sid === '2pt') kind = '2PT Made'
  else if (sid === '2pt_miss') kind = '2PT Miss'
  else if (sid === '3pt') kind = '3PT Made'
  else if (sid === '3pt_miss') kind = '3PT Miss'
  return `Last: ${who} ${kind}`
}

/**
 * Inline court section for the single-page Game Tracker: half-court (tap to record),
 * shooting-by-zone summary, undo last shot, and clear chart. Reads game state via
 * `useGame()`; no route concerns.
 */
interface ShotChartPanelProps {
  /** View filter (F2): which shots the court and zone summary display. Recording always
   *  targets the active player regardless of the view (D14). */
  selection: ShotChartSelection
  /** Same action as the sticky player strip; used by F6's in-popup player switch. */
  onSelectPlayer: (playerId: string) => void
}

export default function ShotChartPanel({ selection, onSelectPlayer }: ShotChartPanelProps) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const { settings } = useSettings()
  const { sport, players, activePlayerId, shotChart, actionLog } = state
  const [pendingTap, setPendingTap] = useState<PendingCourtTap | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [pulseShotId, setPulseShotId] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const pendingPulseIdRef = useRef<string | null>(null)
  const isEventBasketball = hasStartedBasketballEventGame(state)

  const selectorPlayers = useMemo(() => sortTeamPlayersFirst(players), [players])
  const persistedCapturePlayerId = isEventBasketball
    ? basketballPlayerIdForCapturePreferences(state)
    : null
  const effectivePlayerId =
    (persistedCapturePlayerId ?? activePlayerId) &&
    players.some(p => p.id === (persistedCapturePlayerId ?? activePlayerId))
      ? persistedCapturePlayerId ?? activePlayerId
      : selectorPlayers[0]?.id ?? null
  const pendingLoggingPlayer = pendingTap
    ? players.find(p => p.id === pendingTap.playerId)
    : undefined

  // A confirmed court tap only opens the popup — nothing is logged until a choice is made.
  const onCourtTap = useCallback(
    (x: number, y: number) => {
      if (!effectivePlayerId) return
      try {
        navigator.vibrate?.(10)
      } catch {
        /* ignore */
      }
      setPendingTap({ x, y, shotType: isThreePointer(x, y) ? '3pt' : '2pt', playerId: effectivePlayerId })
      setCaptureError(null)
      if (isEventBasketball) {
        const target = basketballCaptureTargetForPlayerId(state, effectivePlayerId)
        if (target.ok) {
          dispatch({
            type: 'SET_BASKETBALL_CAPTURE_PREFERENCES',
            preferences: {
              teamSide: target.value.teamSide,
              selectedParticipantId: target.value.selection.kind === 'participant'
                ? target.value.selection.participantId
                : null,
              selectionInitialized: true,
              shotValueOverride: null,
            },
          })
        }
      }
    },
    [dispatch, effectivePlayerId, isEventBasketball, state]
  )

  const handlePopupSelectPlayer = useCallback(
    (playerId: string) => {
      onSelectPlayer(playerId)
      setPendingTap(prev => (prev ? { ...prev, playerId } : null))
      setCaptureError(null)
      if (isEventBasketball) {
        const target = basketballCaptureTargetForPlayerId(state, playerId)
        if (target.ok) {
          dispatch({
            type: 'SET_BASKETBALL_CAPTURE_PREFERENCES',
            preferences: {
              teamSide: target.value.teamSide,
              selectedParticipantId: target.value.selection.kind === 'participant'
                ? target.value.selection.participantId
                : null,
              selectionInitialized: true,
            },
          })
        }
      }
    },
    [dispatch, isEventBasketball, onSelectPlayer, state]
  )

  const handlePopupPick = useCallback(
    (event: CourtEvent) => {
      const tap = pendingTap
      if (!tap) return
      const loggingPlayerId = tap.playerId

      if (isEventBasketball) {
        const result = captureBasketballCourtEvent(state, {
          recorderUserId: user?.id ?? null,
          playerId: loggingPlayerId,
          point: { x: tap.x, y: tap.y },
          event,
        })
        if (!result.ok) {
          setCaptureError(result.message)
          return
        }
        const shotId = event.kind === 'shot' ? result.eventIds[0] : null
        pendingPulseIdRef.current = shotId
        setCaptureError(null)
        setPendingTap(null)
        dispatch({ type: 'HYDRATE_STATE', state: result.state })
        return
      }

      setPendingTap(null)

      if (event.kind === 'stat') {
        dispatch({
          type: 'INCREMENT_STAT',
          playerId: loggingPlayerId,
          statId: event.statId,
        })
        return
      }

      const id = newShotId()
      pendingPulseIdRef.current = id
      const shot: ShotRecord = {
        id,
        x: tap.x,
        y: tap.y,
        made: event.made,
        shotType: event.shotType,
        zone: zoneForForcedShotType(tap.x, tap.y, event.shotType),
        playerId: loggingPlayerId,
        timestamp: Date.now(),
      }
      dispatch({ type: 'ADD_SHOT', shot })
      if (event.assistPlayerId) {
        dispatch({
          type: 'INCREMENT_STAT',
          playerId: event.assistPlayerId,
          statId: 'ast',
          linkedShotId: id,
        })
      }
      if (event.rebound) {
        dispatch({
          type: 'INCREMENT_STAT',
          playerId: event.rebound.playerId,
          statId: event.rebound.statId,
          linkedShotId: id,
        })
      }
    },
    [dispatch, isEventBasketball, pendingTap, state, user?.id]
  )

  useEffect(() => {
    const pending = pendingPulseIdRef.current
    if (!pending) return
    const last = shotChart[shotChart.length - 1]
    if (last?.id === pending) {
      pendingPulseIdRef.current = null
      setPulseShotId(last.id)
      const t = window.setTimeout(() => setPulseShotId(null), 650)
      return () => window.clearTimeout(t)
    }
  }, [shotChart])

  const lastEntry = actionLog.length > 0 ? actionLog[actionLog.length - 1] : undefined
  const canUndoShot = Boolean(lastEntry?.shotId)
  const undoShotSubtitle = useMemo(
    () => shotLabelFromLogEntry(lastEntry, players),
    [lastEntry, players]
  )
  const canClearShots = shotChart.length > 0

  // What the court + zone summary display (F2); recording is unaffected by the filter.
  const visibleShots = useMemo(
    () => shotsForSelection(shotChart, players, selection),
    [shotChart, players, selection]
  )

  const handleClearChartConfirm = () => {
    setShowClearConfirm(false)
    dispatch({ type: 'CLEAR_SHOT_CHART' })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <p className="text-sm font-semibold text-slate-600 truncate">
          Shot chart — {shotViewLabel(selection, players)}
        </p>
        <p className="text-sm font-bold text-slate-700 shrink-0">{shootingLine(visibleShots)}</p>
      </div>

      <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
        <BasketballCourt
          shots={visibleShots}
          onCourtTap={onCourtTap}
          className="w-full"
          newlyPlacedShotId={pulseShotId}
          emptyHint="Tap the court to log an event."
        />
      </div>

      <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
        <ShootingSummary shots={visibleShots} emptyMessage={shotViewEmptyCopy(selection, players)} />
      </div>

      {!isEventBasketball && <button
        type="button"
        disabled={!canUndoShot}
        onClick={() => dispatch({ type: 'UNDO_LAST_SHOT' })}
        className="w-full py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-800
                   disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99] transition-transform"
      >
        ↩ Undo last shot
      </button>}
      {!isEventBasketball && undoShotSubtitle && (
        <p className="text-center text-xs text-slate-500 -mt-1">{undoShotSubtitle}</p>
      )}
      {!isEventBasketball && <button
        type="button"
        disabled={!canClearShots}
        onClick={() => setShowClearConfirm(true)}
        className="w-full py-2 rounded-xl text-sm font-medium border border-rose-200 bg-rose-50 text-rose-800
                   disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99] transition-transform"
      >
        Clear all chart shots
      </button>}

      {pendingTap && (
        <CourtEventPopup
          playerLabel={popupPlayerLabel(pendingLoggingPlayer)}
          playerStatLine={
            sport && pendingLoggingPlayer
              ? formatCompactGameStatLine(sport, pendingLoggingPlayer.stats)
              : undefined
          }
          players={players}
          activePlayerId={pendingTap.playerId}
          onSelectPlayer={handlePopupSelectPlayer}
          reboundPromptAfterMissEnabled={settings.courtCapture.reboundPromptAfterMiss}
          shotType={pendingTap.shotType}
          errorMessage={captureError}
          onShotTypeChange={shotType => {
            if (!isEventBasketball) return
            dispatch({
              type: 'SET_BASKETBALL_CAPTURE_PREFERENCES',
              preferences: {
                shotValueOverride: shotType === pendingTap.shotType
                  ? null
                  : shotType === '3pt' ? 3 : 2,
              },
            })
          }}
          onPick={handlePopupPick}
          onCancel={() => {
            setPendingTap(null)
            setCaptureError(null)
            if (isEventBasketball) {
              dispatch({
                type: 'SET_BASKETBALL_CAPTURE_PREFERENCES',
                preferences: { shotValueOverride: null },
              })
            }
          }}
        />
      )}

      {!isEventBasketball && <ConfirmDialog
        open={showClearConfirm}
        title="Clear all chart shots?"
        message="Remove every shot from the chart and undo their scoring stats? Linked assists and rebound prompts are cleared too. Other stat taps are not changed."
        confirmLabel="Clear shots"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleClearChartConfirm}
        onCancel={() => setShowClearConfirm(false)}
      />}
    </div>
  )
}
