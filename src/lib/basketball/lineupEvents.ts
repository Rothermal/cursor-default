import { isPlainObject } from '../gameEvents/envelope'
import type { GameEvent, GameEventPeriod, JsonObject } from '../gameEvents/types'
import type { GameEventDefinition } from '../gameEvents/registry'
import { BASKETBALL_CLOCK_TEXT_MAX_LENGTH } from './clockEvents'
import { createBasketballUuid } from './id'
import type {
  BasketballEqualPlayOverridePayload,
  BasketballLineupConfirmedPayload,
  BasketballLineupEvent,
  BasketballRoleChangedPayload,
  BasketballSubstitutionReasonCode,
  BasketballSubstitutionPayload,
  BasketballTeamSide,
} from './types'
import { BASKETBALL_EVENT_SCHEMA_VERSION } from './types'

export type BasketballLineupPayloadByType = {
  'basketball.lineup_confirmed': BasketballLineupConfirmedPayload
  'basketball.substitution': BasketballSubstitutionPayload
  'basketball.role_changed': BasketballRoleChangedPayload
  'basketball.equal_play_override': BasketballEqualPlayOverridePayload
}

export interface CreateBasketballLineupEventInput<
  TType extends keyof BasketballLineupPayloadByType,
> {
  id?: string
  eventType: TType
  payload: BasketballLineupPayloadByType[TType]
  recorderUserId: string | null
  sequence: number
  period: GameEventPeriod
  elapsedMs: number
  occurredAt: string
  teamSide: TType extends 'basketball.equal_play_override' ? 'tracked' : BasketballTeamSide
}

export function createBasketballLineupEvent<
  TType extends keyof BasketballLineupPayloadByType,
>(
  input: CreateBasketballLineupEventInput<TType>
): Extract<BasketballLineupEvent, { eventType: TType }> {
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
    teamSide: input.teamSide,
    location: null,
    actors: [],
    payload: input.payload,
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as Extract<BasketballLineupEvent, { eventType: TType }>
}

export const basketballLineupEventDefinitions: GameEventDefinition<GameEvent>[] = [
  definition('basketball.lineup_confirmed', ['tracked', 'opponent'], validateLineupConfirmed),
  definition('basketball.substitution', ['tracked', 'opponent'], validateSubstitution),
  definition('basketball.role_changed', ['tracked', 'opponent'], validateRoleChanged),
  definition('basketball.equal_play_override', ['tracked'], validateEqualPlayOverride),
]

function definition(
  eventType: keyof BasketballLineupPayloadByType,
  allowedTeamSides: BasketballTeamSide[],
  validatePayload: (payload: JsonObject) => boolean
): GameEventDefinition<GameEvent> {
  return {
    sportId: 'basketball',
    eventType,
    currentSchemaVersion: BASKETBALL_EVENT_SCHEMA_VERSION,
    allowedTeamSides,
    validate: event => {
      if (
        event.sportId !== 'basketball' ||
        event.eventType !== eventType ||
        event.schemaVersion !== BASKETBALL_EVENT_SCHEMA_VERSION ||
        !allowedTeamSides.includes(event.teamSide as BasketballTeamSide) ||
        !isNonNegativeInteger(event.elapsedMs) ||
        event.location !== null ||
        event.actors.length !== 0 ||
        !validatePayload(event.payload)
      ) return { ok: false, message: `${eventType} has an invalid Basketball payload.` }
      return { ok: true, event }
    },
  }
}

function validateLineupConfirmed(payload: JsonObject): boolean {
  return hasExactKeysWithRecordedLater(
    payload,
    ['captureCommandId', 'participantIds', 'boundaryPeriodId']
  ) &&
    isNonEmptyString(payload.captureCommandId) &&
    isParticipantIds(payload.participantIds) &&
    isNonEmptyString(payload.boundaryPeriodId)
}

function validateSubstitution(payload: JsonObject): boolean {
  if (!hasExactKeysWithRecordedLater(
    payload,
    ['captureCommandId', 'participantIds', 'mode', 'reasonCode', 'reasonNote']
  ) ||
      !isNonEmptyString(payload.captureCommandId) ||
      !isParticipantIds(payload.participantIds) ||
      !['balanced', 'exit_only', 'entry_only', 'boundary', 'current_lineup_recovery']
        .includes(String(payload.mode)) ||
      !(payload.reasonCode === null || isBasketballSubstitutionReasonCode(payload.reasonCode)) ||
      !(payload.reasonNote === null || isBoundedText(payload.reasonNote))) return false
  if (payload.reasonCode === null && payload.reasonNote !== null) return false
  if (payload.reasonCode === 'other' && payload.reasonNote === null) return false
  return payload.mode === 'balanced' && payload.participantIds.length === 5
    ? payload.reasonCode === null && payload.reasonNote === null
    : payload.reasonCode !== null
}

function validateRoleChanged(payload: JsonObject): boolean {
  if (!hasExactKeysWithRecordedLater(payload, ['captureCommandId', 'changes']) ||
      !isNonEmptyString(payload.captureCommandId) ||
      !Array.isArray(payload.changes) || payload.changes.length === 0) return false
  const ids = new Set<string>()
  for (const change of payload.changes) {
    if (!hasExactKeys(change, ['participantId', 'position', 'captain']) ||
        !isNonEmptyString(change.participantId) ||
        !(change.position === null || isBoundedPosition(change.position)) ||
        typeof change.captain !== 'boolean' ||
        ids.has(change.participantId)) return false
    ids.add(change.participantId)
  }
  return true
}

function validateEqualPlayOverride(payload: JsonObject): boolean {
  return hasExactKeysWithRecordedLater(payload, [
    'captureCommandId',
    'boundaryPeriodId',
    'candidateParticipantIds',
    'violationCodes',
    'reason',
  ]) &&
    isNonEmptyString(payload.captureCommandId) &&
    isNonEmptyString(payload.boundaryPeriodId) &&
    isParticipantIds(payload.candidateParticipantIds) &&
    isViolationCodes(payload.violationCodes) &&
    isBoundedText(payload.reason)
}

function isParticipantIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 5 &&
    value.every(isNonEmptyString) && new Set(value).size === value.length
}

function isViolationCodes(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  const allowed = ['minimum_periods', 'maximum_consecutive_periods', 'maximum_period_imbalance']
  return value.every(item => allowed.includes(String(item))) && new Set(value).size === value.length
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function hasExactKeysWithRecordedLater(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (hasExactKeys(value, keys)) return true
  return hasExactKeys(value, [...keys, 'recordedLater']) &&
    value.recordedLater === true
}

function isBasketballSubstitutionReasonCode(
  value: unknown
): value is BasketballSubstitutionReasonCode {
  return [
    'injury',
    'eligibility',
    'short_handed',
    'recovery',
    'other',
  ].includes(String(value))
}

function isBoundedPosition(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 80
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

export function formatBasketballSubstitutionReason(
  reasonCode: BasketballSubstitutionReasonCode,
  reasonNote: string | null
): string {
  const label = reasonCode === 'short_handed'
    ? 'Short-handed'
    : reasonCode.charAt(0).toUpperCase() + reasonCode.slice(1)
  return reasonNote ? `${label}: ${reasonNote}` : label
}
