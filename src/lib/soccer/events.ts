import { isPlainObject } from '../gameEvents/envelope'
import type {
  GameEvent,
  GameEventActor,
  GameEventLocation,
  GameEventPeriod,
  JsonObject,
} from '../gameEvents/types'
import type { GameEventDefinition } from '../gameEvents/registry'
import { normalizeSoccerMatchRules, validateSoccerMatchRules, validateSoccerRole } from './rules'
import { isSoccerMatchParticipant } from './state'
import type {
  SoccerAttackingDirectionChangedPayload,
  SoccerClockAdjustedPayload,
  SoccerClockPausedPayload,
  SoccerClockStartedPayload,
  SoccerCardPayload,
  SoccerDefensiveActionPayload,
  SoccerFoulPayload,
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
  SoccerShootoutEligibilityChangedPayload,
  SoccerShootoutGoalkeeperChangedPayload,
  SoccerShootoutKickPayload,
  SoccerShootoutStartedPayload,
  SoccerSubstitutionWindowPayload,
  SoccerTeamEventPayload,
  SoccerTeamSide,
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
  'soccer.defensive_action': SoccerDefensiveActionPayload
  'soccer.foul': SoccerFoulPayload
  'soccer.card': SoccerCardPayload
  'soccer.team_event': SoccerTeamEventPayload
  'soccer.shootout_started': SoccerShootoutStartedPayload
  'soccer.shootout_eligibility_changed': SoccerShootoutEligibilityChangedPayload
  'soccer.shootout_goalkeeper_changed': SoccerShootoutGoalkeeperChangedPayload
  'soccer.shootout_kick': SoccerShootoutKickPayload
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
  teamSide?: SoccerTeamSide
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
  attackingDefinition(
    'soccer.shot',
    validateShot,
    ['shooter', 'creator_primary', 'creator_secondary', 'goalkeeper', 'blocker'],
    ['shooter']
  ),
  attackingDefinition(
    'soccer.own_goal',
    validateOwnGoal,
    ['own_goal_by', 'goalkeeper'],
    ['own_goal_by']
  ),
  attackingDefinition('soccer.score_adjustment', validateScoreAdjustment, [], []),
  incidentDefinition('soccer.defensive_action', validateDefensiveAction, ['defender'], ['defender']),
  incidentDefinition('soccer.foul', validateFoul, ['committed_by', 'fouled'], ['committed_by']),
  incidentDefinition('soccer.card', validateCard, ['recipient'], ['recipient'], true),
  incidentDefinition('soccer.team_event', validateTeamEvent, ['offside_player'], []),
  shootoutDefinition('soccer.shootout_started', validateShootoutStarted, [], []),
  shootoutDefinition(
    'soccer.shootout_eligibility_changed',
    validateShootoutEligibilityChanged,
    ['affected', 'replacement'],
    []
  ),
  shootoutDefinition(
    'soccer.shootout_goalkeeper_changed',
    validateShootoutGoalkeeperChanged,
    ['goalkeeper_out', 'goalkeeper_in'],
    ['goalkeeper_out', 'goalkeeper_in']
  ),
  shootoutDefinition(
    'soccer.shootout_kick',
    validateShootoutKick,
    ['kicker', 'goalkeeper'],
    ['kicker', 'goalkeeper']
  ),
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
  allowedRoles: string[],
  requiredRoles: string[]
): GameEventDefinition<GameEvent> {
  return {
    sportId: 'soccer',
    eventType,
    currentSchemaVersion: SOCCER_EVENT_SCHEMA_VERSION,
    validate: event => {
      const roles = event.actors.map(actor => actor.role)
      const validActors = roles.every(role => allowedRoles.includes(role)) &&
        requiredRoles.every(role => roles.includes(role)) &&
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

function incidentDefinition(
  eventType: 'soccer.defensive_action' | 'soccer.foul' | 'soccer.card' | 'soccer.team_event',
  validatePayload: (payload: JsonObject) => boolean,
  allowedRoles: string[],
  requiredRoles: string[],
  allowShootout = false
): GameEventDefinition<GameEvent> {
  return {
    sportId: 'soccer',
    eventType,
    currentSchemaVersion: SOCCER_EVENT_SCHEMA_VERSION,
    validate: event => {
      const shootoutMoment = event.period.id === 'shootout' && event.elapsedMs === null
      const normalMoment = event.period.id !== 'shootout' && event.elapsedMs !== null
      const validKinds = event.actors.every(actor =>
        eventType === 'soccer.card' || actor.kind !== 'staff'
      )
      const validTeamEventActors = eventType !== 'soccer.team_event' ||
        event.payload.kind === 'offside' ||
        event.actors.length === 0
      if (
        event.sportId !== 'soccer' ||
        event.eventType !== eventType ||
        event.schemaVersion !== SOCCER_EVENT_SCHEMA_VERSION ||
        (!normalMoment && !(allowShootout && shootoutMoment)) ||
        (shootoutMoment && event.location !== null) ||
        !actorsHaveRoles(event.actors, allowedRoles, requiredRoles) ||
        !validKinds ||
        !validTeamEventActors ||
        !validatePayload(event.payload)
      ) {
        return { ok: false, message: `${eventType} has an invalid soccer payload.` }
      }
      return { ok: true, event }
    },
  }
}

function shootoutDefinition(
  eventType:
    | 'soccer.shootout_started'
    | 'soccer.shootout_eligibility_changed'
    | 'soccer.shootout_goalkeeper_changed'
    | 'soccer.shootout_kick',
  validatePayload: (payload: JsonObject) => boolean,
  allowedRoles: string[],
  requiredRoles: string[]
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
        event.period.id !== 'shootout' ||
        event.elapsedMs !== null ||
        event.location !== null ||
        !actorsHaveRoles(event.actors, allowedRoles, requiredRoles) ||
        !event.actors.every(actor => {
          if (actor.role === 'goalkeeper' || actor.role === 'goalkeeper_out' || actor.role === 'goalkeeper_in') {
            return actor.kind === 'player' || actor.kind === 'unknown'
          }
          if (actor.role === 'kicker') return actor.kind !== 'staff'
          return actor.kind === 'player' || actor.kind === 'unknown'
        }) ||
        !validatePayload(event.payload)
      ) {
        return { ok: false, message: `${eventType} has an invalid soccer payload.` }
      }
      return { ok: true, event }
    },
  }
}

function actorsHaveRoles(
  actors: GameEventActor[],
  allowedRoles: string[],
  requiredRoles: string[]
): boolean {
  const roles = actors.map(actor => actor.role)
  return roles.every(role => allowedRoles.includes(role)) &&
    requiredRoles.every(role => roles.includes(role)) &&
    new Set(roles).size === roles.length
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
  return normalizeSoccerMatchRules(payload.rules) !== null || validateSoccerMatchRules(payload.rules) === null
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
      .includes(String(payload.situation)) &&
    (payload.sourceEventId === undefined || payload.sourceEventId === null || isId(payload.sourceEventId))
}

function validateOwnGoal(payload: JsonObject): boolean {
  return Object.keys(payload).length === 0
}

function validateScoreAdjustment(payload: JsonObject): boolean {
  return (payload.delta === 1 || payload.delta === -1) && isNonEmptyString(payload.reason)
}

const DISCIPLINE_REASONS = [
  'dissent',
  'unsporting_behavior',
  'persistent_offenses',
  'delaying_restart',
  'failure_to_respect_distance',
  'unauthorized_entry_exit',
  'serious_foul_play',
  'violent_conduct',
  'dogso',
  'abusive_language',
  'second_caution',
  'other_not_recorded',
]

function validateDefensiveAction(payload: JsonObject): boolean {
  if (!['tackle', 'interception', 'clearance', 'recovery'].includes(String(payload.action))) {
    return false
  }
  return payload.action === 'tackle'
    ? payload.tackleOutcome === 'won' || payload.tackleOutcome === 'lost'
    : payload.tackleOutcome === null
}

function validateFoul(payload: JsonObject): boolean {
  const sanction = String(payload.sanction)
  const reason = payload.sanctionReason
  return ['direct_free_kick', 'indirect_free_kick', 'penalty', 'advantage', 'none']
    .includes(String(payload.restart)) &&
    ['none', 'yellow', 'straight_red', 'second_yellow_red'].includes(sanction) &&
    (sanction === 'none' ? reason === null : isDisciplineReason(reason)) &&
    (sanction !== 'second_yellow_red' || reason === 'second_caution') &&
    isNullableTrimmedString(payload.note) &&
    (payload.lineupResolution === null || validateDisciplineLineupResolution(payload.lineupResolution))
}

function validateCard(payload: JsonObject): boolean {
  return ['yellow', 'straight_red', 'second_yellow_red'].includes(String(payload.sanction)) &&
    isDisciplineReason(payload.reason) &&
    (payload.sanction !== 'second_yellow_red' || payload.reason === 'second_caution') &&
    isNullableTrimmedString(payload.note) &&
    (payload.lineupResolution === null || validateDisciplineLineupResolution(payload.lineupResolution))
}

function validateTeamEvent(payload: JsonObject): boolean {
  return payload.kind === 'corner' || payload.kind === 'offside'
}

function validateDisciplineLineupResolution(value: unknown): boolean {
  if (!isPlainObject(value) || !isId(value.cardedParticipantId)) return false
  if (!['none', 'temporary', 'ejected'].includes(String(value.exit))) return false
  if (typeof value.countsAsSubstitutionWindow !== 'boolean') return false
  return Array.isArray(value.replacementChanges) && value.replacementChanges.every(change => {
    if (!isPlainObject(change)) return false
    const outgoing = change.playerOutParticipantId
    const incoming = change.playerInParticipantId
    return (outgoing === null || isId(outgoing)) &&
      (incoming === null || isId(incoming)) &&
      !(outgoing === null && incoming === null) &&
      outgoing !== incoming &&
      (change.playerInRole === null || validateSoccerRole(change.playerInRole))
  })
}

function validateShootoutStarted(payload: JsonObject): boolean {
  const eligible = payload.trackedEligibleParticipantIds
  const excluded = payload.trackedExcludedParticipantIds
  if (!uniqueIdArray(eligible) || !uniqueIdArray(excluded)) return false
  return (payload.firstKickingSide === 'tracked' || payload.firstKickingSide === 'opponent') &&
    isPositiveInteger(payload.initialKicksPerSide) &&
    !eligible.some(id => excluded.includes(id)) &&
    isPositiveInteger(payload.opponentEligibleCount) &&
    isId(payload.trackedGoalkeeperParticipantId)
}

function validateShootoutEligibilityChanged(payload: JsonObject): boolean {
  const eligible = payload.trackedEligibleParticipantIds
  const excluded = payload.trackedExcludedParticipantIds
  if (!uniqueIdArray(eligible) || !uniqueIdArray(excluded)) return false
  return ['equalization', 'sent_off', 'unable_to_continue', 'goalkeeper_replacement']
    .includes(String(payload.reason)) &&
    !eligible.some(id => excluded.includes(id)) &&
    isPositiveInteger(payload.opponentEligibleCount)
}

function validateShootoutGoalkeeperChanged(payload: JsonObject): boolean {
  return ['tactical', 'unable_to_continue', 'sent_off'].includes(String(payload.reason))
}

function validateShootoutKick(payload: JsonObject): boolean {
  return ['scored', 'saved', 'missed', 'woodwork', 'retake', 'forfeited']
    .includes(String(payload.outcome)) &&
    (payload.anonymousKickerSlot === null || isPositiveInteger(payload.anonymousKickerSlot))
}

function uniqueIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isId) && new Set(value).size === value.length
}

function isDisciplineReason(value: unknown): boolean {
  return DISCIPLINE_REASONS.includes(String(value))
}

function isNullableTrimmedString(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.trim() === value && value.length > 0)
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

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}
