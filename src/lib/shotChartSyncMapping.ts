import type { ShotRecord } from '../types'

/** True when at least one chart shot can be written using `playerIdMap` (non-empty remote id). */
export function hasMappableChartShot(shotChart: ShotRecord[], playerIdMap: Record<string, string>): boolean {
  return shotChart.some(shot => Boolean(playerIdMap[shot.playerId]))
}
