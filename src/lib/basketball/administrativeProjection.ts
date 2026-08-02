import { getBonusStatus } from '../basketballBonus'
import type { GameEventActor } from '../gameEvents/types'
import type { BasketballStatProjectionContext } from './statProjection'
import type {
  BasketballAdministrativeEvent,
  BasketballEjectionEvent,
  BasketballFoulEvent,
  BasketballMatchRules,
  BasketballMatchProjection,
  BasketballTeamSide,
} from './types'

export function applyBasketballAdministrativeEvent(
  projection: BasketballMatchProjection,
  event: BasketballAdministrativeEvent,
  context: BasketballStatProjectionContext,
  rules: BasketballMatchRules
): string | null {
  const momentError = validateAdministrativeMoment(projection, event)
  if (momentError) return momentError

  const actorError = validateAdministrativeActors(projection, event)
  if (actorError) return actorError

  switch (event.eventType) {
    case 'basketball.foul':
      applyFoul(projection, event, rules)
      return null
    case 'basketball.ejection':
      return applyEjection(projection, event, context)
    case 'basketball.timeout':
      applyTimeout(projection, event)
      return null
    case 'basketball.minutes_adjustment':
      return applyMinutesAdjustment(projection, event, rules)
  }
}

function validateAdministrativeMoment(
  projection: BasketballMatchProjection,
  event: BasketballAdministrativeEvent
): string | null {
  if (projection.status === 'not_started') return 'Basketball match has not started.'
  if (projection.status === 'ended' || projection.status === 'suspended') {
    return 'Basketball match is not open for administrative events.'
  }
  if (projection.status !== 'in_progress') {
    return 'Basketball administrative events require an active period.'
  }
  const segment = projection.periods.find(period => period.id === event.period.id)
  if (
    !segment ||
    segment.order !== event.period.order ||
    projection.currentPeriodId !== event.period.id
  ) {
    return 'Basketball administrative event does not target the current period.'
  }
  return null
}

function validateAdministrativeActors(
  projection: BasketballMatchProjection,
  event: BasketballAdministrativeEvent
): string | null {
  if (event.eventType === 'basketball.timeout') {
    if (event.teamSide === 'neutral') return null
    return validateNonParticipantActor(actorForRole(event, 'team'), 'team')
  }

  if (event.eventType === 'basketball.foul') {
    const side = event.teamSide
    const committedError = validateActorForSide(
      projection,
      actorForRole(event, 'committed_by'),
      side,
      ['player', 'staff', 'team']
    )
    if (committedError) return `committed_by ${committedError}`
    const drawnBy = optionalActorForRole(event, 'drawn_by')
    if (!drawnBy) return null
    const drawnError = validateActorForSide(
      projection,
      drawnBy,
      oppositeSide(side),
      ['player', 'unknown']
    )
    return drawnError ? `drawn_by ${drawnError}` : null
  }

  const role = event.eventType === 'basketball.ejection' ? 'subject' : 'player'
  const kinds = event.eventType === 'basketball.ejection'
    ? (['player', 'staff'] as const)
    : (['player'] as const)
  const error = validateActorForSide(projection, actorForRole(event, role), event.teamSide, kinds)
  return error ? `${role} ${error}` : null
}

function validateActorForSide(
  projection: BasketballMatchProjection,
  actor: GameEventActor,
  side: BasketballTeamSide,
  allowedKinds: readonly GameEventActor['kind'][]
): string | null {
  if (!allowedKinds.includes(actor.kind)) return 'has an invalid actor kind.'
  if (actor.kind === 'staff' || actor.kind === 'team') {
    return validateNonParticipantActor(actor, actor.kind)
  }
  if (actor.kind === 'unknown') {
    return actor.participantId ? 'cannot attach an unknown actor to a participant.' : null
  }
  if (!('playerId' in actor)) return 'must use a player actor.'
  if (!actor.participantId) return 'must reference a match participant.'
  const participant = projection.participants[actor.participantId]
  if (!participant) return 'references an unknown match participant.'
  if (participant.teamSide !== side) return 'is attributed to the wrong team side.'
  if (participant.playerId !== actor.playerId) {
    return 'player identity does not match the match participant.'
  }
  return null
}

function validateNonParticipantActor(
  actor: GameEventActor,
  expectedKind: 'staff' | 'team'
): string | null {
  if (actor.kind !== expectedKind) return `must use a ${expectedKind} actor.`
  if (actor.participantId) return 'cannot reference a player participant.'
  return null
}

function applyFoul(
  projection: BasketballMatchProjection,
  event: BasketballFoulEvent,
  rules: BasketballMatchRules
): void {
  const committedBy = actorForRole(event, 'committed_by')
  const counts = event.payload.countingOverride ?? {
    personalFoul: committedBy.kind === 'player',
    teamFoul: true,
    technical: event.payload.class === 'technical',
  }

  if (counts.personalFoul) {
    projection.sideStats[event.teamSide].pf += 1
    if (committedBy.participantId) {
      const participant = projection.participants[committedBy.participantId]
      participant.stats.pf += 1
      participant.disqualified = participant.stats.pf >= rules.personalFoulLimit
    }
  }

  if (counts.teamFoul) {
    const periodFouls = ensurePeriodSideCounts(projection.periodTeamFouls, event.period.id)
    periodFouls[event.teamSide] += 1
    incrementTeamStat(projection, event.teamSide, `team_foul_p${event.period.order}`)
    updateBonusStatus(projection, event.period.id, rules)
  }

  if (counts.technical) {
    incrementTeamStat(projection, event.teamSide, 'team_tech')
  }
}

function applyEjection(
  projection: BasketballMatchProjection,
  event: BasketballEjectionEvent,
  context: BasketballStatProjectionContext
): string | null {
  const subject = actorForRole(event, 'subject')
  if (subject.participantId) {
    const participant = projection.participants[subject.participantId]
    if (event.payload.source === 'automatic_threshold' && !participant.disqualified) {
      return 'Automatic Basketball ejection requires a disqualified participant.'
    }
    participant.ejected = true
  } else if (event.payload.source === 'automatic_threshold') {
    return 'Automatic Basketball ejection requires a player participant.'
  }

  projection.ejections.push({
    eventId: event.id,
    teamSide: event.teamSide,
    subject: structuredClone(subject),
    reason: event.payload.reason,
    source: event.payload.source,
    relatedFoulEventId: event.payload.relatedFoulEventId,
  })
  validateEjectionRelationship(projection, event, subject, context)
  return null
}

function applyTimeout(
  projection: BasketballMatchProjection,
  event: Extract<BasketballAdministrativeEvent, { eventType: 'basketball.timeout' }>
): void {
  if (event.teamSide === 'neutral') {
    projection.neutralTimeouts += 1
    return
  }
  const periodTimeouts = ensurePeriodSideCounts(projection.periodTimeouts, event.period.id)
  periodTimeouts[event.teamSide] += 1
  incrementTeamStat(projection, event.teamSide, `team_to_used_p${event.period.order}`)
}

function applyMinutesAdjustment(
  projection: BasketballMatchProjection,
  event: Extract<BasketballAdministrativeEvent, { eventType: 'basketball.minutes_adjustment' }>,
  rules: BasketballMatchRules
): string | null {
  if (rules.clockModel === 'anchored') return null
  const actor = actorForRole(event, 'player')
  const participant = projection.participants[actor.participantId!]
  const nextMinutes = participant.stats.min + event.payload.deltaMinutes
  if (nextMinutes < 0) return 'Basketball minutes cannot project below zero.'
  participant.stats.min = nextMinutes
  projection.sideStats[event.teamSide].min += event.payload.deltaMinutes
  return null
}

function validateEjectionRelationship(
  projection: BasketballMatchProjection,
  event: BasketballEjectionEvent,
  subject: GameEventActor,
  context: BasketballStatProjectionContext
): void {
  const relatedId = event.payload.relatedFoulEventId
  if (!relatedId) return
  const target = context.activeEventsById.get(relatedId)
  const committedBy = target?.eventType === 'basketball.foul'
    ? actorForRole(target, 'committed_by')
    : null
  if (
    target?.eventType !== 'basketball.foul' ||
    target.teamSide !== event.teamSide ||
    !committedBy ||
    !sameActor(subject, committedBy)
  ) {
    projection.relationshipWarnings.push({
      eventId: event.id,
      relatedEventId: relatedId,
      message: 'Ejection link is stale or does not reference a foul involving the same subject.',
    })
  }
}

function updateBonusStatus(
  projection: BasketballMatchProjection,
  periodId: string,
  rules: BasketballMatchRules
): void {
  const segment = projection.periods.find(period => period.id === periodId)
  if (!segment) return
  const counts = segment.kind === 'overtime' && !rules.overtimeFoulsReset
    ? projection.periods
        .filter(period => period.kind === 'overtime' && period.order <= segment.order)
        .reduce(
          (total, period) => {
            const periodCounts = projection.periodTeamFouls[period.id]
            total.tracked += periodCounts?.tracked ?? 0
            total.opponent += periodCounts?.opponent ?? 0
            return total
          },
          { tracked: 0, opponent: 0 }
        )
    : ensurePeriodSideCounts(projection.periodTeamFouls, periodId)
  projection.bonusStatusByPeriod[periodId] = {
    tracked: getBonusStatus(
      counts.tracked,
      rules.bonusThreshold,
      rules.doubleBonusThreshold,
      rules.hasOneAndOne
    ),
    opponent: getBonusStatus(
      counts.opponent,
      rules.bonusThreshold,
      rules.doubleBonusThreshold,
      rules.hasOneAndOne
    ),
  }
}

function ensurePeriodSideCounts(
  target: Record<string, Record<BasketballTeamSide, number>>,
  periodId: string
): Record<BasketballTeamSide, number> {
  target[periodId] ??= { tracked: 0, opponent: 0 }
  return target[periodId]
}

function incrementTeamStat(
  projection: BasketballMatchProjection,
  side: BasketballTeamSide,
  statId: string
): void {
  projection.teamActorStats[side][statId] = (projection.teamActorStats[side][statId] ?? 0) + 1
}

function actorForRole(
  event: BasketballAdministrativeEvent,
  role: string
): GameEventActor {
  const actor = event.actors.find(candidate => candidate.role === role)
  if (!actor) throw new Error(`Validated Basketball event is missing ${role}.`)
  return actor
}

function optionalActorForRole(
  event: BasketballAdministrativeEvent,
  role: string
): GameEventActor | undefined {
  return event.actors.find(candidate => candidate.role === role)
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
