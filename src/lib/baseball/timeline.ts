import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { baseballSportState } from './commands'
import { baseballCorrectionGroupStatus } from './corrections'
import { baseballPeriod, formatBaseballHalf, parseBaseballPeriod } from './periods'
import { replayBaseballRunsByEvent } from './projector'
import { baseballEventLabel, type BaseballSideNames } from './recentPlays'
import type { BaseballHalf, BaseballSportGameState, BaseballTeamSide } from './types'
import {
  baseballActiveEvents,
  baseballRemovedEvents,
  formatBaseballEventHalf,
  groupBaseballUnits,
  isBaseballCaptureEvent,
} from './units'

/**
 * The Timeline tab (BSB-4C): every capture unit by half-inning, newest first, with each half's
 * line, removed rows collapsed under their half with Restore, and filters. Pure and read-only;
 * corrections go through `corrections.ts`.
 */

export interface BaseballTimelineRow {
  /** The unit's first event id. */
  id: string
  eventIds: string[]
  /** Plays can be removed; game-flow rows only as a listed dependent. */
  kind: 'play' | 'flow'
  label: string
  halfLabel: string
  /** The team the row is about: the batting side for plays at bat, the team for a change. */
  side: BaseballTeamSide | null
  removed: boolean
  removedAt: string | null
  /** Saved again after it was first recorded (restored, or edited in BSB-4D). */
  revised: boolean
  /** The first lineup mismatch the replay reports on this row. */
  warning: string | null
  /** A saved removal this row belongs to, for Restore together. */
  group: BaseballTimelineGroup | null
}

export interface BaseballTimelineGroup {
  receiptId: string
  /** How many rows the removal took out together. */
  size: number
  restorable: boolean
  /** Rows that changed since the removal; shown when the group can no longer come back together. */
  changedLabels: string[]
}

export interface BaseballTimelineHalfGroup {
  key: string
  inning: number
  half: BaseballHalf
  label: string
  battingSide: BaseballTeamSide
  /** "2 R, 3 H, 1 E, 2 LOB", or null for a half with no line yet. */
  line: string | null
  rows: BaseballTimelineRow[]
  removedRows: BaseballTimelineRow[]
}

export interface BaseballTimelineFilter {
  /** A half-inning key, or 'all'. */
  half: string
  side: 'all' | BaseballTeamSide
  /** Only rows with a correction: removed, restored or revised. */
  correctedOnly: boolean
}

export const BASEBALL_TIMELINE_DEFAULT_FILTER: BaseballTimelineFilter = { half: 'all', side: 'all', correctedOnly: false }

export interface BaseballTimeline {
  halves: BaseballTimelineHalfGroup[]
  /** Every half with a row, newest first, for the half filter. */
  halfOptions: Array<{ key: string; label: string }>
  /** Rows the filter hides; zero when nothing is filtered. */
  hiddenCount: number
}

export function baseballTimeline(
  state: GameState,
  names: BaseballSideNames,
  filter: BaseballTimelineFilter = BASEBALL_TIMELINE_DEFAULT_FILTER
): BaseballTimeline {
  const sport = baseballSportState(state)
  if (!sport || !state.eventStream) return { halves: [], halfOptions: [], hiddenCount: 0 }
  const active = baseballActiveEvents(state)
  const removed = baseballRemovedEvents(state)
  const scored = replayBaseballRunsByEvent(sport.setup, active)
  const warnings = new Map<string, string>()
  for (const warning of sport.projection.warnings) {
    if (!warnings.has(warning.eventId)) warnings.set(warning.eventId, warning.message)
  }
  const groups = timelineGroups(state, sport, names)

  const makeRow = (unit: GameEvent[], isRemoved: boolean): BaseballTimelineRow => {
    const first = unit[0]
    return {
      id: first.id,
      eventIds: unit.map(event => event.id),
      kind: isBaseballCaptureEvent(first) ? 'play' : 'flow',
      label: unit.map(event => baseballEventLabel(sport, event, names, isRemoved ? [] : scored.get(event.id) ?? [])).join(' + '),
      halfLabel: formatBaseballEventHalf(first),
      side: rowSide(sport, first),
      removed: isRemoved,
      removedAt: isRemoved ? first.deletedAt : null,
      revised: unit.some(event => event.revision > 1),
      warning: isRemoved ? null : unit.map(event => warnings.get(event.id)).find(Boolean) ?? null,
      group: groups.get(first.id) ?? null,
    }
  }

  const halves = new Map<string, BaseballTimelineHalfGroup>()
  const halfFor = (event: GameEvent): BaseballTimelineHalfGroup | null => {
    const period = parseBaseballPeriod(event.period)
    if (!period) return null
    const key = baseballPeriod(period.inning, period.half).id
    let group = halves.get(key)
    if (!group) {
      const line = sport.projection.lineScore.find(entry => entry.inning === period.inning && entry.half === period.half)
      group = {
        key,
        inning: period.inning,
        half: period.half,
        label: formatBaseballHalf(period.inning, period.half),
        battingSide: battingSideOf(sport, period.half),
        line: line ? `${line.runs} R, ${line.hits} H, ${line.errors} E, ${line.leftOnBase} LOB` : null,
        rows: [],
        removedRows: [],
      }
      halves.set(key, group)
    }
    return group
  }

  let total = 0
  let shown = 0
  const visible = (row: BaseballTimelineRow, halfKey: string) => {
    total += 1
    const keep =
      (filter.half === 'all' || filter.half === halfKey) &&
      (filter.side === 'all' || row.side === filter.side) &&
      (!filter.correctedOnly || row.removed || row.revised)
    if (keep) shown += 1
    return keep
  }

  for (const unit of groupBaseballUnits(active)) {
    const half = halfFor(unit[0])
    if (!half) continue
    const row = makeRow(unit, false)
    if (visible(row, half.key)) half.rows.push(row)
  }
  for (const unit of groupBaseballUnits(removed)) {
    const half = halfFor(unit[0])
    if (!half) continue
    const row = makeRow(unit, true)
    if (visible(row, half.key)) half.removedRows.push(row)
  }

  const ordered = [...halves.values()].sort((a, b) => halfOrder(b) - halfOrder(a))
  for (const half of ordered) {
    half.rows.reverse()
    half.removedRows.reverse()
  }
  return {
    halves: ordered.filter(half => half.rows.length > 0 || half.removedRows.length > 0),
    halfOptions: ordered.map(half => ({ key: half.key, label: half.label })),
    hiddenCount: total - shown,
  }
}

function halfOrder(half: Pick<BaseballTimelineHalfGroup, 'inning' | 'half'>): number {
  return baseballPeriod(half.inning, half.half).order
}

function battingSideOf(sport: BaseballSportGameState, half: BaseballHalf): BaseballTeamSide {
  const awayBats = half === 'top'
  return (sport.setup.trackedSide === 'away') === awayBats ? 'tracked' : 'opponent'
}

function rowSide(sport: BaseballSportGameState, event: GameEvent): BaseballTeamSide | null {
  switch (event.eventType) {
    case 'baseball.pitch':
    case 'baseball.plate_appearance':
    case 'baseball.baserunning': {
      const period = parseBaseballPeriod(event.period)
      return period ? battingSideOf(sport, period.half) : null
    }
    case 'baseball.substitution':
    case 'baseball.score_adjustment':
      return event.teamSide === 'tracked' || event.teamSide === 'opponent' ? event.teamSide : null
    default:
      return null
  }
}

/** Each removed row's saved removal, keyed by the row's first event id. */
function timelineGroups(
  state: GameState,
  sport: BaseballSportGameState,
  names: BaseballSideNames
): Map<string, BaseballTimelineGroup> {
  const removedUnits = groupBaseballUnits(baseballRemovedEvents(state))
  const groups = new Map<string, BaseballTimelineGroup>()
  for (const receipt of sport.capturePreferences.corrections) {
    if (receipt.kind !== 'remove') continue
    const ids = new Set(receipt.entries.map(entry => entry.eventId))
    const units = removedUnits.filter(unit => unit.some(event => ids.has(event.id)))
    const status = baseballCorrectionGroupStatus(state, receipt)
    const changed = new Set(status.changedEventIds)
    const changedLabels = baseballActiveEvents(state)
      .concat(baseballRemovedEvents(state))
      .filter(event => changed.has(event.id))
      .map(event => `${formatBaseballEventHalf(event)}: ${baseballEventLabel(sport, event, names, [])}`)
    const group: BaseballTimelineGroup = {
      receiptId: receipt.id,
      size: units.length,
      restorable: status.restorable && units.length > 1,
      changedLabels,
    }
    for (const unit of units) {
      if (!groups.has(unit[0].id)) groups.set(unit[0].id, group)
    }
  }
  return groups
}
