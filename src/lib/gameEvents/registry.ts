import { cloneEvent, eventIdFromUnknown, isGameEventEnvelope } from './envelope'
import type { GameEvent, GameEventDiagnostic, GameEventTeamSide } from './types'

const DEFAULT_ALLOWED_TEAM_SIDES: readonly GameEventTeamSide[] = ['tracked', 'opponent']

export type GameEventValidationResult<TEvent extends GameEvent> =
  | { ok: true; event: TEvent }
  | { ok: false; message: string }

export interface GameEventDefinition<TEvent extends GameEvent = GameEvent> {
  sportId: TEvent['sportId']
  eventType: TEvent['eventType']
  currentSchemaVersion: number
  /** Omitted definitions retain the pre-neutral tracked/opponent contract. */
  allowedTeamSides?: readonly GameEventTeamSide[]
  /** A migration at key N converts schema N to N + 1. */
  migrations?: Record<number, (event: GameEvent) => GameEvent>
  validate: (event: GameEvent) => GameEventValidationResult<TEvent>
}

export type RegistryEventResult<TEvent extends GameEvent> =
  | { ok: true; event: TEvent }
  | { ok: false; diagnostic: GameEventDiagnostic }

export class GameEventRegistry<TEvent extends GameEvent = GameEvent> {
  private readonly definitions = new Map<string, GameEventDefinition<TEvent>>()

  constructor(definitions: GameEventDefinition<TEvent>[] = []) {
    definitions.forEach(definition => this.register(definition))
  }

  register(definition: GameEventDefinition<TEvent>): void {
    const key = this.key(definition.sportId, definition.eventType)
    if (this.definitions.has(key)) {
      throw new Error(`Duplicate game event definition: ${key}`)
    }
    if (!Number.isInteger(definition.currentSchemaVersion) || definition.currentSchemaVersion < 1) {
      throw new Error(`Invalid current schema version for ${key}`)
    }
    this.definitions.set(key, definition)
  }

  inspect(raw: unknown): RegistryEventResult<TEvent> {
    if (!isGameEventEnvelope(raw)) {
      return {
        ok: false,
        diagnostic: {
          code: 'invalid_envelope',
          message: 'Event does not match the generic envelope.',
          eventId: eventIdFromUnknown(raw),
        },
      }
    }

    const definition = this.definitions.get(this.key(raw.sportId, raw.eventType))
    if (!definition) {
      return {
        ok: false,
        diagnostic: {
          code: 'unknown_event_type',
          message: `No event definition is registered for ${raw.sportId}/${raw.eventType}.`,
          eventId: raw.id,
        },
      }
    }

    if (raw.schemaVersion > definition.currentSchemaVersion) {
      return {
        ok: false,
        diagnostic: {
          code: 'unsupported_schema_version',
          message: `Event schema ${raw.schemaVersion} is newer than supported schema ${definition.currentSchemaVersion}.`,
          eventId: raw.id,
        },
      }
    }

    let migrated: GameEvent = cloneEvent(raw)
    try {
      while (migrated.schemaVersion < definition.currentSchemaVersion) {
        const previousVersion = migrated.schemaVersion
        const migrate = definition.migrations?.[migrated.schemaVersion]
        if (!migrate) {
          return {
            ok: false,
            diagnostic: {
              code: 'unsupported_schema_version',
              message: `No migration exists from schema ${migrated.schemaVersion}.`,
              eventId: raw.id,
            },
          }
        }
        migrated = migrate(cloneEvent(migrated))
        if (!isGameEventEnvelope(migrated)) {
          throw new Error('Migration produced an invalid event envelope.')
        }
        if (migrated.schemaVersion <= previousVersion) {
          throw new Error('Migration did not advance the schema version.')
        }
      }
    } catch (error) {
      return {
        ok: false,
        diagnostic: {
          code: 'migration_failed',
          message: error instanceof Error ? error.message : 'Event migration failed.',
          eventId: raw.id,
        },
      }
    }

    const allowedTeamSides = definition.allowedTeamSides ?? DEFAULT_ALLOWED_TEAM_SIDES
    if (!allowedTeamSides.includes(migrated.teamSide)) {
      return {
        ok: false,
        diagnostic: {
          code: 'validation_failed',
          message: `Team side ${migrated.teamSide} is not allowed for ${raw.sportId}/${raw.eventType}.`,
          eventId: raw.id,
        },
      }
    }

    const validated = definition.validate(migrated)
    if (!validated.ok) {
      return {
        ok: false,
        diagnostic: {
          code: 'validation_failed',
          message: validated.message,
          eventId: raw.id,
        },
      }
    }
    return validated
  }

  private key(sportId: string, eventType: string): string {
    return `${sportId}\u0000${eventType}`
  }
}
