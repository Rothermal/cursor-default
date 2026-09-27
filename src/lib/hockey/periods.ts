import type { GameEventPeriod } from '../gameEvents/types'
import type { HockeyMatchRules, HockeyPeriodKind, HockeyPeriodRef } from './types'

const PERIOD_PATTERN = /^(regulation|overtime)-([1-9]\d?)$/
/** Overtime orders sit after any regulation period count. */
const OVERTIME_ORDER_BASE = 100

/** Regulation periods use `regulation-{n}` (order n); overtime uses `overtime-{n}` (order 100 + n). */
export function hockeyPeriod(kind: HockeyPeriodKind, number: number): GameEventPeriod {
  return {
    id: `${kind}-${number}`,
    order: kind === 'regulation' ? number : OVERTIME_ORDER_BASE + number,
  }
}

export function parseHockeyPeriod(period: GameEventPeriod): HockeyPeriodRef | null {
  const match = PERIOD_PATTERN.exec(period.id)
  if (!match) return null
  const kind = match[1] as HockeyPeriodKind
  const number = Number(match[2])
  return hockeyPeriod(kind, number).order === period.order ? { kind, number } : null
}

/** Period length from the frozen rules, or null when the rules do not allow that period. */
export function hockeyPeriodDurationMs(rules: HockeyMatchRules, period: HockeyPeriodRef): number | null {
  if (period.kind === 'regulation') {
    return period.number <= rules.regulation.periods ? rules.regulation.periodLengthMs : null
  }
  if (!rules.overtime) return null
  if (period.number > 1 && !rules.overtime.repeat) return null
  return rules.overtime.lengthMs
}

export function formatHockeyPeriod(period: HockeyPeriodRef): string {
  if (period.kind === 'regulation') return `Period ${period.number}`
  return period.number === 1 ? 'Overtime' : `Overtime ${period.number}`
}
