import { isPlainObject } from '../gameEvents/envelope'
import type { GameEventDefinition } from '../gameEvents/registry'
import type {
  GameEvent,
  GameEventActor,
  GameEventLocation,
  GameEventPeriod,
  GameEventTeamSide,
} from '../gameEvents/types'
import { createBaseballUuid } from './id'
import { parseBaseballPeriod } from './periods'
import {
  exactKeys,
  isBatHand,
  isId,
  isNullableLabel,
  isNullableShortLabel,
  isOpponentPitcher,
} from './state'
import { normalizeBaseballPosition } from './positions'
import type {
  BaseballEvent,
  BaseballEventType,
  BaseballInPlay,
  BaseballPayloadByType,
  BaseballPitchLocation,
  BaseballRunnerMovement,
} from './types'
import { BASEBALL_EVENT_SCHEMA_VERSION } from './types'

export const BASEBALL_PITCH_RESULTS = [
  'ball',
  'called_strike',
  'swinging_strike',
  'foul',
  'foul_tip',
  'foul_bunt',
  'missed_bunt',
  'in_play',
  'hit_by_pitch',
  'intentional_ball',
  'pitchout',
] as const

export const BASEBALL_IN_PLAY_RESULTS = [
  'single',
  'double',
  'triple',
  'home_run',
  'ground_rule_double',
  'out',
  'error',
  'fielders_choice',
  'sacrifice_bunt',
  'sacrifice_fly',
  'double_play',
  'triple_play',
] as const

const BATTED_BALL_TYPES = ['ground', 'line', 'fly', 'popup', 'bunt', 'unknown'] as const
const QUICK_RESULTS = [
  'walk',
  'intentional_walk',
  'hit_by_pitch',
  'strikeout_swinging',
  'strikeout_looking',
  'catcher_interference',
  'in_play',
] as const
const BASERUNNING_PLAYS = [
  'stolen_base',
  'caught_stealing',
  'pickoff',
  'wild_pitch',
  'passed_ball',
  'balk',
  'error',
  'defensive_indifference',
  'appeal',
  'other',
] as const
const MOVEMENT_REASONS = [
  'on_play',
  'forced',
  'stolen_base',
  'caught_stealing',
  'pickoff',
  'wild_pitch',
  'passed_ball',
  'balk',
  'error',
  'throw',
  'defensive_indifference',
  'appeal',
  'interference',
  'obstruction',
  'awarded',
  'dropped_third_strike',
] as const
const MOVEMENT_FROM = ['batter', 'first', 'second', 'third'] as const
const MOVEMENT_TO = ['first', 'second', 'third', 'home', 'out'] as const
const HALF_END_REASONS = ['time_limit', 'mercy', 'other'] as const
const GAME_END_OUTCOMES = ['completed', 'run_rule', 'time_limit', 'forfeit', 'suspended', 'abandoned'] as const
const MAX_MOVEMENTS = 4
const MAX_REASON_LENGTH = 200

export interface CreateBaseballEventInput<TType extends BaseballEventType> {
  id?: string
  eventType: TType
  payload: BaseballPayloadByType[TType]
  teamSide: GameEventTeamSide
  period: GameEventPeriod
  recorderUserId: string | null
  sequence: number
  occurredAt: string
  location?: GameEventLocation | null
  actors?: GameEventActor[]
}

export function createBaseballEvent<TType extends BaseballEventType>(
  input: CreateBaseballEventInput<TType>
): BaseballEvent<TType> {
  return {
    id: input.id ?? createBaseballUuid(),
    sportId: 'baseball',
    eventType: input.eventType,
    schemaVersion: BASEBALL_EVENT_SCHEMA_VERSION,
    recorderUserId: input.recorderUserId,
    sequence: input.sequence,
    period: input.period,
    elapsedMs: null,
    occurredAt: input.occurredAt,
    teamSide: input.teamSide,
    location: input.location ?? null,
    actors: input.actors ?? [],
    payload: input.payload,
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as BaseballEvent<TType>
}

type PayloadValidator = (payload: Record<string, unknown>, event: GameEvent) => string | null

const OFFENSE: readonly GameEventTeamSide[] = ['tracked', 'opponent']
const NEUTRAL: readonly GameEventTeamSide[] = ['neutral']

function definition(
  eventType: BaseballEventType,
  allowedTeamSides: readonly GameEventTeamSide[],
  validatePayload: PayloadValidator,
  allowsLocation = false
): GameEventDefinition<GameEvent> {
  return {
    sportId: 'baseball',
    eventType,
    currentSchemaVersion: BASEBALL_EVENT_SCHEMA_VERSION,
    allowedTeamSides,
    validate: event => {
      if (event.schemaVersion !== BASEBALL_EVENT_SCHEMA_VERSION) {
        return { ok: false, message: 'Unsupported Baseball event schema version.' }
      }
      if (event.elapsedMs !== null) {
        return { ok: false, message: 'Baseball events do not carry game-clock time.' }
      }
      if (!parseBaseballPeriod(event.period)) {
        return { ok: false, message: 'Baseball events must name a half-inning period.' }
      }
      if (event.location !== null) {
        if (!allowsLocation || !isInPlayLocationEvent(event)) {
          return { ok: false, message: 'Only a ball in play may carry a field location.' }
        }
        if (event.location.attackingDirection !== 'unknown') {
          return { ok: false, message: 'The diamond frame has no attacking direction.' }
        }
      }
      if (!isPlainObject(event.payload)) return { ok: false, message: 'Payload must be an object.' }
      const message = validatePayload(event.payload, event)
      return message ? { ok: false, message } : { ok: true, event }
    },
  }
}

function isInPlayLocationEvent(event: GameEvent): boolean {
  return isPlainObject(event.payload) && isPlainObject(event.payload.inPlay)
}

export const baseballEventDefinitions: GameEventDefinition<GameEvent>[] = [
  definition('baseball.game_started', NEUTRAL, payload =>
    exactKeys(payload, ['captureCommandId']) && isCaptureId(payload.captureCommandId)
      ? null
      : 'Invalid game start payload.'
  ),
  definition('baseball.pitch', OFFENSE, validatePitchPayload, true),
  definition('baseball.plate_appearance', OFFENSE, validatePlateAppearancePayload, true),
  definition('baseball.baserunning', OFFENSE, payload => {
    if (!exactKeys(payload, ['captureCommandId', 'play', 'movements'])) return 'Invalid baserunning payload.'
    if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
    if (!includes(BASERUNNING_PLAYS, payload.play)) return 'Unknown baserunning play.'
    const movements = validateMovements(payload.movements)
    if (typeof movements === 'string') return movements
    if (movements.length === 0) return 'A baserunning play must move at least one runner.'
    if (movements.some(movement => movement.from === 'batter')) {
      return 'The batter does not run on a baserunning play.'
    }
    return null
  }),
  definition('baseball.substitution', OFFENSE, validateSubstitutionPayload),
  definition('baseball.half_inning_ended', NEUTRAL, payload =>
    exactKeys(payload, ['captureCommandId', 'reason', 'note']) &&
    isCaptureId(payload.captureCommandId) &&
    includes(HALF_END_REASONS, payload.reason) &&
    isNote(payload.note)
      ? null
      : 'Invalid half-inning end payload.'
  ),
  definition('baseball.game_ended', NEUTRAL, payload => {
    if (
      !exactKeys(payload, ['captureCommandId', 'outcome', 'forfeitWinner', 'note']) ||
      !isCaptureId(payload.captureCommandId) ||
      !includes(GAME_END_OUTCOMES, payload.outcome) ||
      !isNote(payload.note)
    ) return 'Invalid game end payload.'
    if (payload.outcome === 'forfeit') {
      return payload.forfeitWinner === 'tracked' || payload.forfeitWinner === 'opponent'
        ? null
        : 'A forfeit names the winning side.'
    }
    return payload.forfeitWinner === null ? null : 'Only a forfeit names a winner directly.'
  }),
  definition('baseball.game_reopened', NEUTRAL, payload =>
    exactKeys(payload, ['captureCommandId', 'reason']) &&
    isCaptureId(payload.captureCommandId) &&
    isReason(payload.reason)
      ? null
      : 'Reopening requires a reason.'
  ),
  definition('baseball.score_adjustment', OFFENSE, payload =>
    exactKeys(payload, ['captureCommandId', 'delta', 'reason']) &&
    isCaptureId(payload.captureCommandId) &&
    Number.isInteger(payload.delta) &&
    payload.delta !== 0 &&
    Math.abs(Number(payload.delta)) <= 50 &&
    isReason(payload.reason)
      ? null
      : 'A score adjustment needs a non-zero whole delta and a reason.'
  ),
]

function validatePitchPayload(payload: Record<string, unknown>, event: GameEvent): string | null {
  if (!exactKeys(payload, ['captureCommandId', 'result', 'pitchLocation', 'inPlay', 'movements'])) {
    return 'Invalid pitch payload.'
  }
  if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
  if (!includes(BASEBALL_PITCH_RESULTS, payload.result)) return 'Unknown pitch result.'
  if (payload.pitchLocation !== null && !isPitchLocation(payload.pitchLocation)) {
    return 'Pitch location must be inside the capture pad.'
  }
  if ((payload.result === 'in_play') !== (payload.inPlay !== null)) {
    return 'Only a ball in play carries a batted-ball result.'
  }
  if (payload.inPlay !== null && !isInPlay(payload.inPlay)) return 'Invalid batted-ball result.'
  if (payload.inPlay === null && event.location !== null) return 'Only a ball in play has a field location.'
  const movements = validateMovements(payload.movements)
  return typeof movements === 'string' ? movements : null
}

function validatePlateAppearancePayload(payload: Record<string, unknown>, event: GameEvent): string | null {
  if (!exactKeys(payload, ['captureCommandId', 'result', 'inPlay', 'finalBalls', 'finalStrikes', 'movements'])) {
    return 'Invalid plate appearance payload.'
  }
  if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
  if (!includes(QUICK_RESULTS, payload.result)) return 'Unknown plate appearance result.'
  if ((payload.result === 'in_play') !== (payload.inPlay !== null)) {
    return 'Only a ball in play carries a batted-ball result.'
  }
  if (payload.inPlay !== null && !isInPlay(payload.inPlay)) return 'Invalid batted-ball result.'
  if (payload.inPlay === null && event.location !== null) return 'Only a ball in play has a field location.'
  const countValid =
    (payload.finalBalls === null && payload.finalStrikes === null) ||
    (isIntInRange(payload.finalBalls, 0, 4) && isIntInRange(payload.finalStrikes, 0, 3))
  if (!countValid) return 'The final count must include balls and strikes.'
  const movements = validateMovements(payload.movements)
  if (typeof movements === 'string') return movements
  return movements.some(movement => movement.from === 'batter')
    ? null
    : 'A plate appearance must say what happened to the batter.'
}

function validateSubstitutionPayload(payload: Record<string, unknown>): string | null {
  if (!exactKeys(payload, ['captureCommandId', 'substitution'])) return 'Invalid substitution payload.'
  if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
  const substitution = payload.substitution
  if (!isPlainObject(substitution)) return 'Invalid substitution.'
  switch (substitution.kind) {
    case 'pinch_hitter':
    case 'pinch_runner':
    case 'courtesy_runner':
      return exactKeys(substitution, ['kind', 'incomingId', 'outgoingId']) &&
        isId(substitution.incomingId) &&
        isId(substitution.outgoingId) &&
        substitution.incomingId !== substitution.outgoingId
        ? null
        : 'A replacement names two different players.'
    case 'defensive':
      return exactKeys(substitution, ['kind', 'position', 'incomingId', 'outgoingId']) &&
        isIntInRange(substitution.position, 1, 10) &&
        isId(substitution.incomingId) &&
        (substitution.outgoingId === null ||
          (isId(substitution.outgoingId) && substitution.outgoingId !== substitution.incomingId))
        ? null
        : 'A defensive substitution names a position and a player.'
    case 'position_change': {
      if (!exactKeys(substitution, ['kind', 'assignments']) || !Array.isArray(substitution.assignments)) {
        return 'Invalid position change.'
      }
      const assignments = substitution.assignments
      if (assignments.length < 1 || assignments.length > 10) return 'Invalid position change.'
      const valid = assignments.every(
        entry =>
          isPlainObject(entry) &&
          exactKeys(entry, ['participantId', 'position']) &&
          isId(entry.participantId) &&
          isIntInRange(entry.position, 1, 10)
      )
      return valid ? null : 'Invalid position change.'
    }
    case 'opponent_pitcher':
      return exactKeys(substitution, ['kind', 'pitcher']) && isOpponentPitcher(substitution.pitcher)
        ? null
        : 'Invalid opponent pitcher.'
    case 'opponent_slot':
      return exactKeys(substitution, ['kind', 'slotId', 'label', 'number', 'position', 'bats']) &&
        isId(substitution.slotId) &&
        isNullableLabel(substitution.label) &&
        isNullableShortLabel(substitution.number) &&
        (substitution.position === null ||
          (typeof substitution.position === 'string' &&
            normalizeBaseballPosition(substitution.position) === substitution.position)) &&
        isBatHand(substitution.bats)
        ? null
        : 'Invalid opponent batting slot update.'
    default:
      return 'Unknown substitution kind.'
  }
}

function validateMovements(value: unknown): BaseballRunnerMovement[] | string {
  if (!Array.isArray(value) || value.length > MAX_MOVEMENTS) return 'Invalid runner movements.'
  for (const movement of value) {
    if (!isMovement(movement)) return 'Invalid runner movement.'
  }
  const runners = new Set(value.map(movement => (movement as BaseballRunnerMovement).runnerId))
  if (runners.size !== value.length) return 'Each runner may move once per event.'
  return value as BaseballRunnerMovement[]
}

function isMovement(value: unknown): value is BaseballRunnerMovement {
  if (!isPlainObject(value)) return false
  if (!exactKeys(value, ['runnerId', 'from', 'to', 'reason', 'fielders', 'errorBy', 'earned', 'rbi', 'runCounts'])) {
    return false
  }
  if (!isId(value.runnerId)) return false
  if (!includes(MOVEMENT_FROM, value.from) || !includes(MOVEMENT_TO, value.to)) return false
  if (!includes(MOVEMENT_REASONS, value.reason)) return false
  if (!isFielderList(value.fielders)) return false
  if (value.errorBy !== null && !isIntInRange(value.errorBy, 1, 10)) return false
  for (const key of ['earned', 'rbi', 'runCounts']) {
    if (value[key] !== null && typeof value[key] !== 'boolean') return false
  }
  if (value.to !== 'home' && (value.earned !== null || value.rbi !== null || value.runCounts !== null)) {
    return false
  }
  if (value.to !== 'out' && value.fielders.length > 0 && value.errorBy === null) return false
  return basePosition(value.to) > basePosition(value.from)
}

export function basePosition(value: string): number {
  switch (value) {
    case 'batter': return 0
    case 'first': return 1
    case 'second': return 2
    case 'third': return 3
    case 'home': return 4
    case 'out': return 5
    default: return -1
  }
}

function isInPlay(value: unknown): value is BaseballInPlay {
  return (
    isPlainObject(value) &&
    exactKeys(value, ['battedBallType', 'result', 'fielders', 'errorBy', 'insideThePark']) &&
    includes(BATTED_BALL_TYPES, value.battedBallType) &&
    includes(BASEBALL_IN_PLAY_RESULTS, value.result) &&
    isFielderList(value.fielders) &&
    (value.errorBy === null || isIntInRange(value.errorBy, 1, 10)) &&
    typeof value.insideThePark === 'boolean' &&
    (!value.insideThePark || value.result === 'home_run') &&
    ((value.result === 'error') === (value.errorBy !== null))
  )
}

function isPitchLocation(value: unknown): value is BaseballPitchLocation {
  return (
    isPlainObject(value) &&
    exactKeys(value, ['x', 'y']) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    value.x >= -0.75 &&
    value.x <= 1.75 &&
    value.y >= -0.75 &&
    value.y <= 1.75
  )
}

function isFielderList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 8 && value.every(entry => isIntInRange(entry, 1, 10))
}

function isCaptureId(value: unknown): boolean {
  return value === null || isId(value)
}

function isReason(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_REASON_LENGTH
}

function isNote(value: unknown): boolean {
  return value === null || isReason(value)
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}
