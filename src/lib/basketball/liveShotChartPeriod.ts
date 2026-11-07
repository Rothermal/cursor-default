import type { GameState, ShotRecord } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'

/** Which shots the live court shows: the current period's (default) or the whole game's. */
export type BasketballLiveShotScope = 'period' | 'game'

export interface BasketballLiveChartPeriod {
  id: string
  label: string
}

/**
 * The period the live court is scoped to: the one in progress, or between periods
 * (and after the final buzzer) the most recently completed one. Null before tip-off.
 */
export function basketballLiveChartPeriod(state: GameState): BasketballLiveChartPeriod | null {
  if (state.sportGameState?.sportId !== 'basketball') return null
  const projection = state.sportGameState.projection
  const id = projection.currentPeriodId
    ?? projection.completedPeriodIds[projection.completedPeriodIds.length - 1]
    ?? null
  if (!id) return null
  const segment = projection.periods.find(period => period.id === id)
  return { id, label: segment?.label ?? id }
}

/**
 * Live shots logged in one period, matched by shot event id. Display only: recording,
 * stats and summaries still read the whole game's shot chart.
 */
export function basketballShotsInPeriod(
  state: GameState,
  shots: ShotRecord[],
  periodId: string
): ShotRecord[] {
  const inPeriod = new Set<string>()
  for (const event of state.eventStream?.events ?? []) {
    if (
      isGameEventEnvelope(event) &&
      event.sportId === 'basketball' &&
      event.eventType === 'basketball.shot' &&
      event.period.id === periodId
    ) inPeriod.add(event.id)
  }
  return shots.filter(shot => inPeriod.has(shot.id))
}
