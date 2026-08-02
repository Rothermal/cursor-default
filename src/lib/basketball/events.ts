import { isPlainObject } from '../gameEvents/envelope'
import type { GameEvent, GameEventPeriod, JsonObject } from '../gameEvents/types'
import type { GameEventDefinition } from '../gameEvents/registry'
import { createBasketballUuid } from './id'
import { isBasketballMatchParticipant } from './state'
import type {
  BasketballLifecycleEvent,
  BasketballMatchEndedPayload,
  BasketballMatchReopenedPayload,
  BasketballMatchRosterAddedPayload,
  BasketballParticipantResolvedPayload,
  BasketballPeriodPayload,
} from './types'
import { BASKETBALL_EVENT_SCHEMA_VERSION } from './types'

export type BasketballLifecyclePayloadByType = {
  'basketball.period_started': BasketballPeriodPayload
  'basketball.period_ended': BasketballPeriodPayload
  'basketball.match_roster_added': BasketballMatchRosterAddedPayload
  'basketball.participant_resolved': BasketballParticipantResolvedPayload
  'basketball.match_ended': BasketballMatchEndedPayload
  'basketball.match_reopened': BasketballMatchReopenedPayload
}

export interface CreateBasketballLifecycleEventInput<
  TType extends keyof BasketballLifecyclePayloadByType,
> {
  id?: string
  eventType: TType
  payload: BasketballLifecyclePayloadByType[TType]
  recorderUserId: string | null
  sequence: number
  period: GameEventPeriod
  occurredAt: string
}

export function createBasketballLifecycleEvent<
  TType extends keyof BasketballLifecyclePayloadByType,
>(
  input: CreateBasketballLifecycleEventInput<TType>
): Extract<BasketballLifecycleEvent, { eventType: TType }> {
  return {
    id: input.id ?? createBasketballUuid(),
    sportId: 'basketball',
    eventType: input.eventType,
    schemaVersion: BASKETBALL_EVENT_SCHEMA_VERSION,
    recorderUserId: input.recorderUserId,
    sequence: input.sequence,
    period: input.period,
    elapsedMs: null,
    occurredAt: input.occurredAt,
    teamSide: 'tracked',
    location: null,
    actors: [],
    payload: input.payload,
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as Extract<BasketballLifecycleEvent, { eventType: TType }>
}

export const basketballLifecycleEventDefinitions: GameEventDefinition<GameEvent>[] = [
  lifecycleDefinition('basketball.period_started', validatePeriodPayload),
  lifecycleDefinition('basketball.period_ended', validatePeriodPayload),
  lifecycleDefinition('basketball.match_roster_added', validateRosterAddedPayload),
  lifecycleDefinition('basketball.participant_resolved', validateParticipantResolvedPayload),
  lifecycleDefinition('basketball.match_ended', validateMatchEndedPayload),
  lifecycleDefinition('basketball.match_reopened', validateMatchReopenedPayload),
]

function lifecycleDefinition(
  eventType: keyof BasketballLifecyclePayloadByType,
  validatePayload: (payload: JsonObject) => boolean
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
        event.teamSide !== 'tracked' ||
        event.elapsedMs !== null ||
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

function validatePeriodPayload(payload: JsonObject): boolean {
  return isPlainObject(payload) &&
    isNonEmptyString(payload.periodId) &&
    validCaptureCommandId(payload.captureCommandId)
}

function validateRosterAddedPayload(payload: JsonObject): boolean {
  return isPlainObject(payload) &&
    isBasketballMatchParticipant(payload.participant) &&
    (payload.destination === 'bench' || payload.destination === 'dnp') &&
    payload.participant.initialStatus === payload.destination &&
    validCaptureCommandId(payload.captureCommandId)
}

function validateParticipantResolvedPayload(payload: JsonObject): boolean {
  return isPlainObject(payload) &&
    isNonEmptyString(payload.participantId) &&
    isNonEmptyString(payload.playerId) &&
    isNonEmptyString(payload.displayName) &&
    (payload.number === null || typeof payload.number === 'string') &&
    validCaptureCommandId(payload.captureCommandId)
}

function validateMatchEndedPayload(payload: JsonObject): boolean {
  return isPlainObject(payload) &&
    ['completed', 'suspended', 'abandoned'].includes(String(payload.reason)) &&
    validCaptureCommandId(payload.captureCommandId)
}

function validateMatchReopenedPayload(payload: JsonObject): boolean {
  return isPlainObject(payload) &&
    (payload.reason === null || isNonEmptyString(payload.reason)) &&
    validCaptureCommandId(payload.captureCommandId)
}

function validCaptureCommandId(value: unknown): boolean {
  return value === null || isNonEmptyString(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
