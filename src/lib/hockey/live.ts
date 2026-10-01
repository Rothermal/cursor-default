import type { GameState } from '../../types'
import type { BasketballWorkflowAction } from '../basketball/productionClockPolicy'
import { basketballWorkflowActionKind } from '../basketball/productionClockPolicy'
import { isPlainObject } from '../gameEvents/envelope'
import {
  applyGameEventAppendsAndMutations,
  applyGameEventMutations,
  hasLegacyAggregateActivity,
  initializeGameEventStream,
} from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream, stableJson } from '../gameEvents/stream'
import type { GameEvent, GameEventActor, GameEventLocation, GameEventMutation, GameEventPeriod } from '../gameEvents/types'
import { createHockeyEvent, isHockeyReason, type CreateHockeyEventInput } from './events'
import { hockeyPeriod } from './periods'
import {
  HOCKEY_PLACEMENT_KEYS,
  hockeyEventPlacement,
  hockeyPlacementFields,
  isPlaceableHockeyEventType,
  orderHockeyEvents,
  type HockeyPlacement,
} from './placement'
import { hockeyActivePeriod, hockeyClockMomentAt, lastHockeyPeriod, replayHockeyEvents } from './projector'
import { normalizeHockeyMatchSetup, validateHockeyMatchSetup } from './setup'
import { createHockeySportGameState } from './state'
import type {
  HockeyEventType,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyPayloadByType,
  HockeySide,
  HockeySportGameState,
  HockeyUndoReceipt,
} from './types'

export type HockeyCommandErrorCode =
  | 'not_hockey'
  | 'invalid_setup'
  | 'legacy_activity_present'
  | 'already_initialized'
  | 'stream_not_initialized'
  | 'history_invalid'
  | 'clock_unavailable'
  | 'reason_required'
  | 'rejected'

export type HockeyCommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; state: GameState; code: HockeyCommandErrorCode; message: string }

export interface HockeyCommandContext {
  recorderUserId: string | null
  occurredAt: string
  /** Optional deterministic ids, used in order, for tests and retries. */
  eventIds?: string[]
  /**
   * Correction mode (HKY-4B): rebuild these active events, one capture unit in capture order,
   * from the game as it stood just before them. `occurredAt` must be the first event's capture
   * time. The rebuilt events keep their ids, sequence and capture time.
   */
  replaceEventIds?: readonly string[]
  /** When a correction is saved; the update time of revised events. */
  correctedAt?: string
  /**
   * Correction and recorded-later modes: amends the whole candidate history before it is
   * checked, for dependent repairs saved in the same batch (goalie restamping).
   */
  amendCorrection?: (candidate: GameEvent[]) => { events: GameEvent[]; mutations: GameEventMutation[] }
  /**
   * Game-order placement (HKY-4C). On an append the new events are recorded later at this game
   * time; on a correction the unit moves there. The builder sees the game as it stood at that
   * point, with an anchored clock paused at the given time.
   */
  place?: HockeyPlaceTarget
}

export interface HockeyPlaceTarget {
  periodId: string
  /** Clock time on anchored games (zero for period start); null on clockless games. */
  elapsedMs: number | null
  placement: HockeyPlacement
}

export type HockeyPendingEvent = {
  [K in HockeyEventType]: {
    eventType: K
    payload: HockeyPayloadByType[K]
    period: GameEventPeriod
    elapsedMs: number | null
    teamSide?: HockeySide
    location?: GameEventLocation | null
    actors?: GameEventActor[]
  }
}[HockeyEventType]

type PendingEvent = HockeyPendingEvent

// ---------------------------------------------------------------------------
// Game creation

/**
 * Installs Hockey setup and an empty authoritative event stream on a fresh game.
 * An identical setup is an idempotent no-op; any different setup is rejected once
 * the stream exists, so events are never replayed under replacement rules.
 */
export function initializeHockeyEventGame(state: GameState, setup: HockeyMatchSetup): HockeyCommandResult {
  if (state.sport?.id !== 'hockey') return failure(state, 'not_hockey', 'The active sport is not Hockey.')
  if (state.eventStream) {
    const existing = hockeySportState(state)
    if (existing && stableJson(existing.setup) === stableJson(setup)) return { ok: true, state, events: [] }
    return failure(state, 'already_initialized', 'This game already has a Hockey setup. Start a new game to change it.')
  }
  if (hasLegacyAggregateActivity(state)) {
    return failure(state, 'legacy_activity_present', 'This game already has counter-based stats.')
  }
  // The full normalizer is the same gate hydration applies, so an accepted setup always survives reload.
  const normalized = normalizeHockeyMatchSetup(setup)
  if (!normalized) return failure(state, 'invalid_setup', invalidSetupMessage(setup))
  const initialized = initializeGameEventStream(
    { ...state, sportGameState: createHockeySportGameState(normalized) },
    gameEventRegistry,
    gameEventProjectors
  )
  if (!initialized.ok) return failure(state, 'invalid_setup', initialized.error.message)
  return { ok: true, state: initialized.state, events: [] }
}

/** Keeps the specific lineup message when the structure allows checking it. */
function invalidSetupMessage(setup: HockeyMatchSetup): string {
  try {
    const validation = validateHockeyMatchSetup(setup)
    if (!validation.ok) return validation.message
  } catch {
    // Structurally malformed setup; fall through to the general message.
  }
  return 'The Hockey setup has invalid rules, names or fields.'
}

// ---------------------------------------------------------------------------
// Lifecycle commands

/** Records the opening lineup and opens period 1 atomically; an anchored clock starts paused at zero. */
export function startHockeyGame(state: GameState, context: HockeyCommandContext): HockeyCommandResult {
  return runHockeyCommand(state, context, (sport, projection) => {
    if (projection.status !== 'pregame' || projection.lineupRecorded) return 'The game has already started.'
    const lineup = sport.setup.openingLineup
    const firstPeriod = hockeyPeriod('regulation', 1)
    const events: PendingEvent[] = [
      {
        eventType: 'hockey.opening_lineup',
        payload: {
          captureCommandId: null,
          goalieParticipantId: lineup.goalieParticipantId,
          skaterParticipantIds: [...lineup.skaterParticipantIds],
          opponentGoalieId: sport.setup.opponentGoalie.id,
        },
        period: firstPeriod,
        elapsedMs: null,
      },
      {
        eventType: 'hockey.period_started',
        payload: { captureCommandId: null, kind: 'regulation', number: 1 },
        period: firstPeriod,
        elapsedMs: anchored(sport) ? 0 : null,
      },
    ]
    return events
  })
}

export function startNextHockeyPeriod(state: GameState, context: HockeyCommandContext): HockeyCommandResult {
  return runHockeyCommand(state, context, (sport, projection) => {
    if (projection.status !== 'in_progress') return 'The match is not in progress.'
    if (projection.activePeriodId) return 'End the current period first.'
    const next = projection.nextPeriod
    if (!next) return 'No further period is allowed. End the match instead.'
    return [{
      eventType: 'hockey.period_started',
      payload: { captureCommandId: null, kind: next.kind, number: next.number },
      period: hockeyPeriod(next.kind, next.number),
      elapsedMs: anchored(sport) ? 0 : null,
    }]
  })
}

/**
 * Ends the active period. An anchored running clock is paused in the same command;
 * ending before the clock expires needs a reason, while a clockless period ends any time.
 */
export function endHockeyPeriod(
  state: GameState,
  input: { reason?: string | null },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    const active = hockeyActivePeriod(projection)
    if (projection.status !== 'in_progress' || !active) return 'No period is in progress.'
    const period = { id: active.id, order: active.order }
    const reason = cleanReason(input.reason)
    const events: PendingEvent[] = []
    let elapsedMs: number | null = null
    if (projection.clock) {
      const pause = hockeyPauseIfRunning(projection, period, context.occurredAt)
      if (typeof pause === 'string') return pause
      if (pause) events.push(pause.event)
      elapsedMs = pause ? pause.elapsedMs : projection.clock.elapsedMs
      if (elapsedMs < active.durationMs && !reason) {
        return { code: 'reason_required', message: 'Say why the period is ending before the clock runs out.' }
      }
    }
    events.push({
      eventType: 'hockey.period_ended',
      payload: { captureCommandId: null, reason },
      period,
      elapsedMs,
    })
    return events
  })
}

export function endHockeyMatch(
  state: GameState,
  input: { reason?: string | null },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    if (projection.status !== 'in_progress') return 'The match is not in progress.'
    if (projection.activePeriodId) return 'End the current period first.'
    const reason = cleanReason(input.reason)
    if (!projection.canEndWithoutReason && !reason) {
      return { code: 'reason_required', message: 'Say why the match is ending before its rules complete it.' }
    }
    return [{
      eventType: 'hockey.match_ended',
      payload: { captureCommandId: null, reason },
      period: currentPeriod(projection),
      elapsedMs: null,
    }]
  })
}

/** Suspends or abandons the match, pausing a running anchored clock in the same command. */
export function interruptHockeyMatch(
  state: GameState,
  input: { kind: 'suspended' | 'abandoned'; reason: string },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    if (projection.status !== 'in_progress') return 'The match is not in progress.'
    const reason = cleanReason(input.reason)
    if (!reason) return { code: 'reason_required', message: 'A reason is required.' }
    const period = currentPeriod(projection)
    const events: PendingEvent[] = []
    const pause = hockeyPauseIfRunning(projection, period, context.occurredAt)
    if (typeof pause === 'string') return pause
    if (pause) events.push(pause.event)
    events.push({
      eventType: input.kind === 'suspended' ? 'hockey.match_suspended' : 'hockey.match_abandoned',
      payload: { captureCommandId: null, reason },
      period,
      elapsedMs: eventElapsed(projection, pause?.elapsedMs),
    })
    return events
  })
}

export function reopenHockeyMatch(
  state: GameState,
  input: { reason: string },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    if (projection.status !== 'ended' && projection.status !== 'suspended' && projection.status !== 'abandoned') {
      return 'Only an ended, suspended or abandoned match can be reopened.'
    }
    const reason = cleanReason(input.reason)
    if (!reason) return { code: 'reason_required', message: 'A reason is required.' }
    return [{
      eventType: 'hockey.match_reopened',
      payload: { captureCommandId: null, reason },
      period: currentPeriod(projection),
      elapsedMs: null,
    }]
  })
}

/**
 * One tap after a sudden-death goal: pauses a running clock, ends the decided period
 * and ends the match, atomically. No reason is needed; the goal decided it.
 */
export function finishDecidedHockeyGame(state: GameState, context: HockeyCommandContext): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    if (projection.status !== 'in_progress' || !projection.decidedInPeriodId) {
      return 'No lead has decided the sudden-death overtime.'
    }
    const events: PendingEvent[] = []
    const active = hockeyActivePeriod(projection)
    let period = currentPeriod(projection)
    if (active) {
      period = { id: active.id, order: active.order }
      const pause = hockeyPauseIfRunning(projection, period, context.occurredAt)
      if (typeof pause === 'string') return pause
      if (pause) events.push(pause.event)
      events.push({
        eventType: 'hockey.period_ended',
        payload: { captureCommandId: null, reason: null },
        period,
        elapsedMs: eventElapsed(projection, pause?.elapsedMs),
      })
    }
    events.push({
      eventType: 'hockey.match_ended',
      payload: { captureCommandId: null, reason: null },
      period,
      elapsedMs: null,
    })
    return events
  })
}

// ---------------------------------------------------------------------------
// Clock commands (anchored games only)

export function startHockeyClock(state: GameState, context: HockeyCommandContext): HockeyCommandResult {
  return clockCommand(state, context, (_projection, clock, active, period) => {
    if (clock.running) return 'The clock is already running.'
    if (clock.expired || clock.elapsedMs >= active.durationMs) return 'Set the clock below the period length first.'
    return [{
      eventType: 'hockey.clock_started',
      payload: { captureCommandId: null, anchorElapsedMs: clock.elapsedMs },
      period,
      elapsedMs: clock.elapsedMs,
    }]
  })
}

export function pauseHockeyClock(state: GameState, context: HockeyCommandContext): HockeyCommandResult {
  return clockCommand(state, context, (projection, clock, _active, period) => {
    if (!clock.running) return 'The clock is already paused.'
    const pause = hockeyPauseIfRunning(projection, period, context.occurredAt)
    if (typeof pause === 'string') return pause
    return pause ? [pause.event] : 'The clock is already paused.'
  })
}

/** Sets a paused clock to a new elapsed time; a reason is always required. */
export function setHockeyClock(
  state: GameState,
  input: { elapsedMs: number; reason: string },
  context: HockeyCommandContext
): HockeyCommandResult {
  return clockCommand(state, context, (_projection, clock, active, period) => {
    if (clock.running) return 'Pause the clock before setting it.'
    const reason = cleanReason(input.reason)
    if (!reason) return { code: 'reason_required', message: 'Say why the clock is being changed.' }
    if (!Number.isInteger(input.elapsedMs) || input.elapsedMs < 0 || input.elapsedMs > active.durationMs) {
      return 'The clock must stay within the period length.'
    }
    if (input.elapsedMs === clock.elapsedMs) return 'The clock already shows that time.'
    return [{
      eventType: 'hockey.clock_set',
      payload: {
        captureCommandId: null,
        fromElapsedMs: clock.elapsedMs,
        toElapsedMs: input.elapsedMs,
        reason,
      },
      period,
      elapsedMs: input.elapsedMs,
    }]
  })
}

// ---------------------------------------------------------------------------
// Display, preferences and the shared active-game mutation guard

export interface HockeyClockReading {
  elapsedMs: number
  /** Remaining time for count-down clocks, elapsed time for count-up clocks. */
  displayMs: number
  expired: boolean
}

/** Display-only clock reading; never written to state. */
export function hockeyClockDisplay(sport: HockeySportGameState, nowIso: string): HockeyClockReading | null {
  const projection = sport.projection
  const clock = projection.clock
  const active = hockeyActivePeriod(projection)
  if (!clock || !active || !sport.setup.rulesSnapshot.clock) return null
  const moment = hockeyClockMomentAt(clock, nowIso, active.durationMs)
  const elapsedMs = moment.ok ? moment.elapsedMs : clock.elapsedMs
  const countDown = sport.setup.rulesSnapshot.clock.display === 'count_down'
  return {
    elapsedMs,
    displayMs: countDown ? active.durationMs - elapsedMs : elapsedMs,
    expired: elapsedMs >= active.durationMs,
  }
}

export function formatHockeyClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function setHockeyRinkFlipped(state: GameState, flipped: boolean): GameState {
  const sport = hockeySportState(state)
  if (!sport || sport.capturePreferences.rinkFlipped === flipped) return state
  return {
    ...state,
    sportGameState: { ...sport, capturePreferences: { ...sport.capturePreferences, rinkFlipped: flipped } },
  }
}

export function isRunningAnchoredHockeyGame(state: GameState): boolean {
  const sport = hockeySportState(state)
  return state.sport?.id === 'hockey' &&
    state.gameDataAuthority === 'sport_events' &&
    sport?.projection.clock?.running === true
}

/** Same contract as Basketball: park or replace pauses a running clock first (BKE-6B4). */
export function shouldInterceptRunningHockeyClock(state: GameState, action: BasketballWorkflowAction): boolean {
  return isRunningAnchoredHockeyGame(state) && basketballWorkflowActionKind(action) === 'park_or_replace'
}

export function pauseRunningHockeyClockForWorkflow(
  state: GameState,
  action: BasketballWorkflowAction,
  options: { recorderUserId: string | null; occurredAt?: string }
): HockeyCommandResult {
  if (!shouldInterceptRunningHockeyClock(state, action)) return { ok: true, state, events: [] }
  return pauseHockeyClock(state, {
    recorderUserId: options.recorderUserId,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
  })
}

export function hockeySportState(state: GameState): HockeySportGameState | null {
  const sport = state.sportGameState
  return sport && sport.sportId === 'hockey' ? (sport as HockeySportGameState) : null
}

// ---------------------------------------------------------------------------
// Internals

export type HockeyCommandBuild = PendingEvent[] | string | { code: HockeyCommandErrorCode; message: string }
type Built = HockeyCommandBuild

/**
 * Shared command path: a fresh replay decides, the registry and a candidate replay check
 * the new events, and they append atomically. Capture commands (HKY-2B) use it too.
 */
export function runHockeyCommand(
  state: GameState,
  context: HockeyCommandContext,
  build: (sport: HockeySportGameState, projection: HockeyMatchProjection) => Built
): HockeyCommandResult {
  const sport = hockeySportState(state)
  if (!sport || state.sport?.id !== 'hockey') return failure(state, 'not_hockey', 'This is not a Hockey event game.')
  if (!state.eventStream) return failure(state, 'stream_not_initialized', 'Set up the Hockey game first.')
  if (context.replaceEventIds) return runHockeyCorrection(state, sport, context, context.replaceEventIds, build)
  if (context.place) return runHockeyAddition(state, sport, context, context.place, build)
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  // Commands decide from a fresh replay, never from the cached projection.
  const replay = replayHockeyEvents(sport.setup, inspection.activeEvents)
  if (!inspection.complete || replay.diagnostics.length > 0) {
    return failure(state, 'history_invalid', 'The Hockey event history needs repair before new events are recorded.')
  }
  const built = build(sport, replay.projection)
  if (typeof built === 'string') return failure(state, 'rejected', built)
  if (!Array.isArray(built)) return failure(state, built.code, built.message)

  let sequence = nextHockeyEventSequence(state.eventStream.events, context.recorderUserId)
  const events = built.map((pending, index) => createHockeyEvent({
    id: context.eventIds?.[index],
    eventType: pending.eventType,
    payload: pending.payload,
    period: pending.period,
    elapsedMs: pending.elapsedMs,
    teamSide: pending.teamSide,
    location: pending.location,
    actors: pending.actors,
    recorderUserId: context.recorderUserId,
    sequence: sequence++,
    occurredAt: context.occurredAt,
  }) as unknown as GameEvent)

  for (const event of events) {
    const check = gameEventRegistry.inspect(event)
    if (!check.ok) return failure(state, 'rejected', check.diagnostic.message)
  }
  const candidate = replayHockeyEvents(sport.setup, [...inspection.activeEvents, ...events])
  if (candidate.diagnostics.length > 0) return failure(state, 'rejected', candidate.diagnostics[0].message)

  const result = applyGameEventAppendsAndMutations(
    state,
    events,
    [],
    context.occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok) return failure(state, 'rejected', result.error.message)
  // Any new event ends the chance to restore the last undone capture.
  return { ok: true, state: withHockeyUndoReceipt(result.state, null), events }
}

/**
 * Correction path (HKY-4B): the command's own builder runs against a replay of every active
 * event before the unit, so edits get exactly the checks live capture gets. The unit's events
 * are revised in place; the whole candidate history must then replay. A history that fails
 * after the unit may be repaired this way, but the history before it must replay.
 */
function runHockeyCorrection(
  state: GameState,
  sport: HockeySportGameState,
  context: HockeyCommandContext,
  replaceEventIds: readonly string[],
  build: (sport: HockeySportGameState, projection: HockeyMatchProjection) => Built
): HockeyCommandResult {
  const inspection = inspectGameEventStream(state.eventStream!, gameEventRegistry)
  if (!inspection.complete) return failure(state, 'history_invalid', 'Some stored Hockey events cannot be read.')
  const ordered = orderHockeyEvents(inspection.activeEvents)
  const current = replayHockeyEvents(sport.setup, ordered)
  const status = current.projection.status
  if (current.diagnostics.length === 0 && (status === 'suspended' || status === 'abandoned')) {
    return failure(state, 'rejected', 'Reopen the game to correct it.')
  }
  const targets = replaceEventIds.map(id => ordered.find(event => event.id === id))
  if (targets.length === 0 || targets.some(event => !event)) return failure(state, 'rejected', 'That event is no longer active.')
  let unit = targets as GameEvent[]
  if (context.occurredAt !== unit[0].occurredAt) {
    return failure(state, 'rejected', 'A correction is built at the time the event was recorded.')
  }
  const first = ordered.indexOf(unit[0])
  if (unit.some((event, index) => ordered[first + index] !== event)) {
    return failure(state, 'rejected', 'Only one whole capture can be corrected at a time.')
  }

  // Where the unit replays: where it is placed now, or where a re-time moves it.
  const stored = unitPlacement(unit)
  const place = context.place ?? stored
  if (context.place) {
    // A re-time moves the capture; a clock pause taken with a live timeout stays where it was.
    unit = unit.filter(event => !CLOCK_EVENT_TYPES.has(event.eventType))
    if (unit.length === 0) return failure(state, 'rejected', 'Clock rows cannot be moved.')
    const message = checkHockeyPlaceTarget(sport, current.projection, context.place, context.correctedAt ?? context.occurredAt)
    if (message) return failure(state, 'rejected', message)
  }
  const moving = new Set(unit.map(event => event.id))
  const others = ordered.filter(event => !moving.has(event.id))
  // A content edit keeps the unit where it replays now; a re-time finds its new point with
  // the unit's own capture identity, so same-time placed events keep their order.
  const prefixEvents = context.place
    ? hockeyEventsBeforePlacement(others, context.place, unit[0])
    : ordered.slice(0, first)
  const prefix = replayHockeyEvents(sport.setup, prefixEvents)
  if (prefix.diagnostics.length > 0) {
    return failure(state, 'history_invalid', 'The history before this event needs repair first.')
  }
  const built = build(sport, place ? hockeyPlacedFrame(prefix.projection, place) : prefix.projection)
  if (typeof built === 'string') return failure(state, 'rejected', built)
  if (!Array.isArray(built)) return failure(state, built.code, built.message)
  if (built.length !== unit.length || built.some((pending, index) => pending.eventType !== unit[index].eventType)) {
    return failure(state, 'rejected', 'This change adds or removes events. Remove the row and record it again instead.')
  }
  if (place) {
    const message = checkPlacedBuild(built, place)
    if (message) return failure(state, 'rejected', message)
  }

  const now = context.correctedAt ?? context.occurredAt
  const mutations: GameEventMutation[] = []
  const revised = unit.map((event, index) => {
    const pending = built[index]
    const flags = hockeyPlacementFields(event)
    const payload = place
      ? withPlacement(pending.payload, place.placement, {
          recordedLater: flags.recordedLater,
          // Moving a live capture marks it re-timed; a recorded-later event keeps its badge.
          retimed: flags.retimed || (context.place !== undefined && !flags.recordedLater),
        })
      : pending.payload
    const next = createHockeyEvent({
      id: event.id,
      eventType: pending.eventType,
      payload,
      period: pending.period,
      elapsedMs: pending.elapsedMs,
      teamSide: pending.teamSide,
      location: pending.location,
      actors: pending.actors,
      recorderUserId: event.recorderUserId,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
    } as CreateHockeyEventInput<HockeyEventType>) as unknown as GameEvent
    const changes = {
      period: next.period,
      elapsedMs: next.elapsedMs,
      teamSide: next.teamSide,
      location: next.location,
      actors: next.actors,
      payload: next.payload,
    }
    const same = stableJson(changes) === stableJson({
      period: event.period,
      elapsedMs: event.elapsedMs,
      teamSide: event.teamSide,
      location: event.location,
      actors: event.actors,
      payload: event.payload,
    })
    if (!same) mutations.push({ type: 'update', eventId: event.id, changes })
    return { ...event, ...changes }
  })
  if (mutations.length === 0) return failure(state, 'rejected', 'Nothing changed.')
  for (const event of revised) {
    const check = gameEventRegistry.inspect(event)
    if (!check.ok) return failure(state, 'rejected', check.diagnostic.message)
  }
  const revisedById = new Map(revised.map(event => [event.id, event]))
  let candidate: GameEvent[] = ordered.map(event => revisedById.get(event.id) ?? event)
  if (context.amendCorrection) {
    const amended = context.amendCorrection(candidate)
    candidate = amended.events
    mutations.push(...amended.mutations)
  }
  const replay = replayHockeyEvents(sport.setup, candidate)
  if (replay.diagnostics.length > 0) return failure(state, 'rejected', replay.diagnostics[0].message)
  const result = applyGameEventMutations(state, mutations, now, gameEventRegistry, gameEventProjectors)
  if (!result.ok) return failure(state, 'rejected', result.error.message)
  // A correction ends the chance to restore the last undone capture (the Basketball rule).
  return { ok: true, state: withHockeyUndoReceipt(result.state, null), events: revised }
}

/**
 * Recorded-later path (HKY-4C): the builder runs against the game as it stood at the chosen
 * game time, and the new events append in capture order but replay at that time.
 */
function runHockeyAddition(
  state: GameState,
  sport: HockeySportGameState,
  context: HockeyCommandContext,
  place: HockeyPlaceTarget,
  build: (sport: HockeySportGameState, projection: HockeyMatchProjection) => Built
): HockeyCommandResult {
  const inspection = inspectGameEventStream(state.eventStream!, gameEventRegistry)
  const ordered = orderHockeyEvents(inspection.activeEvents)
  const current = replayHockeyEvents(sport.setup, ordered)
  if (!inspection.complete || current.diagnostics.length > 0) {
    return failure(state, 'history_invalid', 'The Hockey event history needs repair before new events are recorded.')
  }
  const status = current.projection.status
  if (status === 'suspended' || status === 'abandoned') return failure(state, 'rejected', 'Reopen the game to add to it.')
  const message = checkHockeyPlaceTarget(sport, current.projection, place, context.occurredAt)
  if (message) return failure(state, 'rejected', message)
  const prefix = replayHockeyEvents(sport.setup, hockeyEventsBeforePlacement(ordered, place))
  if (prefix.diagnostics.length > 0) return failure(state, 'history_invalid', 'The history before that time needs repair first.')
  const built = build(sport, hockeyPlacedFrame(prefix.projection, place))
  if (typeof built === 'string') return failure(state, 'rejected', built)
  if (!Array.isArray(built)) return failure(state, built.code, built.message)
  const placedMessage = checkPlacedBuild(built, place)
  if (placedMessage) return failure(state, 'rejected', placedMessage)

  let sequence = nextHockeyEventSequence(state.eventStream!.events, context.recorderUserId)
  const events = built.map((pending, index) => createHockeyEvent({
    id: context.eventIds?.[index],
    eventType: pending.eventType,
    payload: withPlacement(pending.payload, place.placement, { recordedLater: true, retimed: false }),
    period: pending.period,
    elapsedMs: pending.elapsedMs,
    teamSide: pending.teamSide,
    location: pending.location,
    actors: pending.actors,
    recorderUserId: context.recorderUserId,
    sequence: sequence++,
    occurredAt: context.occurredAt,
  } as CreateHockeyEventInput<HockeyEventType>) as unknown as GameEvent)
  for (const event of events) {
    const check = gameEventRegistry.inspect(event)
    if (!check.ok) return failure(state, 'rejected', check.diagnostic.message)
  }
  let candidate: GameEvent[] = [...ordered, ...events]
  const mutations: GameEventMutation[] = []
  if (context.amendCorrection) {
    const amended = context.amendCorrection(candidate)
    candidate = amended.events
    mutations.push(...amended.mutations)
  }
  const replay = replayHockeyEvents(sport.setup, candidate)
  if (replay.diagnostics.length > 0) return failure(state, 'rejected', replay.diagnostics[0].message)
  const result = applyGameEventAppendsAndMutations(state, events, mutations, context.occurredAt, gameEventRegistry, gameEventProjectors)
  if (!result.ok) return failure(state, 'rejected', result.error.message)
  return { ok: true, state: withHockeyUndoReceipt(result.state, null), events }
}

const CLOCK_EVENT_TYPES = new Set<string>(['hockey.clock_started', 'hockey.clock_paused', 'hockey.clock_set'])

/** The unit's stored placement, when its capture events are placed. */
function unitPlacement(unit: readonly GameEvent[]): HockeyPlaceTarget | null {
  const placed = unit.find(event => hockeyEventPlacement(event) !== null)
  if (!placed) return null
  return { periodId: placed.period.id, elapsedMs: placed.elapsedMs, placement: hockeyEventPlacement(placed)! }
}

/**
 * Active events that replay before an event placed at `place` (game order). A new addition
 * goes after every placed event at the same point; an existing event being re-timed passes
 * itself as `existing`, so it keeps its capture-order tie-break.
 */
export function hockeyEventsBeforePlacement(
  events: readonly GameEvent[],
  place: HockeyPlaceTarget,
  existing?: Pick<GameEvent, 'id' | 'sequence'>
): GameEvent[] {
  const probe = placeProbe(place, existing)
  const ordered = orderHockeyEvents([...events, probe])
  return ordered.slice(0, ordered.indexOf(probe))
}

/** A stand-in for the placed event, to find its position in game order. */
function placeProbe(place: HockeyPlaceTarget, existing?: Pick<GameEvent, 'id' | 'sequence'>): GameEvent {
  return {
    id: existing?.id ?? '\uffff-placement-probe',
    sportId: 'hockey',
    eventType: 'hockey.shot',
    schemaVersion: 1,
    recorderUserId: '\uffff',
    sequence: existing?.sequence ?? Number.MAX_SAFE_INTEGER,
    period: { id: place.periodId, order: 0 },
    elapsedMs: place.elapsedMs,
    occurredAt: '9999-12-31T23:59:59.999Z',
    teamSide: 'neutral',
    location: null,
    actors: [],
    payload: { placement: place.placement },
    revision: 1,
    createdAt: '9999-12-31T23:59:59.999Z',
    updatedAt: '9999-12-31T23:59:59.999Z',
    deletedAt: null,
  } as GameEvent
}

/** The projection at the placement with an anchored clock paused at the placed time. */
export function hockeyPlacedFrame(projection: HockeyMatchProjection, place: HockeyPlaceTarget): HockeyMatchProjection {
  if (!projection.clock || place.elapsedMs === null) return projection
  return {
    ...projection,
    clock: {
      ...projection.clock,
      running: false,
      elapsedMs: place.elapsedMs,
      anchorElapsedMs: null,
      anchorOccurredAt: null,
      expired: false,
    },
  }
}

/** Whether a placement names a started period and a time inside what has been played of it. */
export function checkHockeyPlaceTarget(
  sport: HockeySportGameState,
  projection: HockeyMatchProjection,
  place: HockeyPlaceTarget,
  occurredAt: string
): string | null {
  const period = projection.periods.find(entry => entry.id === place.periodId)
  if (!period) return 'Pick a period that has started.'
  const anchored = sport.setup.rulesSnapshot.clockModel === 'anchored'
  if (!anchored) return place.elapsedMs === null ? null : 'This game has no clock.'
  if (place.elapsedMs === null || !Number.isInteger(place.elapsedMs) || place.elapsedMs < 0) return 'Enter the clock time.'
  if (place.placement === 'period_start') return place.elapsedMs === 0 ? null : 'A period-start event is at 0:00 played.'
  let limit = period.endedAtElapsedMs ?? period.durationMs
  if (period.id === projection.activePeriodId && projection.clock) {
    const moment = hockeyClockMomentAt(projection.clock, occurredAt, period.durationMs)
    if (!moment.ok) return moment.message
    limit = moment.elapsedMs
  }
  return place.elapsedMs > limit ? 'That time has not been played yet in this period.' : null
}

function checkPlacedBuild(built: readonly HockeyPendingEvent[], place: HockeyPlaceTarget): string | null {
  for (const pending of built) {
    if (!isPlaceableHockeyEventType(pending.eventType)) return 'This kind of event cannot be placed at a game time.'
    if (place.placement === 'period_start' && pending.eventType !== 'hockey.goalie_change') {
      return 'Only a goalie change is placed at the period start.'
    }
    if (pending.period.id !== place.periodId || pending.elapsedMs !== place.elapsedMs) {
      return 'The event must be recorded at the chosen time.'
    }
  }
  return null
}

function withPlacement<T>(
  payload: T,
  placement: HockeyPlacement,
  flags: { recordedLater: boolean; retimed: boolean }
): T {
  const base = { ...(payload as Record<string, unknown>) }
  for (const key of HOCKEY_PLACEMENT_KEYS) delete base[key]
  return {
    ...base,
    placement,
    ...(flags.recordedLater ? { recordedLater: true } : {}),
    ...(flags.retimed ? { retimed: true } : {}),
  } as T
}

/** Sets or clears the Restore receipt; it lives in device preferences, outside fingerprints. */
export function withHockeyUndoReceipt(state: GameState, receipt: HockeyUndoReceipt | null): GameState {
  const sport = hockeySportState(state)
  if (!sport || sport.capturePreferences.lastUndo === receipt) return state
  return {
    ...state,
    sportGameState: { ...sport, capturePreferences: { ...sport.capturePreferences, lastUndo: receipt } },
  }
}

function clockCommand(
  state: GameState,
  context: HockeyCommandContext,
  build: (
    projection: HockeyMatchProjection,
    clock: NonNullable<HockeyMatchProjection['clock']>,
    active: NonNullable<ReturnType<typeof hockeyActivePeriod>>,
    period: GameEventPeriod
  ) => Built
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    const clock = projection.clock
    if (!clock) return { code: 'clock_unavailable', message: 'This game does not use a clock.' }
    const active = hockeyActivePeriod(projection)
    if (projection.status !== 'in_progress' || !active) return 'The clock can only change during a period.'
    return build(projection, clock, active, { id: active.id, order: active.order })
  })
}

/** A pause event when the anchored clock is running; expiration is detected from the moment. */
export function hockeyPauseIfRunning(
  projection: HockeyMatchProjection,
  period: GameEventPeriod,
  occurredAt: string
): { event: PendingEvent; elapsedMs: number } | null | string {
  const clock = projection.clock
  const active = hockeyActivePeriod(projection)
  if (!clock?.running || !active) return null
  const moment = hockeyClockMomentAt(clock, occurredAt, active.durationMs)
  if (!moment.ok) return moment.message
  return {
    elapsedMs: moment.elapsedMs,
    event: {
      eventType: 'hockey.clock_paused',
      payload: {
        captureCommandId: null,
        elapsedMs: moment.elapsedMs,
        source: moment.unboundedElapsedMs >= active.durationMs ? 'expiration' : 'manual',
      },
      period,
      elapsedMs: moment.elapsedMs,
    },
  }
}

/** Elapsed for a follow-on event: the paused clock inside an active anchored period, else null. */
function eventElapsed(projection: HockeyMatchProjection, pausedAt: number | undefined): number | null {
  if (!projection.clock || !projection.activePeriodId) return null
  return pausedAt ?? projection.clock.elapsedMs
}

function currentPeriod(projection: HockeyMatchProjection): GameEventPeriod {
  const period = hockeyActivePeriod(projection) ?? lastHockeyPeriod(projection)
  return period ? { id: period.id, order: period.order } : hockeyPeriod('regulation', 1)
}

function anchored(sport: HockeySportGameState): boolean {
  return sport.setup.rulesSnapshot.clockModel === 'anchored'
}

function cleanReason(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return isHockeyReason(trimmed) ? trimmed : null
}

export function nextHockeyEventSequence(events: unknown[], recorderUserId: string | null): number {
  return (
    events.reduce<number>((highest, value) => {
      if (!isPlainObject(value) || value.recorderUserId !== recorderUserId) return highest
      return typeof value.sequence === 'number' && Number.isInteger(value.sequence)
        ? Math.max(highest, value.sequence)
        : highest
    }, 0) + 1
  )
}

function failure(state: GameState, code: HockeyCommandErrorCode, message: string): HockeyCommandResult {
  return { ok: false, state, code, message }
}
