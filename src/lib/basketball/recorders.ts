import type { GameState } from '../../types'
import { loadGameEventStreamForRecorder } from '../gameEvents/cloud'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type { GameEvent, GameEventInspection, GameEventStream } from '../gameEvents/types'
import { supabase } from '../supabase'
import { loadBasketballCloudShell } from './cloudSync'
import { reconcileBasketballPlayerRows } from './courtCorrections'

export interface BasketballRecorderSummary {
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

export interface BasketballPrimaryRecorderHistoryEntry {
  id: string
  previousRecorderId: string | null
  previousDisplayName: string | null
  recorderId: string
  displayName: string
  changedBy: string
  changedByDisplayName: string
  changedAt: string
}

export interface BasketballRecorderProjection {
  recorder: BasketballRecorderSummary
  state: GameState
  eventStream: GameEventStream
  inspection: GameEventInspection<GameEvent>
}

export async function loadBasketballGameRecorders(
  gameId: string
): Promise<BasketballRecorderSummary[]> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('get_basketball_game_recorders', {
    p_game_id: gameId,
  })
  if (error) throw new Error(`Basketball recorder streams could not load: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Basketball recorder response is invalid.')

  const rows = data.map(parseRecorderSummary)
  if (new Set(rows.map(row => row.recorderId)).size !== rows.length) {
    throw new Error('Basketball recorder response contains duplicate recorders.')
  }
  if (rows.filter(row => row.isPrimary).length > 1) {
    throw new Error('Basketball recorder response contains multiple primary recorders.')
  }
  return rows
}

export async function loadBasketballPrimaryRecorderHistory(
  gameId: string
): Promise<BasketballPrimaryRecorderHistoryEntry[]> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('get_basketball_primary_recorder_history', {
    p_game_id: gameId,
  })
  if (error) throw new Error(`Basketball primary history could not load: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Basketball primary history response is invalid.')

  const rows = data.map(row => {
    const value = objectRow(row)
    return {
      id: requiredString(value.id, 'history id'),
      previousRecorderId: nullableString(value.previous_recorded_by, 'previous recorder'),
      previousDisplayName: nullableString(value.previous_display_name, 'previous recorder name'),
      recorderId: requiredString(value.recorded_by, 'selected recorder'),
      displayName: requiredString(value.display_name, 'selected recorder name'),
      changedBy: requiredString(value.changed_by, 'selection actor'),
      changedByDisplayName: requiredString(
        value.changed_by_display_name,
        'selection actor name'
      ),
      changedAt: requiredTimestamp(value.changed_at, 'selection time'),
    }
  })
  if (new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('Basketball primary history contains duplicate entries.')
  }
  return rows
}

export async function selectBasketballPrimaryRecorder(
  gameId: string,
  recorderId: string
): Promise<void> {
  if (!supabase) throw new Error('Supabase client not configured')
  if (!gameId.trim() || !recorderId.trim()) {
    throw new Error('Basketball primary recorder identity is invalid.')
  }
  const { data, error } = await supabase.rpc('set_basketball_primary_recorder', {
    p_game_id: gameId,
    p_recorded_by: recorderId,
  })
  if (error) throw new Error(`Basketball primary recorder could not update: ${error.message}`)
  if (data !== recorderId) {
    throw new Error('Basketball primary recorder update returned an invalid response.')
  }
}

export function primaryBasketballRecorder(
  recorders: BasketballRecorderSummary[]
): BasketballRecorderSummary | null {
  return recorders.find(recorder => recorder.isPrimary) ?? null
}

export function basketballRecorderNeedsAttention(
  recorder: BasketballRecorderSummary
): boolean {
  return !recorder.checkpointCurrent || (recorder.unresolvedConflictCount ?? 0) > 0
}

export async function loadBasketballRecorderProjection(
  gameId: string,
  recorder: BasketballRecorderSummary
): Promise<BasketballRecorderProjection> {
  const shell = await loadBasketballCloudShell(gameId)
  const loaded = await loadGameEventStreamForRecorder(
    gameId,
    recorder.recorderId,
    shell.cloudToLocalPlayerId,
    gameEventRegistry
  )
  if (!loaded.ok) {
    throw new Error(loaded.error ?? 'Basketball recorder stream could not load.')
  }

  const rebuilt = rebuildGameEventProjection(
    { ...shell.state, eventStream: loaded.eventStream },
    gameEventRegistry,
    gameEventProjectors
  )
  const allEvents = [
    ...rebuilt.inspection.activeEvents,
    ...rebuilt.inspection.deletedEvents,
  ]
  if (allEvents.some(event => (
    event.sportId !== 'basketball' || event.recorderUserId !== recorder.recorderId
  ))) {
    throw new Error('Basketball recorder stream contains mixed ownership.')
  }

  return {
    recorder,
    state: reconcileBasketballPlayerRows(rebuilt.state),
    eventStream: loaded.eventStream,
    inspection: rebuilt.inspection,
  }
}

function parseRecorderSummary(row: unknown): BasketballRecorderSummary {
  const value = objectRow(row)
  const primarySource = nullableString(value.primary_source, 'primary source')
  if (primarySource !== null && primarySource !== 'default' && primarySource !== 'selected') {
    throw new Error('Basketball recorder primary source is invalid.')
  }
  return {
    recorderId: requiredString(value.recorder_user_id, 'recorder id'),
    displayName: requiredString(value.display_name, 'recorder name'),
    eventCount: nullableInteger(value.event_count, 'event count'),
    checkpointEventCount: nullableInteger(
      value.checkpoint_event_count,
      'checkpoint event count'
    ),
    checkpointSyncedAt: nullableTimestamp(value.checkpoint_synced_at, 'checkpoint time'),
    checkpointCurrent: requiredBoolean(value.checkpoint_current, 'checkpoint status'),
    unresolvedConflictCount: nullableInteger(value.unresolved_conflict_count, 'conflict count'),
    isPrimary: requiredBoolean(value.is_primary, 'primary status'),
    primarySource,
    canSelectPrimary: requiredBoolean(value.can_select_primary, 'primary selection capability'),
  }
}

function objectRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Basketball recorder response contains an invalid row.')
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
