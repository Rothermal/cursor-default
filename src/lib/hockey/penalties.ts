import { hockeyPeriodSkaters } from './captureProjection'
import type {
  HockeyInfraction,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyPenaltyClass,
  HockeyPenaltyRecord,
  HockeyPenaltyReleaseRecord,
  HockeyPenaltyRules,
  HockeySide,
} from './types'

/**
 * Penalties, the penalty box and derived strength (HKY-3A). The box is never stored: it is
 * simulated from the accepted penalties and releases up to a game time, so a clock
 * correction moves every timer with it. Clockless games record penalties but have no box.
 */

export const HOCKEY_PENALTY_CLASSES: readonly HockeyPenaltyClass[] = [
  'minor',
  'double_minor',
  'major',
  'misconduct',
  'game_misconduct',
  'match',
  'penalty_shot',
]

export const HOCKEY_PENALTY_CLASS_LABELS: Record<HockeyPenaltyClass, string> = {
  minor: 'Minor',
  double_minor: 'Double minor',
  major: 'Major',
  misconduct: 'Misconduct',
  game_misconduct: 'Game misconduct',
  match: 'Match',
  penalty_shot: 'Penalty shot',
}

export const HOCKEY_INFRACTIONS: readonly HockeyInfraction[] = [
  'tripping',
  'hooking',
  'slashing',
  'interference',
  'holding',
  'high_sticking',
  'roughing',
  'cross_checking',
  'boarding',
  'charging',
  'elbowing',
  'too_many_men',
  'delay_of_game',
  'unsportsmanlike',
  'fighting',
  'abuse_of_officials',
  'other',
]

export const HOCKEY_INFRACTION_LABELS: Record<HockeyInfraction, string> = {
  tripping: 'Tripping',
  hooking: 'Hooking',
  slashing: 'Slashing',
  interference: 'Interference',
  holding: 'Holding',
  high_sticking: 'High-sticking',
  roughing: 'Roughing',
  cross_checking: 'Cross-checking',
  boarding: 'Boarding',
  charging: 'Charging',
  elbowing: 'Elbowing',
  too_many_men: 'Too many men',
  delay_of_game: 'Delay of game',
  unsportsmanlike: 'Unsportsmanlike conduct',
  fighting: 'Fighting',
  abuse_of_officials: 'Abuse of officials',
  other: 'Other',
}

/** Classes that take a skater off the ice while their time runs. */
const STRENGTH_CLASSES = new Set<HockeyPenaltyClass>(['minor', 'double_minor', 'major', 'match'])
/** Classes that remove the offender for the rest of the game. */
const REMOVING_CLASSES = new Set<HockeyPenaltyClass>(['game_misconduct', 'match'])

export function hockeyPenaltyAffectsStrength(penaltyClass: HockeyPenaltyClass): boolean {
  return STRENGTH_CLASSES.has(penaltyClass)
}

export function hockeyPenaltyRemovesOffender(penaltyClass: HockeyPenaltyClass): boolean {
  return REMOVING_CLASSES.has(penaltyClass)
}

/** True when the class puts someone in the box: everything but a game misconduct or a penalty shot. */
export function hockeyPenaltyHasBoxTime(penaltyClass: HockeyPenaltyClass): boolean {
  return penaltyClass !== 'game_misconduct' && penaltyClass !== 'penalty_shot'
}

/** Assessed length stamped from the rules; the recorder may override it except for a penalty shot. */
export function hockeyPenaltyDefaultDurationMs(rules: HockeyPenaltyRules, penaltyClass: HockeyPenaltyClass): number {
  switch (penaltyClass) {
    case 'minor':
      return rules.minorMs
    case 'double_minor':
      return rules.doubleMinorMs
    case 'major':
    case 'match':
      return rules.majorMs
    case 'misconduct':
    case 'game_misconduct':
      return rules.misconductMs
    case 'penalty_shot':
      return 0
  }
}

/** The segments a penalty serves; a double minor is two, a penalty shot or game misconduct none. */
export function hockeyPenaltySegmentsMs(penaltyClass: HockeyPenaltyClass, durationMs: number): number[] {
  if (!hockeyPenaltyHasBoxTime(penaltyClass)) return []
  if (penaltyClass === 'double_minor') {
    const first = Math.floor(durationMs / 2)
    return [first, durationMs - first]
  }
  return [durationMs]
}

export function hockeyPenaltyLabel(record: Pick<HockeyPenaltyRecord, 'class' | 'infraction' | 'infractionLabel' | 'durationMs'>): string {
  const infraction = record.infraction === 'other' && record.infractionLabel
    ? record.infractionLabel
    : HOCKEY_INFRACTION_LABELS[record.infraction]
  const length = record.durationMs > 0 && record.class !== 'game_misconduct'
    ? ` (${formatPenaltyMinutes(record.durationMs)})`
    : ''
  return `${HOCKEY_PENALTY_CLASS_LABELS[record.class].toLowerCase()}, ${infraction.toLowerCase()}${length}`
}

function formatPenaltyMinutes(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds % 60 === 0) return `${seconds / 60} min`
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Game time

/**
 * Clock time played before a period: the sum of the ended periods before it. Anchored
 * games only; box timers use it to carry across a period end.
 */
export function hockeyPeriodOffsetMs(projection: HockeyMatchProjection, periodId: string): number | null {
  let offset = 0
  for (const period of projection.periods) {
    if (period.id === periodId) return offset
    if (period.endedAtElapsedMs === null) return null
    offset += period.endedAtElapsedMs
  }
  return null
}

/** Game time of a moment in a period, or null for clockless games and unknown periods. */
export function hockeyGameTimeMs(
  projection: HockeyMatchProjection,
  periodId: string,
  elapsedMs: number | null
): number | null {
  if (!projection.clock || elapsedMs === null) return null
  const offset = hockeyPeriodOffsetMs(projection, periodId)
  return offset === null ? null : offset + elapsedMs
}

/** Game time now: the active period at `elapsedMs`, or everything played between periods. */
export function hockeyCurrentGameTimeMs(projection: HockeyMatchProjection, activeElapsedMs: number | null): number | null {
  if (!projection.clock) return null
  if (projection.activePeriodId) return hockeyGameTimeMs(projection, projection.activePeriodId, activeElapsedMs ?? projection.clock.elapsedMs)
  return projection.periods.reduce((total, period) => total + (period.endedAtElapsedMs ?? 0), 0)
}

// ---------------------------------------------------------------------------
// The penalty box

export type HockeyBoxEntryStatus = 'running' | 'waiting'

export interface HockeyBoxEntry {
  penaltyEventId: string
  side: HockeySide
  /** 1, or 2 for the second half of a double minor. */
  segment: 1 | 2
  class: HockeyPenaltyClass
  /** True while it counts against its side's strength; cancelled coincidental time never does. */
  strength: boolean
  cancelled: boolean
  status: HockeyBoxEntryStatus
  durationMs: number
  remainingMs: number
  /** Who sits in the box: the named server, else the offender. */
  participantId: string | null
  label: string | null
}

export interface HockeyBoxNote {
  eventId: string
  message: string
}

export interface HockeyPenaltyBox {
  tracked: HockeyBoxEntry[]
  opponent: HockeyBoxEntry[]
  /** Penalties whose time counted against strength when assessed (not cancelled). */
  strengthPenaltyIds: string[]
  cancelledPenaltyIds: string[]
  notes: HockeyBoxNote[]
}

export interface HockeySideStrength {
  /** Period skaters less penalties counting against strength; never an extra attacker. */
  baseSkaters: number
  /** `baseSkaters` plus one when this side's net is empty. */
  skatersOnIce: number
}

export interface HockeyStrengthState {
  tracked: HockeySideStrength
  opponent: HockeySideStrength
}

/** A release is at most once per segment; this finds whether one exists. */
export function hockeyPenaltyReleaseExists(
  releases: readonly HockeyPenaltyReleaseRecord[],
  penaltyEventId: string,
  segment: 1 | 2
): boolean {
  return releases.some(release => release.penaltyEventId === penaltyEventId && release.segment === segment)
}

/**
 * Simulates the box up to `gameTimeMs`. Penalties and releases later than that moment (only
 * possible after a clock was set back) are treated as happening at it. Clockless games get an
 * empty box.
 */
export function hockeyPenaltyBoxAt(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection,
  gameTimeMs: number | null,
  options: { penalties?: readonly HockeyPenaltyRecord[]; releases?: readonly HockeyPenaltyReleaseRecord[] } = {}
): HockeyPenaltyBox {
  const penalties = options.penalties ?? projection.penalties
  const releases = options.releases ?? projection.penaltyReleases
  const simulation = new BoxSimulation(setup.rulesSnapshot.penalties.coincidentalMinors)
  if (gameTimeMs === null || !projection.clock) return simulation.result()
  simulation.run(penalties, releases, gameTimeMs)
  return simulation.result()
}

/** Current strength from a box; a side's net is empty when its goalie is pulled. */
export function hockeyStrengthState(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection,
  box: HockeyPenaltyBox
): HockeyStrengthState {
  const period = projection.periods.find(entry => entry.id === projection.activePeriodId) ??
    projection.periods[projection.periods.length - 1] ??
    { kind: 'regulation' as const }
  const cap = hockeyPeriodSkaters(setup, period)
  const floor = Math.min(setup.rulesSnapshot.minimumSkaters, cap)
  const side = (value: HockeySide): HockeySideStrength => {
    const serving = box[value].filter(entry => entry.status === 'running' && entry.strength).length
    const baseSkaters = Math.max(floor, cap - serving)
    const emptyNet = projection.lineupRecorded && projection.goalieInNet[value] === null
    return { baseSkaters, skatersOnIce: baseSkaters + (emptyNet ? 1 : 0) }
  }
  return { tracked: side('tracked'), opponent: side('opponent') }
}

/** `5v4` from the tracked side's view. */
export function formatHockeyStrength(strength: HockeyStrengthState): string {
  return `${strength.tracked.skatersOnIce}v${strength.opponent.skatersOnIce}`
}

interface BoxItem {
  record: HockeyPenaltyRecord
  segment: 1 | 2
  strength: boolean
  cancelled: boolean
  durationMs: number
  remainingMs: number
  state: 'waiting' | 'running' | 'done'
  /** The next segment of the same penalty, which takes over its slot. */
  next: BoxItem | null
  /** Starts once every one of these is done (a misconduct after the same offender's minor). */
  after: BoxItem[]
  /** Order of the chain head in its side's queue. */
  queuedAt: number
}

class BoxSimulation {
  private readonly items: BoxItem[] = []
  private readonly notes: HockeyBoxNote[] = []
  private readonly strengthIds: string[] = []
  private readonly cancelledIds: string[] = []
  private queueCounter = 0

  constructor(private readonly coincidentalMinors: 'substitute' | 'play_short') {}

  run(penalties: readonly HockeyPenaltyRecord[], releases: readonly HockeyPenaltyReleaseRecord[], until: number): void {
    type Action = { time: number; order: number; apply: () => void }
    const actions: Action[] = []
    const units = groupPenaltyUnits(penalties.filter(record => record.gameTimeMs !== null))
    units.forEach((unit, index) => {
      actions.push({ time: Math.min(unit[0].gameTimeMs!, until), order: index, apply: () => this.assess(unit) })
    })
    releases.forEach((release, index) => {
      actions.push({
        time: Math.min(release.gameTimeMs, until),
        order: units.length + index,
        apply: () => this.release(release),
      })
    })
    actions.sort((left, right) => left.time - right.time || left.order - right.order)
    let now = actions.length > 0 ? Math.min(actions[0].time, until) : until
    for (const action of actions) {
      this.advance(action.time - now)
      now = action.time
      action.apply()
    }
    this.advance(until - now)
  }

  result(): HockeyPenaltyBox {
    const entries = (side: HockeySide): HockeyBoxEntry[] => this.items
      .filter(item => item.record.side === side && item.state !== 'done')
      .sort((left, right) => rank(left) - rank(right) || left.queuedAt - right.queuedAt || left.segment - right.segment)
      .map(item => ({
        penaltyEventId: item.record.eventId,
        side,
        segment: item.segment,
        class: item.record.class,
        strength: item.strength,
        cancelled: item.cancelled,
        status: item.state === 'running' ? 'running' : 'waiting',
        durationMs: item.durationMs,
        remainingMs: item.remainingMs,
        participantId: item.record.serverParticipantId ?? item.record.offenderParticipantId,
        label: item.record.serverLabel ?? item.record.offenderLabel,
      }))
    return {
      tracked: entries('tracked'),
      opponent: entries('opponent'),
      strengthPenaltyIds: [...this.strengthIds],
      cancelledPenaltyIds: [...this.cancelledIds],
      notes: [...this.notes],
    }
  }

  private assess(unit: HockeyPenaltyRecord[]): void {
    const cancelled = this.cancelledInUnit(unit)
    const chains: Array<{ record: HockeyPenaltyRecord; items: BoxItem[] }> = []
    for (const record of unit) {
      const segments = hockeyPenaltySegmentsMs(record.class, record.durationMs)
      if (segments.length === 0) continue
      const isCancelled = cancelled.has(record.eventId)
      const strength = hockeyPenaltyAffectsStrength(record.class) && !isCancelled
      if (strength) this.strengthIds.push(record.eventId)
      if (isCancelled) this.cancelledIds.push(record.eventId)
      const queuedAt = this.queueCounter++
      const items = segments.map((durationMs, index): BoxItem => ({
        record,
        segment: (index + 1) as 1 | 2,
        strength,
        cancelled: isCancelled,
        durationMs,
        remainingMs: durationMs,
        state: 'waiting',
        next: null,
        after: [],
        queuedAt,
      }))
      items.forEach((item, index) => { item.next = items[index + 1] ?? null })
      chains.push({ record, items })
      this.items.push(...items)
    }
    // A misconduct starts when the same offender's strength penalty in this unit ends.
    for (const chain of chains) {
      if (chain.record.class !== 'misconduct') continue
      const offender = offenderKey(chain.record)
      if (!offender) continue
      chain.items[0].after = chains
        .filter(other => other !== chain && hockeyPenaltyAffectsStrength(other.record.class) && offenderKey(other.record) === offender)
        // Every segment, so releasing a waiting second half never starts the misconduct early.
        .flatMap(other => other.items)
    }
    for (const chain of chains) this.tryStart(chain.items[0])
  }

  /**
   * Coincidental penalties cancel pairwise by class. Under `play_short`, one minor per side at
   * full strength is the exception: both count and the teams play four on four.
   */
  private cancelledInUnit(unit: HockeyPenaltyRecord[]): Set<string> {
    const cancelled = new Set<string>()
    const grouped = unit.filter(record => record.coincidenceGroupId !== null)
    if (grouped.length === 0) return cancelled
    const strengthPenalties = grouped.filter(record => hockeyPenaltyAffectsStrength(record.class))
    const minors = strengthPenalties.filter(record => record.class === 'minor')
    if (
      this.coincidentalMinors === 'play_short' &&
      strengthPenalties.length === 2 &&
      minors.length === 2 &&
      minors[0].side !== minors[1].side &&
      !this.items.some(item => item.strength && item.state !== 'done')
    ) {
      return cancelled
    }
    const bucket = (record: HockeyPenaltyRecord) => (record.class === 'match' ? 'major' : record.class)
    for (const name of ['minor', 'double_minor', 'major']) {
      const tracked = strengthPenalties.filter(record => bucket(record) === name && record.side === 'tracked')
      const opponent = strengthPenalties.filter(record => bucket(record) === name && record.side === 'opponent')
      const pairs = Math.min(tracked.length, opponent.length)
      for (let index = 0; index < pairs; index++) {
        cancelled.add(tracked[index].eventId)
        cancelled.add(opponent[index].eventId)
      }
    }
    return cancelled
  }

  private release(release: HockeyPenaltyReleaseRecord): void {
    const item = this.items.find(entry => entry.record.eventId === release.penaltyEventId && entry.segment === release.segment)
    if (!item || item.state === 'done') {
      this.notes.push({
        eventId: release.eventId,
        message: 'This early release has no effect: the penalty had already ended by then.',
      })
      return
    }
    this.finish(item)
  }

  private advance(delta: number): void {
    let remaining = delta
    while (remaining > 0) {
      const running = this.items.filter(item => item.state === 'running')
      if (running.length === 0) return
      const step = Math.min(remaining, ...running.map(item => item.remainingMs))
      for (const item of running) item.remainingMs -= step
      remaining -= step
      for (const item of running) {
        if (item.remainingMs <= 0 && item.state === 'running') this.finish(item)
      }
    }
  }

  /** Ends an item and starts whatever was waiting on it. */
  private finish(item: BoxItem): void {
    const wasRunning = item.state === 'running'
    item.state = 'done'
    item.remainingMs = Math.max(0, item.remainingMs)
    const next = firstOpen(item.next)
    if (next && wasRunning) {
      // The next half of a double minor takes over the same slot at once.
      next.state = 'running'
    }
    if (item.strength && wasRunning && !(next && next.strength)) this.startWaiting(item.record.side)
    for (const other of this.items) {
      if (other.state === 'waiting' && other.after.includes(item)) this.tryStart(other)
    }
  }

  private tryStart(item: BoxItem | null): void {
    const head = firstOpen(item)
    if (!head || head.state !== 'waiting') return
    if (!head.after.every(dependency => dependency.state === 'done')) return
    if (head.strength && this.runningStrength(head.record.side) >= 2) return
    if (head.strength && this.hasEarlierWaitingHead(head)) return
    head.state = 'running'
  }

  /** Waiting strength penalties start in the order they were assessed. */
  private startWaiting(side: HockeySide): void {
    const heads = this.items
      .filter(item => item.record.side === side && item.strength && item.state === 'waiting' && isChainHead(this.items, item))
      .sort((left, right) => left.queuedAt - right.queuedAt)
    for (const head of heads) {
      if (this.runningStrength(side) >= 2) return
      head.state = 'running'
    }
  }

  private hasEarlierWaitingHead(head: BoxItem): boolean {
    return this.items.some(item =>
      item !== head &&
      item.record.side === head.record.side &&
      item.strength &&
      item.state === 'waiting' &&
      item.queuedAt < head.queuedAt &&
      isChainHead(this.items, item)
    )
  }

  private runningStrength(side: HockeySide): number {
    return this.items.filter(item => item.record.side === side && item.strength && item.state === 'running').length
  }
}

/** Running first, then waiting. */
function rank(item: BoxItem): number {
  return item.state === 'running' ? 0 : 1
}

/** The first segment of a chain that is not done, starting at `item`. */
function firstOpen(item: BoxItem | null): BoxItem | null {
  let current = item
  while (current && current.state === 'done') current = current.next
  return current
}

/** True when no earlier open segment of the same penalty precedes this one. */
function isChainHead(items: readonly BoxItem[], item: BoxItem): boolean {
  return !items.some(other => other.next === item && other.state !== 'done')
}

function offenderKey(record: HockeyPenaltyRecord): string | null {
  if (record.offenderParticipantId) return `p:${record.offenderParticipantId}`
  if (record.offenderLabel) return `l:${record.side}:${record.offenderLabel.trim().toLowerCase()}`
  return null
}

/** Consecutive penalties sharing a capture command form one unit; others stand alone. */
export function groupPenaltyUnits(records: readonly HockeyPenaltyRecord[]): HockeyPenaltyRecord[][] {
  const units: HockeyPenaltyRecord[][] = []
  for (const record of records) {
    const last = units[units.length - 1]
    if (record.captureCommandId && last && last[0].captureCommandId === record.captureCommandId) last.push(record)
    else units.push([record])
  }
  return units
}
