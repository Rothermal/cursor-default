import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useGame } from '../../context/GameContext'
import { useSettings } from '../../context/SettingsContext'
import { useAuth } from '../../context/AuthContext'
import { RotateCcw } from 'lucide-react'
import BasketballCourt from './BasketballCourt'
import BasketballFullCourt from './BasketballFullCourt'
import ShootingSummary from './ShootingSummary'
import ConfirmDialog from '../ConfirmDialog'
import CourtEventPopup, { type CourtEvent } from './CourtEventPopup'
import {
  basketballCourtOrientationForState,
  isThreePointer,
  zoneForForcedShotType,
} from './courtGeometry'
import { formatCompactGameStatLine } from '../../lib/statDisplay'
import {
  isTeamPseudoPlayer,
  sortTeamPlayersFirst,
  TEAM_PLAYER_HOME_ID,
  TEAM_PLAYER_OPP_ID,
} from '../../lib/teamPlayers'
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
  setBasketballCourtOrientation,
  switchBasketballEnds,
} from '../../lib/basketball/commands'
import {
  basketballDirectionTowardTap,
  basketballShotFeet,
  isBasketballBeyondHalfCourt,
} from '../../lib/basketball/fullCourtGeometry'
import {
  basketballFullCourtShotLocations,
  basketballFullCourtShotRecords,
  basketballSideAttacking,
  basketballSideDirection,
  isBasketballFullCourtGame,
} from '../../lib/basketball/fullCourtView'
import { gameSideDisplayName } from '../../lib/display'
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
import BasketballShotEditor from '../basketball/BasketballShotEditor'
import { legacyBasketballShotActorError } from '../../lib/basketball/legacyCourtCapture'
import { basketballActorPlayers } from '../../lib/basketball/liveActors'
import { sideOf } from '../../lib/shotChartViews'
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
  side: 'home' | 'opponent'
  /** Full court only: the canonical tap, 0..1 each way. */
  fullCourtPoint?: { x: number; y: number }
  /** Full court only: the recorder kept a backcourt shot, so the prompt stays closed. */
  backcourtKept?: boolean
}

/** A full-court tap's location for a side, stamped with that side's current basket. */
function fullCourtTapLocation(
  state: Parameters<typeof basketballSideDirection>[0],
  point: { x: number; y: number },
  side: 'home' | 'opponent'
) {
  const direction = basketballSideDirection(state, side === 'opponent' ? 'opponent' : 'tracked')
  return direction ? { ...point, attackingDirection: direction } : null
}

function fullCourtShotType(location: ReturnType<typeof fullCourtTapLocation>): '2pt' | '3pt' {
  if (!location) return '2pt'
  const feet = basketballShotFeet(location)
  return isThreePointer(feet.x, feet.y) ? '3pt' : '2pt'
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
  /** Display-only filter, independent of capture attribution. */
  selection: ShotChartSelection
  /** Same action as the sticky player strip; used by F6's in-popup player switch. */
  onSelectPlayer: (playerId: string) => void
  /** Explicit workspace target; popup attribution stays local to this capture. */
  capturePlayerId?: string | null
  /** Keeps chart review available while blocking new events for an unavailable player. */
  captureDisabled?: boolean
  captureDisabledMessage?: string
  compact?: boolean
  surfaceActions?: ReactNode
  reviewControls?: ReactNode
  /** `fullCourtPoint` is the tapped full-court spot a foul keeps (BKE-7C). */
  onAdministrative?: (
    kind: 'foul' | 'free_throw',
    side: 'tracked' | 'opponent',
    fullCourtPoint: { x: number; y: number } | null
  ) => void
}

export default function ShotChartPanel({
  selection,
  onSelectPlayer,
  capturePlayerId,
  captureDisabled = false,
  captureDisabledMessage,
  onAdministrative,
  compact = false,
  surfaceActions,
  reviewControls,
}: ShotChartPanelProps) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const { basketballSettings } = useSettings()
  const { sport, activePlayerId, shotChart, actionLog } = state
  // Older local event games may predate side metadata on the derived player rows.
  const players = useMemo(() => {
    if (state.sportGameState?.sportId !== 'basketball') return state.players
    const sides = new Map(Object.values(state.sportGameState.projection.participants)
      .map(participant => [participant.playerId, participant.teamSide]))
    return state.players.map(player => {
      const side = sides.get(player.id)
      return side && !isTeamPseudoPlayer(player)
        ? { ...player, teamSide: side === 'opponent' ? 'opponent' as const : 'home' as const }
        : player
    })
  }, [state.players, state.sportGameState])
  const [pendingTap, setPendingTap] = useState<PendingCourtTap | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [pulseShotId, setPulseShotId] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  const [shotDetail, setShotDetail] = useState<BasketballShotDetailModel | null>(null)
  const [shotDetailReviewComplete, setShotDetailReviewComplete] = useState(false)
  const [timelineCorrectionIntent, setTimelineCorrectionIntent] = useState<BasketballTimelineCorrectionIntent | null>(null)
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
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
  const basketballCorrectionsOpen = state.sportGameState?.sportId === 'basketball' && (
    state.sportGameState.projection.status === 'in_progress' ||
    state.sportGameState.projection.status === 'period_break'
  )
  const courtOrientation = basketballCourtOrientationForState(state)
  const fullCourt = isEventBasketball && isBasketballFullCourtGame(state)
  const fullCourtLocations = useMemo(
    () => fullCourt ? basketballFullCourtShotLocations(state) : null,
    [fullCourt, state]
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
    () => isEventBasketball && overlapChoices.length > 1
      ? buildBasketballTimelineReview(state)
      : null,
    [isEventBasketball, overlapChoices.length, state]
  )

  const selectorPlayers = useMemo(() => sortTeamPlayersFirst(players), [players])
  const popupPlayers = useMemo(() => {
    return basketballActorPlayers(state, players)
  }, [players, state])
  const persistedCapturePlayerId = isEventBasketball
    ? basketballPlayerIdForCapturePreferences(state)
    : null
  const effectivePlayerId = capturePlayerId !== undefined ? capturePlayerId :
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
      const player = players.find(candidate => candidate.id === effectivePlayerId)
      if (!player) return
      setPendingTap({ x, y, shotType: isThreePointer(x, y) ? '3pt' : '2pt', playerId: effectivePlayerId, side: sideOf(player) })
      setCaptureError(null)
      if (isEventBasketball && capturePlayerId === undefined) {
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
    [capturePlayerId, dispatch, effectivePlayerId, isEventBasketball, state, players]
  )

  // Full court: the tapped half picks the team shooting at that basket (BKE-7 §3.3).
  const onFullCourtTap = useCallback(
    (point: { x: number; y: number }) => {
      const attacking = basketballSideAttacking(state, basketballDirectionTowardTap(point.x))
      if (!attacking) return
      const side = attacking === 'opponent' ? 'opponent' : 'home'
      const effective = players.find(candidate => candidate.id === effectivePlayerId)
      const playerId = effective && sideOf(effective) === side
        ? effective.id
        : side === 'opponent' ? TEAM_PLAYER_OPP_ID : TEAM_PLAYER_HOME_ID
      if (!players.some(candidate => candidate.id === playerId)) return
      try {
        navigator.vibrate?.(10)
      } catch {
        /* ignore */
      }
      setPendingTap({
        x: 0,
        y: 0,
        fullCourtPoint: point,
        shotType: fullCourtShotType(fullCourtTapLocation(state, point, side)),
        playerId,
        side,
      })
      setCaptureError(null)
    },
    [effectivePlayerId, players, state]
  )

  const handlePopupSelectSide = useCallback((side: 'home' | 'opponent') => {
    setPendingTap(prev => {
      if (!prev?.fullCourtPoint || prev.side === side) return prev
      return {
        ...prev,
        side,
        playerId: side === 'opponent' ? TEAM_PLAYER_OPP_ID : TEAM_PLAYER_HOME_ID,
        shotType: fullCourtShotType(fullCourtTapLocation(state, prev.fullCourtPoint, side)),
        backcourtKept: false,
      }
    })
    setCaptureError(null)
  }, [state])

  const handlePopupSwitchEnds = useCallback(() => {
    const result = switchBasketballEnds(state, { recorderUserId: user?.id ?? null })
    if (!result.ok) {
      setCaptureError(result.message)
      return
    }
    setCaptureError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    // The same team now shoots at the near basket; its value is measured from there.
    setPendingTap(prev => prev?.fullCourtPoint
      ? { ...prev, shotType: fullCourtShotType(fullCourtTapLocation(result.state, prev.fullCourtPoint, prev.side)) }
      : prev)
  }, [dispatch, state, user?.id])

  const handlePopupSelectPlayer = useCallback(
    (playerId: string) => {
      const player = popupPlayers.find(candidate => candidate.id === playerId)
      if (!pendingTap || !player || sideOf(player) !== pendingTap.side) return
      if (capturePlayerId === undefined) onSelectPlayer(playerId)
      setPendingTap(prev => (prev ? { ...prev, playerId } : null))
      setCaptureError(null)
      if (isEventBasketball && capturePlayerId === undefined) {
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
    [capturePlayerId, dispatch, isEventBasketball, onSelectPlayer, state, pendingTap, popupPlayers]
  )

  const handlePopupPick = useCallback(
    (event: CourtEvent) => {
      const tap = pendingTap
      if (!tap) return
      const loggingPlayerId = tap.playerId
      const actorIds = [loggingPlayerId, ...(event.kind === 'shot'
        ? [event.assistPlayerId, event.rebound?.playerId].filter((id): id is string => Boolean(id)) : [])]
      if (actorIds.some(id => !basketballActorPlayers(state, players).some(player => player.id === id))) {
        setCaptureError('A selected player is no longer eligible. Cancel and choose an active player.')
        return
      }

      if (isEventBasketball) {
        const result = captureBasketballCourtEvent(state, {
          recorderUserId: user?.id ?? null,
          playerId: loggingPlayerId,
          ...(tap.fullCourtPoint
            ? { fullCourtPoint: tap.fullCourtPoint }
            : { point: { x: tap.x, y: tap.y } }),
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

      if (event.kind === 'shot') {
        const actorError = legacyBasketballShotActorError(players.find(player => player.id === loggingPlayerId))
        if (actorError) {
          setCaptureError(actorError)
          return
        }
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
    [dispatch, isEventBasketball, pendingTap, players, state, user?.id]
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

  // Full court: the same shots in full-court feet, for drawing and overlap checks.
  const fullCourtShots = useMemo(
    () => fullCourtLocations ? basketballFullCourtShotRecords(visibleShots, fullCourtLocations) : null,
    [fullCourtLocations, visibleShots]
  )
  const pendingFullCourtLocation = pendingTap?.fullCourtPoint
    ? fullCourtTapLocation(state, pendingTap.fullCourtPoint, pendingTap.side)
    : null
  const pendingBackcourt = Boolean(
    pendingFullCourtLocation &&
    !pendingTap?.backcourtKept &&
    isBasketballBeyondHalfCourt(pendingFullCourtLocation)
  )
  const trackedDirection = fullCourt ? basketballSideDirection(state, 'tracked') : null
  const trackedName = gameSideDisplayName(state.gameInfo, 'tracked')
  const opponentName = gameSideDisplayName(state.gameInfo, 'opponent')
  const fullCourtLabels = trackedDirection
    ? trackedDirection === 'left_to_right'
      ? { left: opponentName, right: trackedName }
      : { left: trackedName, right: opponentName }
    : undefined

  const detailForShot = useCallback((shot: ShotRecord) => {
    if (!isEventBasketball) return legacyBasketballShotDetail(state, shot.id)
    return basketballReview
      ? basketballShotDetailFromReview(state, basketballReview, shot.id)
      : basketballShotDetailForEvent(state, shot.id)
  }, [basketballReview, isEventBasketball, state])

  const openShotDetail = useCallback((shot: ShotRecord) => {
    if (!isEventBasketball) {
      const detail = legacyBasketballShotDetail(state, shot.id)
      setShotDetailReviewComplete(false)
      if (detail) setShotDetail(detail)
      return
    }
    const review = basketballReview ?? buildBasketballTimelineReview(state)
    const detail = basketballShotDetailFromReview(state, review, shot.id)
    setShotDetailReviewComplete(review.complete)
    if (detail) setShotDetail(detail)
  }, [basketballReview, isEventBasketball, state])

  const handleMarkerActivate = useCallback((
    shot: ShotRecord,
    marker: SVGGElement,
    point: { x: number; y: number } | null
  ) => {
    const activation = resolveBasketballMarkerActivation(fullCourtShots ?? visibleShots, shot.id, point)
    if (!activation) return
    if (activation.kind === 'chooser') {
      overlapOriginRef.current = marker
      setOverlapChoices(activation.shots)
      return
    }
    openShotDetail(activation.shot)
  }, [fullCourtShots, openShotDetail, visibleShots])

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

  const flipCourt = () => {
    const result = setBasketballCourtOrientation(
      state,
      courtOrientation === 'standard' ? 'flipped' : 'standard'
    )
    if (!result.ok) {
      setCaptureError(result.message)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const chartHeader = (
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-sm font-semibold text-content-muted truncate">
          Shot chart — {shotViewLabel(selection, players)}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <p className="text-sm font-bold text-content">{shootingLine(visibleShots)}</p>
          <button
            type="button"
            onClick={flipCourt}
            className="grid h-8 w-8 place-items-center rounded border border-line bg-surface text-content-muted"
            title="Flip court"
            aria-label="Flip court"
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
  )

  return (
    <div className="space-y-2">
      {!compact && <>{reviewControls}{chartHeader}</>}
      <div className={compact ? 'overflow-hidden border border-line bg-surface' : 'rounded-xl bg-surface border border-line p-3 shadow-sm'}>
        {fullCourtShots ? (
          <BasketballFullCourt
            shots={fullCourtShots}
            onCourtTap={eventCaptureOpen && !captureDisabled ? onFullCourtTap : undefined}
            onMarkerActivate={handleMarkerActivate}
            className="w-full"
            newlyPlacedShotId={pulseShotId}
            flipped={courtOrientation === 'flipped'}
            labels={fullCourtLabels}
            emptyHint={eventCaptureOpen && !captureDisabled}
          />
        ) : <BasketballCourt
          shots={visibleShots}
          onCourtTap={eventCaptureOpen && !captureDisabled ? onCourtTap : undefined}
          onMarkerActivate={handleMarkerActivate}
          className="w-full"
          newlyPlacedShotId={pulseShotId}
          flipped={courtOrientation === 'flipped'}
          emptyHint={eventCaptureOpen && !captureDisabled
            ? 'Tap the court to log an event.'
            : captureDisabledMessage ?? 'Court capture is unavailable between periods or after completion.'}
        />}
      </div>

      {surfaceActions}
      {compact && <>{chartHeader}{reviewControls}</>}

      {captureDisabled && captureDisabledMessage && (
        <p role="status" className="rounded-lg border border-warning-line bg-warning px-3 py-2 text-sm font-semibold text-warning-content">
          {captureDisabledMessage}
        </p>
      )}

      {correctionError && (
        <p role="alert" className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm font-semibold text-danger-content">
          {correctionError}
        </p>
      )}

      <details open={compact ? undefined : true} className="border-b border-line py-2">
        <summary className={compact ? 'min-h-9 cursor-pointer text-sm font-semibold text-content-muted' : 'hidden'}>Chart details &amp; tools</summary>
      <div className={compact ? 'border-y border-line bg-surface p-3' : 'rounded-xl bg-surface border border-line p-3 shadow-sm'}>
        <ShootingSummary shots={visibleShots} emptyMessage={shotViewEmptyCopy(selection, players)} />
      </div>

      {!isEventBasketball && <button
        type="button"
        disabled={!canUndoShot}
        onClick={() => dispatch({ type: 'UNDO_LAST_SHOT' })}
        className="w-full py-2.5 rounded-xl text-sm font-semibold border border-line bg-surface text-content
                   disabled:bg-control-disabled disabled:text-content-disabled disabled:pointer-events-none active:scale-[0.99] transition-transform"
      >
        ↩ Undo last shot
      </button>}
      {isEventBasketball && <button
        type="button"
        disabled={!canUndoEventShot}
        onClick={handleEventShotUndo}
        className="w-full py-2.5 rounded-xl text-sm font-semibold border border-line bg-surface text-content
                   disabled:bg-control-disabled disabled:text-content-disabled disabled:pointer-events-none active:scale-[0.99] transition-transform"
        title={canUndoEventShot ? 'Undo the newest court capture' : 'A newer non-shot capture must be undone first'}
      >
        ↩ Undo last shot
      </button>}
      {!isEventBasketball && undoShotSubtitle && (
        <p className="text-center text-xs text-content-subtle -mt-1">{undoShotSubtitle}</p>
      )}
      {!isEventBasketball && <button
        type="button"
        disabled={!canClearShots}
        onClick={() => setShowClearConfirm(true)}
        className="w-full py-2 rounded-xl text-sm font-medium border border-danger-line bg-danger text-danger-content
                   disabled:bg-control-disabled disabled:text-content-disabled disabled:pointer-events-none active:scale-[0.99] transition-transform"
      >
        Clear all chart shots
      </button>}
      {isEventBasketball && <button
        type="button"
        disabled={!eventCaptureOpen || !clearPreview || clearPreview.shotCount === 0}
        onClick={() => setShowClearConfirm(true)}
        className="w-full py-2 rounded-xl text-sm font-medium border border-danger-line bg-danger text-danger-content
                   disabled:bg-control-disabled disabled:text-content-disabled disabled:pointer-events-none active:scale-[0.99] transition-transform"
      >
        Clear all chart shots
      </button>}

      </details>

      {pendingTap && (
        <CourtEventPopup
          playerLabel={popupPlayerLabel(pendingLoggingPlayer)}
          playerStatLine={
            sport && pendingLoggingPlayer
              ? formatCompactGameStatLine(sport, pendingLoggingPlayer.stats)
              : undefined
          }
          players={popupPlayers}
          playerLabels={state.sportGameState?.sportId === 'basketball' ? Object.fromEntries(
            Object.values(state.sportGameState.projection.participants).filter(participant => participant.playerId)
              .map(participant => [participant.playerId!, `#${participant.number || '?'} ${participant.displayName}${participant.position ? ` (${participant.position})` : ''}`])
          ) : undefined}
          activePlayerId={pendingTap.playerId}
          captureSide={pendingTap.side}
          onAdministrative={onAdministrative ? kind => {
            const side = pendingTap.side === 'opponent' ? 'opponent' : 'tracked'
            const fullCourtPoint = pendingTap.fullCourtPoint ?? null
            setPendingTap(null)
            setCaptureError(null)
            onAdministrative(kind, side, fullCourtPoint)
          } : undefined}
          turnoverAvailable={isEventBasketball}
          onSelectPlayer={handlePopupSelectPlayer}
          sideOptions={pendingTap.fullCourtPoint ? [
            { side: 'home', label: trackedName },
            { side: 'opponent', label: opponentName },
          ] : undefined}
          onSelectSide={pendingTap.fullCourtPoint ? handlePopupSelectSide : undefined}
          backcourtPrompt={pendingBackcourt ? {
            onSwitchEnds: handlePopupSwitchEnds,
            onKeep: () => setPendingTap(prev => prev ? { ...prev, backcourtKept: true } : prev),
          } : null}
          reboundPromptAfterMissEnabled={basketballSettings.capture.reboundPromptAfterMiss}
          shotType={pendingTap.shotType}
          errorMessage={captureError}
          shotDisabledMessage={isEventBasketball ? null : legacyBasketballShotActorError(pendingLoggingPlayer)}
          onShotTypeChange={shotType => {
            if (!isEventBasketball || capturePlayerId !== undefined) return
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
            if (isEventBasketball && capturePlayerId === undefined) {
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
          className="fixed inset-0 z-[55] flex items-end justify-center bg-overlay/[0.4] p-3 sm:items-center sm:p-4"
          onClick={closeOverlapChooser}
        >
          <section
            ref={overlapDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="overlapping-shots-title"
            className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
            onClick={event => event.stopPropagation()}
          >
            <header className="border-b border-line px-4 py-3">
              <h2 id="overlapping-shots-title" className="text-base font-bold text-content">Select shot</h2>
            </header>
            <div className="max-h-[55vh] divide-y divide-line overflow-y-auto">
              {overlapChoices.map((shot, index) => {
                const detail = detailForShot(shot)
                return (
                  <button
                    key={shot.id}
                    ref={index === 0 ? overlapFirstChoiceRef : undefined}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-info"
                    onClick={() => {
                      closeOverlapChooser()
                      openShotDetail(shot)
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-content">
                        {detail?.ordinalLabel ?? 'Shot'} | {detail?.shooterLabel ?? 'Unknown shooter'}
                      </span>
                      <span className="mt-0.5 block text-xs font-medium text-content-subtle">
                        {detail ? `${detail.resultLabel} ${detail.valueLabel}` : shot.made ? 'Made' : 'Missed'}
                      </span>
                    </span>
                    <span className={`h-3 w-3 shrink-0 rounded-full ${shot.made ? 'bg-success' : 'bg-danger'}`} />
                  </button>
                )
              })}
            </div>
            <footer className="shrink-0 border-t border-line px-4 py-3">
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
          onEdit={shotDetailReviewComplete && basketballCorrectionsOpen && shotDetail.source === 'event'
            ? () => {
                setShotDetail(null)
                setEditingShotId(shotDetail.shotId)
              }
            : undefined}
          onRemove={shotDetailReviewComplete && basketballCorrectionsOpen && shotDetail.source === 'event'
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

      {editingShotId && (
        <BasketballShotEditor
          eventId={editingShotId}
          onClose={() => setEditingShotId(null)}
          onApplied={eventId => {
            setEditingShotId(null)
            setPulseShotId(eventId)
            window.setTimeout(() => setPulseShotId(null), 1_200)
          }}
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
