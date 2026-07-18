import { supabase } from '../supabase'
import { isGameEventEnvelope, isPlainObject } from './envelope'
import type { GameEventRegistry } from './registry'
import { inspectGameEventStream } from './stream'
import type {
  GameEvent,
  GameEventActor,
  GameEventDiagnostic,
  GameEventInspection,
  GameEventStream,
  JsonObject,
} from './types'
import { GAME_EVENT_STREAM_VERSION } from './types'

export interface GameEventCloudRow {
  id: string
  game_id: string
  recorded_by: string
  sport_id: string
  event_type: string
  schema_version: number
  stream_sequence: number
  revision: number
  period_id: string
  period_order: number
  elapsed_ms: number | null
  occurred_at: string
  team_side: string
  location: unknown
  actors: unknown
  payload: unknown
  event_created_at: string
  event_updated_at: string
  deleted_at: string | null
}

export interface GameEventUpsertParams {
  p_id: string
  p_game_id: string
  p_sport_id: string
  p_event_type: string
  p_schema_version: number
  p_stream_sequence: number
  p_revision: number
  p_period_id: string
  p_period_order: number
  p_elapsed_ms: number | null
  p_occurred_at: string
  p_team_side: string
  p_location: unknown
  p_actors: GameEventActor[]
  p_payload: JsonObject
  p_event_created_at: string
  p_event_updated_at: string
  p_deleted_at: string | null
}

export type GameEventCloudWriteStatus =
  | 'applied'
  | 'idempotent'
  | 'stale'
  | 'conflict'

export type SerializeGameEventResult =
  | { ok: true; params: GameEventUpsertParams }
  | { ok: false; diagnostic: GameEventDiagnostic }

export type GameEventCloudWriteResult =
  | { ok: true; status: 'applied' | 'idempotent' }
  | { ok: false; status: 'stale' | 'conflict' | 'mapping_error' | 'cloud_error'; error: string }

export interface GameEventCloudLoadResult<TEvent extends GameEvent = GameEvent> {
  ok: boolean
  eventStream: GameEventStream
  inspection: GameEventInspection<TEvent>
  quarantinedRows: unknown[]
  error: string | null
}

export function serializeGameEventForCloud(
  gameId: string,
  recorderUserId: string,
  event: GameEvent,
  localToCloudPlayerId: Record<string, string>
): SerializeGameEventResult {
  const rawEvent: unknown = event
  if (!isGameEventEnvelope(rawEvent)) {
    return {
      ok: false,
      diagnostic: {
        code: 'invalid_envelope',
        message: 'The local event envelope is invalid.',
        eventId:
          isPlainObject(rawEvent) && typeof rawEvent.id === 'string' ? rawEvent.id : null,
      },
    }
  }
  if (event.recorderUserId !== null && event.recorderUserId !== recorderUserId) {
    return {
      ok: false,
      diagnostic: {
        code: 'validation_failed',
        message: 'The event belongs to a different recorder.',
        eventId: event.id,
      },
    }
  }

  const actors: GameEventActor[] = []
  for (const actor of event.actors) {
    if (actor.kind !== 'player') {
      actors.push(structuredClone(actor))
      continue
    }
    const cloudPlayerId = localToCloudPlayerId[actor.playerId]
    if (!cloudPlayerId) {
      return {
        ok: false,
        diagnostic: {
          code: 'unmapped_player',
          message: `Player ${actor.playerId} has no cloud roster mapping.`,
          eventId: event.id,
        },
      }
    }
    actors.push({ ...actor, playerId: cloudPlayerId })
  }

  return {
    ok: true,
    params: {
      p_id: event.id,
      p_game_id: gameId,
      p_sport_id: event.sportId,
      p_event_type: event.eventType,
      p_schema_version: event.schemaVersion,
      p_stream_sequence: event.sequence,
      p_revision: event.revision,
      p_period_id: event.period.id,
      p_period_order: event.period.order,
      p_elapsed_ms: event.elapsedMs,
      p_occurred_at: event.occurredAt,
      p_team_side: event.teamSide,
      p_location: event.location,
      p_actors: actors,
      p_payload: event.payload,
      p_event_created_at: event.createdAt,
      p_event_updated_at: event.updatedAt,
      p_deleted_at: event.deletedAt,
    },
  }
}

export async function upsertGameEventForRecorder(
  gameId: string,
  recorderUserId: string,
  event: GameEvent,
  localToCloudPlayerId: Record<string, string>
): Promise<GameEventCloudWriteResult> {
  const serialized = serializeGameEventForCloud(
    gameId,
    recorderUserId,
    event,
    localToCloudPlayerId
  )
  if (!serialized.ok) {
    return {
      ok: false,
      status: 'mapping_error',
      error: serialized.diagnostic.message,
    }
  }
  if (!supabase) {
    return { ok: false, status: 'cloud_error', error: 'Supabase not configured' }
  }

  const { data, error } = await supabase.rpc(
    'upsert_game_event_revisioned',
    serialized.params
  )
  if (error) return { ok: false, status: 'cloud_error', error: error.message }
  if (data === 'applied' || data === 'idempotent') return { ok: true, status: data }
  if (data === 'stale' || data === 'conflict') {
    return { ok: false, status: data, error: `Cloud event write was ${data}.` }
  }
  return { ok: false, status: 'cloud_error', error: 'Unexpected cloud event write result.' }
}

export function deserializeGameEventFromCloud(
  rawRow: unknown,
  cloudToLocalPlayerId: Record<string, string>
):
  | { ok: true; event: GameEvent }
  | { ok: false; diagnostic: GameEventDiagnostic; rawRow: unknown } {
  if (!isPlainObject(rawRow)) return invalidCloudRow(rawRow, null, 'Cloud event row is not an object.')

  const actorsRaw = rawRow.actors
  if (!Array.isArray(actorsRaw)) {
    return invalidCloudRow(rawRow, stringOrNull(rawRow.id), 'Cloud event actors are not an array.')
  }

  const actors: unknown[] = []
  for (const actor of actorsRaw) {
    if (!isPlainObject(actor)) {
      return invalidCloudRow(rawRow, stringOrNull(rawRow.id), 'Cloud event actor is invalid.')
    }
    if (actor.kind !== 'player') {
      actors.push(structuredClone(actor))
      continue
    }
    const cloudPlayerId = stringOrNull(actor.playerId)
    const localPlayerId = cloudPlayerId ? cloudToLocalPlayerId[cloudPlayerId] : undefined
    if (!localPlayerId) {
      return {
        ok: false,
        rawRow,
        diagnostic: {
          code: 'unmapped_player',
          message: `Cloud player ${cloudPlayerId ?? 'unknown'} has no local roster mapping.`,
          eventId: stringOrNull(rawRow.id),
        },
      }
    }
    actors.push({ ...actor, playerId: localPlayerId })
  }

  const event = {
    id: rawRow.id,
    sportId: rawRow.sport_id,
    eventType: rawRow.event_type,
    schemaVersion: numberOrOriginal(rawRow.schema_version),
    recorderUserId: rawRow.recorded_by,
    sequence: numberOrOriginal(rawRow.stream_sequence),
    revision: numberOrOriginal(rawRow.revision),
    period: {
      id: rawRow.period_id,
      order: numberOrOriginal(rawRow.period_order),
    },
    elapsedMs:
      rawRow.elapsed_ms === null ? null : numberOrOriginal(rawRow.elapsed_ms),
    occurredAt: rawRow.occurred_at,
    teamSide: rawRow.team_side,
    location: rawRow.location,
    actors,
    payload: rawRow.payload,
    createdAt: rawRow.event_created_at,
    updatedAt: rawRow.event_updated_at,
    deletedAt: rawRow.deleted_at,
  }

  if (!isGameEventEnvelope(event)) {
    return invalidCloudRow(rawRow, stringOrNull(rawRow.id), 'Cloud row does not form a valid event envelope.')
  }
  return { ok: true, event }
}

export async function loadGameEventStreamForRecorder<TEvent extends GameEvent>(
  gameId: string,
  recorderUserId: string,
  cloudToLocalPlayerId: Record<string, string>,
  registry: GameEventRegistry<TEvent>
): Promise<GameEventCloudLoadResult<TEvent>> {
  const emptyStream: GameEventStream = { version: GAME_EVENT_STREAM_VERSION, events: [] }
  const emptyInspection = inspectGameEventStream(emptyStream, registry)
  if (!supabase) {
    return {
      ok: false,
      eventStream: emptyStream,
      inspection: emptyInspection,
      quarantinedRows: [],
      error: 'Supabase not configured',
    }
  }

  const { data, error } = await supabase
    .from('game_events')
    .select('*')
    .eq('game_id', gameId)
    .eq('recorded_by', recorderUserId)

  if (error) {
    return {
      ok: false,
      eventStream: emptyStream,
      inspection: emptyInspection,
      quarantinedRows: [],
      error: error.message,
    }
  }

  const events: GameEvent[] = []
  const quarantinedRows: unknown[] = []
  const transportDiagnostics: GameEventDiagnostic[] = []
  for (const row of data ?? []) {
    if (
      !isPlainObject(row) ||
      row.game_id !== gameId ||
      row.recorded_by !== recorderUserId
    ) {
      quarantinedRows.push(row)
      transportDiagnostics.push({
        code: 'invalid_cloud_row',
        message: 'Cloud event row does not belong to the requested recorder stream.',
        eventId: isPlainObject(row) ? stringOrNull(row.id) : null,
      })
      continue
    }
    const mapped = deserializeGameEventFromCloud(row, cloudToLocalPlayerId)
    if (mapped.ok) events.push(mapped.event)
    else {
      quarantinedRows.push(mapped.rawRow)
      transportDiagnostics.push(mapped.diagnostic)
    }
  }

  const eventStream: GameEventStream = {
    version: GAME_EVENT_STREAM_VERSION,
    events,
  }
  const inspected = inspectGameEventStream(eventStream, registry)
  const inspection: GameEventInspection<TEvent> = {
    ...inspected,
    complete: inspected.complete && transportDiagnostics.length === 0,
    diagnostics: [...transportDiagnostics, ...inspected.diagnostics],
  }
  return {
    ok: true,
    eventStream,
    inspection,
    quarantinedRows,
    error: null,
  }
}

function invalidCloudRow(
  rawRow: unknown,
  eventId: string | null,
  message: string
): { ok: false; diagnostic: GameEventDiagnostic; rawRow: unknown } {
  return {
    ok: false,
    rawRow,
    diagnostic: { code: 'invalid_cloud_row', message, eventId },
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrOriginal(value: unknown): number | unknown {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : value.toString()
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : value
  }
  return value
}
