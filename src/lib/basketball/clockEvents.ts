import { isPlainObject } from '../gameEvents/envelope'
import type { GameEvent, GameEventPeriod, JsonObject } from '../gameEvents/types'
import type { GameEventDefinition } from '../gameEvents/registry'
import { createBasketballUuid } from './id'
import type {
  BasketballClockAdjustedPayload,
  BasketballClockEvent,
  BasketballClockPausedPayload,
  BasketballClockStartedPayload,
  BasketballStoppagePayload,
} from './types'
import { BASKETBALL_EVENT_SCHEMA_VERSION } from './types'

export const BASKETBALL_CLOCK_TEXT_MAX_LENGTH = 240

export type BasketballClockPayloadByType = {
  'basketball.clock_started': BasketballClockStartedPayload
  'basketball.clock_paused': BasketballClockPausedPayload
  'basketball.clock_adjusted': BasketballClockAdjustedPayload
  'basketball.stoppage': BasketballStoppagePayload
}

export interface CreateBasketballClockEventInput<
  TType extends keyof BasketballClockPayloadByType,
> {
  id?: string
  eventType: TType
  payload: BasketballClockPayloadByType[TType]
  recorderUserId: string | null
  sequence: number
  period: GameEventPeriod
  elapsedMs: number
  occurredAt: string
}

export function createBasketballClockEvent<
  TType extends keyof BasketballClockPayloadByType,
>(
  input: CreateBasketballClockEventInput<TType>
): Extract<BasketballClockEvent, { eventType: TType }> {
  return {
    id: input.id ?? createBasketballUuid(),
    sportId: 'basketball',
    eventType: input.eventType,
    schemaVersion: BASKETBALL_EVENT_SCHEMA_VERSION,
    recorderUserId: input.recorderUserId,
    sequence: input.sequence,
    period: input.period,
    elapsedMs: input.elapsedMs,
    occurredAt: input.occurredAt,
    teamSide: 'neutral',
    location: null,
    actors: [],
    payload: input.payload,
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as Extract<BasketballClockEvent, { eventType: TType }>
}

export const basketballClockEventDefinitions: GameEventDefinition<GameEvent>[] = [
  definition('basketball.clock_started', validateClockStarted),
  definition('basketball.clock_paused', validateClockPaused),
  definition('basketball.clock_adjusted', validateClockAdjusted),
  definition('basketball.stoppage', validateStoppage),
]

function definition(
  eventType: keyof BasketballClockPayloadByType,
  validatePayload: (payload: JsonObject) => boolean
): GameEventDefinition<GameEvent> {
  return {
    sportId: 'basketball',
    eventType,
    currentSchemaVersion: BASKETBALL_EVENT_SCHEMA_VERSION,
    allowedTeamSides: ['neutral'],
    validate: event => {
      if (
        event.sportId !== 'basketball' ||
        event.eventType !== eventType ||
        event.schemaVersion !== BASKETBALL_EVENT_SCHEMA_VERSION ||
        event.teamSide !== 'neutral' ||
        !isNonNegativeInteger(event.elapsedMs) ||
        event.location !== null ||
        event.actors.length !== 0 ||
        !validatePayload(event.payload)
      ) {
        return { ok: false, message: `${eventType} has an invalid Basketball payload.` }
      }
      return { ok: true, event }
    },
  }
}

function validateClockStarted(payload: JsonObject): boolean {
  return hasExactKeys(payload, ['captureCommandId', 'anchorElapsedMs']) &&
    validCaptureCommandId(payload.captureCommandId) &&
    isNonNegativeInteger(payload.anchorElapsedMs)
}

function validateClockPaused(payload: JsonObject): boolean {
  return hasExactKeys(payload, ['captureCommandId', 'elapsedMs', 'source']) &&
    validCaptureCommandId(payload.captureCommandId) &&
    isNonNegativeInteger(payload.elapsedMs) &&
    ['manual', 'expiration', 'period_end'].includes(String(payload.source))
}

function validateClockAdjusted(payload: JsonObject): boolean {
  return hasExactKeys(payload, [
    'captureCommandId',
    'fromElapsedMs',
    'toElapsedMs',
    'reason',
  ]) &&
    validCaptureCommandId(payload.captureCommandId) &&
    isNonNegativeInteger(payload.fromElapsedMs) &&
    isNonNegativeInteger(payload.toElapsedMs) &&
    isBoundedText(payload.reason)
}

function validateStoppage(payload: JsonObject): boolean {
  return hasExactKeys(payload, ['captureCommandId', 'pauseEventId', 'category', 'note']) &&
    isNonEmptyString(payload.captureCommandId) &&
    isNonEmptyString(payload.pauseEventId) &&
    [
      'timeout',
      'foul_free_throw',
      'out_of_bounds',
      'substitution',
      'injury',
      'official_review',
      'other',
    ].includes(String(payload.category)) &&
    (payload.note === null || isBoundedText(payload.note))
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validCaptureCommandId(value: unknown): boolean {
  return value === null || isNonEmptyString(value)
}

function isBoundedText(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= BASKETBALL_CLOCK_TEXT_MAX_LENGTH
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}
