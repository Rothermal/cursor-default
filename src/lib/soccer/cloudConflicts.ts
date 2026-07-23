import type {
  GameEventSyncBaseEntry,
  GameEventSyncConflict,
  PendingGameEventConflictResolution,
} from '../../types'
import { cloneEvent, isGameEventEnvelope } from '../gameEvents/envelope'
import {
  canonicalGameEventStreamForFingerprint,
  compareGameEvents,
} from '../gameEvents/stream'
import type { GameEvent, GameEventStream } from '../gameEvents/types'

export interface SameRecorderMergeConflict {
  eventId: string
  localEvent: GameEvent
  remoteEvent: GameEvent
}

export interface SameRecorderMergeResult {
  eventStream: GameEventStream
  conflicts: SameRecorderMergeConflict[]
}

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
  now: string
): {
  eventStream: GameEventStream
  syncBase: GameEventSyncBaseEntry
  pending: PendingGameEventConflictResolution
} {
  const selected = resolution === 'remote'
    ? cloneEvent(conflict.remoteEvent)
    : {
        ...cloneEvent(conflict.localEvent),
        revision: Math.max(conflict.localEvent.revision, conflict.remoteEvent.revision) + 1,
        updatedAt: now,
      }
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
