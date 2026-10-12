import { isPlainObject } from '../gameEvents/envelope'
import type { GameEvent, GameEventPeriod, JsonObject } from '../gameEvents/types'
import type { GameEventDefinition } from '../gameEvents/registry'
import { createBasketballUuid } from './id'
import { isBasketballAttackingDirection, oppositeBasketballDirection } from './fullCourtGeometry'
import { resolveBasketballPeriodSegment } from './rules'
import type {
  BasketballAttackingDirection,
  BasketballAttackingDirectionSetEvent,
  BasketballAttackingDirectionSetPayload,
  BasketballMatchEvent,
  BasketballMatchProjection,
  BasketballMatchRules,
  BasketballMatchSegment,
  BasketballTeamSide,
} from './types'
import { BASKETBALL_EVENT_SCHEMA_VERSION } from './types'

export const BASKETBALL_ATTACKING_DIRECTION_EVENT = 'basketball.attacking_direction_set'

export interface CreateBasketballAttackingDirectionEventInput {
  id?: string
  payload: BasketballAttackingDirectionSetPayload
  recorderUserId: string | null
  sequence: number
  period: GameEventPeriod
  elapsedMs: number | null
  occurredAt: string
}

export function createBasketballAttackingDirectionEvent(
  input: CreateBasketballAttackingDirectionEventInput
): BasketballAttackingDirectionSetEvent {
  return {
    id: input.id ?? createBasketballUuid(),
    sportId: 'basketball',
    eventType: BASKETBALL_ATTACKING_DIRECTION_EVENT,
    schemaVersion: BASKETBALL_EVENT_SCHEMA_VERSION,
    recorderUserId: input.recorderUserId,
    sequence: input.sequence,
    period: input.period,
    elapsedMs: input.elapsedMs,
    occurredAt: input.occurredAt,
    teamSide: 'neutral',
    location: null,
    actors: [],
    payload: input.payload,
    revision: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as unknown as BasketballAttackingDirectionSetEvent
}

export const basketballCourtEventDefinitions: GameEventDefinition<GameEvent>[] = [{
  sportId: 'basketball',
  eventType: BASKETBALL_ATTACKING_DIRECTION_EVENT,
  currentSchemaVersion: BASKETBALL_EVENT_SCHEMA_VERSION,
  allowedTeamSides: ['neutral'],
  validate: event => {
    if (
      event.sportId !== 'basketball' ||
      event.eventType !== BASKETBALL_ATTACKING_DIRECTION_EVENT ||
      event.schemaVersion !== BASKETBALL_EVENT_SCHEMA_VERSION ||
      event.teamSide !== 'neutral' ||
      !(event.elapsedMs === null || (Number.isInteger(event.elapsedMs) && event.elapsedMs >= 0)) ||
      event.location !== null ||
      event.actors.length !== 0 ||
      !validatePayload(event.payload)
    ) {
      return { ok: false, message: `${BASKETBALL_ATTACKING_DIRECTION_EVENT} has an invalid Basketball payload.` }
    }
    return { ok: true, event }
  },
}]

/** The tip-off fixes the game's frame, so it is a read-only boundary; Switch ends is not. */
export function isBasketballTipOffEvent(event: BasketballMatchEvent): boolean {
  return event.eventType === BASKETBALL_ATTACKING_DIRECTION_EVENT && event.payload.reason === 'tip_off'
}

export function isBasketballCourtEvent(
  event: BasketballMatchEvent
): event is BasketballAttackingDirectionSetEvent {
  return event.eventType === BASKETBALL_ATTACKING_DIRECTION_EVENT
}

/**
 * Tip-off sets the first direction, once, right after the first period starts and
 * before any other event; Switch ends changes it from that point forward, during a
 * period only (BKE-7 §3.2).
 */
export function applyBasketballCourtEvent(
  projection: BasketballMatchProjection,
  event: BasketballAttackingDirectionSetEvent,
  captureOrderedEvents: readonly BasketballMatchEvent[]
): string | null {
  // A break belongs to no period, so a switch there would rewrite an ended period's
  // history (§3.4); the recorder switches once the next period starts.
  if (projection.status !== 'in_progress') {
    return 'The ends can be set only during a Basketball period.'
  }
  const periodId = projection.currentPeriodId
  if (!periodId || event.period.id !== periodId) {
    return 'The ends are set in the current Basketball period.'
  }
  const direction = event.payload.trackedDirection
  if (event.payload.reason === 'tip_off') {
    if (projection.court) return 'The tip-off direction is already set.'
    if (projection.periods.length !== 1) return 'The tip-off direction is set in the first period.'
    // One frame for the whole game: nothing but the first period's start was captured
    // before it. Capture order, not replay order: a recorded-later lineup correction at
    // elapsed zero replays ahead of the tip-off without having been captured before it.
    const capturedBefore = captureOrderedEvents.slice(
      0,
      Math.max(0, captureOrderedEvents.findIndex(candidate => candidate.id === event.id))
    )
    if (capturedBefore.some(prior => prior.eventType !== 'basketball.period_started')) {
      return 'The tip-off direction is set before anything else is recorded.'
    }
    projection.court = {
      trackedAttackingDirection: direction,
      periodDirections: { [periodId]: [direction] },
      tipOffEventId: event.id,
    }
    return null
  }
  if (!projection.court) return 'Switch ends needs a full-court game.'
  if (projection.court.trackedAttackingDirection === direction) {
    return 'The tracked team already attacks that basket.'
  }
  projection.court.trackedAttackingDirection = direction
  const periodDirections = projection.court.periodDirections[periodId] ?? []
  projection.court.periodDirections[periodId] = [...periodDirections, direction]
  return null
}

/**
 * Halftime: the first regulation period past the midpoint of an even segment list
 * flips the direction. Odd lists never flip, and overtime keeps the second-half
 * direction. Every started period records the direction it began with.
 */
export function applyBasketballCourtPeriodStart(
  projection: BasketballMatchProjection,
  rules: BasketballMatchRules,
  segment: BasketballMatchSegment
): void {
  const court = projection.court
  if (!court) return
  const regulationCount = rules.regulationSegments.length
  if (
    segment.kind === 'regulation' &&
    regulationCount % 2 === 0 &&
    segment.order === regulationCount / 2 + 1
  ) {
    court.trackedAttackingDirection = oppositeBasketballDirection(court.trackedAttackingDirection)
  }
  court.periodDirections[segment.id] = [court.trackedAttackingDirection]
}

export interface BasketballPeriodDirection {
  /** The side's direction when it is the only one used in the period, else null. */
  direction: BasketballAttackingDirection | null
  /** Every direction the side used in the period, oldest first. */
  used: BasketballAttackingDirection[]
}

/**
 * The basket a side attacked in a period, for added and edited shots (BKE-7 §3.4):
 * only a period with one direction throughout gives one; otherwise the recorder picks.
 */
export function basketballPeriodDirection(
  projection: BasketballMatchProjection,
  rules: BasketballMatchRules,
  periodId: string,
  side: BasketballTeamSide
): BasketballPeriodDirection {
  const tracked = projection.court?.periodDirections[periodId] ?? []
  if (!resolveBasketballPeriodSegment(rules, periodId)) return { direction: null, used: [] }
  const used = [...new Set(side === 'tracked' ? tracked : tracked.map(oppositeBasketballDirection))]
  return { direction: used.length === 1 ? used[0] : null, used }
}

/** The side's direction now, or null for a half-court game. */
export function basketballCurrentDirection(
  projection: BasketballMatchProjection,
  side: BasketballTeamSide
): BasketballAttackingDirection | null {
  const tracked = projection.court?.trackedAttackingDirection
  if (!tracked) return null
  return side === 'tracked' ? tracked : oppositeBasketballDirection(tracked)
}

function validatePayload(payload: JsonObject): boolean {
  if (!isPlainObject(payload)) return false
  const keys = Object.keys(payload).sort()
  return keys.join(',') === 'captureCommandId,reason,trackedDirection' &&
    typeof payload.captureCommandId === 'string' &&
    payload.captureCommandId.trim().length > 0 &&
    isBasketballAttackingDirection(payload.trackedDirection) &&
    (payload.reason === 'tip_off' || payload.reason === 'switch_ends')
}
