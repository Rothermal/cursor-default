import { isPlainObject } from '../gameEvents/envelope'
import type { GameEventDefinition } from '../gameEvents/registry'
import type { GameEvent, GameEventActor, GameEventLocation, GameEventPeriod } from '../gameEvents/types'
import { createHockeyUuid } from './id'
import { parseHockeyPeriod } from './periods'
import { HOCKEY_FACEOFF_DOT_IDS, HOCKEY_FACEOFF_DOTS, type HockeyFaceoffDotId } from './rinkGeometry'
import type { HockeyEvent, HockeyEventType, HockeyPayloadByType, HockeyShotActorRole, HockeySide } from './types'
import { HOCKEY_EMPTY_NET, HOCKEY_EVENT_SCHEMA_VERSION } from './types'

export const HOCKEY_MAX_REASON_LENGTH = 200
export const HOCKEY_MAX_LABEL_LENGTH = 80
const MAX_ID_LENGTH = 100
const MAX_ON_ICE = 7
const SHOT_ROLES: readonly HockeyShotActorRole[] = ['shooter', 'assist_primary', 'assist_secondary', 'goalie', 'blocker']
const MAX_ELAPSED_MS = 4 * 60 * 60 * 1000

export interface CreateHockeyEventInput<TType extends HockeyEventType> {
  id?: string
  eventType: TType
  payload: HockeyPayloadByType[TType]
  period: GameEventPeriod
  elapsedMs: number | null
  recorderUserId: string | null
  sequence: number
  occurredAt: string
  /** Sided capture events only; lifecycle and clock events are always neutral. */
  teamSide?: HockeySide
  location?: GameEventLocation | null
  actors?: GameEventActor[]
}

export function createHockeyEvent<TType extends HockeyEventType>(
  input: CreateHockeyEventInput<TType>
): HockeyEvent<TType> {
  return {
    id: input.id ?? createHockeyUuid(),
    sportId: 'hockey',
    eventType: input.eventType,
    schemaVersion: HOCKEY_EVENT_SCHEMA_VERSION,
    recorderUserId: input.recorderUserId,
    sequence: input.sequence,
    period: { ...input.period },
    elapsedMs: input.elapsedMs,
    occurredAt: input.occurredAt,
    teamSide: input.teamSide ?? 'neutral',
    location: input.location ? { ...input.location } : null,
    actors: structuredClone(input.actors ?? []),
    payload: structuredClone(input.payload),
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as HockeyEvent<TType>
}

type PayloadValidator = (payload: Record<string, unknown>) => string | null

/**
 * Structural checks only. Whether an event is allowed at its point in the match
 * (period order, clock state, required reasons) is decided by replay.
 */
function definition(eventType: HockeyEventType, validatePayload: PayloadValidator): GameEventDefinition<GameEvent> {
  return {
    sportId: 'hockey',
    eventType,
    currentSchemaVersion: HOCKEY_EVENT_SCHEMA_VERSION,
    allowedTeamSides: ['neutral'],
    validate: event => {
      if (event.schemaVersion !== HOCKEY_EVENT_SCHEMA_VERSION) {
        return { ok: false, message: 'Unsupported Hockey event schema version.' }
      }
      if (!parseHockeyPeriod(event.period)) {
        return { ok: false, message: 'Hockey events must name a regulation or overtime period.' }
      }
      if (event.elapsedMs !== null && !isElapsed(event.elapsedMs)) {
        return { ok: false, message: 'Hockey elapsed time must be whole milliseconds within the period.' }
      }
      if (event.location !== null) return { ok: false, message: 'Hockey lifecycle events have no rink location.' }
      if (event.actors.length > 0) return { ok: false, message: 'Hockey lifecycle events have no actors.' }
      if (!isPlainObject(event.payload)) return { ok: false, message: 'Payload must be an object.' }
      const message = validatePayload(event.payload)
      return message ? { ok: false, message } : { ok: true, event }
    },
  }
}

const reasonOnly: PayloadValidator = payload =>
  exactKeys(payload, ['captureCommandId', 'reason']) &&
  isCaptureId(payload.captureCommandId) &&
  isReason(payload.reason)
    ? null
    : 'A reason is required.'

const optionalReason: PayloadValidator = payload =>
  exactKeys(payload, ['captureCommandId', 'reason']) &&
  isCaptureId(payload.captureCommandId) &&
  (payload.reason === null || isReason(payload.reason))
    ? null
    : 'Invalid reason payload.'

export const hockeyEventDefinitions: GameEventDefinition<GameEvent>[] = [
  definition('hockey.opening_lineup', payload => {
    if (!exactKeys(payload, ['captureCommandId', 'goalieParticipantId', 'skaterParticipantIds', 'opponentGoalieId'])) {
      return 'Invalid opening lineup payload.'
    }
    if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
    if (!isId(payload.goalieParticipantId) || !isId(payload.opponentGoalieId)) return 'Invalid goalie id.'
    if (
      !Array.isArray(payload.skaterParticipantIds) ||
      payload.skaterParticipantIds.length > 6 ||
      !payload.skaterParticipantIds.every(isId)
    ) return 'Invalid skater ids.'
    return null
  }),
  definition('hockey.period_started', payload => {
    if (!exactKeys(payload, ['captureCommandId', 'kind', 'number'])) return 'Invalid period start payload.'
    if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
    if (payload.kind !== 'regulation' && payload.kind !== 'overtime') return 'Unknown period kind.'
    return isPeriodNumber(payload.number) ? null : 'Invalid period number.'
  }),
  definition('hockey.period_ended', optionalReason),
  definition('hockey.clock_started', payload =>
    exactKeys(payload, ['captureCommandId', 'anchorElapsedMs']) &&
    isCaptureId(payload.captureCommandId) &&
    isElapsed(payload.anchorElapsedMs)
      ? null
      : 'Invalid clock start payload.'
  ),
  definition('hockey.clock_paused', payload =>
    exactKeys(payload, ['captureCommandId', 'elapsedMs', 'source']) &&
    isCaptureId(payload.captureCommandId) &&
    isElapsed(payload.elapsedMs) &&
    (payload.source === 'manual' || payload.source === 'expiration')
      ? null
      : 'Invalid clock pause payload.'
  ),
  definition('hockey.clock_set', payload =>
    exactKeys(payload, ['captureCommandId', 'fromElapsedMs', 'toElapsedMs', 'reason']) &&
    isCaptureId(payload.captureCommandId) &&
    isElapsed(payload.fromElapsedMs) &&
    isElapsed(payload.toElapsedMs) &&
    isReason(payload.reason)
      ? null
      : 'Setting the clock needs a valid time and a reason.'
  ),
  definition('hockey.match_ended', optionalReason),
  definition('hockey.match_suspended', reasonOnly),
  definition('hockey.match_abandoned', reasonOnly),
  definition('hockey.match_reopened', reasonOnly),
  captureDefinition(
    'hockey.shot',
    { location: true, roles: SHOT_ROLES },
    payload => {
      if (!exactKeys(payload, ['captureCommandId', 'outcome', 'missType', 'emptyNet', 'penaltyShot', 'strength', 'onIce'])) {
        return 'Invalid shot payload.'
      }
      if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
      const outcome = payload.outcome
      if (outcome !== 'goal' && outcome !== 'saved' && outcome !== 'missed' && outcome !== 'blocked') {
        return 'Unknown shot outcome.'
      }
      if (payload.missType !== null) {
        if (outcome !== 'missed') return 'Only a missed shot has a miss type.'
        if (!['wide', 'high', 'post', 'crossbar'].includes(payload.missType as string)) return 'Unknown miss type.'
      }
      if (typeof payload.emptyNet !== 'boolean' || typeof payload.penaltyShot !== 'boolean') {
        return 'Empty net and penalty shot are true or false.'
      }
      if (payload.strength !== null && !['ev', 'pp', 'sh'].includes(payload.strength as string)) {
        return 'Unknown strength.'
      }
      if (outcome === 'goal') return validateOnIce(payload.onIce)
      return payload.onIce === null ? null : 'Only a goal records who was on the ice.'
    },
    event => {
      const payload = event.payload as { outcome: string; emptyNet: boolean }
      const roles = roleSet(event)
      if ((roles.has('assist_primary') || roles.has('assist_secondary')) && payload.outcome !== 'goal') {
        return 'Only a goal has assists.'
      }
      if ((roles.has('assist_primary') || roles.has('assist_secondary')) && !roles.has('shooter')) {
        return 'Assists need a credited scorer.'
      }
      if (roles.has('assist_secondary') && !roles.has('assist_primary')) {
        return 'A secondary assist needs a primary assist.'
      }
      if (roles.has('blocker') && payload.outcome !== 'blocked') return 'Only a blocked shot has a blocker.'
      if (roles.has('goalie') && payload.emptyNet) return 'An empty-net shot has no goalie.'
      return null
    }
  ),
  captureDefinition(
    'hockey.goalie_change',
    { location: false, roles: [] },
    payload => {
      if (!exactKeys(payload, ['captureCommandId', 'inParticipantId', 'reason', 'newOpponentGoalie'])) {
        return 'Invalid goalie change payload.'
      }
      if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
      if (payload.inParticipantId !== null && !isId(payload.inParticipantId)) return 'Invalid goalie id.'
      if (!['tactical', 'injury', 'pulled', 'return', 'penalty'].includes(payload.reason as string)) {
        return 'Unknown goalie change reason.'
      }
      if ((payload.inParticipantId === null) !== (payload.reason === 'pulled')) {
        return 'Pulling the goalie leaves the net empty; every other change names a goalie.'
      }
      const added = payload.newOpponentGoalie
      if (added !== null) {
        if (
          !isPlainObject(added) ||
          !exactKeys(added, ['id', 'label', 'number']) ||
          !isId(added.id) ||
          (added.label !== null && !isLabel(added.label)) ||
          (added.number !== null && !(typeof added.number === 'string' && added.number.trim().length > 0 && added.number.length <= 3))
        ) return 'Invalid new opponent goalie.'
        if (added.id !== payload.inParticipantId) return 'A new opponent goalie must be the goalie going in.'
      }
      return null
    },
    event => event.teamSide === 'tracked' && (event.payload as { newOpponentGoalie: unknown }).newOpponentGoalie !== null
      ? 'Only the opponent adds goalies during a game.'
      : null
  ),
  captureDefinition(
    'hockey.score_adjustment',
    { location: false, roles: [] },
    payload =>
      exactKeys(payload, ['captureCommandId', 'delta', 'reason']) &&
      isCaptureId(payload.captureCommandId) &&
      (payload.delta === 1 || payload.delta === -1) &&
      isReason(payload.reason)
        ? null
        : 'A score adjustment is plus or minus one, with a reason.'
  ),
  captureDefinition(
    'hockey.faceoff',
    { location: 'required', roles: ['taker', 'opponent_taker'], sides: ['neutral'] },
    payload => {
      if (!exactKeys(payload, ['captureCommandId', 'dotId', 'winner'])) return 'Invalid faceoff payload.'
      if (!isCaptureId(payload.captureCommandId)) return 'Invalid capture command id.'
      if (!(HOCKEY_FACEOFF_DOT_IDS as readonly unknown[]).includes(payload.dotId)) return 'Unknown faceoff dot.'
      return payload.winner === 'tracked' || payload.winner === 'opponent' ? null : 'A faceoff winner is tracked or opponent.'
    },
    event => {
      const dot = HOCKEY_FACEOFF_DOTS[(event.payload as { dotId: HockeyFaceoffDotId }).dotId]
      return event.location && event.location.x === dot.x && event.location.y === dot.y
        ? null
        : 'A faceoff is located exactly on its dot.'
    }
  ),
  captureDefinition('hockey.hit', { location: true, roles: ['hitter', 'hit_player'] }, playPayload),
  captureDefinition('hockey.takeaway', { location: true, roles: ['player'] }, playPayload),
  captureDefinition('hockey.giveaway', { location: true, roles: ['player'] }, playPayload),
]

function playPayload(payload: Record<string, unknown>): string | null {
  return exactKeys(payload, ['captureCommandId']) && isCaptureId(payload.captureCommandId)
    ? null
    : 'Invalid payload.'
}

/**
 * Structural checks for sided capture events. Who may take part (dressed skaters, the
 * defending goalie, the defending side's blocker) is decided by replay.
 */
function captureDefinition(
  eventType: HockeyEventType,
  options: {
    location: boolean | 'required'
    roles: readonly string[]
    sides?: GameEventDefinition<GameEvent>['allowedTeamSides']
  },
  validatePayload: PayloadValidator,
  validateEvent: (event: GameEvent) => string | null = () => null
): GameEventDefinition<GameEvent> {
  return {
    sportId: 'hockey',
    eventType,
    currentSchemaVersion: HOCKEY_EVENT_SCHEMA_VERSION,
    allowedTeamSides: options.sides ?? ['tracked', 'opponent'],
    validate: event => {
      if (event.schemaVersion !== HOCKEY_EVENT_SCHEMA_VERSION) {
        return { ok: false, message: 'Unsupported Hockey event schema version.' }
      }
      if (!parseHockeyPeriod(event.period)) {
        return { ok: false, message: 'Hockey events must name a regulation or overtime period.' }
      }
      if (event.elapsedMs !== null && !isElapsed(event.elapsedMs)) {
        return { ok: false, message: 'Hockey elapsed time must be whole milliseconds within the period.' }
      }
      if (event.location !== null && !options.location) {
        return { ok: false, message: 'This Hockey event has no rink location.' }
      }
      if (event.location === null && options.location === 'required') {
        return { ok: false, message: 'This Hockey event needs a rink location.' }
      }
      if (event.location !== null && event.location.attackingDirection === 'unknown') {
        return { ok: false, message: 'A rink location needs an attacking direction.' }
      }
      const actorMessage = validateActors(event.actors, options.roles)
      if (actorMessage) return { ok: false, message: actorMessage }
      if (!isPlainObject(event.payload)) return { ok: false, message: 'Payload must be an object.' }
      const message = validatePayload(event.payload) ?? validateEvent(event)
      return message ? { ok: false, message } : { ok: true, event }
    },
  }
}

function validateActors(actors: readonly GameEventActor[], roles: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const actor of actors) {
    if (!roles.includes(actor.role)) return 'This Hockey event does not take that actor role.'
    if (seen.has(actor.role)) return 'Each actor role appears once.'
    seen.add(actor.role)
    if (actor.participantId !== undefined && !isId(actor.participantId)) return 'Invalid actor participant.'
    if (actor.label !== undefined && !isLabel(actor.label)) return 'Actor labels must be 1-80 characters.'
    if (actor.kind === 'player') {
      if (!isId(actor.playerId) || actor.participantId === undefined) return 'Player actors need a match participant.'
    } else if (actor.kind !== 'unknown') {
      return 'Hockey actors are players or labels.'
    }
  }
  return null
}

function validateOnIce(value: unknown): string | null {
  if (!isPlainObject(value) || !exactKeys(value, ['status', 'skaterParticipantIds', 'goalie'])) {
    return 'Invalid on-ice set.'
  }
  const { status, skaterParticipantIds: skaters, goalie } = value
  if (status !== 'complete' && status !== 'partial' && status !== 'not_recorded') return 'Unknown on-ice status.'
  if (!Array.isArray(skaters) || skaters.length > MAX_ON_ICE || !skaters.every(isId)) return 'Invalid on-ice skaters.'
  if (new Set(skaters).size !== skaters.length) return 'A skater is listed twice on the ice.'
  if (goalie !== null && goalie !== HOCKEY_EMPTY_NET && !isId(goalie)) return 'Invalid on-ice goalie.'
  if (typeof goalie === 'string' && skaters.includes(goalie)) return 'The goalie cannot also be a skater.'
  if (status === 'not_recorded' && (skaters.length > 0 || goalie !== null)) {
    return 'An on-ice set that was not recorded has no players.'
  }
  if (status === 'partial' && skaters.length === 0 && goalie === null) {
    return 'A partial on-ice set names at least one player.'
  }
  if (status === 'complete' && goalie === null) return 'A complete on-ice set names the goalie or an empty net.'
  return null
}

function roleSet(event: GameEvent): Set<string> {
  return new Set(event.actors.map(actor => actor.role))
}

export function isHockeyReason(value: unknown): value is string {
  return isReason(value)
}

function isReason(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= HOCKEY_MAX_REASON_LENGTH
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= HOCKEY_MAX_LABEL_LENGTH
}

function isCaptureId(value: unknown): boolean {
  return value === null || isId(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH
}

function isElapsed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_ELAPSED_MS
}

function isPeriodNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}
