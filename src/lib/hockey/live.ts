import type { GameState } from '../../types'
import type { BasketballWorkflowAction } from '../basketball/productionClockPolicy'
import { basketballWorkflowActionKind } from '../basketball/productionClockPolicy'
import { isPlainObject } from '../gameEvents/envelope'
import {
  applyGameEventAppendsAndMutations,
  hasLegacyAggregateActivity,
  initializeGameEventStream,
} from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream, stableJson } from '../gameEvents/stream'
import type { GameEvent, GameEventActor, GameEventLocation, GameEventPeriod } from '../gameEvents/types'
import { createHockeyEvent, isHockeyReason } from './events'
import { hockeyPeriod } from './periods'
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
