import { useState } from 'react'
import type { GameState } from '../../types'
import type { GameEventPeriod } from '../../lib/gameEvents/types'
import {
  basketballHistoricalDisplayMs,
  basketballHistoricalElapsedMs,
  defaultBasketballHistoricalTime,
} from '../../lib/basketball/historicalTime'

export default function BasketballHistoricalTimeField({
  state,
  period,
  elapsedMs,
  onChange,
}: {
  state: GameState
  period: GameEventPeriod
  elapsedMs: number | null
  onChange: (elapsedMs: number | null) => void
}) {
  const resolved = defaultBasketballHistoricalTime(state, period)
  const durationMs = resolved.ok ? resolved.durationMs : null
  const countDown = resolved.ok && resolved.countDown
  const displayMs = durationMs === null || elapsedMs === null
    ? null
    : basketballHistoricalDisplayMs(durationMs, elapsedMs, countDown)
  const [value, setValue] = useState(() => formatTime(displayMs))

  if (durationMs === null) return null

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">
        Game time ({countDown ? 'remaining' : 'elapsed'})
      </span>
      <input
        value={value}
        onChange={event => {
          const next = event.target.value
          setValue(next)
          const parsed = parseTime(next)
          if (parsed !== null) {
            onChange(basketballHistoricalElapsedMs(durationMs, parsed, countDown))
          }
        }}
        onBlur={() => {
          if (parseTime(value) === null) onChange(null)
        }}
        inputMode="numeric"
        placeholder="8:00"
        aria-describedby="basketball-historical-time-help"
        className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm font-semibold tabular-nums text-slate-800"
      />
      <span id="basketball-historical-time-help" className="mt-1 block text-xs text-slate-500">
        Enter minutes and seconds from 0:00 through {formatTime(durationMs)}.
      </span>
    </label>
  )
}

function parseTime(value: string): number | null {
  const match = value.trim().match(/^(\d{1,3}):([0-5]\d)(?:\.(\d))?$/)
  if (!match) return null
  return (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(match[3] ?? 0) * 100
}

function formatTime(valueMs: number | null): string {
  if (valueMs === null) return ''
  const clamped = Math.max(0, valueMs)
  const totalSeconds = Math.floor(clamped / 1000)
  const tenths = Math.floor((clamped % 1000) / 100)
  const base = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
  return tenths > 0 ? `${base}.${tenths}` : base
}
