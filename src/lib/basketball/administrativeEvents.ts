import { isPlainObject } from '../gameEvents/envelope'
import type {
  GameEvent,
  GameEventActor,
  GameEventPeriod,
  GameEventTeamSide,
} from '../gameEvents/types'
import type { GameEventDefinition } from '../gameEvents/registry'
import { createBasketballUuid } from './id'
import type {
  BasketballAdministrativeEvent,
  BasketballEjectionPayload,
  BasketballFoulPayload,
  BasketballMinutesAdjustmentPayload,
  BasketballTimeoutPayload,
} from './types'
import { BASKETBALL_EVENT_SCHEMA_VERSION } from './types'

export type BasketballAdministrativePayloadByType = {
  'basketball.foul': BasketballFoulPayload
  'basketball.ejection': BasketballEjectionPayload
  'basketball.timeout': BasketballTimeoutPayload
  'basketball.minutes_adjustment': BasketballMinutesAdjustmentPayload
}

export interface CreateBasketballAdministrativeEventInput<
  TType extends keyof BasketballAdministrativePayloadByType,
> {
  id?: string
  eventType: TType
  payload: BasketballAdministrativePayloadByType[TType]
  recorderUserId: string | null
  sequence: number
  period: GameEventPeriod
  elapsedMs?: number | null
  occurredAt: string
  teamSide: GameEventTeamSide
  actors?: GameEventActor[]
}

export function createBasketballAdministrativeEvent<
  TType extends keyof BasketballAdministrativePayloadByType,
>(
  input: CreateBasketballAdministrativeEventInput<TType>
): Extract<BasketballAdministrativeEvent, { eventType: TType }> {
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
    location: null,
    actors: input.actors ?? [],
    payload: input.payload,
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as Extract<BasketballAdministrativeEvent, { eventType: TType }>
}

export const basketballAdministrativeEventDefinitions: GameEventDefinition<GameEvent>[] = [
  definition('basketball.foul', validateFoul, ['tracked', 'opponent']),
  definition('basketball.ejection', validateEjection, ['tracked', 'opponent']),
  definition('basketball.timeout', validateTimeout, ['tracked', 'opponent', 'neutral']),
  definition('basketball.minutes_adjustment', validateMinutesAdjustment, ['tracked', 'opponent']),
]

function definition(
  eventType: keyof BasketballAdministrativePayloadByType,
  validateEvent: (event: GameEvent) => boolean,
  allowedTeamSides: readonly GameEventTeamSide[]
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
        event.location !== null ||
        !validateEvent(event)
      ) {
        return { ok: false, message: `${eventType} has an invalid Basketball payload.` }
      }
      return { ok: true, event }
    },
  }
}

function validateFoul(event: GameEvent): boolean {
  const payload = event.payload
  const roles = event.actors.map(actor => actor.role)
  const committedBy = actorForRole(event.actors, 'committed_by')
  const drawnBy = actorForRole(event.actors, 'drawn_by')
  return (
    event.teamSide !== 'neutral' &&
    roles.every(role => role === 'committed_by' || role === 'drawn_by') &&
    new Set(roles).size === roles.length &&
    Boolean(committedBy) &&
    (committedBy?.kind === 'player' || committedBy?.kind === 'staff' || committedBy?.kind === 'team') &&
    (!drawnBy || drawnBy.kind === 'player' || drawnBy.kind === 'unknown') &&
    ['personal', 'technical', 'flagrant', 'intentional', 'double'].includes(String(payload.class)) &&
    [
      'common',
      'shooting',
      'offensive',
      'loose_ball',
      'away_from_play',
      'administrative',
    ].includes(String(payload.context)) &&
    (payload.teamControlSide === null ||
      payload.teamControlSide === 'tracked' ||
      payload.teamControlSide === 'opponent') &&
    isNullableId(payload.incidentId) &&
    isCountingOverride(payload.countingOverride) &&
    validCaptureCommandId(payload.captureCommandId)
  )
}

function validateEjection(event: GameEvent): boolean {
  const payload = event.payload
  const subject = actorForRole(event.actors, 'subject')
  return (
    event.teamSide !== 'neutral' &&
    event.actors.length === 1 &&
    Boolean(subject) &&
    (subject?.kind === 'player' || subject?.kind === 'staff') &&
    isNonEmptyString(payload.reason) &&
    (payload.source === 'automatic_threshold' || payload.source === 'official_ruling') &&
    isNullableId(payload.relatedFoulEventId) &&
    validCaptureCommandId(payload.captureCommandId)
  )
}

function validateTimeout(event: GameEvent): boolean {
  const payload = event.payload
  const labelValid = payload.label === null || isNonEmptyString(payload.label)
  if (!labelValid || !validCaptureCommandId(payload.captureCommandId)) return false
  if (event.teamSide === 'neutral') {
    return (
      (payload.kind === 'media' || payload.kind === 'official') &&
      payload.chargedSide === null &&
      event.actors.length === 0
    )
  }
  const team = actorForRole(event.actors, 'team')
  return (
    (payload.kind === 'full' || payload.kind === 'thirty_second') &&
    payload.chargedSide === event.teamSide &&
    event.actors.length === 1 &&
    team?.kind === 'team'
  )
}

function validateMinutesAdjustment(event: GameEvent): boolean {
  const player = actorForRole(event.actors, 'player')
  return (
    event.teamSide !== 'neutral' &&
    event.actors.length === 1 &&
    player?.kind === 'player' &&
    Number.isInteger(event.payload.deltaMinutes) &&
    Number(event.payload.deltaMinutes) !== 0 &&
    validCaptureCommandId(event.payload.captureCommandId)
  )
}

function isCountingOverride(value: unknown): boolean {
  if (value === null) return true
  return (
    isPlainObject(value) &&
    typeof value.personalFoul === 'boolean' &&
    typeof value.teamFoul === 'boolean' &&
    typeof value.technical === 'boolean' &&
    isNonEmptyString(value.reason)
  )
}

function actorForRole(actors: GameEventActor[], role: string): GameEventActor | undefined {
  return actors.find(actor => actor.role === role)
}

function validCaptureCommandId(value: unknown): boolean {
  return value === null || isNonEmptyString(value)
}

function isNullableId(value: unknown): boolean {
  return value === null || isNonEmptyString(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
