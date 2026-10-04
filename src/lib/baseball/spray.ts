import type { GameEvent } from '../gameEvents/types'
import { BASEBALL_BATTED_BALL_OPTIONS } from './capture'
import { BASEBALL_IN_PLAY_LABELS } from './recentPlays'
import { baseballPersonLabel } from './trackerView'
import type { BaseballBattedBallType, BaseballInPlay, BaseballInPlayResult, BaseballSportGameState, BaseballTeamSide } from './types'
import { groupBaseballUnits } from './units'

/**
 * The Summary's spray chart (BSB-5B): one point per located ball in play. Batter credit comes
 * from the replayed plate appearances, so a lineup correction moves the point's batter too.
 */

export type BaseballSprayResult = 'hit' | 'out' | 'error'

export interface BaseballSprayPoint {
  /** The event that completed the plate appearance. */
  eventId: string
  /** Its capture unit's first event id, which opens the play details. */
  playId: string
  x: number
  y: number
  side: BaseballTeamSide
  batterId: string
  result: BaseballSprayResult
  battedBallType: BaseballBattedBallType
  /** "#2 Garcia: double, line drive" */
  label: string
}

export interface BaseballSprayFilter {
  side: 'all' | BaseballTeamSide
  batterId: 'all' | string
  result: 'all' | BaseballSprayResult
  battedBallType: 'all' | BaseballBattedBallType
}

export const BASEBALL_SPRAY_DEFAULT_FILTER: BaseballSprayFilter = {
  side: 'all',
  batterId: 'all',
  result: 'all',
  battedBallType: 'all',
}

export interface BaseballSprayChart {
  points: BaseballSprayPoint[]
  /** Balls in play the filter keeps that have no location. */
  unlocated: number
  /** Batters with a ball in play, for the batter filter, within the chosen team. */
  batters: Array<{ id: string; name: string }>
}

const HITS = new Set<BaseballInPlayResult>(['single', 'double', 'triple', 'home_run', 'ground_rule_double'])
const IN_PLAY = new Set<string>(Object.keys(BASEBALL_IN_PLAY_LABELS))
const BATTED_BALL_LABELS = Object.fromEntries(BASEBALL_BATTED_BALL_OPTIONS.map(option => [option.type, option.label.toLowerCase()]))

export function baseballSprayResult(outcome: BaseballInPlayResult): BaseballSprayResult {
  if (HITS.has(outcome)) return 'hit'
  return outcome === 'error' ? 'error' : 'out'
}

export function baseballSprayChart(
  sport: BaseballSportGameState,
  events: readonly GameEvent[],
  filter: BaseballSprayFilter = BASEBALL_SPRAY_DEFAULT_FILTER
): BaseballSprayChart {
  const byId = new Map(events.map(event => [event.id, event]))
  const unitOf = new Map<string, string>()
  for (const unit of groupBaseballUnits(events)) for (const event of unit) unitOf.set(event.id, unit[0].id)

  const all = sport.projection.plateAppearances.flatMap(record => {
    if (!IN_PLAY.has(record.outcome)) return []
    const outcome = record.outcome as BaseballInPlayResult
    const inPlay = (byId.get(record.eventId)?.payload as { inPlay?: BaseballInPlay | null } | undefined)?.inPlay
    const battedBallType = inPlay?.battedBallType ?? 'unknown'
    const name = baseballPersonLabel(sport, record.batterId).name
    const typeLabel = battedBallType === 'unknown' ? '' : `, ${BATTED_BALL_LABELS[battedBallType] ?? battedBallType}`
    return [{
      eventId: record.eventId,
      playId: unitOf.get(record.eventId) ?? record.eventId,
      location: record.location,
      side: record.battingSide,
      batterId: record.batterId,
      result: baseballSprayResult(outcome),
      battedBallType,
      label: `${name}: ${BASEBALL_IN_PLAY_LABELS[outcome]}${typeLabel}`,
    }]
  })

  const sideMatches = all.filter(entry => filter.side === 'all' || entry.side === filter.side)
  const batters = sideMatches
    .map(entry => entry.batterId)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map(id => ({ id, name: baseballPersonLabel(sport, id).name }))
  const kept = sideMatches.filter(entry =>
    (filter.batterId === 'all' || entry.batterId === filter.batterId) &&
    (filter.result === 'all' || entry.result === filter.result) &&
    (filter.battedBallType === 'all' || entry.battedBallType === filter.battedBallType)
  )
  return {
    points: kept.flatMap(({ location, ...entry }) => (location ? [{ ...entry, x: location.x, y: location.y }] : [])),
    unlocated: kept.filter(entry => !entry.location).length,
    batters,
  }
}
