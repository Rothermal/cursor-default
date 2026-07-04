import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../../context/GameContext'
import BasketballCourt from './BasketballCourt'
import ShootingSummary from './ShootingSummary'
import ConfirmDialog from '../ConfirmDialog'
import { classifyShotZone, isThreePointer } from './courtGeometry'
import { sortTeamPlayersFirst } from '../../lib/teamPlayers'
import type { ActionLogEntry, Player, ShotRecord } from '../../types'

function newShotId(): string {
  return `shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
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
export default function ShotChartPanel() {
  const { state, dispatch } = useGame()
  const { players, activePlayerId, shotChart, actionLog } = state
  const [mode, setMode] = useState<'made' | 'missed'>('made')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [pulseShotId, setPulseShotId] = useState<string | null>(null)
  const pendingPulseIdRef = useRef<string | null>(null)

  const selectorPlayers = useMemo(() => sortTeamPlayersFirst(players), [players])
  const effectivePlayerId =
    activePlayerId && players.some(p => p.id === activePlayerId)
      ? activePlayerId
      : selectorPlayers[0]?.id ?? null

  const onCourtTap = useCallback(
    (x: number, y: number) => {
      if (!effectivePlayerId) return
      const three = isThreePointer(x, y)
      const id = newShotId()
      pendingPulseIdRef.current = id
      try {
        navigator.vibrate?.(10)
      } catch {
        /* ignore */
      }
      const shot: ShotRecord = {
        id,
        x,
        y,
        made: mode === 'made',
        shotType: three ? '3pt' : '2pt',
        zone: classifyShotZone(x, y),
        playerId: effectivePlayerId,
        timestamp: Date.now(),
      }
      dispatch({ type: 'ADD_SHOT', shot })
    },
    [dispatch, effectivePlayerId, mode]
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

  const handleClearChartConfirm = () => {
    setShowClearConfirm(false)
    dispatch({ type: 'CLEAR_SHOT_CHART' })
  }

  return (
    <div className="space-y-2">
      <div className="flex rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => setMode('made')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            mode === 'made'
              ? 'bg-emerald-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          Made
        </button>
        <button
          type="button"
          onClick={() => setMode('missed')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            mode === 'missed'
              ? 'bg-rose-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          Missed
        </button>
      </div>

      <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
        <BasketballCourt
          shots={shotChart}
          onCourtTap={onCourtTap}
          className="w-full"
          newlyPlacedShotId={pulseShotId}
          emptyHint="Tap the court to record shots."
        />
      </div>

      <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
        <ShootingSummary shots={shotChart} />
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
