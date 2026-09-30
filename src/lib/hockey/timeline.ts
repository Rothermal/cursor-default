import type { GameState } from '../../types'
import { gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEvent } from '../gameEvents/types'
import { hockeySportState } from './live'
import { formatHockeyPeriod, parseHockeyPeriod } from './periods'
import { replayHockeyEvents } from './projector'
import { groupHockeyCaptureUnits, hockeyEventLabel, type HockeySideLabels } from './recentEvents'
import type { HockeySide, HockeyStrength } from './types'
import { HOCKEY_CAPTURE_EVENT_TYPES } from './types'

/**
 * The Hockey Timeline (HKY-4A): every event of the game, active and removed, grouped by
 * period oldest first. Rows come from the stream itself, never from the cached projection,
 * so a history that no longer replays still shows where it fails.
 */

export type HockeyTimelineFamily =
  | 'goals'
  | 'shots'
  | 'faceoffs'
  | 'physical'
  | 'penalties'
  | 'goalies'
  | 'team'
  | 'shootout'
  | 'game_flow'

/** Filter order and labels, matching HKY-0 §9. */
export const HOCKEY_TIMELINE_FAMILIES: ReadonlyArray<{ id: HockeyTimelineFamily; label: string }> = [
  { id: 'goals', label: 'Goals' },
  { id: 'shots', label: 'Shots' },
  { id: 'faceoffs', label: 'Faceoffs' },
  { id: 'physical', label: 'Physical' },
  { id: 'penalties', label: 'Penalties' },
  { id: 'goalies', label: 'Goalies' },
  { id: 'team', label: 'Team' },
  { id: 'shootout', label: 'Shootout' },
  { id: 'game_flow', label: 'Game flow' },
]

export interface HockeyTimelineRow {
  /** The first event's id; stable for React keys. */
  id: string
  events: GameEvent[]
  periodId: string
  periodOrder: number
  periodLabel: string
  /** Clock time as the rules display it (count down or up); null without a clock. */
  displayMs: number | null
  label: string
  families: HockeyTimelineFamily[]
  sides: HockeySide[]
  /** Tracked participants named on the events (any actor role, or the goalie put in net). */
  participantIds: string[]
  /** Goals only. */
  strength: HockeyStrength | null
  /** A capture unit, as opposed to a lifecycle or clock row. */
  capture: boolean
  removed: boolean
  /** Changed after capture: edited, removed or restored. Appended events start at revision 1. */
  revised: boolean
  recordedLater: boolean
  /** The replay message when this row is where the stored history stops replaying. */
  diagnostic: string | null
}

export interface HockeyTimeline {
  rows: HockeyTimelineRow[]
  /** A problem with the stream itself (malformed events), not tied to one row. */
  historyMessage: string | null
}

export interface HockeyTimelineFilters {
  /** Empty means every family. */
  families: HockeyTimelineFamily[]
  side: HockeySide | 'all'
  periodId: string | null
  participantId: string | null
  showRemoved: boolean
}

export const DEFAULT_HOCKEY_TIMELINE_FILTERS: HockeyTimelineFilters = {
  families: [],
  side: 'all',
  periodId: null,
  participantId: null,
  showRemoved: false,
}

export interface HockeyTimelinePeriodGroup {
  periodId: string
  label: string
  rows: HockeyTimelineRow[]
}

const CAPTURE_TYPES = new Set<string>(HOCKEY_CAPTURE_EVENT_TYPES)
const DEFAULT_SIDE_LABELS: HockeySideLabels = { tracked: 'Tracked', opponent: 'Opponent' }

/** Every row of the game in period order; within a period, capture order (game order until HKY-4C). */
export function hockeyTimeline(state: GameState, sideLabels: HockeySideLabels = DEFAULT_SIDE_LABELS): HockeyTimeline {
  const sport = hockeySportState(state)
  if (!sport || !state.eventStream) return { rows: [], historyMessage: null }
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  const replay = replayHockeyEvents(sport.setup, inspection.activeEvents)
  const failing = replay.diagnostics[0] ?? null
  const durations = new Map(replay.projection.periods.map(period => [period.id, period.durationMs]))
  const countDown = sport.setup.rulesSnapshot.clock?.display === 'count_down'
  const trackedIds = new Set(sport.setup.participants.map(participant => participant.id))

  const all = [...inspection.activeEvents, ...inspection.deletedEvents].sort(compareGameEventCaptureOrder)
  // Removed and active events never share a unit: Undo and Timeline removal act on whole units.
  const units = groupHockeyCaptureUnits(all).flatMap(unit => splitByRemoval(unit))
  const rows = units.map((unit): HockeyTimelineRow => {
    const first = unit[0]
    const period = parseHockeyPeriod(first.period)
    const duration = durations.get(first.period.id) ?? null
    const displayMs = first.elapsedMs === null
      ? null
      : countDown && duration !== null ? duration - first.elapsedMs : first.elapsedMs
    const shotPayload = first.eventType === 'hockey.shot' ? first.payload as { outcome?: string; strength?: HockeyStrength | null } : null
    return {
      id: first.id,
      events: unit,
      periodId: first.period.id,
      periodOrder: first.period.order,
      periodLabel: period ? formatHockeyPeriod(period) : first.period.id,
      displayMs,
      label: unit.map(event => hockeyEventLabel(sport.setup, event, sideLabels)).join(' + '),
      families: unique(unit.flatMap(eventFamilies)),
      sides: unique(unit.map(event => event.teamSide).filter((side): side is HockeySide => side === 'tracked' || side === 'opponent')),
      participantIds: unique(unit.flatMap(event => eventParticipantIds(event)).filter(id => trackedIds.has(id))),
      strength: shotPayload?.outcome === 'goal' ? shotPayload.strength ?? null : null,
      capture: CAPTURE_TYPES.has(first.eventType),
      removed: first.deletedAt !== null,
      revised: unit.some(event => event.revision > 1),
      recordedLater: unit.some(event => (event.payload as { recordedLater?: unknown }).recordedLater === true),
      diagnostic: failing && unit.some(event => event.id === failing.eventId) ? failing.message : null,
    }
  })
  rows.sort((left, right) => left.periodOrder - right.periodOrder)

  const historyMessage = inspection.diagnostics.length > 0
    ? 'Some stored events could not be read and are not shown.'
    : failing && !rows.some(row => row.diagnostic)
      ? failing.message
      : null
  return { rows, historyMessage }
}

export function filterHockeyTimelineRows(rows: readonly HockeyTimelineRow[], filters: HockeyTimelineFilters): HockeyTimelineRow[] {
  return rows.filter(row => {
    if (row.removed && !filters.showRemoved) return false
    if (filters.families.length > 0 && !row.families.some(family => filters.families.includes(family))) return false
    if (filters.side !== 'all' && !row.sides.includes(filters.side)) return false
    if (filters.periodId !== null && row.periodId !== filters.periodId) return false
    if (filters.participantId !== null && !row.participantIds.includes(filters.participantId)) return false
    return true
  })
}

/** Rows grouped by period, keeping row order; periods appear in the order of their rows. */
export function groupHockeyTimelineByPeriod(rows: readonly HockeyTimelineRow[]): HockeyTimelinePeriodGroup[] {
  const groups: HockeyTimelinePeriodGroup[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.periodId === row.periodId) last.rows.push(row)
    else groups.push({ periodId: row.periodId, label: row.periodLabel, rows: [row] })
  }
  return groups
}

/** Periods that have rows, for the period filter. */
export function hockeyTimelinePeriods(rows: readonly HockeyTimelineRow[]): Array<{ id: string; label: string }> {
  return groupHockeyTimelineByPeriod(rows).map(group => ({ id: group.periodId, label: group.label }))
}

/** How many of the given filters differ from the defaults, for the collapsed summary. */
export function activeHockeyTimelineFilterCount(filters: HockeyTimelineFilters): number {
  return [
    filters.families.length > 0,
    filters.side !== 'all',
    filters.periodId !== null,
    filters.participantId !== null,
    filters.showRemoved,
  ].filter(Boolean).length
}

// ---------------------------------------------------------------------------
// Internals

function eventFamilies(event: GameEvent): HockeyTimelineFamily[] {
  switch (event.eventType) {
    case 'hockey.shot':
      // A goal is also a shot, so both filters show it.
      return (event.payload as { outcome?: string }).outcome === 'goal' ? ['goals', 'shots'] : ['shots']
    case 'hockey.faceoff':
      return ['faceoffs']
    case 'hockey.hit':
    case 'hockey.takeaway':
    case 'hockey.giveaway':
      return ['physical']
    case 'hockey.penalty':
    case 'hockey.penalty_release':
      return ['penalties']
    case 'hockey.goalie_change':
      return ['goalies']
    case 'hockey.timeout':
    case 'hockey.team_event':
    case 'hockey.score_adjustment':
      return ['team']
    case 'hockey.shootout_started':
    case 'hockey.shootout_attempt':
      return ['shootout']
    default:
      return ['game_flow']
  }
}

function eventParticipantIds(event: GameEvent): string[] {
  const ids = event.actors.map(actor => actor.participantId).filter((id): id is string => typeof id === 'string')
  if (event.eventType === 'hockey.goalie_change') {
    const inId = (event.payload as { inParticipantId?: unknown }).inParticipantId
    if (typeof inId === 'string') ids.push(inId)
  }
  return ids
}

function splitByRemoval(unit: GameEvent[]): GameEvent[][] {
  const active = unit.filter(event => event.deletedAt === null)
  const removed = unit.filter(event => event.deletedAt !== null)
  return [active, removed].filter(part => part.length > 0)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
