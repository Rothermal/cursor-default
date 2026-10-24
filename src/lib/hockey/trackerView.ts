import type { GameEvent } from '../gameEvents/types'
import { hockeyPlayMarkers, hockeyShotMarkers } from './captureCommands'
import type { HockeyMatchSetup, HockeySide } from './types'

export interface HockeyTrackerFilters {
  family: 'all' | 'shots' | 'plays'
  side: 'all' | HockeySide
  scope: 'match' | 'current'
}

/** Display filters never supply live capture context or change the replay source. */
export function hockeyTrackerMarkers(
  setup: HockeyMatchSetup,
  events: readonly GameEvent[],
  currentPeriodId: string | null,
  filters: HockeyTrackerFilters
) {
  const visible = events.filter(event =>
    (filters.side === 'all' || event.teamSide === filters.side) &&
    (filters.scope === 'match' || (currentPeriodId !== null && event.period.id === currentPeriodId)))
  return [
    ...(filters.family === 'plays' ? [] : hockeyShotMarkers(setup, visible)),
    ...(filters.family === 'shots' ? [] : hockeyPlayMarkers(setup, visible)),
  ]
}
