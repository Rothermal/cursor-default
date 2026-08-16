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

export type RemoteConflictRevisionPolicy = 'preserve' | 'advance'

export function gameEventSyncFingerprint(event: GameEvent): string {
  const canonical = canonicalGameEventStreamForFingerprint({ version: 1, events: [event] })
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
