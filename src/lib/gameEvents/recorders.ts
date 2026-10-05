import { supabase } from '../supabase'

/**
 * Sport-neutral recorder presence and primary selection over the fixed per-sport wrappers
 * (migrations 053/057 for Basketball, 073 for Hockey). Each sport passes its RPC names and
 * label; the server rows are the same for every sport.
 */
export interface EventRecorderRpcs {
  /** Sentence-case sport name for messages, e.g. "Hockey". */
  label: string
  recorders: string
  primaryHistory: string
  setPrimary: string
}

export interface EventRecorderSummary {
  recorderId: string
  displayName: string
  eventCount: number | null
  checkpointEventCount: number | null
  checkpointSyncedAt: string | null
  checkpointCurrent: boolean
  unresolvedConflictCount: number | null
  isPrimary: boolean
  primarySource: 'default' | 'selected' | null
  canSelectPrimary: boolean
}

export interface EventPrimaryRecorderHistoryEntry {
  id: string
  previousRecorderId: string | null
  previousDisplayName: string | null
  recorderId: string
  displayName: string
  changedBy: string
  changedByDisplayName: string
  changedAt: string
}

export async function loadEventGameRecorders(
  rpcs: EventRecorderRpcs,
  gameId: string
): Promise<EventRecorderSummary[]> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc(rpcs.recorders, { p_game_id: gameId })
  if (error) throw new Error(`${rpcs.label} recorder streams could not load: ${error.message}`)
  if (!Array.isArray(data)) throw new Error(`${rpcs.label} recorder response is invalid.`)

  const rows = data.map(row => parseRecorderSummary(rpcs.label, row))
  if (new Set(rows.map(row => row.recorderId)).size !== rows.length) {
    throw new Error(`${rpcs.label} recorder response contains duplicate recorders.`)
  }
  if (rows.filter(row => row.isPrimary).length > 1) {
    throw new Error(`${rpcs.label} recorder response contains multiple primary recorders.`)
  }
  return rows
}

export async function loadEventPrimaryRecorderHistory(
  rpcs: EventRecorderRpcs,
  gameId: string
): Promise<EventPrimaryRecorderHistoryEntry[]> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc(rpcs.primaryHistory, { p_game_id: gameId })
  if (error) throw new Error(`${rpcs.label} primary history could not load: ${error.message}`)
  if (!Array.isArray(data)) throw new Error(`${rpcs.label} primary history response is invalid.`)

  const rows = data.map(row => {
    const value = objectRow(rpcs.label, row)
    return {
      id: requiredString(value.id, 'history id'),
      previousRecorderId: nullableString(value.previous_recorded_by, 'previous recorder'),
      previousDisplayName: nullableString(value.previous_display_name, 'previous recorder name'),
      recorderId: requiredString(value.recorded_by, 'selected recorder'),
      displayName: requiredString(value.display_name, 'selected recorder name'),
      changedBy: requiredString(value.changed_by, 'selection actor'),
      changedByDisplayName: requiredString(value.changed_by_display_name, 'selection actor name'),
      changedAt: requiredTimestamp(value.changed_at, 'selection time'),
    }
  })
  if (new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error(`${rpcs.label} primary history contains duplicate entries.`)
  }
  return rows
}

export async function selectEventPrimaryRecorder(
  rpcs: EventRecorderRpcs,
  gameId: string,
  recorderId: string
): Promise<void> {
  if (!supabase) throw new Error('Supabase client not configured')
  if (!gameId.trim() || !recorderId.trim()) {
    throw new Error(`${rpcs.label} primary recorder identity is invalid.`)
  }
  const { data, error } = await supabase.rpc(rpcs.setPrimary, {
    p_game_id: gameId,
    p_recorded_by: recorderId,
  })
  if (error) throw new Error(`${rpcs.label} primary recorder could not update: ${error.message}`)
  if (data !== recorderId) {
    throw new Error(`${rpcs.label} primary recorder update returned an invalid response.`)
  }
}

export function eventRecorderNeedsAttention(recorder: EventRecorderSummary): boolean {
  return !recorder.checkpointCurrent || (recorder.unresolvedConflictCount ?? 0) > 0
}

function parseRecorderSummary(label: string, row: unknown): EventRecorderSummary {
  const value = objectRow(label, row)
  const primarySource = nullableString(value.primary_source, 'primary source')
  if (primarySource !== null && primarySource !== 'default' && primarySource !== 'selected') {
    throw new Error(`${label} recorder primary source is invalid.`)
  }
  return {
    recorderId: requiredString(value.recorder_user_id, 'recorder id'),
    displayName: requiredString(value.display_name, 'recorder name'),
    eventCount: nullableInteger(value.event_count, 'event count'),
    checkpointEventCount: nullableInteger(value.checkpoint_event_count, 'checkpoint event count'),
    checkpointSyncedAt: nullableTimestamp(value.checkpoint_synced_at, 'checkpoint time'),
    checkpointCurrent: requiredBoolean(value.checkpoint_current, 'checkpoint status'),
    unresolvedConflictCount: nullableInteger(value.unresolved_conflict_count, 'conflict count'),
    isPrimary: requiredBoolean(value.is_primary, 'primary status'),
    primarySource,
    canSelectPrimary: requiredBoolean(value.can_select_primary, 'primary selection capability'),
  }
}

function objectRow(label: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} recorder response contains an invalid row.`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}.`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}.`)
  return value
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}.`)
  return value
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}.`)
  }
  return parsed
}

function nullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null
  return requiredTimestamp(value, label)
}

function requiredTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label)
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`Invalid ${label}.`)
  return timestamp
}
