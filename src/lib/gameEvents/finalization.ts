import type { GameState } from '../../types'
import { supabase } from '../supabase'
import { eventRevisionCheckpoint, eventStreamFingerprint } from './cloudTransport'
import { isGameEventEnvelope, isPlainObject } from './envelope'
import type { GameEvent, GameEventStream } from './types'

/**
 * Sport-neutral finalization readiness, primary conflicts, checkpoint confirmation, publication
 * history, finalize and reopen over the fixed per-sport wrappers (migrations 057-059 for
 * Basketball, 073 for Hockey). Rows have the same shape for every sport; each sport passes its
 * RPC names and a sentence-case label for messages.
 */
export interface EventFinalizationRpcs {
  label: string
  readiness: string
  conflicts: string
  resolveConflict: string
  confirmCheckpoint: string
  publication: string
  publicationHistory: string
  finalize: string
  reopen: string
}

export interface EventFinalizationReadiness {
  gameStatus: string
  canFinalize: boolean
  canReopen: boolean
  primaryRecorderId: string | null
  primaryDisplayName: string | null
  primaryEnded: boolean
  primaryCheckpointCurrent: boolean
  primaryConflictCount: number
  primaryLocked: boolean
  activePublicationId: string | null
  finalizedAt: string | null
  nonPrimaryAttentionCount: number
}

export interface EventPrimaryFinalizationConflict {
  conflictId: string
  recorderId: string
  recorderDisplayName: string
  eventId: string
  localEvent: GameEvent
  remoteEvent: GameEvent
  detectedAt: string
}

export interface EventCanonicalPublication<Snapshot> {
  publicationId: string
  publicationNumber: number
  primaryRecorderId: string
  primaryDisplayName: string
  snapshot: Snapshot
  snapshotFingerprint: string
  finalizedBy: string
  finalizedByDisplayName: string
  finalizedAt: string
}

export interface EventCanonicalPublicationHistoryEntry {
  publicationId: string
  publicationNumber: number
  primaryRecorderId: string
  primaryDisplayName: string
  finalizedBy: string
  finalizedByDisplayName: string
  finalizedAt: string
  invalidatedBy: string | null
  invalidatedByDisplayName: string | null
  invalidatedAt: string | null
  invalidationReason: string | null
  isActive: boolean
}

export interface EventFinalizeResponse {
  publicationId: string
  publicationNumber: number
  primaryRecorderId: string
  finalizedAt: string
}

export interface EventReopenResponse {
  gameId: string
  publicationId: string
  reason: string
  reopenedAt: string
}

export async function loadEventFinalizationReadiness(
  rpcs: EventFinalizationRpcs,
  gameId: string
): Promise<EventFinalizationReadiness> {
  const client = requireClient()
  const { data, error } = await client.rpc(rpcs.readiness, { p_game_id: gameId })
  if (error) throw new Error(`${rpcs.label} finalization readiness could not load: ${error.message}`)
  const row = firstRow(rpcs.label, data)
  return {
    gameStatus: requiredString(row.game_status, 'game status'),
    canFinalize: requiredBoolean(row.can_finalize, 'finalization capability'),
    canReopen: requiredBoolean(row.can_reopen, 'reopen capability'),
    primaryRecorderId: nullableString(row.primary_recorded_by, 'primary recorder'),
    primaryDisplayName: nullableString(row.primary_display_name, 'primary recorder name'),
    primaryEnded: requiredBoolean(row.primary_ended, 'primary terminal status'),
    primaryCheckpointCurrent: requiredBoolean(row.primary_checkpoint_current, 'primary checkpoint status'),
    primaryConflictCount: requiredInteger(row.primary_conflict_count, 'primary conflict count'),
    primaryLocked: requiredBoolean(row.primary_locked, 'primary lock status'),
    activePublicationId: nullableString(row.active_publication_id, 'active publication'),
    finalizedAt: nullableTimestamp(row.finalized_at, 'finalized time'),
    nonPrimaryAttentionCount: requiredInteger(row.non_primary_attention_count, 'non-primary attention count'),
  }
}

export async function loadEventPrimaryFinalizationConflicts(
  rpcs: EventFinalizationRpcs,
  gameId: string
): Promise<EventPrimaryFinalizationConflict[]> {
  const client = requireClient()
  const { data, error } = await client.rpc(rpcs.conflicts, { p_game_id: gameId })
  if (error) throw new Error(`Primary conflicts could not load: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Primary conflict response is invalid.')
  const conflicts = data.map(raw => {
    const row = objectRow(rpcs.label, raw)
    if (!isGameEventEnvelope(row.local_event) || !isGameEventEnvelope(row.remote_event)) {
      throw new Error('Primary conflict contains an invalid event.')
    }
    return {
      conflictId: requiredString(row.conflict_id, 'conflict id'),
      recorderId: requiredString(row.recorded_by, 'recorder id'),
      recorderDisplayName: requiredString(row.recorder_display_name, 'recorder name'),
      eventId: requiredString(row.event_id, 'event id'),
      localEvent: row.local_event,
      remoteEvent: row.remote_event,
      detectedAt: requiredTimestamp(row.detected_at, 'conflict time'),
    }
  })
  if (new Set(conflicts.map(conflict => conflict.conflictId)).size !== conflicts.length) {
    throw new Error('Primary conflict response contains duplicate conflicts.')
  }
  return conflicts
}

export async function resolveEventPrimaryFinalizationConflict(
  rpcs: EventFinalizationRpcs,
  conflictId: string,
  resolution: 'local' | 'remote'
): Promise<void> {
  const client = requireClient()
  const { error } = await client.rpc(rpcs.resolveConflict, {
    p_conflict_id: conflictId,
    p_resolution: resolution,
  })
  if (error) throw new Error(`Primary conflict could not resolve: ${error.message}`)
}

/** Stores the exact checkpoint of the freshly loaded primary stream; readiness alone never compares it. */
export async function confirmEventPrimaryCheckpoint(
  rpcs: EventFinalizationRpcs,
  gameId: string,
  recorderId: string,
  state: GameState,
  eventStream: GameEventStream
): Promise<void> {
  const client = requireClient()
  const revisions = eventRevisionCheckpoint(state)
  const maxSequence = eventStream.events.reduce<number>(
    (max, event) => isGameEventEnvelope(event) ? Math.max(max, event.sequence) : max,
    -1
  )
  const { error } = await client.rpc(rpcs.confirmCheckpoint, {
    p_game_id: gameId,
    p_primary_recorded_by: recorderId,
    p_stream_version: eventStream.version,
    p_event_revisions: revisions,
    p_event_count: revisions.length,
    p_max_sequence: maxSequence,
    p_stream_fingerprint: eventStreamFingerprint(state),
  })
  if (error) throw new Error(`Primary checkpoint could not confirm: ${error.message}`)
}

export async function loadEventCanonicalPublication<Snapshot extends { gameId: string; primaryRecorderId: string }>(
  rpcs: EventFinalizationRpcs,
  gameId: string,
  parseSnapshot: (value: unknown) => Snapshot
): Promise<EventCanonicalPublication<Snapshot> | null> {
  const client = requireClient()
  const { data, error } = await client.rpc(rpcs.publication, { p_game_id: gameId })
  if (error) throw new Error(`Canonical ${rpcs.label} result could not load: ${error.message}`)
  if (!Array.isArray(data) || data.length === 0) return null
  const row = objectRow(rpcs.label, data[0])
  const snapshot = parseSnapshot(row.canonical_snapshot)
  const primaryRecorderId = requiredString(row.primary_recorded_by, 'primary recorder')
  if (snapshot.gameId !== gameId || snapshot.primaryRecorderId !== primaryRecorderId) {
    throw new Error(`Canonical ${rpcs.label} publication identity is invalid.`)
  }
  return {
    publicationId: requiredString(row.publication_id, 'publication id'),
    publicationNumber: requiredInteger(row.publication_number, 'publication number'),
    primaryRecorderId,
    primaryDisplayName: requiredString(row.primary_display_name, 'primary recorder name'),
    snapshot,
    snapshotFingerprint: requiredString(row.snapshot_fingerprint, 'snapshot fingerprint'),
    finalizedBy: requiredString(row.finalized_by, 'finalization actor'),
    finalizedByDisplayName: requiredString(row.finalized_by_display_name, 'finalization actor name'),
    finalizedAt: requiredTimestamp(row.finalized_at, 'finalized time'),
  }
}

/** `extra` reads sport-specific columns, such as Basketball's reopen mode. */
export async function loadEventCanonicalPublicationHistory<Extra extends object = object>(
  rpcs: EventFinalizationRpcs,
  gameId: string,
  extra?: (row: Record<string, unknown>) => Extra
): Promise<Array<EventCanonicalPublicationHistoryEntry & Extra>> {
  const client = requireClient()
  const { data, error } = await client.rpc(rpcs.publicationHistory, { p_game_id: gameId })
  if (error) throw new Error(`${rpcs.label} publication history could not load: ${error.message}`)
  if (!Array.isArray(data)) throw new Error(`${rpcs.label} publication history response is invalid.`)

  const history = data.map(raw => {
    const row = objectRow(rpcs.label, raw)
    const isActive = requiredBoolean(row.is_active, 'publication active state')
    const invalidatedBy = nullableString(row.invalidated_by, 'invalidation actor')
    const invalidatedByDisplayName = nullableString(row.invalidated_by_display_name, 'invalidation actor name')
    const invalidatedAt = nullableTimestamp(row.invalidated_at, 'invalidation time')
    const invalidationReason = nullableString(row.invalidation_reason, 'invalidation reason')
    const invalidation = [invalidatedBy, invalidatedByDisplayName, invalidatedAt, invalidationReason]
    if (isActive ? invalidation.some(value => value !== null) : invalidation.some(value => value === null)) {
      throw new Error(`${rpcs.label} publication invalidation metadata is inconsistent.`)
    }
    const entry: EventCanonicalPublicationHistoryEntry = {
      publicationId: requiredString(row.publication_id, 'publication id'),
      publicationNumber: requiredInteger(row.publication_number, 'publication number'),
      primaryRecorderId: requiredString(row.primary_recorded_by, 'primary recorder'),
      primaryDisplayName: requiredString(row.primary_display_name, 'primary recorder name'),
      finalizedBy: requiredString(row.finalized_by, 'finalization actor'),
      finalizedByDisplayName: requiredString(row.finalized_by_display_name, 'finalization actor name'),
      finalizedAt: requiredTimestamp(row.finalized_at, 'finalization time'),
      invalidatedBy,
      invalidatedByDisplayName,
      invalidatedAt,
      invalidationReason,
      isActive,
    }
    return { ...entry, ...(extra ? extra(row) : ({} as Extra)) }
  })
  if (
    new Set(history.map(item => item.publicationId)).size !== history.length ||
    new Set(history.map(item => item.publicationNumber)).size !== history.length ||
    history.filter(item => item.isActive).length > 1
  ) {
    throw new Error(`${rpcs.label} publication history contains duplicate authority.`)
  }
  return history
}

export async function finalizeEventGame(
  rpcs: EventFinalizationRpcs,
  input: { gameId: string; recorderId: string; state: GameState; snapshot: unknown }
): Promise<EventFinalizeResponse> {
  const client = requireClient()
  const { data, error } = await client.rpc(rpcs.finalize, {
    p_game_id: input.gameId,
    p_primary_recorded_by: input.recorderId,
    p_event_revisions: eventRevisionCheckpoint(input.state),
    p_stream_fingerprint: eventStreamFingerprint(input.state),
    p_canonical_snapshot: input.snapshot,
  })
  if (error) throw new Error(`${rpcs.label} finalization failed: ${error.message}`)
  const row = objectRow(rpcs.label, data)
  const primaryRecorderId = requiredString(row.primary_recorded_by, 'primary recorder')
  if (primaryRecorderId !== input.recorderId) {
    throw new Error(`${rpcs.label} finalization returned a different primary recorder.`)
  }
  return {
    publicationId: requiredString(row.publication_id, 'publication id'),
    publicationNumber: requiredInteger(row.publication_number, 'publication number'),
    primaryRecorderId,
    finalizedAt: requiredTimestamp(row.finalized_at, 'finalized time'),
  }
}

export async function reopenEventGame(
  rpcs: EventFinalizationRpcs,
  gameId: string,
  reason: string
): Promise<EventReopenResponse> {
  const client = requireClient()
  const trimmedReason = reason.trim()
  if (trimmedReason.length < 3) throw new Error('A reopen reason is required.')
  const { data, error } = await client.rpc(rpcs.reopen, { p_game_id: gameId, p_reason: trimmedReason })
  if (error) throw new Error(`${rpcs.label} game could not reopen: ${error.message}`)
  const row = objectRow(rpcs.label, data)
  const reopenedGameId = requiredString(row.game_id, 'reopened game id')
  if (reopenedGameId !== gameId) throw new Error(`${rpcs.label} reopen returned a different game.`)
  return {
    gameId: reopenedGameId,
    publicationId: requiredString(row.publication_id, 'invalidated publication id'),
    reason: trimmedReason,
    reopenedAt: requiredTimestamp(row.reopened_at, 'reopen time'),
  }
}

function requireClient() {
  if (!supabase) throw new Error('Supabase client not configured')
  return supabase
}

function firstRow(label: string, value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`${label} finalization response is invalid.`)
  }
  return objectRow(label, value[0])
}

function objectRow(label: string, value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} finalization response is invalid.`)
  return value
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}.`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return requiredString(value, label)
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}.`)
  return value
}

function requiredInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}.`)
  }
  return parsed
}

function requiredTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label)
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`Invalid ${label}.`)
  return timestamp
}

function nullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null
  return requiredTimestamp(value, label)
}
