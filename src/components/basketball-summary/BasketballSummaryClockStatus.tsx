import { Clock3 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { deriveBasketballClockDisplay } from '../../lib/basketball/clockProjection'
import { formatBasketballDurationMs } from '../../lib/basketball/duration'
import { isBasketballMatchRulesV3, resolveBasketballPeriodSegment } from '../../lib/basketball/rules'
import type { BasketballSummarySource } from '../../lib/basketball/summarySource'

interface Props {
  source: BasketballSummarySource
}

export default function BasketballSummaryClockStatus({ source }: Props) {
  const sportState = source.state.sportGameState?.sportId === 'basketball'
    ? source.state.sportGameState
    : null
  const rules = sportState?.setup.rulesSnapshot
  const clock = sportState?.projection.clock
  const [now, setNow] = useState(() => new Date().toISOString())

  useEffect(() => {
    if (!clock?.running) return
    const interval = window.setInterval(() => setNow(new Date().toISOString()), 250)
    return () => window.clearInterval(interval)
  }, [clock?.running])

  const display = useMemo(() => {
    if (!sportState || !clock?.periodId || !rules || !isBasketballMatchRulesV3(rules)) return null
    const segment = resolveBasketballPeriodSegment(rules, clock.periodId)
    if (!segment) return null
    const value = deriveBasketballClockDisplay(
      clock,
      segment.durationMs,
      rules.clockDisplayDirection,
      now
    )
    return value ? { value, segment } : null
  }, [clock, now, rules, sportState])

  if (!clock || !display) return null
  const remote = source.kind !== 'local'
  return (
    <section className="border-b border-slate-200 bg-white px-4 py-3" aria-label="Summary clock status">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <Clock3 size={18} className="text-blue-700" />
        <strong className="text-sm text-slate-900">{display.segment.label}</strong>
        <span className="text-lg font-bold tabular-nums text-slate-950">
          {formatBasketballDurationMs(display.value.displayMs)}
        </span>
        <span className="text-xs font-semibold uppercase text-slate-500">
          {clock.running ? 'Running' : 'Paused'}{remote ? ' / remote display' : ''}
        </span>
        {display.value.reachedExpiration && (
          <span className="text-xs font-bold text-amber-700">Expiration awaiting an authoritative pause</span>
        )}
        {display.value.backwardClockWarning && (
          <span className="text-xs font-bold text-amber-700">Device time moved behind the clock anchor</span>
        )}
      </div>
    </section>
  )
}
