import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../../context/GameContext'
import BasketballCourt from './BasketballCourt'
import ShootingSummary from './ShootingSummary'
import ConfirmDialog from '../ConfirmDialog'
import CourtEventPopup, { type CourtEvent } from './CourtEventPopup'
import { classifyShotZone, isThreePointer } from './courtGeometry'
import { isTeamPseudoPlayer, sortTeamPlayersFirst } from '../../lib/teamPlayers'
import { shotsForSelection, type ShotChartSelection } from '../../lib/shotChartViews'
import type { ActionLogEntry, Player, ShotRecord } from '../../types'

function newShotId(): string {
  return `shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

/** Court tap awaiting resolution in the event popup. */
interface PendingCourtTap {
  x: number
  y: number
  shotType: '2pt' | '3pt'
}

function popupPlayerLabel(player: Player | undefined): string {
  if (!player) return 'Player'
  if (isTeamPseudoPlayer(player)) return `★ ${player.name}`
  return `#${player.number || '?'} ${player.name.split(' ')[0]}`
}

/** "{view}" part of the context label (§3.3): who the chart is currently showing. */
function viewLabel(selection: ShotChartSelection, players: Player[]): string {
  if (selection.kind === 'all') return 'All shots'
  const target = players.find(p => p.id === selection.playerId)
  if (!target) return 'All shots'
  if (isTeamPseudoPlayer(target)) return `${target.name} (team)`
  return `#${target.number || '?'} ${target.name}`
}

/** Empty-state copy per view (§3.4 / D10). */
function emptyCopy(selection: ShotChartSelection, players: Player[]): string {
  if (selection.kind === 'all') return 'No chart shots recorded.'
  const target = players.find(p => p.id === selection.playerId)
  if (!target) return 'No chart shots recorded.'
  if (isTeamPseudoPlayer(target)) return `No shots recorded for ${target.name} yet.`
  return `No shots for ${target.name}.`
}

function shootingLine(shots: ShotRecord[]): string {
  const att = shots.length
  const made = shots.filter(s => s.made).length
  if (att === 0) return '0/0'
  return `${made}/${att} (${Math.round((made / att) * 100)}%)`
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
}

export default function ShotChartPanel({ selection }: ShotChartPanelProps) {
  const { state, dispatch } = useGame()
  const { players, activePlayerId, shotChart, actionLog } = state
  const [pendingTap, setPendingTap] = useState<PendingCourtTap | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [pulseShotId, setPulseShotId] = useState<string | null>(null)
  const pendingPulseIdRef = useRef<string | null>(null)

  const selectorPlayers = useMemo(() => sortTeamPlayersFirst(players), [players])
  const effectivePlayerId =
    activePlayerId && players.some(p => p.id === activePlayerId)
      ? activePlayerId
      : selectorPlayers[0]?.id ?? null
  const effectivePlayer = players.find(p => p.id === effectivePlayerId)

  // A confirmed court tap only opens the popup — nothing is logged until a choice is made.
  const onCourtTap = useCallback(
    (x: number, y: number) => {
      if (!effectivePlayerId) return
      try {
        navigator.vibrate?.(10)
      } catch {
        /* ignore */
      }
      setPendingTap({ x, y, shotType: isThreePointer(x, y) ? '3pt' : '2pt' })
    },
    [effectivePlayerId]
  )

  const handlePopupPick = useCallback(
    (event: CourtEvent) => {
      const tap = pendingTap
      setPendingTap(null)
      if (!tap || !effectivePlayerId) return

      if (event.kind === 'stat') {
        dispatch({
          type: 'INCREMENT_STAT',
          playerId: effectivePlayerId,
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
        shotType: tap.shotType,
        zone: classifyShotZone(tap.x, tap.y),
        playerId: effectivePlayerId,
        timestamp: Date.now(),
      }
      dispatch({ type: 'ADD_SHOT', shot })
    },
    [dispatch, effectivePlayerId, pendingTap]
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
          Shot chart — {viewLabel(selection, players)}
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
        <ShootingSummary shots={visibleShots} emptyMessage={emptyCopy(selection, players)} />
      </div>

      <button
        type="button"
        disabled={!canUndoShot}
        onClick={() => dispatch({ type: 'UNDO_LAST_SHOT' })}
        className="w-full py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-800
                   disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99] transition-transform"
      >
        ↩ Undo last shot
      </button>
      {undoShotSubtitle && (
        <p className="text-center text-xs text-slate-500 -mt-1">{undoShotSubtitle}</p>
      )}
      <button
        type="button"
        disabled={!canClearShots}
        onClick={() => setShowClearConfirm(true)}
        className="w-full py-2 rounded-xl text-sm font-medium border border-rose-200 bg-rose-50 text-rose-800
                   disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99] transition-transform"
      >
        Clear all chart shots
      </button>

      {pendingTap && (
        <CourtEventPopup
          playerLabel={popupPlayerLabel(effectivePlayer)}
          shotType={pendingTap.shotType}
          onPick={handlePopupPick}
          onCancel={() => setPendingTap(null)}
        />
      )}

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear all chart shots?"
        message="Remove every shot from the chart and undo their scoring stats? Stat taps (no location) are not changed."
        confirmLabel="Clear shots"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleClearChartConfirm}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  )
}
