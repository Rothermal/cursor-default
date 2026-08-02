import { eventIdFromUnknown, isGameEventEnvelope, isPlainObject } from './envelope'
import type {
  GameEvent,
  GameEventDiagnostic,
  GameEventInspection,
  GameEventStream,
} from './types'
import { GAME_EVENT_STREAM_VERSION } from './types'
import type { GameEventRegistry } from './registry'

export function createGameEventStream(): GameEventStream {
  return { version: GAME_EVENT_STREAM_VERSION, events: [] }
}

export function normalizeGameEventStream(value: unknown): GameEventStream | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as { version?: unknown; events?: unknown }
  if (!Number.isInteger(candidate.version) || Number(candidate.version) < 1) return null
  if (!Array.isArray(candidate.events)) return null
  return { version: Number(candidate.version), events: candidate.events }
}

export function compareGameEvents(left: GameEvent, right: GameEvent): number {
  if (left.period.order !== right.period.order) return left.period.order - right.period.order
  const leftElapsed = left.elapsedMs ?? Number.MAX_SAFE_INTEGER
  const rightElapsed = right.elapsedMs ?? Number.MAX_SAFE_INTEGER
  if (leftElapsed !== rightElapsed) return leftElapsed - rightElapsed
  if (left.sequence !== right.sequence) return left.sequence - right.sequence
  return left.id.localeCompare(right.id)
}

/** Projection rebuilds follow recorder capture order, independent of display clock order. */
export function compareGameEventCaptureOrder(left: GameEvent, right: GameEvent): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence
  return left.id.localeCompare(right.id)
}

/** Stable raw representation for dirty detection; does not mutate persisted event order. */
export function canonicalGameEventStreamForFingerprint(
  stream: GameEventStream | null
): GameEventStream | null {
  if (!stream) return null
  const events = [...stream.events].sort((left, right) => {
    if (isGameEventEnvelope(left) && isGameEventEnvelope(right)) {
      return compareGameEvents(left, right)
    }
    if (isGameEventEnvelope(left)) return -1
    if (isGameEventEnvelope(right)) return 1
    return stableJson(left).localeCompare(stableJson(right))
  })
  return {
    version: stream.version,
    events: events.map(canonicalizeJsonLike),
  }
}

function canonicalizeJsonLike(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJsonLike)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalizeJsonLike(value[key])])
  )
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalizeJsonLike(value)) ?? String(value)
}

export function inspectGameEventStream<TEvent extends GameEvent>(
  stream: GameEventStream,
  registry: GameEventRegistry<TEvent>
): GameEventInspection<TEvent> {
  if (stream.version !== GAME_EVENT_STREAM_VERSION) {
    return {
      complete: false,
      activeEvents: [],
      deletedEvents: [],
      diagnostics: [
        {
          code: 'invalid_stream',
          message: `Unsupported event stream version ${stream.version}.`,
          eventId: null,
        },
      ],
    }
  }

  const activeEvents: TEvent[] = []
  const deletedEvents: TEvent[] = []
  const diagnostics: GameEventDiagnostic[] = []

  stream.events.forEach((raw, eventIndex) => {
    const result = registry.inspect(raw)
    if (!result.ok) {
      diagnostics.push({
        ...result.diagnostic,
        eventId: result.diagnostic.eventId ?? eventIdFromUnknown(raw),
        eventIndex,
      })
      return
    }
    if (result.event.deletedAt) deletedEvents.push(result.event)
    else activeEvents.push(result.event)
  })

  activeEvents.sort(compareGameEvents)
  deletedEvents.sort(compareGameEvents)
  return {
    complete: diagnostics.length === 0,
    activeEvents,
    deletedEvents,
    diagnostics,
  }
}
