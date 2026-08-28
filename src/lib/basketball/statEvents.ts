import type { GameEvent, GameEventActor, GameEventLocation, GameEventPeriod, JsonObject } from '../gameEvents/types'
import type { GameEventDefinition } from '../gameEvents/registry'
import { isThreePointer, normalizedCourtLocationToFeet } from './courtGeometry'
import { createBasketballUuid } from './id'
import type {
  BasketballMatchEvent,
  BasketballRelatedEventPayload,
  BasketballReboundPayload,
  BasketballScoreAdjustmentPayload,
  BasketballShotPayload,
  BasketballTeamSide,
  BasketballTurnoverPayload,
  BasketballFreeThrowTripPayload,
} from './types'
import { BASKETBALL_EVENT_SCHEMA_VERSION } from './types'

export type BasketballStatPayloadByType = {
  'basketball.free_throw_trip': BasketballFreeThrowTripPayload
  'basketball.shot': BasketballShotPayload
  'basketball.assist': BasketballRelatedEventPayload
  'basketball.rebound': BasketballReboundPayload
  'basketball.steal': BasketballRelatedEventPayload
  'basketball.block': BasketballRelatedEventPayload
  'basketball.turnover': BasketballTurnoverPayload
  'basketball.score_adjustment': BasketballScoreAdjustmentPayload
}

export interface CreateBasketballStatEventInput<
  TType extends keyof BasketballStatPayloadByType,
> {
  id?: string
  eventType: TType
  payload: BasketballStatPayloadByType[TType]
  recorderUserId: string | null
  sequence: number
  period: GameEventPeriod
  elapsedMs?: number | null
  occurredAt: string
  teamSide: BasketballTeamSide
  location?: GameEventLocation | null
  actors?: GameEventActor[]
}

export function createBasketballStatEvent<
  TType extends keyof BasketballStatPayloadByType,
>(
  input: CreateBasketballStatEventInput<TType>
): Extract<BasketballMatchEvent, { eventType: TType }> {
  return {
    id: input.id ?? createBasketballUuid(),
    sportId: 'basketball',
    eventType: input.eventType,
    schemaVersion: BASKETBALL_EVENT_SCHEMA_VERSION,
    recorderUserId: input.recorderUserId,
    sequence: input.sequence,
    period: input.period,
    elapsedMs: input.elapsedMs ?? null,
    occurredAt: input.occurredAt,
    teamSide: input.teamSide,
    location: input.location ?? null,
    actors: input.actors ?? [],
    payload: input.payload,
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as Extract<BasketballMatchEvent, { eventType: TType }>
}

export const basketballStatEventDefinitions: GameEventDefinition<GameEvent>[] = [
  statDefinition('basketball.free_throw_trip', validateFreeThrowTrip, [], []),
  statDefinition('basketball.shot', validateShot, ['shooter'], ['shooter'], true),
  statDefinition('basketball.assist', validateRelatedEvent, ['assister'], ['assister']),
  statDefinition('basketball.rebound', validateRebound, ['rebounder'], ['rebounder']),
  statDefinition('basketball.steal', validateRelatedEvent, ['stealer', 'turnover_by'], ['stealer']),
  statDefinition('basketball.block', validateRelatedEvent, ['blocker'], ['blocker']),
  statDefinition('basketball.turnover', validateTurnover, ['committed_by'], ['committed_by']),
  statDefinition('basketball.score_adjustment', validateScoreAdjustment, ['team'], ['team']),
]

function statDefinition(
  eventType: keyof BasketballStatPayloadByType,
  validatePayload: (payload: JsonObject) => boolean,
  allowedRoles: string[],
  requiredRoles: string[],
  allowLocation = false
): GameEventDefinition<GameEvent> {
  return {
    sportId: 'basketball',
    eventType,
    currentSchemaVersion: BASKETBALL_EVENT_SCHEMA_VERSION,
    validate: event => {
      if (
        event.sportId !== 'basketball' ||
        event.eventType !== eventType ||
        event.schemaVersion !== BASKETBALL_EVENT_SCHEMA_VERSION ||
        (!allowLocation && event.location !== null) ||
        !actorsHaveRoles(event.actors, allowedRoles, requiredRoles) ||
        !actorsMatchEventFamily(eventType, event) ||
        !validRecordedLaterFlag(event.payload.recordedLater) ||
        !validatePayload(event.payload) ||
        (eventType === 'basketball.shot' && !shotEnvelopeMatchesPayload(event))
      ) {
        return { ok: false, message: `${eventType} has an invalid Basketball payload.` }
      }
      return { ok: true, event }
    },
  }
}

function actorsHaveRoles(
  actors: GameEventActor[],
  allowedRoles: string[],
  requiredRoles: string[]
): boolean {
  const roles = actors.map(actor => actor.role)
  return roles.every(role => allowedRoles.includes(role)) &&
    requiredRoles.every(role => roles.includes(role)) &&
    new Set(roles).size === roles.length
}

function actorsMatchEventFamily(
  eventType: keyof BasketballStatPayloadByType,
  event: GameEvent
): boolean {
  if (eventType === 'basketball.free_throw_trip') return event.actors.length === 0
  if (eventType === 'basketball.score_adjustment') {
    return event.actors.length === 1 && event.actors[0].kind === 'team'
  }
  if (eventType === 'basketball.turnover') {
    const actor = event.actors[0]
    return event.payload.kind === 'team'
      ? actor?.kind === 'team'
      : actor?.kind === 'player' || actor?.kind === 'unknown'
  }
  return event.actors.every(actor => actor.kind !== 'staff') &&
    !(eventType === 'basketball.steal' &&
      event.payload.relatedEventId !== null &&
      event.actors.some(actor => actor.role === 'turnover_by'))
}

function shotEnvelopeMatchesPayload(event: GameEvent): boolean {
  const payload = event.payload as unknown as BasketballShotPayload
  if (payload.attempt === 'free_throw') return event.location === null
  if (!event.location) {
    return payload.valueSource === 'quick_entry' || payload.valueSource === 'manual_override'
  }
  if (event.location.attackingDirection !== 'unknown') return false
  if (payload.valueSource !== 'court' && payload.valueSource !== 'manual_override') return false
  if (payload.valueSource === 'manual_override') return true
  const point = normalizedCourtLocationToFeet(event.location)
  return payload.value === (isThreePointer(point.x, point.y) ? 3 : 2)
}

function validateFreeThrowTrip(payload: JsonObject): boolean {
  return (payload.maximumAttempts === 1 || payload.maximumAttempts === 2 || payload.maximumAttempts === 3) &&
    typeof payload.oneAndOne === 'boolean' &&
    (!payload.oneAndOne || payload.maximumAttempts === 2) &&
    isNullableId(payload.sourceFoulEventId) &&
    typeof payload.technical === 'boolean' &&
    typeof payload.possessionRetained === 'boolean' &&
    validCaptureCommandId(payload.captureCommandId)
}

function validateShot(payload: JsonObject): boolean {
  if (
    (payload.value !== 1 && payload.value !== 2 && payload.value !== 3) ||
    typeof payload.made !== 'boolean' ||
    (payload.attempt !== 'field_goal' && payload.attempt !== 'free_throw') ||
    !['court', 'manual_override', 'quick_entry', 'free_throw'].includes(String(payload.valueSource)) ||
    !isNullableId(payload.freeThrowTripId) ||
    !(payload.tripAttemptNumber === null || isPositiveInteger(payload.tripAttemptNumber)) ||
    !validCaptureCommandId(payload.captureCommandId)
  ) return false

  const grouped = payload.freeThrowTripId !== null || payload.tripAttemptNumber !== null
  if (payload.attempt === 'free_throw') {
    return payload.value === 1 &&
      payload.valueSource === 'free_throw' &&
      grouped === (payload.freeThrowTripId !== null && payload.tripAttemptNumber !== null)
  }
  return (payload.value === 2 || payload.value === 3) &&
    payload.valueSource !== 'free_throw' &&
    payload.freeThrowTripId === null &&
    payload.tripAttemptNumber === null
}

function validateRelatedEvent(payload: JsonObject): boolean {
  return isNullableId(payload.relatedEventId) && validCaptureCommandId(payload.captureCommandId)
}

function validateRebound(payload: JsonObject): boolean {
  return (payload.kind === 'offensive' || payload.kind === 'defensive') &&
    validateRelatedEvent(payload)
}

function validateTurnover(payload: JsonObject): boolean {
  return (payload.kind === 'player' || payload.kind === 'team') &&
    validCaptureCommandId(payload.captureCommandId)
}

function validateScoreAdjustment(payload: JsonObject): boolean {
  if (
    !Number.isInteger(payload.delta) ||
    Number(payload.delta) === 0 ||
    !['scoreboard_control', 'unattributed_score', 'official_correction'].includes(String(payload.reason)) ||
    !(payload.note === null || typeof payload.note === 'string') ||
    !validCaptureCommandId(payload.captureCommandId)
  ) return false
  return payload.reason !== 'official_correction' || isNonEmptyString(payload.note)
}

function validCaptureCommandId(value: unknown): boolean {
  return value === null || isNonEmptyString(value)
}

function validRecordedLaterFlag(value: unknown): boolean {
  return value === undefined || value === true
}

function isNullableId(value: unknown): boolean {
  return value === null || isNonEmptyString(value)
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
