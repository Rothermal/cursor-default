import type { ShotRecord } from '../../types'
import type { GameEventActor } from '../gameEvents/types'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { normalizedCourtLocationToFeet, zoneForForcedShotType } from './courtGeometry'
import type {
  BasketballMatchEvent,
  BasketballMatchProjection,
  BasketballShotEvent,
  BasketballStatEvent,
  BasketballStatId,
  BasketballTeamSide,
} from './types'

export interface BasketballStatProjectionContext {
  activeEventsById: Map<string, BasketballMatchEvent>
  tripAttemptPositions: Map<string, Set<number>>
  shotChart: ShotRecord[]
}

export function createBasketballStatProjectionContext(): BasketballStatProjectionContext {
  return {
    activeEventsById: new Map(),
    tripAttemptPositions: new Map(),
    shotChart: [],
  }
}

export function registerProjectedBasketballEvent(
  context: BasketballStatProjectionContext,
  event: BasketballMatchEvent
): void {
  context.activeEventsById.set(event.id, event)
}

export function applyBasketballStatEvent(
  projection: BasketballMatchProjection,
  event: BasketballStatEvent,
  context: BasketballStatProjectionContext
): string | null {
  const momentError = validateStatMoment(projection, event)
  if (momentError) return momentError

  const actorError = validateEventActors(projection, event)
  if (actorError) return actorError

  switch (event.eventType) {
    case 'basketball.free_throw_trip':
      validateFreeThrowTripRelationship(projection, event, context)
      return null
    case 'basketball.shot':
      applyShot(projection, event, context)
      return null
    case 'basketball.assist':
      incrementActorStat(projection, event.teamSide, actorForRole(event, 'assister'), 'ast')
      validateAssistRelationship(projection, event, context)
      return null
    case 'basketball.rebound':
      incrementActorStat(
        projection,
        event.teamSide,
        actorForRole(event, 'rebounder'),
        event.payload.kind === 'offensive' ? 'oreb' : 'dreb'
      )
      validateReboundRelationship(projection, event, context)
      return null
    case 'basketball.steal':
      incrementActorStat(projection, event.teamSide, actorForRole(event, 'stealer'), 'stl')
      validateStealRelationship(projection, event, context)
      return null
    case 'basketball.block':
      incrementActorStat(projection, event.teamSide, actorForRole(event, 'blocker'), 'blk')
      validateBlockRelationship(projection, event, context)
      return null
    case 'basketball.turnover':
      applyTurnover(projection, event)
      return null
    case 'basketball.score_adjustment':
      projection.score[event.teamSide] += event.payload.delta
      return null
  }
}

function validateStatMoment(
  projection: BasketballMatchProjection,
  event: BasketballStatEvent
): string | null {
  if (projection.status === 'not_started') return 'Basketball match has not started.'
  if (projection.status === 'ended' || projection.status === 'suspended') {
    return 'Basketball match is not open for stat events.'
  }
  if (!projection.startedPeriodIds.includes(event.period.id)) {
    return 'Basketball stat event period has not started.'
  }
  const segment = projection.periods.find(period => period.id === event.period.id)
  if (!segment || segment.order !== event.period.order) {
    return 'Basketball stat event period is invalid.'
  }
  if (projection.currentPeriodId !== event.period.id) {
    return 'Basketball stat event does not target the current period.'
  }
  return null
}

function validateEventActors(
  projection: BasketballMatchProjection,
  event: BasketballStatEvent
): string | null {
  if (event.eventType === 'basketball.free_throw_trip') return null
  for (const actor of event.actors) {
    const expectedSide = actor.role === 'turnover_by'
      ? oppositeSide(event.teamSide)
      : event.teamSide
    const error = validateActorForSide(projection, actor, expectedSide)
    if (error) return `${actor.role} ${error}`
  }
  return null
}

function validateActorForSide(
  projection: BasketballMatchProjection,
  actor: GameEventActor,
  side: BasketballTeamSide
): string | null {
  if (!actor.participantId) {
    if (actor.kind === 'team' || actor.kind === 'unknown') return null
    return 'must reference a match participant.'
  }
  if (actor.kind !== 'player' && actor.kind !== 'unknown') {
    return 'has an invalid participant actor kind.'
  }
  const participant = projection.participants[actor.participantId]
  if (!participant) return 'references an unknown match participant.'
  if (participant.teamSide !== side) return 'is attributed to the wrong team side.'
  if (actor.kind === 'player' && participant.playerId !== actor.playerId) {
    return 'player identity does not match the match participant.'
  }
  return null
}

function applyShot(
  projection: BasketballMatchProjection,
  event: BasketballShotEvent,
  context: BasketballStatProjectionContext
): void {
  const actor = actorForRole(event, 'shooter')
  const statId: BasketballStatId = event.payload.attempt === 'free_throw'
    ? (event.payload.made ? 'ft' : 'ft_miss')
    : event.payload.value === 3
      ? (event.payload.made ? '3pt' : '3pt_miss')
      : (event.payload.made ? '2pt' : '2pt_miss')
  incrementActorStat(projection, event.teamSide, actor, statId)
  if (event.payload.made) projection.score[event.teamSide] += event.payload.value

  validateFreeThrowAttemptRelationship(projection, event, context)
  if (event.payload.attempt !== 'field_goal' || !event.location) return

  const point = normalizedCourtLocationToFeet(event.location)
  const x = roundCourtFeet(point.x)
  const y = roundCourtFeet(point.y)
  const shotType = event.payload.value === 3 ? '3pt' : '2pt'
  context.shotChart.push({
    id: event.id,
    x,
    y,
    made: event.payload.made,
    shotType,
    zone: zoneForForcedShotType(x, y, shotType),
    playerId: projectionPlayerId(projection, actor, event.teamSide),
    timestamp: Date.parse(event.occurredAt),
  })
}

function applyTurnover(
  projection: BasketballMatchProjection,
  event: Extract<BasketballStatEvent, { eventType: 'basketball.turnover' }>
): void {
  const actor = actorForRole(event, 'committed_by')
  projection.sideStats[event.teamSide].to += 1
  if (event.payload.kind === 'team') {
    projection.teamActorStats[event.teamSide].team_turnover += 1
    return
  }
  incrementActorOnly(projection, event.teamSide, actor, 'to')
}

function incrementActorStat(
  projection: BasketballMatchProjection,
  side: BasketballTeamSide,
  actor: GameEventActor,
  statId: BasketballStatId
): void {
  projection.sideStats[side][statId] += 1
  incrementActorOnly(projection, side, actor, statId)
}

function incrementActorOnly(
  projection: BasketballMatchProjection,
  side: BasketballTeamSide,
  actor: GameEventActor,
  statId: BasketballStatId
): void {
  if (actor.participantId) {
    const participant = projection.participants[actor.participantId]
    if (participant) participant.stats[statId] += 1
    return
  }
  projection.teamActorStats[side][statId] += 1
}

function validateAssistRelationship(
  projection: BasketballMatchProjection,
  event: Extract<BasketballStatEvent, { eventType: 'basketball.assist' }>,
  context: BasketballStatProjectionContext
): void {
  const relatedId = event.payload.relatedEventId
  if (!relatedId) return
  const target = context.activeEventsById.get(relatedId)
  const assister = actorForRole(event, 'assister')
  const shooter = target?.eventType === 'basketball.shot'
    ? actorForRole(target, 'shooter')
    : null
  if (
    target?.eventType !== 'basketball.shot' ||
    target.payload.attempt !== 'field_goal' ||
    !target.payload.made ||
    target.teamSide !== event.teamSide ||
    !shooter ||
    sameActor(assister, shooter)
  ) {
    warn(projection, event.id, relatedId, 'Assist link is stale or does not reference a same-side made field goal.')
  }
}

function validateReboundRelationship(
  projection: BasketballMatchProjection,
  event: Extract<BasketballStatEvent, { eventType: 'basketball.rebound' }>,
  context: BasketballStatProjectionContext
): void {
  const relatedId = event.payload.relatedEventId
  if (!relatedId) return
  const target = context.activeEventsById.get(relatedId)
  const expectedShotSide = event.payload.kind === 'offensive'
    ? event.teamSide
    : oppositeSide(event.teamSide)
  if (
    target?.eventType !== 'basketball.shot' ||
    target.payload.made ||
    target.teamSide !== expectedShotSide
  ) {
    warn(projection, event.id, relatedId, 'Rebound link is stale or does not match its shot and rebound side.')
  }
}

function validateBlockRelationship(
  projection: BasketballMatchProjection,
  event: Extract<BasketballStatEvent, { eventType: 'basketball.block' }>,
  context: BasketballStatProjectionContext
): void {
  const relatedId = event.payload.relatedEventId
  if (!relatedId) return
  const target = context.activeEventsById.get(relatedId)
  if (
    target?.eventType !== 'basketball.shot' ||
    target.payload.attempt !== 'field_goal' ||
    target.payload.made ||
    target.teamSide === event.teamSide
  ) {
    warn(projection, event.id, relatedId, 'Block link is stale or does not reference an opposite-side missed field goal.')
  }
}

function validateStealRelationship(
  projection: BasketballMatchProjection,
  event: Extract<BasketballStatEvent, { eventType: 'basketball.steal' }>,
  context: BasketballStatProjectionContext
): void {
  const relatedId = event.payload.relatedEventId
  if (!relatedId) return
  const target = context.activeEventsById.get(relatedId)
  if (target?.eventType !== 'basketball.turnover' || target.teamSide === event.teamSide) {
    warn(projection, event.id, relatedId, 'Steal link is stale or does not reference an opposite-side turnover.')
  }
}

function validateFreeThrowTripRelationship(
  projection: BasketballMatchProjection,
  event: Extract<BasketballStatEvent, { eventType: 'basketball.free_throw_trip' }>,
  context: BasketballStatProjectionContext
): void {
  const relatedId = event.payload.sourceFoulEventId
  if (!relatedId) return
  const target = context.activeEventsById.get(relatedId)
  if (!target || String(target.eventType) !== 'basketball.foul') {
    warn(projection, event.id, relatedId, 'Free-throw trip source foul is stale or unavailable.')
  }
}

function validateFreeThrowAttemptRelationship(
  projection: BasketballMatchProjection,
  event: BasketballShotEvent,
  context: BasketballStatProjectionContext
): void {
  const tripId = event.payload.freeThrowTripId
  const attemptNumber = event.payload.tripAttemptNumber
  if (!tripId || attemptNumber === null) return
  const target = context.activeEventsById.get(tripId)
  if (
    target?.eventType !== 'basketball.free_throw_trip' ||
    target.teamSide !== event.teamSide ||
    attemptNumber > target.payload.maximumAttempts
  ) {
    warn(projection, event.id, tripId, 'Free-throw attempt trip link is stale or outside the awarded trip.')
    return
  }
  const positions = context.tripAttemptPositions.get(tripId) ?? new Set<number>()
  if (positions.has(attemptNumber)) {
    warn(projection, event.id, tripId, 'Free-throw trip contains a duplicate attempt position.')
    return
  }
  positions.add(attemptNumber)
  context.tripAttemptPositions.set(tripId, positions)
}

function projectionPlayerId(
  projection: BasketballMatchProjection,
  actor: GameEventActor,
  side: BasketballTeamSide
): string {
  if (actor.participantId) {
    const playerId = projection.participants[actor.participantId]?.playerId
    if (playerId) return playerId
  }
  return side === 'tracked' ? TEAM_PLAYER_HOME_ID : TEAM_PLAYER_OPP_ID
}

function actorForRole(
  event: BasketballStatEvent,
  role: string
): GameEventActor {
  const actor = event.actors.find(candidate => candidate.role === role)
  if (!actor) throw new Error(`Validated Basketball event is missing ${role}.`)
  return actor
}

function sameActor(left: GameEventActor, right: GameEventActor): boolean {
  if (left.participantId || right.participantId) {
    return Boolean(left.participantId && left.participantId === right.participantId)
  }
  return left.kind === right.kind && left.label === right.label
}

function oppositeSide(side: BasketballTeamSide): BasketballTeamSide {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

function warn(
  projection: BasketballMatchProjection,
  eventId: string,
  relatedEventId: string,
  message: string
): void {
  projection.relationshipWarnings.push({ eventId, relatedEventId, message })
}

function roundCourtFeet(value: number): number {
  return Math.round(value * 10) / 10
}
