import type { GameEventPeriod } from '../gameEvents/types'
import type { BaseballHalf } from './types'

const PERIOD_PATTERN = /^inning-([1-9]\d?)-(top|bottom)$/

/** Half-innings use `inning-{n}-top|bottom` with order 2n-1 and 2n. */
export function baseballPeriod(inning: number, half: BaseballHalf): GameEventPeriod {
  return {
    id: `inning-${inning}-${half}`,
    order: inning * 2 - (half === 'top' ? 1 : 0),
  }
}

export function parseBaseballPeriod(
  period: GameEventPeriod
): { inning: number; half: BaseballHalf } | null {
  const match = PERIOD_PATTERN.exec(period.id)
  if (!match) return null
  const inning = Number(match[1])
  const half = match[2] as BaseballHalf
  return baseballPeriod(inning, half).order === period.order ? { inning, half } : null
}

export function formatBaseballHalf(inning: number, half: BaseballHalf): string {
  return `${half === 'top' ? 'Top' : 'Bottom'} ${inning}`
}
