import type { GameState, ShotRecord } from '../../types'

export const GAME_EVENT_STREAM_VERSION = 1

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type GameEventTeamSide = 'tracked' | 'opponent'
export type GameEventActorKind = 'player' | 'staff' | 'team' | 'unknown'

interface GameEventActorBase {
  role: string
  kind: GameEventActorKind
  label?: string
}

export interface GameEventPlayerActor extends GameEventActorBase {
  kind: 'player'
  /** Local player id in persisted game state; mapped at the cloud boundary. */
  playerId: string
}

export interface GameEventLabelActor extends GameEventActorBase {
  kind: 'staff' | 'team' | 'unknown'
  label: string
}

export type GameEventActor = GameEventPlayerActor | GameEventLabelActor

export interface GameEventPeriod {
  /** Sport-owned stable segment id, such as `regulation-1` or `shootout`. */
  id: string
  /** Canonical ordering value supplied by the sport's match model. */
  order: number
}

export interface GameEventLocation {
  /** Normalized coordinates in the inclusive 0..1 range. */
  x: number
  y: number
  attackingDirection: 'left_to_right' | 'right_to_left' | 'unknown'
}

export interface GameEvent<
  TPayload extends JsonObject = JsonObject,
  TEventType extends string = string,
  TSportId extends string = string,
> {
  id: string
  sportId: TSportId
  eventType: TEventType
  schemaVersion: number
  recorderUserId: string | null
  sequence: number
  period: GameEventPeriod
  elapsedMs: number | null
  occurredAt: string
  teamSide: GameEventTeamSide
  location: GameEventLocation | null
  actors: GameEventActor[]
  payload: TPayload
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** Raw entries stay unknown so malformed/future values can round-trip without data loss. */
export interface GameEventStream {
  version: number
  events: unknown[]
}

export type GameEventDiagnosticCode =
  | 'invalid_stream'
  | 'invalid_envelope'
  | 'unknown_event_type'
  | 'unsupported_schema_version'
  | 'migration_failed'
  | 'validation_failed'
  | 'missing_projector'
  | 'unmapped_player'
  | 'invalid_cloud_row'

export interface GameEventDiagnostic {
  code: GameEventDiagnosticCode
  message: string
  eventId: string | null
  eventIndex?: number
}

export interface GameEventInspection<TEvent extends GameEvent = GameEvent> {
  complete: boolean
  activeEvents: TEvent[]
  deletedEvents: TEvent[]
  diagnostics: GameEventDiagnostic[]
}

export interface GameEventProjection {
  playerStatsById: Record<string, Record<string, number>>
  opponentScore: number
  homeTeamScore: number | null
  shotChart: ShotRecord[]
}

export interface SportGameEventProjector<TEvent extends GameEvent = GameEvent> {
  sportId: string
  project: (state: GameState, events: TEvent[]) => GameEventProjection
}

export type GameEventEditableFields = Pick<
  GameEvent,
  'period' | 'elapsedMs' | 'occurredAt' | 'teamSide' | 'location' | 'actors' | 'payload'
>

export type GameEventMutationErrorCode =
  | 'legacy_activity_present'
  | 'stream_not_initialized'
  | 'event_not_found'
  | 'duplicate_event_id'
  | 'invalid_event'
  | 'sport_mismatch'
  | 'already_deleted'
  | 'not_deleted'

export interface GameEventMutationError {
  code: GameEventMutationErrorCode
  message: string
}

export type GameEventMutationResult =
  | { ok: true; state: GameState; inspection: GameEventInspection }
  | { ok: false; state: GameState; error: GameEventMutationError }
