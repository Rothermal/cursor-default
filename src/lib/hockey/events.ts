import { isPlainObject } from '../gameEvents/envelope'
import type { GameEventDefinition } from '../gameEvents/registry'
import type { GameEvent, GameEventPeriod } from '../gameEvents/types'
import { createHockeyUuid } from './id'
import { parseHockeyPeriod } from './periods'
import type { HockeyEvent, HockeyEventType, HockeyPayloadByType } from './types'
import { HOCKEY_EVENT_SCHEMA_VERSION } from './types'

export const HOCKEY_MAX_REASON_LENGTH = 200
const MAX_ID_LENGTH = 100
const MAX_ELAPSED_MS = 4 * 60 * 60 * 1000

export interface CreateHockeyEventInput<TType extends HockeyEventType> {
  id?: string
  eventType: TType
  payload: HockeyPayloadByType[TType]
  period: GameEventPeriod
  elapsedMs: number | null
  recorderUserId: string | null
  sequence: number
  occurredAt: string
}

export function createHockeyEvent<TType extends HockeyEventType>(
  input: CreateHockeyEventInput<TType>
): HockeyEvent<TType> {
  return {
    id: input.id ?? createHockeyUuid(),
    sportId: 'hockey',
    eventType: input.eventType,
    schemaVersion: HOCKEY_EVENT_SCHEMA_VERSION,
    recorderUserId: input.recorderUserId,
    sequence: input.sequence,
    period: { ...input.period },
    elapsedMs: input.elapsedMs,
    occurredAt: input.occurredAt,
    teamSide: 'neutral',
    location: null,
    actors: [],
    payload: structuredClone(input.payload),
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as HockeyEvent<TType>
}

type PayloadValidator = (payload: Record<string, unknown>) => string | null

/**
 * Structural checks only. Whether an event is allowed at its point in the match
 * (period order, clock state, required reasons) is decided by replay.
 */
function definition(eventType: HockeyEventType, validatePayload: PayloadValidator): GameEventDefinition<GameEvent> {
  return {
    sportId: 'hockey',
    eventType,
    currentSchemaVersion: HOCKEY_EVENT_SCHEMA_VERSION,
    allowedTeamSides: ['neutral'],
    validate: event => {
      if (event.schemaVersion !== HOCKEY_EVENT_SCHEMA_VERSION) {
        return { ok: false, message: 'Unsupported Hockey event schema version.' }
      }
      if (!parseHockeyPeriod(event.period)) {
        return { ok: false, message: 'Hockey events must name a regulation or overtime period.' }
      }
      if (event.elapsedMs !== null && !isElapsed(event.elapsedMs)) {
        return { ok: false, message: 'Hockey elapsed time must be whole milliseconds within the period.' }
      }
      if (event.location !== null) return { ok: false, message: 'Hockey lifecycle events have no rink location.' }
      if (event.actors.length > 0) return { ok: false, message: 'Hockey lifecycle events have no actors.' }
      if (!isPlainObject(event.payload)) return { ok: false, message: 'Payload must be an object.' }
      const message = validatePayload(event.payload)
      return message ? { ok: false, message } : { ok: true, event }
    },
  }
}

const reasonOnly: PayloadValidator = payload =>
  exactKeys(payload, ['captureCommandId', 'reason']) &&
  isCaptureId(payload.captureCommandId) &&
  isReason(payload.reason)
    ? null
    : 'A reason is required.'

const optionalReason: PayloadValidator = payload =>
  exactKeys(payload, ['captureCommandId', 'reason']) &&
  isCaptureId(payload.captureCommandId) &&
  (payload.reason === null || isReason(payload.reason))
    ? null
    : 'Invalid reason payload.'

export const hockeyEventDefinitions: GameEventDefinition<GameEvent>[] = [
  definition('hockey.opening_lineup', payload => {
    if (!exactKeys(payload, ['captureCommandId', 'goalieParticipantId', 'skaterParticipantIds', 'opponentGoalieId'])) {
      return 'Invalid opening lineup payload.'
    }
    if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
    if (!isId(payload.goalieParticipantId) || !isId(payload.opponentGoalieId)) return 'Invalid goalie id.'
    if (
      !Array.isArray(payload.skaterParticipantIds) ||
      payload.skaterParticipantIds.length > 6 ||
      !payload.skaterParticipantIds.every(isId)
    ) return 'Invalid skater ids.'
    return null
  }),
  definition('hockey.period_started', payload => {
    if (!exactKeys(payload, ['captureCommandId', 'kind', 'number'])) return 'Invalid period start payload.'
    if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
    if (payload.kind !== 'regulation' && payload.kind !== 'overtime') return 'Unknown period kind.'
    return isPeriodNumber(payload.number) ? null : 'Invalid period number.'
  }),
  definition('hockey.period_ended', optionalReason),
  definition('hockey.clock_started', payload =>
    exactKeys(payload, ['captureCommandId', 'anchorElapsedMs']) &&
    isCaptureId(payload.captureCommandId) &&
    isElapsed(payload.anchorElapsedMs)
      ? null
      : 'Invalid clock start payload.'
  ),
  definition('hockey.clock_paused', payload =>
    exactKeys(payload, ['captureCommandId', 'elapsedMs', 'source']) &&
    isCaptureId(payload.captureCommandId) &&
    isElapsed(payload.elapsedMs) &&
    (payload.source === 'manual' || payload.source === 'expiration')
      ? null
      : 'Invalid clock pause payload.'
  ),
  definition('hockey.clock_set', payload =>
    exactKeys(payload, ['captureCommandId', 'fromElapsedMs', 'toElapsedMs', 'reason']) &&
    isCaptureId(payload.captureCommandId) &&
    isElapsed(payload.fromElapsedMs) &&
    isElapsed(payload.toElapsedMs) &&
    isReason(payload.reason)
      ? null
      : 'Setting the clock needs a valid time and a reason.'
  ),
  definition('hockey.match_ended', optionalReason),
  definition('hockey.match_suspended', reasonOnly),
  definition('hockey.match_abandoned', reasonOnly),
  definition('hockey.match_reopened', reasonOnly),
]

export function isHockeyReason(value: unknown): value is string {
  return isReason(value)
}

function isReason(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= HOCKEY_MAX_REASON_LENGTH
}

function isCaptureId(value: unknown): boolean {
  return value === null || isId(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH
}

function isElapsed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_ELAPSED_MS
}

function isPeriodNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}
