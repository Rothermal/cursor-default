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
import {
  basketballLiveCaptureUnits,
  clearBasketballShotChart,
  previewBasketballClearShotChart,
  undoLatestBasketballCourtCapture,
} from '../../lib/basketball/courtCorrections'
import {
  basketballShotDetailFromReview,
  basketballShotDetailForEvent,
  buildBasketballTimelineReview,
  legacyBasketballShotDetail,
  resolveBasketballMarkerActivation,
  type BasketballShotDetailModel,
} from '../../lib/basketball/timeline'
import BasketballShotDetailDialog from '../basketball/BasketballShotDetailDialog'
import BasketballTimelineCorrectionDialog, {
  type BasketballTimelineCorrectionIntent,
} from '../basketball/BasketballTimelineCorrectionDialog'

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
  /** Keeps chart review available while blocking new events for an unavailable player. */
  captureDisabled?: boolean
  captureDisabledMessage?: string
}

export default function ShotChartPanel({
  selection,
  onSelectPlayer,
  captureDisabled = false,
  captureDisabledMessage,
}: ShotChartPanelProps) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const { settings } = useSettings()
  const { sport, players, activePlayerId, shotChart, actionLog } = state
  const [pendingTap, setPendingTap] = useState<PendingCourtTap | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [pulseShotId, setPulseShotId] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  const [shotDetail, setShotDetail] = useState<BasketballShotDetailModel | null>(null)
  const [timelineCorrectionIntent, setTimelineCorrectionIntent] = useState<BasketballTimelineCorrectionIntent | null>(null)
  const [overlapChoices, setOverlapChoices] = useState<ShotRecord[]>([])
  const pendingPulseIdRef = useRef<string | null>(null)
  const overlapDialogRef = useRef<HTMLElement>(null)
  const overlapFirstChoiceRef = useRef<HTMLButtonElement>(null)
  const overlapOriginRef = useRef<SVGGElement | null>(null)
  const isEventBasketball = hasStartedBasketballEventGame(state)
  const eventCaptureOpen = !isEventBasketball || (
    state.sportGameState?.sportId === 'basketball' &&
    state.sportGameState.projection.status === 'in_progress'
  )
  const eventCaptureUnits = useMemo(
    () => isEventBasketball ? basketballLiveCaptureUnits(state) : [],
    [isEventBasketball, state]
  )
  const clearPreview = useMemo(
    () => isEventBasketball ? previewBasketballClearShotChart(state) : null,
    [isEventBasketball, state]
  )
  const basketballReview = useMemo(
    () => isEventBasketball
      ? buildBasketballTimelineReview(state)
      : null,
    [isEventBasketball, state]
  )
  const timelineCorrectionsEnabled = Boolean(
    basketballReview?.complete &&
    state.sportGameState?.sportId === 'basketball' && (
      state.sportGameState.projection.status === 'in_progress' ||
      state.sportGameState.projection.status === 'period_break'
    )
  )

  const selectorPlayers = useMemo(() => sortTeamPlayersFirst(players), [players])
  const popupPlayers = useMemo(() => {
    if (!isEventBasketball || state.sportGameState?.sportId !== 'basketball') return players
    return players.filter(player => {
      if (isTeamPseudoPlayer(player)) return true
      const participant = Object.values(state.sportGameState!.projection.participants)
        .find(candidate => candidate.playerId === player.id)
      return participant && !participant.disqualified && !participant.ejected
    })
  }, [isEventBasketball, players, state.sportGameState])
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
        setCorrectionError(null)
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
  const canUndoEventShot = eventCaptureOpen && Boolean(eventCaptureUnits[0]?.containsLocatedFieldGoal)

  // What the court + zone summary display (F2); recording is unaffected by the filter.
  const visibleShots = useMemo(
    () => shotsForSelection(shotChart, players, selection),
    [shotChart, players, selection]
  )

  const detailForShot = useCallback((shot: ShotRecord) => {
    if (!isEventBasketball) return legacyBasketballShotDetail(state, shot.id)
    return basketballReview
      ? basketballShotDetailFromReview(state, basketballReview, shot.id)
      : basketballShotDetailForEvent(state, shot.id)
  }, [basketballReview, isEventBasketball, state])

  const openShotDetail = useCallback((shot: ShotRecord) => {
    const detail = detailForShot(shot)
    if (detail) setShotDetail(detail)
  }, [detailForShot])

  const handleMarkerActivate = useCallback((
    shot: ShotRecord,
    marker: SVGGElement,
    point: { x: number; y: number } | null
  ) => {
    const activation = resolveBasketballMarkerActivation(visibleShots, shot.id, point)
    if (!activation) return
    if (activation.kind === 'chooser') {
      overlapOriginRef.current = marker
      setOverlapChoices(activation.shots)
      return
    }
    openShotDetail(activation.shot)
  }, [openShotDetail, visibleShots])

  const closeOverlapChooser = useCallback(() => setOverlapChoices([]), [])

  useEffect(() => {
    if (overlapChoices.length <= 1) return
    const origin = overlapOriginRef.current
    overlapFirstChoiceRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeOverlapChooser()
        return
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(
        overlapDialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []
      )
      if (buttons.length === 0) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      origin?.focus()
    }
  }, [closeOverlapChooser, overlapChoices.length])

  const handleClearChartConfirm = () => {
    setShowClearConfirm(false)
    if (isEventBasketball) {
      const result = clearBasketballShotChart(state)
      if (!result.ok) {
        setCorrectionError(result.message)
        return
      }
      setCorrectionError(null)
      dispatch({ type: 'HYDRATE_STATE', state: result.state })
      return
    }
    dispatch({ type: 'CLEAR_SHOT_CHART' })
  }

  const handleEventShotUndo = () => {
    const result = undoLatestBasketballCourtCapture(state, new Date().toISOString(), true)
    if (!result.ok) {
      setCorrectionError(result.message)
      return
    }
    setCorrectionError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
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
          onCourtTap={eventCaptureOpen && !captureDisabled ? onCourtTap : undefined}
          onMarkerActivate={handleMarkerActivate}
          className="w-full"
          newlyPlacedShotId={pulseShotId}
          emptyHint={eventCaptureOpen && !captureDisabled
            ? 'Tap the court to log an event.'
            : captureDisabledMessage ?? 'Court capture is unavailable between periods or after completion.'}
        />
      </div>

      {captureDisabled && captureDisabledMessage && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          {captureDisabledMessage}
        </p>
      )}

      <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
        <ShootingSummary shots={visibleShots} emptyMessage={shotViewEmptyCopy(selection, players)} />
      </div>

      {correctionError && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
          {correctionError}
        </p>
      )}

      {!isEventBasketball && <button
        type="button"
        disabled={!canUndoShot}
        onClick={() => dispatch({ type: 'UNDO_LAST_SHOT' })}
        className="w-full py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-800
                   disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99] transition-transform"
      >
        ↩ Undo last shot
      </button>}
      {isEventBasketball && <button
        type="button"
        disabled={!canUndoEventShot}
        onClick={handleEventShotUndo}
        className="w-full py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-800
                   disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99] transition-transform"
        title={canUndoEventShot ? 'Undo the newest court capture' : 'A newer non-shot capture must be undone first'}
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
      {isEventBasketball && <button
        type="button"
        disabled={!eventCaptureOpen || !clearPreview || clearPreview.shotCount === 0}
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
          players={popupPlayers}
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

      {overlapChoices.length > 1 && (
        <div
          className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
          onClick={closeOverlapChooser}
        >
          <section
            ref={overlapDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="overlapping-shots-title"
            className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
            onClick={event => event.stopPropagation()}
          >
            <header className="border-b border-slate-200 px-4 py-3">
              <h2 id="overlapping-shots-title" className="text-base font-bold text-slate-900">Select shot</h2>
            </header>
            <div className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto">
              {overlapChoices.map((shot, index) => {
                const detail = detailForShot(shot)
                return (
                  <button
                    key={shot.id}
                    ref={index === 0 ? overlapFirstChoiceRef : undefined}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-blue-50"
                    onClick={() => {
                      closeOverlapChooser()
                      openShotDetail(shot)
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-900">
                        {detail?.ordinalLabel ?? 'Shot'} | {detail?.shooterLabel ?? 'Unknown shooter'}
                      </span>
                      <span className="mt-0.5 block text-xs font-medium text-slate-500">
                        {detail ? `${detail.resultLabel} ${detail.valueLabel}` : shot.made ? 'Made' : 'Missed'}
                      </span>
                    </span>
                    <span className={`h-3 w-3 shrink-0 rounded-full ${shot.made ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  </button>
                )
              })}
            </div>
            <footer className="border-t border-slate-200 px-4 py-3">
              <button type="button" className="btn-secondary w-full py-2.5" onClick={closeOverlapChooser}>
                Cancel
              </button>
            </footer>
          </section>
        </div>
      )}

      {shotDetail && (
        <BasketballShotDetailDialog
          detail={shotDetail}
          onClose={() => setShotDetail(null)}
          onRemove={timelineCorrectionsEnabled && shotDetail.source === 'event'
            ? () => {
                setShotDetail(null)
                setTimelineCorrectionIntent({
                  kind: 'remove',
                  eventId: shotDetail.shotId,
                  scope: 'event',
                })
              }
            : undefined}
        />
      )}

      {timelineCorrectionIntent && (
        <BasketballTimelineCorrectionDialog
          intent={timelineCorrectionIntent}
          onClose={() => setTimelineCorrectionIntent(null)}
          onApplied={() => setShotDetail(null)}
        />
      )}

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear all chart shots?"
        message={isEventBasketball && clearPreview
          ? `Remove ${clearPreview.shotCount} shot${clearPreview.shotCount === 1 ? '' : 's'}, ${clearPreview.linkedAssistCount} linked assist${clearPreview.linkedAssistCount === 1 ? '' : 's'}, and ${clearPreview.linkedReboundCount} linked rebound${clearPreview.linkedReboundCount === 1 ? '' : 's'}? ${clearPreview.unlinkedBlockCount} linked block${clearPreview.unlinkedBlockCount === 1 ? '' : 's'} will keep its stat and lose only the shot link.`
          : 'Remove every shot from the chart and undo their scoring stats? Linked assists and rebound prompts are cleared too. Other stat taps are not changed.'}
        confirmLabel="Clear shots"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleClearChartConfirm}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  )
}
