import type { GameEvent } from '../gameEvents/types'
import { hockeyParticipantLabel } from './captureCommands'
import { hockeyGoalStrengthLabel, type HockeyGoalStrengthLabel } from './gameLines'
import { formatHockeyPeriod, parseHockeyPeriod } from './periods'
import { orderHockeyEvents } from './placement'
import {
  HOCKEY_FACEOFF_DOT_IDS,
  HOCKEY_RINK_LENGTH_FT,
  HOCKEY_RINK_WIDTH_FT,
  type HockeyFaceoffDotId,
} from './rinkGeometry'
import type {
  HockeyAttackingDirection,
  HockeyEvent,
  HockeyMatchSetup,
  HockeyShotOutcome,
  HockeySide,
} from './types'

/**
 * Summary rink views (HKY-6A2): the shot map and the faceoff map. Both read the active
 * events of the selected source and draw them in one frame: the tracked side always attacks
 * left to right and the opponent right to left, whatever end each period was played at.
 * Read only; nothing here writes events.
 */

export interface HockeySummaryNames {
  tracked: string
  opponent: string
}

/** The attacking direction each side is drawn with. */
export const HOCKEY_SUMMARY_DIRECTIONS: Readonly<Record<HockeySide, HockeyAttackingDirection>> = {
  tracked: 'left_to_right',
  opponent: 'right_to_left',
}

/** A location turned to the summary frame for `side`: half a turn when it was played the other way. */
export function hockeySummaryPoint(
  location: { x: number; y: number; attackingDirection: string },
  side: HockeySide
): { x: number; y: number } {
  if (location.attackingDirection === HOCKEY_SUMMARY_DIRECTIONS[side]) return { x: location.x, y: location.y }
  return { x: 1 - location.x, y: 1 - location.y }
}

/** The dot half a turn away: left and right swap, and so do upper and lower. */
export function rotateHockeyFaceoffDot(dotId: HockeyFaceoffDotId): HockeyFaceoffDotId {
  if (dotId === 'center') return dotId
  const [end, zone, edge] = dotId.split('_')
  return `${end === 'left' ? 'right' : 'left'}_${zone}_${edge === 'upper' ? 'lower' : 'upper'}` as HockeyFaceoffDotId
}

export interface HockeyPeriodOption {
  id: string
  label: string
}

// ---------------------------------------------------------------------------
// Shot map

export interface HockeyShotMapShot {
  eventId: string
  side: HockeySide
  /** The tracked shooter, for the player filter; null for opponents and unnamed shooters. */
  participantId: string | null
  shooter: string
  periodId: string
  periodLabel: string
  outcome: HockeyShotOutcome
  /** Recorded on goals only (HKY-3B), so every other shot has none. */
  strength: HockeyGoalStrengthLabel
  /** In the summary frame; null when the shot was not located. */
  point: { x: number; y: number } | null
}

export type HockeyShotMapStrength = Exclude<HockeyGoalStrengthLabel, null>

export interface HockeyShotMapFilters {
  side: HockeySide | 'all'
  participantId: string | null
  periodId: string | null
  /** Empty means every outcome. */
  outcomes: HockeyShotOutcome[]
  strength: HockeyShotMapStrength | 'all'
}

export const DEFAULT_HOCKEY_SHOT_MAP_FILTERS: HockeyShotMapFilters = {
  side: 'all',
  participantId: null,
  periodId: null,
  outcomes: [],
  strength: 'all',
}

export const HOCKEY_SHOT_MAP_OUTCOMES: ReadonlyArray<{ id: HockeyShotOutcome; label: string }> = [
  { id: 'goal', label: 'Goal' },
  { id: 'saved', label: 'Saved' },
  { id: 'missed', label: 'Missed' },
  { id: 'blocked', label: 'Blocked' },
]

export const HOCKEY_SHOT_MAP_STRENGTHS: readonly HockeyShotMapStrength[] = ['EV', 'PP', 'SH', 'EN', 'PS']

export interface HockeyShotMapCluster {
  /** The first shot's event id. */
  id: string
  /** Where the first shot is, in the summary frame. */
  x: number
  y: number
  /** In game order. */
  shots: HockeyShotMapShot[]
}

export interface HockeyShotMap {
  /** Shots the filters keep, in game order, located or not. */
  shots: HockeyShotMapShot[]
  clusters: HockeyShotMapCluster[]
  unlocated: HockeyShotMapShot[]
  /** Tracked shooters with a shot, for the player filter. */
  shooters: Array<{ id: string; name: string }>
  periods: HockeyPeriodOption[]
}

/** On-ice distance (feet) under which marks share one numbered spot; about a mark's width. */
export const HOCKEY_SHOT_MAP_OVERLAP_FT = 5

/** Every active shot of the game in game order. Shootout attempts are not shots (HKY-3C). */
export function hockeyShotMapShots(
  setup: HockeyMatchSetup,
  events: readonly GameEvent[],
  names: HockeySummaryNames
): HockeyShotMapShot[] {
  return inGameOrder(events, 'hockey.shot').map(event => {
    const shot = event as HockeyEvent<'hockey.shot'>
    const side = shot.teamSide as HockeySide
    const shooterActor = shot.actors.find(actor => actor.role === 'shooter')
    const participant = shooterActor?.participantId
      ? setup.participants.find(entry => entry.id === shooterActor.participantId) ?? null
      : null
    return {
      eventId: shot.id,
      side,
      participantId: side === 'tracked' && participant ? participant.id : null,
      shooter: participant ? hockeyParticipantLabel(participant) : shooterActor?.label ?? `${names[side]}, no shooter`,
      periodId: shot.period.id,
      periodLabel: periodLabel(shot),
      outcome: shot.payload.outcome,
      strength: shot.payload.outcome === 'goal' ? hockeyGoalStrengthLabel(shot.payload) : null,
      point: shot.location ? hockeySummaryPoint(shot.location, side) : null,
    }
  })
}

export function hockeyShotMap(
  setup: HockeyMatchSetup,
  all: readonly HockeyShotMapShot[],
  filters: HockeyShotMapFilters = DEFAULT_HOCKEY_SHOT_MAP_FILTERS
): HockeyShotMap {
  const shooters = setup.participants
    .filter(participant => all.some(shot => shot.participantId === participant.id))
    .map(participant => ({ id: participant.id, name: hockeyParticipantLabel(participant) }))
  const shots = all.filter(shot =>
    (filters.side === 'all' || shot.side === filters.side) &&
    (filters.participantId === null || shot.participantId === filters.participantId) &&
    (filters.periodId === null || shot.periodId === filters.periodId) &&
    (filters.outcomes.length === 0 || filters.outcomes.includes(shot.outcome)) &&
    (filters.strength === 'all' || shot.strength === filters.strength)
  )
  return {
    shots,
    clusters: hockeyShotMapClusters(shots),
    unlocated: shots.filter(shot => !shot.point),
    shooters,
    periods: periodOptions(all),
  }
}

/**
 * Groups located shots by spot in game order: each shot joins the first group whose first
 * shot is within the overlap distance, so the same filtered shots always group the same way.
 */
export function hockeyShotMapClusters(shots: readonly HockeyShotMapShot[]): HockeyShotMapCluster[] {
  const clusters: HockeyShotMapCluster[] = []
  for (const shot of shots) {
    if (!shot.point) continue
    const { x, y } = shot.point
    const near = clusters.find(cluster =>
      Math.hypot((cluster.x - x) * HOCKEY_RINK_LENGTH_FT, (cluster.y - y) * HOCKEY_RINK_WIDTH_FT) < HOCKEY_SHOT_MAP_OVERLAP_FT
    )
    if (near) near.shots.push(shot)
    else clusters.push({ id: shot.eventId, x, y, shots: [shot] })
  }
  return clusters
}

export function activeHockeyShotMapFilterCount(filters: HockeyShotMapFilters): number {
  return [
    filters.side !== 'all',
    filters.participantId !== null,
    filters.periodId !== null,
    filters.outcomes.length > 0,
    filters.strength !== 'all',
  ].filter(Boolean).length
}

// ---------------------------------------------------------------------------
// Faceoff map

export interface HockeyFaceoffTally {
  won: number
  lost: number
  /** Whole percent won, or null with no faceoffs. */
  percent: number | null
}

export interface HockeyFaceoffMapFilters {
  /** A tracked taker, or null for the whole team. */
  participantId: string | null
  periodId: string | null
}

export const DEFAULT_HOCKEY_FACEOFF_MAP_FILTERS: HockeyFaceoffMapFilters = { participantId: null, periodId: null }

export interface HockeyFaceoffMap {
  /** Each dot in the summary frame, from the tracked side's view. */
  dots: Record<HockeyFaceoffDotId, HockeyFaceoffTally>
  total: HockeyFaceoffTally
  /** Tracked takers with a faceoff, for the taker filter. */
  takers: Array<{ id: string; name: string }>
  periods: HockeyPeriodOption[]
}

export function hockeyFaceoffMap(
  setup: HockeyMatchSetup,
  events: readonly GameEvent[],
  filters: HockeyFaceoffMapFilters = DEFAULT_HOCKEY_FACEOFF_MAP_FILTERS
): HockeyFaceoffMap {
  const faceoffs = inGameOrder(events, 'hockey.faceoff')
    .map(event => event as HockeyEvent<'hockey.faceoff'>)
  const taker = (event: HockeyEvent<'hockey.faceoff'>) => event.actors.find(actor => actor.role === 'taker')?.participantId ?? null
  const counts = Object.fromEntries(HOCKEY_FACEOFF_DOT_IDS.map(id => [id, { won: 0, lost: 0 }])) as Record<
    HockeyFaceoffDotId,
    { won: number; lost: number }
  >
  const total = { won: 0, lost: 0 }
  for (const event of faceoffs) {
    if (filters.participantId !== null && taker(event) !== filters.participantId) continue
    if (filters.periodId !== null && event.period.id !== filters.periodId) continue
    const stored = event.payload.dotId as HockeyFaceoffDotId
    // A faceoff is located in the tracked side's direction for its period.
    const dotId = event.location?.attackingDirection === HOCKEY_SUMMARY_DIRECTIONS.tracked
      ? stored
      : rotateHockeyFaceoffDot(stored)
    const result = event.payload.winner === 'tracked' ? 'won' : 'lost'
    counts[dotId][result] += 1
    total[result] += 1
  }
  return {
    dots: Object.fromEntries(HOCKEY_FACEOFF_DOT_IDS.map(id => [id, tally(counts[id])])) as Record<HockeyFaceoffDotId, HockeyFaceoffTally>,
    total: tally(total),
    takers: setup.participants
      .filter(participant => faceoffs.some(event => taker(event) === participant.id))
      .map(participant => ({ id: participant.id, name: hockeyParticipantLabel(participant) })),
    periods: periodOptions(faceoffs.map(event => ({ periodId: event.period.id, periodLabel: periodLabel(event) }))),
  }
}

/** Dots in reading order for the list under the map: the tracked side's attacking end first. */
export const HOCKEY_FACEOFF_MAP_DOT_ORDER: ReadonlyArray<{ id: HockeyFaceoffDotId; label: string }> = [
  { id: 'right_end_upper', label: 'Offensive zone, far' },
  { id: 'right_end_lower', label: 'Offensive zone, near' },
  { id: 'right_neutral_upper', label: 'Neutral zone, offensive side, far' },
  { id: 'right_neutral_lower', label: 'Neutral zone, offensive side, near' },
  { id: 'center', label: 'Center ice' },
  { id: 'left_neutral_upper', label: 'Neutral zone, defensive side, far' },
  { id: 'left_neutral_lower', label: 'Neutral zone, defensive side, near' },
  { id: 'left_end_upper', label: 'Defensive zone, far' },
  { id: 'left_end_lower', label: 'Defensive zone, near' },
]

// ---------------------------------------------------------------------------
// Internals

/**
 * Active events of one type in game order. The whole stream is ordered first: placed
 * (recorded-later or re-timed) events need the period start and end anchors to find their
 * place, so ordering a one-type subset would move them after the live captures.
 */
function inGameOrder(events: readonly GameEvent[], eventType: string): GameEvent[] {
  return orderHockeyEvents(events.filter(event => !event.deletedAt)).filter(event => event.eventType === eventType)
}

function tally(counts: { won: number; lost: number }): HockeyFaceoffTally {
  const taken = counts.won + counts.lost
  return { ...counts, percent: taken === 0 ? null : Math.round((counts.won / taken) * 100) }
}

function periodLabel(event: GameEvent): string {
  const period = parseHockeyPeriod(event.period)
  return period ? formatHockeyPeriod(period) : event.period.id
}

function periodOptions(rows: ReadonlyArray<{ periodId: string; periodLabel: string }>): HockeyPeriodOption[] {
  const options: HockeyPeriodOption[] = []
  for (const row of rows) {
    if (!options.some(option => option.id === row.periodId)) options.push({ id: row.periodId, label: row.periodLabel })
  }
  return options
}
