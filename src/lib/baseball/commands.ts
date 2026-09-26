import type { GameState } from '../../types'
import { isPlainObject } from '../gameEvents/envelope'
import {
  applyGameEventAppendsAndMutations,
  hasLegacyAggregateActivity,
  initializeGameEventStream,
} from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import type { GameEvent, GameEventLocation, GameEventTeamSide } from '../gameEvents/types'
import { createBaseballEvent } from './events'
import { baseballPeriod } from './periods'
import { replayBaseballEvents } from './projector'
import { createBaseballSportGameState, validateBaseballMatchSetup } from './state'
import type {
  BaseballBase,
  BaseballBaserunningPlay,
  BaseballEventType,
  BaseballGameEndOutcome,
  BaseballHalfInningEndReason,
  BaseballInPlay,
  BaseballMatchProjection,
  BaseballMatchSetup,
  BaseballMovementReason,
  BaseballMovementTo,
  BaseballPayloadByType,
  BaseballPitchLocation,
  BaseballPitchResult,
  BaseballQuickPlateAppearanceResult,
  BaseballRunnerMovement,
  BaseballSportGameState,
  BaseballSubstitution,
  BaseballTeamSide,
} from './types'

export type BaseballCommandErrorCode =
  | 'not_baseball'
  | 'invalid_setup'
  | 'legacy_activity_present'
  | 'stream_not_initialized'
  | 'rejected'

export type BaseballCommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; state: GameState; code: BaseballCommandErrorCode; message: string }

export interface BaseballCommandContext {
  recorderUserId: string | null
  occurredAt: string
  /** Optional deterministic id for tests and retries. */
  eventId?: string
  captureCommandId?: string | null
}

const BASES: readonly BaseballBase[] = ['first', 'second', 'third']

// ---------------------------------------------------------------------------
// Game creation

/** Installs Baseball setup and an empty authoritative event stream on a fresh game. */
export function initializeBaseballEventGame(state: GameState, setup: BaseballMatchSetup): BaseballCommandResult {
  if (state.sport?.id !== 'baseball') return failure(state, 'not_baseball', 'The active sport is not Baseball.')
  if (hasLegacyAggregateActivity(state)) {
    return failure(state, 'legacy_activity_present', 'This game already has counter-based stats.')
  }
  const validation = validateBaseballMatchSetup(setup)
  if (!validation.ok) return failure(state, 'invalid_setup', validation.message)
  const initialized = initializeGameEventStream(
    { ...state, sportGameState: createBaseballSportGameState(setup) },
    gameEventRegistry,
    gameEventProjectors
  )
  if (!initialized.ok) return failure(state, 'invalid_setup', initialized.error.message)
  return { ok: true, state: initialized.state, events: [] }
}

// ---------------------------------------------------------------------------
// Capture commands

export function startBaseballGame(state: GameState, context: BaseballCommandContext): BaseballCommandResult {
  return append(state, context, 'baseball.game_started', 'neutral', { captureCommandId: captureId(context) })
}

export interface RecordPitchInput {
  result: BaseballPitchResult
  pitchLocation?: BaseballPitchLocation | null
  inPlay?: BaseballInPlay | null
  /** Batted-ball location in the diamond frame (home plate at bottom center). */
  location?: { x: number; y: number } | null
  movements?: BaseballRunnerMovement[]
}

export function recordBaseballPitch(
  state: GameState,
  input: RecordPitchInput,
  context: BaseballCommandContext
): BaseballCommandResult {
  const projection = currentProjection(state)
  if (!projection) return notBaseball(state)
  return append(
    state,
    context,
    'baseball.pitch',
    projection.battingSide,
    {
      captureCommandId: captureId(context),
      result: input.result,
      pitchLocation: input.pitchLocation ?? null,
      inPlay: input.inPlay ?? null,
      movements: input.movements ?? [],
    },
    diamondLocation(input.location)
  )
}

export interface RecordQuickPlateAppearanceInput {
  result: BaseballQuickPlateAppearanceResult
  inPlay?: BaseballInPlay | null
  location?: { x: number; y: number } | null
  finalBalls?: number | null
  finalStrikes?: number | null
  movements: BaseballRunnerMovement[]
}

export function recordBaseballPlateAppearance(
  state: GameState,
  input: RecordQuickPlateAppearanceInput,
  context: BaseballCommandContext
): BaseballCommandResult {
  const projection = currentProjection(state)
  if (!projection) return notBaseball(state)
  return append(
    state,
    context,
    'baseball.plate_appearance',
    projection.battingSide,
    {
      captureCommandId: captureId(context),
      result: input.result,
      inPlay: input.inPlay ?? null,
      finalBalls: input.finalBalls ?? null,
      finalStrikes: input.finalStrikes ?? null,
      movements: input.movements,
    },
    diamondLocation(input.location)
  )
}

export function recordBaseballBaserunning(
  state: GameState,
  play: BaseballBaserunningPlay,
  movements: BaseballRunnerMovement[],
  context: BaseballCommandContext
): BaseballCommandResult {
  const projection = currentProjection(state)
  if (!projection) return notBaseball(state)
  return append(state, context, 'baseball.baserunning', projection.battingSide, {
    captureCommandId: captureId(context),
    play,
    movements,
  })
}

export function substituteBaseball(
  state: GameState,
  side: BaseballTeamSide,
  substitution: BaseballSubstitution,
  context: BaseballCommandContext
): BaseballCommandResult {
  return append(state, context, 'baseball.substitution', side, {
    captureCommandId: captureId(context),
    substitution: substitution as BaseballPayloadByType['baseball.substitution']['substitution'],
  })
}

export function endBaseballHalfInning(
  state: GameState,
  reason: BaseballHalfInningEndReason,
  note: string | null,
  context: BaseballCommandContext
): BaseballCommandResult {
  return append(state, context, 'baseball.half_inning_ended', 'neutral', {
    captureCommandId: captureId(context),
    reason,
    note,
  })
}

export function endBaseballGame(
  state: GameState,
  outcome: BaseballGameEndOutcome,
  context: BaseballCommandContext,
  options: { forfeitWinner?: BaseballTeamSide | null; note?: string | null } = {}
): BaseballCommandResult {
  return append(state, context, 'baseball.game_ended', 'neutral', {
    captureCommandId: captureId(context),
    outcome,
    forfeitWinner: options.forfeitWinner ?? null,
    note: options.note ?? null,
  })
}

export function reopenBaseballGame(
  state: GameState,
  reason: string,
  context: BaseballCommandContext
): BaseballCommandResult {
  return append(state, context, 'baseball.game_reopened', 'neutral', {
    captureCommandId: captureId(context),
    reason,
  })
}

export function adjustBaseballScore(
  state: GameState,
  side: BaseballTeamSide,
  delta: number,
  reason: string,
  context: BaseballCommandContext
): BaseballCommandResult {
  return append(state, context, 'baseball.score_adjustment', side, {
    captureCommandId: captureId(context),
    delta,
    reason,
  })
}

// ---------------------------------------------------------------------------
// Movement proposals for capture UI

export function baseballMovement(
  runnerId: string,
  from: BaseballRunnerMovement['from'],
  to: BaseballMovementTo,
  reason: BaseballMovementReason,
  options: Partial<Pick<BaseballRunnerMovement, 'fielders' | 'errorBy' | 'earned' | 'rbi' | 'runCounts'>> = {}
): BaseballRunnerMovement {
  return {
    runnerId,
    from,
    to,
    reason,
    fielders: options.fielders ?? [],
    errorBy: options.errorBy ?? null,
    earned: options.earned ?? null,
    rbi: options.rbi ?? null,
    runCounts: options.runCounts ?? null,
  }
}

export type BaseballProposalKind =
  | 'walk'
  | 'hit_by_pitch'
  | 'catcher_interference'
  | 'strikeout'
  | BaseballInPlay['result']

/**
 * Standard runner movements for a plate appearance result. The recorder confirms or edits
 * them on the diamond; projection never infers movements that are not recorded.
 */
export function proposeBaseballMovements(
  projection: BaseballMatchProjection,
  kind: BaseballProposalKind,
  fielders: number[] = []
): BaseballRunnerMovement[] {
  const batterId = projection.currentBatterId
  if (!batterId) return []
  const bases = projection.bases
  const runners = BASES.flatMap((base, index) => (bases[base] ? [{ base, index: index + 1, id: bases[base]!.runnerId }] : []))
  const advance = (count: number, reason: BaseballMovementReason) =>
    runners.map(runner => baseballMovement(runner.id, runner.base, destination(runner.index + count), reason))

  switch (kind) {
    case 'walk':
    case 'hit_by_pitch':
    case 'catcher_interference': {
      const movements = [baseballMovement(batterId, 'batter', 'first', 'awarded')]
      const forced = forcedRunners(projection)
      for (const runner of runners) {
        if (forced.has(runner.base)) movements.push(baseballMovement(runner.id, runner.base, destination(runner.index + 1), 'forced'))
      }
      return movements
    }
    case 'strikeout':
      return [baseballMovement(batterId, 'batter', 'out', 'on_play', { fielders: [2] })]
    case 'single':
      return [baseballMovement(batterId, 'batter', 'first', 'on_play'), ...advance(1, 'on_play')]
    case 'double':
    case 'ground_rule_double':
      return [baseballMovement(batterId, 'batter', 'second', kind === 'double' ? 'on_play' : 'awarded'), ...advance(2, kind === 'double' ? 'on_play' : 'awarded')]
    case 'triple':
      return [baseballMovement(batterId, 'batter', 'third', 'on_play'), ...advance(3, 'on_play')]
    case 'home_run':
      return [baseballMovement(batterId, 'batter', 'home', 'on_play'), ...advance(4, 'on_play')]
    case 'out':
      return [baseballMovement(batterId, 'batter', 'out', 'on_play', { fielders })]
    case 'sacrifice_fly': {
      const third = runners.find(runner => runner.base === 'third')
      return [
        baseballMovement(batterId, 'batter', 'out', 'on_play', { fielders }),
        ...(third ? [baseballMovement(third.id, 'third', 'home', 'on_play')] : []),
      ]
    }
    case 'sacrifice_bunt':
      return [baseballMovement(batterId, 'batter', 'out', 'on_play', { fielders }), ...advance(1, 'on_play')]
    case 'error':
      return [baseballMovement(batterId, 'batter', 'first', 'on_play'), ...advance(1, 'on_play')]
    case 'fielders_choice': {
      const forced = forcedRunners(projection)
      const lead = [...runners].reverse().find(runner => forced.has(runner.base))
      return [
        baseballMovement(batterId, 'batter', 'first', 'on_play'),
        ...runners
          .filter(runner => forced.has(runner.base))
          .map(runner =>
            runner === lead
              ? baseballMovement(runner.id, runner.base, 'out', 'on_play', { fielders })
              : baseballMovement(runner.id, runner.base, destination(runner.index + 1), 'forced')
          ),
      ]
    }
    case 'double_play': {
      const first = runners.find(runner => runner.base === 'first')
      if (!first) return [baseballMovement(batterId, 'batter', 'out', 'on_play', { fielders })]
      const middle = fielders.slice(0, -1)
      return [
        baseballMovement(first.id, 'first', 'out', 'on_play', { fielders: middle.length > 0 ? middle : fielders }),
        baseballMovement(batterId, 'batter', 'out', 'on_play', { fielders: fielders.slice(-2) }),
      ]
    }
    case 'triple_play':
      return [
        baseballMovement(batterId, 'batter', 'out', 'on_play', { fielders }),
        ...runners.slice(0, 2).map(runner => baseballMovement(runner.id, runner.base, 'out', 'on_play')),
      ]
  }
}

function forcedRunners(projection: BaseballMatchProjection): Set<BaseballBase> {
  const forced = new Set<BaseballBase>()
  if (!projection.bases.first) return forced
  forced.add('first')
  if (!projection.bases.second) return forced
  forced.add('second')
  if (projection.bases.third) forced.add('third')
  return forced
}

function destination(position: number): BaseballMovementTo {
  if (position >= 4) return 'home'
  return BASES[position - 1]
}

// ---------------------------------------------------------------------------
// Internals

export function baseballSportState(state: GameState): BaseballSportGameState | null {
  const sport = state.sportGameState
  return sport && sport.sportId === 'baseball' ? (sport as BaseballSportGameState) : null
}

function currentProjection(state: GameState): BaseballMatchProjection | null {
  return baseballSportState(state)?.projection ?? null
}

export function nextBaseballEventSequence(events: unknown[], recorderUserId: string | null): number {
  return (
    events.reduce<number>((highest, value) => {
      if (!isPlainObject(value) || value.recorderUserId !== recorderUserId) return highest
      return typeof value.sequence === 'number' && Number.isInteger(value.sequence)
        ? Math.max(highest, value.sequence)
        : highest
    }, 0) + 1
  )
}

function append<TType extends BaseballEventType>(
  state: GameState,
  context: BaseballCommandContext,
  eventType: TType,
  teamSide: GameEventTeamSide,
  payload: BaseballPayloadByType[TType],
  location: GameEventLocation | null = null
): BaseballCommandResult {
  const sport = baseballSportState(state)
  if (!sport || state.sport?.id !== 'baseball') return notBaseball(state)
  if (!state.eventStream) return failure(state, 'stream_not_initialized', 'Start a Baseball event game first.')
  const projection = sport.projection
  const period = baseballPeriod(projection.inning, projection.half)
  const event = createBaseballEvent({
    id: context.eventId,
    eventType,
    payload,
    teamSide,
    period,
    recorderUserId: context.recorderUserId,
    sequence: nextBaseballEventSequence(state.eventStream.events, context.recorderUserId),
    occurredAt: context.occurredAt,
    location,
  }) as unknown as GameEvent

  // Precise replay message before the generic atomic append.
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  const registryCheck = gameEventRegistry.inspect(event)
  if (!registryCheck.ok) return failure(state, 'rejected', registryCheck.diagnostic.message)
  if (inspection.complete) {
    const replay = replayBaseballEvents(sport.setup, [...inspection.activeEvents, event])
    if (replay.diagnostics.length > 0) return failure(state, 'rejected', replay.diagnostics[0].message)
  }

  const result = applyGameEventAppendsAndMutations(
    state,
    [event],
    [],
    context.occurredAt,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok) return failure(state, 'rejected', result.error.message)
  return { ok: true, state: result.state, events: [event] }
}

function diamondLocation(value: { x: number; y: number } | null | undefined): GameEventLocation | null {
  if (!value) return null
  return {
    x: Math.min(1, Math.max(0, value.x)),
    y: Math.min(1, Math.max(0, value.y)),
    attackingDirection: 'unknown',
  }
}

function captureId(context: BaseballCommandContext): string | null {
  return context.captureCommandId ?? null
}

function notBaseball(state: GameState): BaseballCommandResult {
  return failure(state, 'not_baseball', 'This is not a Baseball event game.')
}

function failure(state: GameState, code: BaseballCommandErrorCode, message: string): BaseballCommandResult {
  return { ok: false, state, code, message }
}
