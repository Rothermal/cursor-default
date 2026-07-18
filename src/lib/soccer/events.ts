import { isPlainObject } from '../gameEvents/envelope'
import type {
  GameEvent,
  GameEventActor,
  GameEventLocation,
  GameEventPeriod,
  GameEventTeamSide,
  JsonObject,
} from '../gameEvents/types'
import type { GameEventDefinition } from '../gameEvents/registry'
import { validateSoccerMatchRules, validateSoccerRole } from './rules'
import { isSoccerMatchParticipant } from './state'
import type {
  SoccerAttackingDirectionChangedPayload,
  SoccerClockAdjustedPayload,
  SoccerClockPausedPayload,
  SoccerClockStartedPayload,
  SoccerMatchEndedPayload,
  SoccerMatchEvent,
  SoccerMatchReopenedPayload,
  SoccerMatchRosterAddedPayload,
  SoccerMatchRulesChangedPayload,
  SoccerOpeningLineupPayload,
  SoccerOwnGoalPayload,
  SoccerParticipantResolvedPayload,
  SoccerPeriodPayload,
  SoccerRoleChangedPayload,
  SoccerScoreAdjustmentPayload,
  SoccerShotPayload,
  SoccerSubstitutionWindowPayload,
} from './types'
import { createSoccerUuid } from './id'
import { SOCCER_EVENT_SCHEMA_VERSION } from './types'

export type SoccerEventPayloadByType = {
  'soccer.opening_lineup': SoccerOpeningLineupPayload
  'soccer.period_started': SoccerPeriodPayload
  'soccer.period_ended': SoccerPeriodPayload
  'soccer.clock_started': SoccerClockStartedPayload
  'soccer.clock_paused': SoccerClockPausedPayload
  'soccer.clock_adjusted': SoccerClockAdjustedPayload
  'soccer.match_rules_changed': SoccerMatchRulesChangedPayload
  'soccer.substitution_window': SoccerSubstitutionWindowPayload
  'soccer.role_changed': SoccerRoleChangedPayload
  'soccer.attacking_direction_changed': SoccerAttackingDirectionChangedPayload
  'soccer.match_roster_added': SoccerMatchRosterAddedPayload
  'soccer.participant_resolved': SoccerParticipantResolvedPayload
  'soccer.match_ended': SoccerMatchEndedPayload
  'soccer.match_reopened': SoccerMatchReopenedPayload
  'soccer.shot': SoccerShotPayload
  'soccer.own_goal': SoccerOwnGoalPayload
  'soccer.score_adjustment': SoccerScoreAdjustmentPayload
}

export interface CreateSoccerEventInput<TType extends keyof SoccerEventPayloadByType> {
  id?: string
  eventType: TType
  payload: SoccerEventPayloadByType[TType]
  recorderUserId: string | null
  sequence: number
  period: GameEventPeriod
  elapsedMs: number | null
  occurredAt: string
  teamSide?: GameEventTeamSide
  location?: GameEventLocation | null
  actors?: GameEventActor[]
}

export function createSoccerEvent<TType extends keyof SoccerEventPayloadByType>(
  input: CreateSoccerEventInput<TType>
): Extract<SoccerMatchEvent, { eventType: TType }> {
  return {
    id: input.id ?? createSoccerUuid(),
    sportId: 'soccer',
    eventType: input.eventType,
    schemaVersion: SOCCER_EVENT_SCHEMA_VERSION,
    recorderUserId: input.recorderUserId,
    sequence: input.sequence,
    period: input.period,
    elapsedMs: input.elapsedMs,
    occurredAt: input.occurredAt,
    teamSide: input.teamSide ?? 'tracked',
    location: input.location ?? null,
    actors: input.actors ?? [],
    payload: input.payload,
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as Extract<SoccerMatchEvent, { eventType: TType }>
}

export function nextSoccerEventSequence(
  events: unknown[],
  recorderUserId: string | null
): number {
  return events.reduce<number>((highest, value) => {
    if (!isPlainObject(value) || value.recorderUserId !== recorderUserId) return highest
    return typeof value.sequence === 'number' && Number.isInteger(value.sequence)
      ? Math.max(highest, value.sequence)
      : highest
  }, -1) + 1
}

export const soccerEventDefinitions: GameEventDefinition<GameEvent>[] = [
  matchStateDefinition('soccer.opening_lineup', validateOpeningLineup),
  matchStateDefinition('soccer.period_started', validatePeriod),
  matchStateDefinition('soccer.period_ended', validatePeriod),
  matchStateDefinition('soccer.clock_started', validateClockStarted),
  matchStateDefinition('soccer.clock_paused', validateClockPaused),
  matchStateDefinition('soccer.clock_adjusted', validateClockAdjusted),
  matchStateDefinition('soccer.match_rules_changed', validateRulesChanged),
  matchStateDefinition('soccer.substitution_window', validateSubstitutionWindow),
  matchStateDefinition('soccer.role_changed', validateRoleChanged),
  matchStateDefinition('soccer.attacking_direction_changed', validateDirectionChanged),
  matchStateDefinition('soccer.match_roster_added', validateRosterAdded),
  matchStateDefinition('soccer.participant_resolved', validateParticipantResolved),
  matchStateDefinition('soccer.match_ended', validateMatchEnded),
  matchStateDefinition('soccer.match_reopened', validateMatchReopened),
  attackingDefinition('soccer.shot', validateShot, ['shooter', 'creator_primary', 'creator_secondary', 'goalkeeper', 'blocker']),
  attackingDefinition('soccer.own_goal', validateOwnGoal, ['own_goal_by', 'goalkeeper']),
  attackingDefinition('soccer.score_adjustment', validateScoreAdjustment, []),
]

function matchStateDefinition(
  eventType: keyof SoccerEventPayloadByType,
  validatePayload: (payload: JsonObject) => boolean
): GameEventDefinition<GameEvent> {
  return {
    sportId: 'soccer',
    eventType,
    currentSchemaVersion: SOCCER_EVENT_SCHEMA_VERSION,
    validate: event => {
      if (
        event.sportId !== 'soccer' ||
        event.eventType !== eventType ||
        event.schemaVersion !== SOCCER_EVENT_SCHEMA_VERSION ||
        event.teamSide !== 'tracked' ||
        event.location !== null ||
        event.actors.length !== 0 ||
        !validatePayload(event.payload)
      ) {
        return { ok: false, message: `${eventType} has an invalid soccer payload.` }
      }
      return { ok: true, event }
    },
  }
}

function attackingDefinition(
  eventType: 'soccer.shot' | 'soccer.own_goal' | 'soccer.score_adjustment',
  validatePayload: (payload: JsonObject) => boolean,
  allowedRoles: string[]
): GameEventDefinition<GameEvent> {
  return {
    sportId: 'soccer',
    eventType,
    currentSchemaVersion: SOCCER_EVENT_SCHEMA_VERSION,
    validate: event => {
      const roles = event.actors.map(actor => actor.role)
      const validActors = roles.every(role => allowedRoles.includes(role)) &&
        new Set(roles).size === roles.length
      const locationIsAllowed = eventType !== 'soccer.score_adjustment'
        ? true
        : event.location === null
      if (
        event.sportId !== 'soccer' ||
        event.eventType !== eventType ||
        event.schemaVersion !== SOCCER_EVENT_SCHEMA_VERSION ||
        event.elapsedMs === null ||
        !validActors ||
        !locationIsAllowed ||
        !validatePayload(event.payload)
      ) {
        return { ok: false, message: `${eventType} has an invalid soccer payload.` }
      }
      return { ok: true, event }
    },
  }
}

function validateOpeningLineup(payload: JsonObject): boolean {
  return Array.isArray(payload.starters) && payload.starters.length > 0 && payload.starters.every(
    entry => isPlainObject(entry) && isId(entry.participantId) && validateSoccerRole(entry.role)
  )
}

function validatePeriod(payload: JsonObject): boolean {
  return isId(payload.periodId)
}

function validateClockStarted(payload: JsonObject): boolean {
  return isNonNegativeInteger(payload.anchorElapsedMs)
}

function validateClockPaused(payload: JsonObject): boolean {
  return isNonNegativeInteger(payload.elapsedMs)
}

function validateClockAdjusted(payload: JsonObject): boolean {
  return isNonNegativeInteger(payload.fromElapsedMs) && isNonNegativeInteger(payload.toElapsedMs)
}

function validateRulesChanged(payload: JsonObject): boolean {
  return validateSoccerMatchRules(payload.rules) === null
}

function validateSubstitutionWindow(payload: JsonObject): boolean {
  return Boolean(
    Array.isArray(payload.changes) &&
      payload.changes.length > 0 &&
      typeof payload.halftime === 'boolean' &&
      payload.changes.every(change => {
        if (!isPlainObject(change)) return false
        const out = change.playerOutParticipantId
        const incoming = change.playerInParticipantId
        if ((out !== null && !isId(out)) || (incoming !== null && !isId(incoming))) return false
        if (out === null && incoming === null) return false
        if (out !== null && out === incoming) return false
        return change.playerInRole === null || validateSoccerRole(change.playerInRole)
      })
  )
}

function validateRoleChanged(payload: JsonObject): boolean {
  return Array.isArray(payload.changes) && payload.changes.length > 0 && payload.changes.every(
    change => isPlainObject(change) && isId(change.participantId) && validateSoccerRole(change.role)
  )
}

function validateDirectionChanged(payload: JsonObject): boolean {
  return payload.direction === 'left_to_right' || payload.direction === 'right_to_left'
}

function validateRosterAdded(payload: JsonObject): boolean {
  return isSoccerMatchParticipant(payload.participant) &&
    (payload.destination === 'bench' || payload.destination === 'on_field')
}

function validateParticipantResolved(payload: JsonObject): boolean {
  return isId(payload.participantId) && isId(payload.playerId) && isNonEmptyString(payload.displayName) &&
    (payload.number === null || typeof payload.number === 'string')
}

function validateMatchEnded(payload: JsonObject): boolean {
  return payload.reason === 'completed' || payload.reason === 'suspended' || payload.reason === 'abandoned'
}

function validateMatchReopened(payload: JsonObject): boolean {
  return payload.reason === null || typeof payload.reason === 'string'
}

function validateShot(payload: JsonObject): boolean {
  return ['goal', 'saved', 'blocked', 'off_target', 'woodwork'].includes(String(payload.outcome)) &&
    ['open_play', 'penalty', 'direct_free_kick', 'corner_sequence', 'other_set_piece']
      .includes(String(payload.situation))
}

function validateOwnGoal(payload: JsonObject): boolean {
  return Object.keys(payload).length === 0
}

function validateScoreAdjustment(payload: JsonObject): boolean {
  return (payload.delta === 1 || payload.delta === -1) && isNonEmptyString(payload.reason)
}

function isId(value: unknown): value is string {
  return isNonEmptyString(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}
