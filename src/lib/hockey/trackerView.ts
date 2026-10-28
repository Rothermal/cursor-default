import type { GameEvent } from '../gameEvents/types'
import { hockeyPlayMarkers, hockeyShotMarkers, type HockeyShotMarker, type HockeyRinkPlayMarker } from './captureCommands'
import { HOCKEY_RINK_LENGTH_FT, HOCKEY_RINK_WIDTH_FT } from './rinkGeometry'
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

/** Review overlapping visible marker disks; never moves or groups saved events. */
export function hockeyTrackerMarkerIds(markers: readonly (HockeyShotMarker | HockeyRinkPlayMarker)[], id: string): string[] {
  const selected = markers.find(marker => marker.id === id)
  if (!selected) return []
  return markers.filter(marker => Math.hypot(
    (marker.x - selected.x) * HOCKEY_RINK_LENGTH_FT,
    (marker.y - selected.y) * HOCKEY_RINK_WIDTH_FT
  ) <= 9.2).map(marker => marker.id).sort()
}
