import type {
  GameEvent,
  GameEventActor,
  GameEventLocation,
  GameEventPeriod,
  JsonObject,
} from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1
}

function isPeriod(value: unknown): value is GameEventPeriod {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    isNonNegativeInteger(value.order)
  )
}

function isLocation(value: unknown): value is GameEventLocation {
  return (
    isPlainObject(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    value.x >= 0 &&
    value.x <= 1 &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    value.y >= 0 &&
    value.y <= 1 &&
    (value.attackingDirection === 'left_to_right' ||
      value.attackingDirection === 'right_to_left' ||
      value.attackingDirection === 'unknown')
  )
}

function isActor(value: unknown): value is GameEventActor {
  if (!isPlainObject(value) || !isNonEmptyString(value.role)) return false
  if (value.participantId !== undefined && !isNonEmptyString(value.participantId)) return false
  if (value.kind === 'player') return isNonEmptyString(value.playerId)
  return (
    (value.kind === 'staff' || value.kind === 'team' || value.kind === 'unknown') &&
    isNonEmptyString(value.label)
  )
}

export function isGameEventEnvelope(value: unknown): value is GameEvent {
  if (!isPlainObject(value)) return false
  if (!isNonEmptyString(value.id) || !UUID_PATTERN.test(value.id)) return false
  if (!isNonEmptyString(value.sportId) || !isNonEmptyString(value.eventType)) return false
  if (!isPositiveInteger(value.schemaVersion) || !isPositiveInteger(value.revision)) return false
  if (value.recorderUserId !== null && !isNonEmptyString(value.recorderUserId)) return false
  if (!isNonNegativeInteger(value.sequence) || !isPeriod(value.period)) return false
  if (value.elapsedMs !== null && !isNonNegativeInteger(value.elapsedMs)) return false
  if (!isIsoTimestamp(value.occurredAt)) return false
  if (value.teamSide !== 'tracked' && value.teamSide !== 'opponent') return false
  if (value.location !== null && !isLocation(value.location)) return false
  if (!Array.isArray(value.actors) || !value.actors.every(isActor)) return false
  if (!isPlainObject(value.payload)) return false
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) return false
  if (value.deletedAt !== null && !isIsoTimestamp(value.deletedAt)) return false
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) return false
  if (value.deletedAt !== null && Date.parse(value.deletedAt) < Date.parse(value.createdAt)) {
    return false
  }
  return true
}

export function eventIdFromUnknown(value: unknown): string | null {
  return isPlainObject(value) && typeof value.id === 'string' ? value.id : null
}

export function cloneEvent<TEvent extends GameEvent>(event: TEvent): TEvent {
  return structuredClone(event)
}

export function asJsonObject(value: Record<string, unknown>): JsonObject {
  return value as JsonObject
}
