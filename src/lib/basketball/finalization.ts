import type { GameState } from '../../types'
import { isPlainObject } from '../gameEvents/envelope'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream, normalizeGameEventStream } from '../gameEvents/stream'
import type { GameEventStream } from '../gameEvents/types'
import {
  BASKETBALL_GAME_STATE_VERSION,
  type BasketballMatchSetup,
} from './types'
import { normalizeBasketballSportGameState } from './state'

export const BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION = 1
export const EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION = 2

export interface BasketballCanonicalSnapshot {
  version: typeof EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION
  canonicalSchemaVersion: typeof BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION
  sportId: 'basketball'
  gameId: string
  primaryRecorderId: string
  eventStream: GameEventStream
  sportGameState: {
    sportId: 'basketball'
    version: typeof BASKETBALL_GAME_STATE_VERSION
    setup: BasketballMatchSetup
  }
}

export function createBasketballCanonicalSnapshot(
  gameId: string,
  recorderId: string,
  state: GameState
): BasketballCanonicalSnapshot {
  if (!gameId.trim() || !recorderId.trim()) {
    throw new Error('Basketball canonical identity is invalid.')
  }
  if (
    state.gameDataAuthority !== 'sport_events' ||
    !state.eventStream ||
    state.sportGameState?.sportId !== 'basketball'
  ) {
    throw new Error('Basketball canonical source is unavailable.')
  }

  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) {
    throw new Error(
      inspection.diagnostics[0]?.message ?? 'Basketball canonical event stream is invalid.'
    )
  }
  assertRecorderOwnership(inspection.activeEvents, inspection.deletedEvents, recorderId)

  const rebuilt = rebuildGameEventProjection(
    state,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!rebuilt.inspection.complete || rebuilt.state.sportGameState?.sportId !== 'basketball') {
    throw new Error(
      rebuilt.inspection.diagnostics[0]?.message ??
        'Basketball canonical event stream does not project completely.'
    )
  }

  return {
    version: EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION,
    canonicalSchemaVersion: BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
    sportId: 'basketball',
    gameId,
    primaryRecorderId: recorderId,
    eventStream: structuredClone(state.eventStream),
    sportGameState: {
      sportId: 'basketball',
      version: state.sportGameState.version,
      setup: structuredClone(state.sportGameState.setup),
    },
  }
}

export function parseBasketballCanonicalSnapshot(
  value: unknown
): BasketballCanonicalSnapshot {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, [
      'version',
      'canonicalSchemaVersion',
      'sportId',
      'gameId',
      'primaryRecorderId',
      'eventStream',
      'sportGameState',
    ]) ||
    value.version !== EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION ||
    value.canonicalSchemaVersion !== BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION ||
    value.sportId !== 'basketball' ||
    !isNonEmptyString(value.gameId) ||
    !isNonEmptyString(value.primaryRecorderId) ||
    !isPlainObject(value.eventStream) ||
    !hasOnlyKeys(value.eventStream, ['version', 'events']) ||
    !isPlainObject(value.sportGameState) ||
    !hasOnlyKeys(value.sportGameState, ['sportId', 'version', 'setup']) ||
    value.sportGameState.sportId !== 'basketball' ||
    value.sportGameState.version !== BASKETBALL_GAME_STATE_VERSION ||
    !isPlainObject(value.sportGameState.setup)
  ) {
    throw new Error('Basketball canonical snapshot is invalid.')
  }

  const eventStream = normalizeGameEventStream(value.eventStream)
  const sportState = normalizeBasketballSportGameState({
    sportId: 'basketball',
    version: value.sportGameState.version,
    setup: value.sportGameState.setup,
  })
  if (!eventStream || !sportState) {
    throw new Error('Basketball canonical snapshot is invalid.')
  }

  const inspection = inspectGameEventStream(eventStream, gameEventRegistry)
  if (!inspection.complete) {
    throw new Error('Basketball canonical snapshot contains invalid events.')
  }
  assertRecorderOwnership(
    inspection.activeEvents,
    inspection.deletedEvents,
    value.primaryRecorderId
  )

  return {
    version: EVENT_PLATFORM_CANONICAL_ENVELOPE_VERSION,
    canonicalSchemaVersion: BASKETBALL_CANONICAL_PAYLOAD_SCHEMA_VERSION,
    sportId: 'basketball',
    gameId: value.gameId,
    primaryRecorderId: value.primaryRecorderId,
    eventStream: structuredClone(eventStream),
    sportGameState: {
      sportId: 'basketball',
      version: BASKETBALL_GAME_STATE_VERSION,
      setup: structuredClone(sportState.setup),
    },
  }
}

function assertRecorderOwnership(
  activeEvents: Array<{ sportId: string; recorderUserId: string | null }>,
  deletedEvents: Array<{ sportId: string; recorderUserId: string | null }>,
  recorderId: string
): void {
  if (
    [...activeEvents, ...deletedEvents].some(event =>
      event.sportId !== 'basketball' || event.recorderUserId !== recorderId
    )
  ) {
    throw new Error('Basketball canonical events do not belong to the primary recorder.')
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every(key => allowedKeys.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
