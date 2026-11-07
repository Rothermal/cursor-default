import type {
  GameEventSyncBaseEntry,
  GameEventSyncConflict,
  PendingGameEventConflictResolution,
} from '../../types'
import { cloneEvent, isGameEventEnvelope, isPlainObject } from './envelope'
import {
  canonicalGameEventStreamForFingerprint,
  compareGameEvents,
} from './stream'
import type { GameEvent, GameEventStream } from './types'

export interface SameRecorderMergeConflict {
  eventId: string
  localEvent: GameEvent
  remoteEvent: GameEvent
}

export interface SameRecorderMergeResult {
  eventStream: GameEventStream
  conflicts: SameRecorderMergeConflict[]
}

/** Sync stops on this until someone reviews the conflicts; background retries skip it. */
export const EVENT_CONFLICT_REVIEW_REQUIRED = 'Resolve the event sync conflicts before retrying cloud sync.'

export type RemoteConflictRevisionPolicy = 'preserve' | 'advance'

const SYNC_TIMESTAMP_FIELDS = ['occurredAt', 'createdAt', 'updatedAt', 'deletedAt'] as const

/**
 * The cloud returns timestamps as `+00:00` with trimmed milliseconds, the device writes `Z`.
 * Both name the same instant, so the merge compares instants, not spellings.
 */
function normalizeSyncTimestamp(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value
}

export function gameEventSyncFingerprint(event: GameEvent): string {
  const normalized: Record<string, unknown> = { ...event }
  for (const field of SYNC_TIMESTAMP_FIELDS) {
    if (field in normalized) normalized[field] = normalizeSyncTimestamp(normalized[field])
  }
  const canonical = canonicalGameEventStreamForFingerprint({
    version: 1,
    events: [normalized as unknown as GameEvent],
  })
  return JSON.stringify(canonical?.events[0] ?? null)
}

export function gameEventSyncBase(
  stream: GameEventStream | null
): Record<string, GameEventSyncBaseEntry> {
  const base: Record<string, GameEventSyncBaseEntry> = {}
  for (const rawEvent of stream?.events ?? []) {
    if (!isGameEventEnvelope(rawEvent)) continue
    base[rawEvent.id] = {
      revision: rawEvent.revision,
      fingerprint: gameEventSyncFingerprint(rawEvent),
    }
  }
  return base
}

export function mergeSameRecorderEventStreams(
  localStream: GameEventStream,
  remoteStream: GameEventStream,
  base: Record<string, GameEventSyncBaseEntry>
): SameRecorderMergeResult {
  const localById = eventMap(localStream, 'Local')
  const remoteById = eventMap(remoteStream, 'Cloud')
  const merged: GameEvent[] = []
  const conflicts: SameRecorderMergeConflict[] = []
  const eventIds = new Set([...localById.keys(), ...remoteById.keys()])

  for (const eventId of eventIds) {
    const localEvent = localById.get(eventId)
    const remoteEvent = remoteById.get(eventId)
    if (!localEvent && remoteEvent) {
      merged.push(cloneEvent(remoteEvent))
      continue
    }
    if (localEvent && !remoteEvent) {
      merged.push(cloneEvent(localEvent))
      continue
    }
    if (!localEvent || !remoteEvent) continue

    const localFingerprint = gameEventSyncFingerprint(localEvent)
    const remoteFingerprint = gameEventSyncFingerprint(remoteEvent)
    if (localFingerprint === remoteFingerprint) {
      merged.push(cloneEvent(localEvent))
      continue
    }

    const previous = base[eventId]
    const localMatchesBase = previous?.fingerprint === localFingerprint
    const remoteMatchesBase = previous?.fingerprint === remoteFingerprint
    if (localMatchesBase && !remoteMatchesBase) {
      merged.push(cloneEvent(remoteEvent))
    } else if (remoteMatchesBase && !localMatchesBase) {
      merged.push(cloneEvent(localEvent))
    } else {
      merged.push(cloneEvent(localEvent))
      conflicts.push({
        eventId,
        localEvent: cloneEvent(localEvent),
        remoteEvent: cloneEvent(remoteEvent),
      })
    }
  }

  merged.sort(compareGameEvents)
  return {
    eventStream: { version: localStream.version, events: merged },
    conflicts,
  }
}

/**
 * A sole recorder's device is the source of truth: each competing revision keeps the local
 * event, re-issued one revision above both copies so the cloud accepts it. No review needed.
 */
export function preferLocalMergeConflicts(
  merge: SameRecorderMergeResult,
  now: string
): GameEventStream {
  const winners = new Map(merge.conflicts.map(conflict => [conflict.eventId, {
    ...cloneEvent(conflict.localEvent),
    revision: Math.max(conflict.localEvent.revision, conflict.remoteEvent.revision) + 1,
    updatedAt: now,
  }]))
  return {
    ...merge.eventStream,
    events: merge.eventStream.events.map(rawEvent =>
      isGameEventEnvelope(rawEvent) ? winners.get(rawEvent.id) ?? rawEvent : rawEvent
    ),
  }
}

export function applyGameEventConflictResolution(
  stream: GameEventStream,
  conflict: GameEventSyncConflict,
  resolution: 'local' | 'remote',
  now: string,
  remoteRevisionPolicy: RemoteConflictRevisionPolicy = 'preserve'
): {
  eventStream: GameEventStream
  syncBase: GameEventSyncBaseEntry
  pending: PendingGameEventConflictResolution
} {
  const shouldAdvance = resolution === 'local' || remoteRevisionPolicy === 'advance'
  const chosen = resolution === 'remote' ? conflict.remoteEvent : conflict.localEvent
  const selected = shouldAdvance
    ? {
        ...cloneEvent(chosen),
        revision: Math.max(conflict.localEvent.revision, conflict.remoteEvent.revision) + 1,
        updatedAt: now,
      }
    : cloneEvent(chosen)
  const events = stream.events.map(rawEvent =>
    isGameEventEnvelope(rawEvent) && rawEvent.id === conflict.eventId
      ? selected
      : rawEvent
  )
  return {
    eventStream: { ...stream, events },
    syncBase: {
      revision: conflict.remoteEvent.revision,
      fingerprint: gameEventSyncFingerprint(conflict.remoteEvent),
    },
    pending: {
      conflictId: conflict.conflictId,
      eventId: conflict.eventId,
      resolution,
    },
  }
}

export function gameEventSyncConflictFromRow(
  value: unknown,
  sportId?: string
): GameEventSyncConflict | null {
  if (!isPlainObject(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.event_id !== 'string' ||
    typeof value.detected_at !== 'string' ||
    !isGameEventEnvelope(value.local_event) ||
    !isGameEventEnvelope(value.remote_event)
  ) return null
  if (
    value.local_event.id !== value.event_id ||
    value.remote_event.id !== value.event_id ||
    value.local_event.sportId !== value.remote_event.sportId ||
    (sportId !== undefined && value.local_event.sportId !== sportId)
  ) return null
  return {
    conflictId: value.id,
    eventId: value.event_id,
    localEvent: value.local_event,
    remoteEvent: value.remote_event,
    detectedAt: value.detected_at,
  }
}

function eventMap(stream: GameEventStream, label: string): Map<string, GameEvent> {
  const result = new Map<string, GameEvent>()
  for (const rawEvent of stream.events) {
    if (!isGameEventEnvelope(rawEvent)) {
      throw new Error(`${label} event history contains an invalid event.`)
    }
    if (result.has(rawEvent.id)) {
      throw new Error(`${label} event history contains a duplicate event id.`)
    }
    result.set(rawEvent.id, rawEvent)
  }
  return result
}
