import type { GameEventActor } from '../gameEvents/types'
import { orderedSoccerSegments } from './rules'
import type {
  SoccerCardSanction,
  SoccerDisciplineLineupResolution,
  SoccerDisciplineReason,
  SoccerMatchEvent,
  SoccerMatchProjection,
  SoccerParticipantStatTotals,
  SoccerProjectedParticipant,
  SoccerRole,
  SoccerShootoutProjection,
} from './types'

export type SoccerNormalIncident = Extract<
  SoccerMatchEvent,
  {
    eventType:
      | 'soccer.defensive_action'
      | 'soccer.foul'
      | 'soccer.card'
      | 'soccer.team_event'
  }
>

export type SoccerShootoutEvent = Extract<
  SoccerMatchEvent,
  {
    eventType:
      | 'soccer.shootout_started'
      | 'soccer.shootout_eligibility_changed'
      | 'soccer.shootout_goalkeeper_changed'
      | 'soccer.shootout_kick'
      | 'soccer.card'
  }
>

export interface SoccerSoc4ProjectionContext {
  activeEvents: SoccerMatchEvent[]
  normalYellowByActor: Map<string, number>
  shootoutYellowByActor: Map<string, number>
  normalRedActors: Set<string>
  shootoutRedActors: Set<string>
}

export function createSoccerSoc4ProjectionContext(
  activeEvents: SoccerMatchEvent[]
): SoccerSoc4ProjectionContext {
  return {
    activeEvents,
    normalYellowByActor: new Map(),
    shootoutYellowByActor: new Map(),
    normalRedActors: new Set(),
    shootoutRedActors: new Set(),
  }
}

export function isSoccerNormalIncident(event: SoccerMatchEvent): event is SoccerNormalIncident {
  return event.eventType === 'soccer.defensive_action' ||
    event.eventType === 'soccer.foul' ||
    (event.eventType === 'soccer.card' && event.period.id !== 'shootout') ||
    event.eventType === 'soccer.team_event'
}

export function isSoccerShootoutEvent(event: SoccerMatchEvent): event is SoccerShootoutEvent {
  return event.eventType === 'soccer.shootout_started' ||
    event.eventType === 'soccer.shootout_eligibility_changed' ||
    event.eventType === 'soccer.shootout_goalkeeper_changed' ||
    event.eventType === 'soccer.shootout_kick' ||
    (event.eventType === 'soccer.card' && event.period.id === 'shootout')
}

export function compareSoccerIncidentTime(
  left: SoccerMatchEvent,
  right: SoccerMatchEvent
): number {
  if (left.period.order !== right.period.order) return left.period.order - right.period.order
  const leftElapsed = left.elapsedMs ?? Number.MAX_SAFE_INTEGER
  const rightElapsed = right.elapsedMs ?? Number.MAX_SAFE_INTEGER
  if (leftElapsed !== rightElapsed) return leftElapsed - rightElapsed
  const priority = (event: SoccerMatchEvent): number => {
    if (event.eventType === 'soccer.foul') return 1
    if (event.eventType === 'soccer.card') return 2
    return 3
  }
  const priorityDifference = priority(left) - priority(right)
  if (priorityDifference !== 0) return priorityDifference
  if (left.sequence !== right.sequence) return left.sequence - right.sequence
  return left.id.localeCompare(right.id)
}

export function validateSoccerShotSource(
  event: Extract<SoccerMatchEvent, { eventType: 'soccer.shot' }>,
  context: SoccerSoc4ProjectionContext
): string | null {
  const sourceEventId = event.payload.sourceEventId
  if (!sourceEventId) return null
  if (event.payload.situation === 'open_play' || event.payload.situation === 'other_set_piece') {
    return 'Open-play and other-set-piece shots cannot link a restart source.'
  }
  const source = context.activeEvents.find(candidate => candidate.id === sourceEventId)
  if (!source) return 'Shot source event is missing or removed.'
  if (
    source.sequence >= event.sequence ||
    source.period.id !== event.period.id ||
    source.elapsedMs === null ||
    event.elapsedMs === null ||
    source.elapsedMs > event.elapsedMs
  ) {
    return 'Shot source must be an earlier event in the same period.'
  }
  if (event.payload.situation === 'corner_sequence') {
    return source.eventType === 'soccer.team_event' &&
      source.payload.kind === 'corner' &&
      source.teamSide === event.teamSide
      ? null
      : 'Corner-sequence shot source must be a corner for the shooting side.'
  }
  const requiredRestart = event.payload.situation === 'penalty'
    ? 'penalty'
    : 'direct_free_kick'
  return source.eventType === 'soccer.foul' &&
    source.payload.restart === requiredRestart &&
    source.teamSide === oppositeSide(event.teamSide)
    ? null
    : 'Shot source must be the matching foul committed by the opposite side.'
}

export function applySoccerBlockedShotTotals(
  projection: SoccerMatchProjection,
  event: Extract<SoccerMatchEvent, { eventType: 'soccer.shot' }>
): void {
  if (event.payload.outcome !== 'blocked') return
  const defendingSide = oppositeSide(event.teamSide)
  projection.sideTotals[defendingSide].blockedShots += 1
  const blocker = actorForRole(event.actors, 'blocker')
  if (defendingSide === 'tracked' && blocker) {
    incrementActorStat(projection, blocker, 'blockedShots')
  }
}

export function applySoccerNormalIncident(
  projection: SoccerMatchProjection,
  event: SoccerNormalIncident,
  context: SoccerSoc4ProjectionContext
): string | null {
  const momentError = validateNormalMoment(projection, event)
  if (momentError) return momentError

  switch (event.eventType) {
    case 'soccer.defensive_action':
      return applyDefensiveAction(projection, event)
    case 'soccer.foul':
      return applyFoul(projection, event, context)
    case 'soccer.card':
      return applyCard(projection, event, context, 'normal')
    case 'soccer.team_event':
      return applyTeamEvent(projection, event)
  }
}

function applyDefensiveAction(
  projection: SoccerMatchProjection,
  event: Extract<SoccerNormalIncident, { eventType: 'soccer.defensive_action' }>
): string | null {
  const defender = actorForRole(event.actors, 'defender')
  if (!defender) return 'A defensive action requires a defender.'
  const actorError = validateIncidentActor(projection, defender, event.teamSide, event, true, true)
  if (actorError) return `Defender ${actorError}`
  const totals = projection.sideTotals[event.teamSide]
  if (event.payload.action === 'tackle') {
    totals.tacklesAttempted += 1
    totals[event.payload.tackleOutcome === 'won' ? 'tacklesWon' : 'tacklesLost'] += 1
    if (event.teamSide === 'tracked') {
      incrementActorStat(projection, defender, 'tacklesAttempted')
      incrementActorStat(
        projection,
        defender,
        event.payload.tackleOutcome === 'won' ? 'tacklesWon' : 'tacklesLost'
      )
    }
  } else {
    const key = event.payload.action === 'interception'
      ? 'interceptions'
      : event.payload.action === 'clearance'
        ? 'clearances'
        : 'recoveries'
    totals[key] += 1
    if (event.teamSide === 'tracked') incrementActorStat(projection, defender, key)
  }
  if (defender.kind === 'team') totals.teamAttributedDefensiveActions += 1
  if (defender.kind === 'unknown' && !defender.participantId) {
    totals.unknownAttributedDefensiveActions += 1
  }
  return null
}

function applyFoul(
  projection: SoccerMatchProjection,
  event: Extract<SoccerNormalIncident, { eventType: 'soccer.foul' }>,
  context: SoccerSoc4ProjectionContext
): string | null {
  const committedBy = actorForRole(event.actors, 'committed_by')
  const fouled = actorForRole(event.actors, 'fouled')
  if (!committedBy) return 'A foul requires a committing actor.'
  const committingError = validateIncidentActor(
    projection,
    committedBy,
    event.teamSide,
    event,
    true,
    true
  )
  if (committingError) return `Committing actor ${committingError}`
  if (fouled) {
    const fouledError = validateIncidentActor(
      projection,
      fouled,
      oppositeSide(event.teamSide),
      event,
      true,
      true
    )
    if (fouledError) return `Fouled actor ${fouledError}`
  }

  const committingTotals = projection.sideTotals[event.teamSide]
  const receivingTotals = projection.sideTotals[oppositeSide(event.teamSide)]
  committingTotals.foulsCommitted += 1
  receivingTotals.foulsDrawn += 1
  if (event.teamSide === 'tracked') incrementActorStat(projection, committedBy, 'foulsCommitted')
  if (oppositeSide(event.teamSide) === 'tracked' && fouled) {
    incrementActorStat(projection, fouled, 'foulsDrawn')
  }
  if (committedBy.kind === 'team') committingTotals.teamAttributedFouls += 1
  if (committedBy.kind === 'unknown' && !committedBy.participantId) {
    committingTotals.unknownAttributedFouls += 1
  }
  if (event.payload.restart === 'penalty') {
    committingTotals.penaltiesConceded += 1
    receivingTotals.penaltiesWon += 1
  }
  if (event.payload.sanction !== 'none' && event.payload.sanctionReason) {
    return applyDiscipline(
      projection,
      event,
      committedBy,
      event.payload.sanction,
      event.payload.sanctionReason,
      event.payload.lineupResolution,
      context,
      'normal'
    )
  }
  return event.payload.lineupResolution === null
    ? null
    : 'An unsanctioned foul cannot carry a lineup resolution.'
}

function applyCard(
  projection: SoccerMatchProjection,
  event: Extract<SoccerMatchEvent, { eventType: 'soccer.card' }>,
  context: SoccerSoc4ProjectionContext,
  scope: 'normal' | 'shootout'
): string | null {
  const recipient = actorForRole(event.actors, 'recipient')
  if (!recipient) return 'A card requires a recipient.'
  if (recipient.kind !== 'staff') {
    const actorError = validateIncidentActor(
      projection,
      recipient,
      event.teamSide,
      event,
      true,
      true,
      scope === 'shootout'
    )
    if (actorError) return `Card recipient ${actorError}`
  } else if (recipient.participantId) {
    return 'A staff recipient cannot reference a match participant.'
  }
  return applyDiscipline(
    projection,
    event,
    recipient,
    event.payload.sanction,
    event.payload.reason,
    event.payload.lineupResolution,
    context,
    scope
  )
}

function applyTeamEvent(
  projection: SoccerMatchProjection,
  event: Extract<SoccerNormalIncident, { eventType: 'soccer.team_event' }>
): string | null {
  const offsidePlayer = actorForRole(event.actors, 'offside_player')
  if (event.payload.kind === 'corner') {
    if (offsidePlayer) return 'A corner cannot identify an offside player.'
    projection.sideTotals[event.teamSide].corners += 1
    return null
  }
  if (offsidePlayer) {
    const actorError = validateIncidentActor(
      projection,
      offsidePlayer,
      event.teamSide,
      event,
      true,
      true
    )
    if (actorError) return `Offside actor ${actorError}`
  }
  projection.sideTotals[event.teamSide].offsides += 1
  return null
}

function applyDiscipline(
  projection: SoccerMatchProjection,
  event: Extract<SoccerMatchEvent, { eventType: 'soccer.foul' | 'soccer.card' }>,
  actor: GameEventActor,
  sanction: SoccerCardSanction,
  _reason: SoccerDisciplineReason,
  resolution: SoccerDisciplineLineupResolution | null,
  context: SoccerSoc4ProjectionContext,
  scope: 'normal' | 'shootout'
): string | null {
  const key = disciplineActorKey(event.teamSide, actor)
  const yellowLedger = scope === 'normal'
    ? context.normalYellowByActor
    : context.shootoutYellowByActor
  const redLedger = scope === 'normal' ? context.normalRedActors : context.shootoutRedActors
  if (sanction === 'second_yellow_red' && (yellowLedger.get(key) ?? 0) < 1) {
    return 'Second-yellow red requires an earlier active yellow in the same discipline scope.'
  }
  if (redLedger.has(key)) return 'An already sent-off recipient cannot receive another card.'

  const yellowIncrement = sanction === 'yellow' || sanction === 'second_yellow_red' ? 1 : 0
  const redIncrement = sanction === 'straight_red' || sanction === 'second_yellow_red' ? 1 : 0
  yellowLedger.set(key, (yellowLedger.get(key) ?? 0) + yellowIncrement)
  if (redIncrement) redLedger.add(key)

  if (scope === 'shootout') {
    const shootout = projection.shootout
    if (!shootout) return 'Shootout discipline requires an active shootout.'
    const prefix = event.teamSide === 'tracked' ? 'tracked' : 'opponent'
    if (yellowIncrement) shootout.cards[`${prefix}Yellow`] += yellowIncrement
    if (redIncrement) shootout.cards[`${prefix}Red`] += redIncrement
    if (event.teamSide === 'tracked' && actor.participantId) {
      const discipline = projection.participantDiscipline[actor.participantId]
      if (discipline) {
        discipline.shootoutYellowCards += yellowIncrement
        discipline.shootoutRedCards += redIncrement
      }
    }
    if (resolution !== null) return 'Shootout cards use eligibility events instead of lineup resolution.'
    return null
  }

  const totals = projection.sideTotals[event.teamSide]
  totals.yellowCards += yellowIncrement
  totals.redCards += redIncrement
  if (actor.kind === 'staff') {
    totals.staffYellowCards += yellowIncrement
    totals.staffRedCards += redIncrement
  } else if (actor.kind === 'team') {
    totals.teamAttributedCards += yellowIncrement + redIncrement
  } else if (actor.kind === 'unknown' && !actor.participantId) {
    totals.unknownAttributedCards += yellowIncrement + redIncrement
  }
  if (event.teamSide === 'tracked' && actor.participantId) {
    const discipline = projection.participantDiscipline[actor.participantId]
    if (discipline) {
      discipline.normalYellowCards += yellowIncrement
      discipline.redCards += redIncrement
      discipline.ejected = discipline.ejected || redIncrement > 0
    }
    if (yellowIncrement) incrementActorStat(projection, actor, 'yellowCards', yellowIncrement)
    if (redIncrement) incrementActorStat(projection, actor, 'redCards', redIncrement)
  }

  if (event.teamSide !== 'tracked' || !actor.participantId) {
    return resolution === null ? null : 'Only a tracked participant can carry lineup resolution.'
  }
  return applyDisciplineLineupResolution(
    projection,
    event,
    actor,
    sanction,
    resolution,
    context
  )
}

function applyDisciplineLineupResolution(
  projection: SoccerMatchProjection,
  event: Extract<SoccerMatchEvent, { eventType: 'soccer.foul' | 'soccer.card' }>,
  actor: GameEventActor,
  sanction: SoccerCardSanction,
  resolution: SoccerDisciplineLineupResolution | null,
  context: SoccerSoc4ProjectionContext
): string | null {
  if (!actor.participantId || event.elapsedMs === null) return 'Lineup resolution requires a timed participant card.'
  if (!resolution || resolution.cardedParticipantId !== actor.participantId) {
    return 'Tracked player discipline requires a matching atomic lineup resolution.'
  }
  const participant = projection.participants[actor.participantId]
  if (!participant) return 'Carded participant is unavailable.'
  const participantRole = roleAt(participant, event.period.id, event.elapsedMs)
  if (!participantRole) return 'Carded participant has no role at the event time.'
  const onFieldBefore = Object.values(projection.participants).filter(item =>
    participantWasOnField(item, event.period.id, event.elapsedMs!)
  ).length
  const expectedExit = sanction === 'yellow'
    ? projection.currentRules.yellowCardExitPolicy === 'stay_on' ? 'none' : 'temporary'
    : 'ejected'
  if (resolution.exit !== expectedExit) return 'Card lineup exit does not match the snapshotted rules.'
  if (resolution.exit === 'none') {
    return resolution.replacementChanges.length === 0
      ? null
      : 'A stay-on yellow cannot include replacement changes.'
  }

  const laterDependency = context.activeEvents.find(candidate =>
    candidate.id !== event.id &&
    candidate.sequence < event.sequence &&
    candidate.period.id === event.period.id &&
    candidate.elapsedMs !== null &&
    candidate.elapsedMs > event.elapsedMs! &&
    eventReferencesParticipant(candidate, actor.participantId!)
  )
  if (laterDependency) {
    return `Later event ${laterDependency.id} depends on the carded participant's prior lineup state.`
  }

  const interval = participant.onFieldIntervals.find(item =>
    item.periodId === event.period.id &&
    event.elapsedMs! >= item.startElapsedMs &&
    (item.endElapsedMs === null || event.elapsedMs! <= item.endElapsedMs)
  )
  if (!interval) return 'Carded participant was not on field at the event time.'
  if (interval.endElapsedMs !== null && interval.endElapsedMs > event.elapsedMs) {
    return 'Later lineup history still depends on the carded participant being on field.'
  }

  interval.endElapsedMs = event.elapsedMs
  const roleInterval = participant.roleIntervals.find(item =>
    item.periodId === event.period.id &&
    event.elapsedMs! >= item.startElapsedMs &&
    (item.endElapsedMs === null || event.elapsedMs! <= item.endElapsedMs)
  )
  if (roleInterval) roleInterval.endElapsedMs = event.elapsedMs
  if (participant.status === 'on_field' && isLatestStartedPeriod(projection, event.period.id)) {
    closeActiveTime(participant, event.elapsedMs)
    participant.status = 'left'
    participant.hasExited = true
  }

  const changes = resolution.replacementChanges
  if (sanction === 'yellow') {
    if (changes.length > 1 || changes.some(change => change.playerOutParticipantId !== null)) {
      return 'Yellow-card replacement may contain one entry-only change.'
    }
  } else if (participantRole.group !== 'goalkeeper' && changes.length > 0) {
    return 'A non-goalkeeper red card cannot include a replacement.'
  } else if (
    participantRole.group === 'goalkeeper' &&
    (
      changes.length !== 1 ||
      changes[0].playerOutParticipantId === null ||
      changes[0].playerInParticipantId === null ||
      changes[0].playerInRole?.group !== 'goalkeeper'
    )
  ) {
    return 'Goalkeeper red-card handoff requires one field player out and one goalkeeper in.'
  }
  if (
    sanction === 'yellow' &&
    participantRole.group === 'goalkeeper' &&
    (
      changes.length !== 1 ||
      changes[0].playerInParticipantId === null ||
      changes[0].playerInRole?.group !== 'goalkeeper'
    )
  ) {
    return 'A temporarily exiting goalkeeper requires an immediate goalkeeper replacement.'
  }

  for (const change of changes) {
    const error = applyDisciplineReplacementChange(projection, event, change)
    if (error) return error
  }
  const incomingCount = changes.filter(change => change.playerInParticipantId !== null).length
  projection.substitutionCount += incomingCount
  if (resolution.countsAsSubstitutionWindow) projection.substitutionWindowCount += 1
  if (
    projection.currentRules.substitutionLimit !== null &&
    projection.substitutionCount > projection.currentRules.substitutionLimit
  ) return 'Discipline replacement exceeds the substitution limit.'
  if (
    projection.currentRules.substitutionWindowLimit !== null &&
    projection.substitutionWindowCount > projection.currentRules.substitutionWindowLimit
  ) return 'Discipline replacement exceeds the substitution-window limit.'
  const onFieldAfter = onFieldCountAfterMoment(projection, event.period.id, event.elapsedMs)
  const expectedOnField = onFieldBefore - 1 +
    changes.filter(change => change.playerInParticipantId !== null).length -
    changes.filter(change => change.playerOutParticipantId !== null).length
  if (onFieldAfter !== expectedOnField) return 'Discipline resolution changed the wrong on-field count.'
  return validateGoalkeeperCountAt(projection, event.period.id, event.elapsedMs)
}

function applyDisciplineReplacementChange(
  projection: SoccerMatchProjection,
  event: Extract<SoccerMatchEvent, { eventType: 'soccer.foul' | 'soccer.card' }>,
  change: SoccerDisciplineLineupResolution['replacementChanges'][number]
): string | null {
  const elapsedMs = event.elapsedMs!
  if (change.playerOutParticipantId) {
    const outgoing = projection.participants[change.playerOutParticipantId]
    if (!outgoing || !participantWasOnField(outgoing, event.period.id, elapsedMs)) {
      return 'Discipline replacement outgoing participant was not on field.'
    }
    const interval = outgoing.onFieldIntervals.find(item =>
      item.periodId === event.period.id &&
      elapsedMs >= item.startElapsedMs &&
      (item.endElapsedMs === null || elapsedMs <= item.endElapsedMs)
    )
    if (interval?.endElapsedMs !== null && interval?.endElapsedMs !== elapsedMs) {
      return 'Later lineup history still depends on the replacement participant being on field.'
    }
    if (interval) interval.endElapsedMs = elapsedMs
    const roleInterval = outgoing.roleIntervals.find(item =>
      item.periodId === event.period.id &&
      elapsedMs >= item.startElapsedMs &&
      (item.endElapsedMs === null || elapsedMs <= item.endElapsedMs)
    )
    if (roleInterval) roleInterval.endElapsedMs = elapsedMs
    if (outgoing.status === 'on_field' && isLatestStartedPeriod(projection, event.period.id)) {
      closeActiveTime(outgoing, elapsedMs)
      outgoing.status = 'left'
      outgoing.hasExited = true
    }
  }
  if (change.playerInParticipantId) {
    const incoming = projection.participants[change.playerInParticipantId]
    if (!incoming || participantWasOnField(incoming, event.period.id, elapsedMs)) {
      return 'Discipline replacement incoming participant must be off field.'
    }
    if (incoming.hasExited && !projection.currentRules.allowReturnSubstitutions) {
      return 'Return substitutions are disabled for the replacement participant.'
    }
    const periodEnd = projection.periodEndElapsedMsById[event.period.id]
    const endElapsedMs = projection.currentPeriodId === event.period.id ? null : periodEnd
    incoming.role = structuredClone(change.playerInRole ?? incoming.role)
    incoming.onFieldIntervals.push({ periodId: event.period.id, startElapsedMs: elapsedMs, endElapsedMs })
    incoming.roleIntervals.push({
      periodId: event.period.id,
      startElapsedMs: elapsedMs,
      endElapsedMs,
      role: structuredClone(incoming.role),
    })
    incoming.onFieldIntervals.sort((a, b) => a.startElapsedMs - b.startElapsedMs)
    incoming.roleIntervals.sort((a, b) => a.startElapsedMs - b.startElapsedMs)
    incoming.appearances = Math.max(1, incoming.appearances)
    if (isLatestStartedPeriod(projection, event.period.id)) {
      incoming.status = 'on_field'
      incoming.activeSinceElapsedMs = projection.clock.running ? elapsedMs : null
    }
  }
  return null
}

function closeActiveTime(participant: SoccerProjectedParticipant, elapsedMs: number): void {
  if (participant.activeSinceElapsedMs === null) return
  participant.totalActiveMs += Math.max(0, elapsedMs - participant.activeSinceElapsedMs)
  participant.activeSinceElapsedMs = null
}

export function applySoccerShootoutEvent(
  projection: SoccerMatchProjection,
  event: SoccerShootoutEvent,
  context: SoccerSoc4ProjectionContext
): string | null {
  switch (event.eventType) {
    case 'soccer.shootout_started':
      return startShootout(projection, event)
    case 'soccer.shootout_eligibility_changed':
      return changeShootoutEligibility(projection, event, context)
    case 'soccer.shootout_goalkeeper_changed':
      return changeShootoutGoalkeeper(projection, event)
    case 'soccer.shootout_kick':
      return applyShootoutKick(projection, event, context)
    case 'soccer.card':
      return applyCard(projection, event, context, 'shootout')
  }
}

function startShootout(
  projection: SoccerMatchProjection,
  event: Extract<SoccerShootoutEvent, { eventType: 'soccer.shootout_started' }>
): string | null {
  if (projection.status !== 'period_break' || projection.shootout) {
    return 'Shootout can start only once from a period break.'
  }
  if (projection.currentRules.tieResolution === 'draw_allowed') {
    return 'Match rules do not allow a shootout.'
  }
  if (projection.sideTotals.tracked.score !== projection.sideTotals.opponent.score) {
    return 'Shootout requires a tied normal match score.'
  }
  const requiredSegments = projection.currentRules.tieResolution === 'extra_time_then_shootout'
    ? orderedSoccerSegments(projection.currentRules)
    : projection.currentRules.regulationSegments
  if (!requiredSegments.every(segment => projection.completedPeriodIds.includes(segment.id))) {
    return 'Every required normal segment must be complete before a shootout.'
  }
  const shootoutOrder = Math.max(...orderedSoccerSegments(projection.currentRules).map(item => item.order), 0) + 1
  if (event.period.order !== shootoutOrder) return 'Shootout period order is invalid.'
  if (event.payload.initialKicksPerSide !== projection.currentRules.shootoutInitialKicksPerSide) {
    return 'Shootout initial kick count must match the snapshotted match rules.'
  }
  const finalOnField = Object.values(projection.participants)
    .filter(participant => participant.status === 'on_field')
    .map(participant => participant.participantId)
    .sort()
  const reviewed = [
    ...event.payload.trackedEligibleParticipantIds,
    ...event.payload.trackedExcludedParticipantIds,
  ].sort()
  if (JSON.stringify(finalOnField) !== JSON.stringify(reviewed)) {
    return 'Shootout eligibility review must account for every final on-field participant.'
  }
  if (event.payload.trackedEligibleParticipantIds.length !== event.payload.opponentEligibleCount) {
    return 'Shootout eligible-player counts must be equalized.'
  }
  if (!event.payload.trackedEligibleParticipantIds.includes(event.payload.trackedGoalkeeperParticipantId)) {
    return 'Tracked shootout goalkeeper must be eligible.'
  }
  const goalkeeper = projection.participants[event.payload.trackedGoalkeeperParticipantId]
  if (!goalkeeper || goalkeeper.role.group !== 'goalkeeper') {
    return 'Tracked shootout goalkeeper must be the final goalkeeper.'
  }
  projection.status = 'shootout'
  projection.shootout = {
    firstKickingSide: event.payload.firstKickingSide,
    initialKicksPerSide: event.payload.initialKicksPerSide,
    trackedEligibleParticipantIds: [...event.payload.trackedEligibleParticipantIds],
    trackedExcludedParticipantIds: [...event.payload.trackedExcludedParticipantIds],
    opponentEligibleCount: event.payload.opponentEligibleCount,
    currentGoalkeepers: {
      tracked: `participant:${event.payload.trackedGoalkeeperParticipantId}`,
      opponent: 'unknown:unknown',
    },
    kicks: [],
    score: { tracked: 0, opponent: 0 },
    attempts: { tracked: 0, opponent: 0 },
    saves: { tracked: 0, opponent: 0 },
    cards: {
      trackedYellow: 0,
      trackedRed: 0,
      opponentYellow: 0,
      opponentRed: 0,
    },
    nextSide: event.payload.firstKickingSide,
    decided: false,
    winner: null,
    suddenDeathRound: null,
  }
  return null
}

function changeShootoutEligibility(
  projection: SoccerMatchProjection,
  event: Extract<SoccerShootoutEvent, { eventType: 'soccer.shootout_eligibility_changed' }>,
  context: SoccerSoc4ProjectionContext
): string | null {
  const shootout = projection.shootout
  if (projection.status !== 'shootout' || !shootout || shootout.decided) {
    return 'Shootout eligibility can change only during an undecided shootout.'
  }
  if (event.payload.trackedEligibleParticipantIds.length !== event.payload.opponentEligibleCount) {
    return 'Shootout eligible-player counts must remain equalized.'
  }
  if (!event.payload.trackedEligibleParticipantIds.every(id => projection.participants[id])) {
    return 'Shootout eligibility references an unknown tracked participant.'
  }
  for (const id of event.payload.trackedEligibleParticipantIds) {
    if (context.shootoutRedActors.has(`tracked:participant:${id}`)) {
      return 'A sent-off participant cannot remain shootout eligible.'
    }
  }
  shootout.trackedEligibleParticipantIds = [...event.payload.trackedEligibleParticipantIds]
  shootout.trackedExcludedParticipantIds = [...event.payload.trackedExcludedParticipantIds]
  shootout.opponentEligibleCount = event.payload.opponentEligibleCount
  return null
}

function changeShootoutGoalkeeper(
  projection: SoccerMatchProjection,
  event: Extract<SoccerShootoutEvent, { eventType: 'soccer.shootout_goalkeeper_changed' }>
): string | null {
  const shootout = projection.shootout
  if (projection.status !== 'shootout' || !shootout || shootout.decided) {
    return 'Goalkeeper can change only during an undecided shootout.'
  }
  const outgoing = actorForRole(event.actors, 'goalkeeper_out')
  const incoming = actorForRole(event.actors, 'goalkeeper_in')
  if (!outgoing || !incoming) return 'Goalkeeper change requires outgoing and incoming actors.'
  const outgoingKey = shootoutActorKey(outgoing)
  const incomingKey = shootoutActorKey(incoming)
  if (outgoingKey !== shootout.currentGoalkeepers[event.teamSide]) {
    return 'Outgoing goalkeeper does not match the current shootout goalkeeper.'
  }
  if (event.teamSide === 'tracked') {
    if (!incoming.participantId || !shootout.trackedEligibleParticipantIds.includes(incoming.participantId)) {
      if (
        event.payload.reason !== 'unable_to_continue' ||
        !projection.currentRules.allowUnusedGoalkeeperShootoutReplacement ||
        !incoming.participantId ||
        !projection.participants[incoming.participantId]
      ) return 'Incoming tracked goalkeeper is not eligible for this change.'
    }
  } else if (incoming.participantId) {
    return 'Opponent goalkeeper cannot reference a tracked participant.'
  }
  shootout.currentGoalkeepers[event.teamSide] = incomingKey
  return null
}

function applyShootoutKick(
  projection: SoccerMatchProjection,
  event: Extract<SoccerShootoutEvent, { eventType: 'soccer.shootout_kick' }>,
  context: SoccerSoc4ProjectionContext
): string | null {
  const shootout = projection.shootout
  if (projection.status !== 'shootout' || !shootout || shootout.decided) {
    return 'Kick requires an active undecided shootout.'
  }
  if (event.teamSide !== shootout.nextSide) return 'Kick was recorded for the wrong shootout side.'
  const kicker = actorForRole(event.actors, 'kicker')
  const goalkeeper = actorForRole(event.actors, 'goalkeeper')
  if (!kicker || !goalkeeper) return 'Shootout kick requires kicker and goalkeeper actors.'
  if (shootout.trackedEligibleParticipantIds.some(id =>
    context.shootoutRedActors.has(`tracked:participant:${id}`)
  )) return 'Shootout eligibility must be equalized after a tracked send-off before the next kick.'
  const kickerError = validateShootoutKicker(projection, event.teamSide, kicker, event.payload.anonymousKickerSlot)
  if (kickerError) return kickerError
  const goalkeeperSide = oppositeSide(event.teamSide)
  const goalkeeperKey = shootoutActorKey(goalkeeper)
  if (goalkeeper.participantId && goalkeeperSide === 'opponent') {
    return 'Opponent goalkeeper cannot reference a tracked participant.'
  }
  if (goalkeeperKey !== shootout.currentGoalkeepers[goalkeeperSide] && goalkeeper.kind !== 'unknown') {
    return 'Kick goalkeeper does not match the designated defending goalkeeper.'
  }
  if (context.shootoutRedActors.has(`${goalkeeperSide}:${goalkeeperKey}`)) {
    return 'A sent-off goalkeeper must be replaced before the next kick.'
  }

  const kickerKey = shootoutKickerKey(kicker, event.payload.anonymousKickerSlot)
  const latestKick = shootout.kicks[shootout.kicks.length - 1]
  const pendingRetake = latestKick?.outcome === 'retake'
    ? latestKick
    : null
  if (pendingRetake && (pendingRetake.teamSide !== event.teamSide || pendingRetake.kickerKey !== kickerKey)) {
    return 'Retaken kick must preserve side and kicker.'
  }
  if (!pendingRetake) {
    const uniqueCount = event.teamSide === 'tracked'
      ? shootout.trackedEligibleParticipantIds.length
      : shootout.opponentEligibleCount
    const completedForSide = shootout.kicks.filter(kick => kick.teamSide === event.teamSide && kick.advances)
    const cycleStart = Math.floor(completedForSide.length / uniqueCount) * uniqueCount
    if (completedForSide.slice(cycleStart).some(kick => kick.kickerKey === kickerKey)) {
      return 'A kicker cannot repeat before every eligible slot has kicked in this round.'
    }
  }

  const advances = event.payload.outcome !== 'retake'
  const scored = event.payload.outcome === 'scored'
  const kickNumber = shootout.kicks.filter(kick => kick.teamSide === event.teamSide && kick.advances).length + 1
  const round = Math.min(shootout.attempts.tracked, shootout.attempts.opponent) + 1
  const suddenDeath = shootout.attempts.tracked >= shootout.initialKicksPerSide &&
    shootout.attempts.opponent >= shootout.initialKicksPerSide
  shootout.kicks.push({
    eventId: event.id,
    teamSide: event.teamSide,
    outcome: event.payload.outcome,
    kickerKey,
    goalkeeperKey,
    kickNumber,
    round,
    suddenDeath,
    advances,
    scored,
  })
  if (!advances) return null
  shootout.attempts[event.teamSide] += 1
  if (scored) shootout.score[event.teamSide] += 1
  if (event.payload.outcome === 'saved') shootout.saves[goalkeeperSide] += 1
  updateShootoutDecision(shootout)
  if (!shootout.decided) shootout.nextSide = oppositeSide(event.teamSide)
  return null
}

function validateShootoutKicker(
  projection: SoccerMatchProjection,
  side: 'tracked' | 'opponent',
  actor: GameEventActor,
  anonymousSlot: number | null
): string | null {
  const shootout = projection.shootout!
  if (side === 'tracked' && actor.participantId) {
    if (!shootout.trackedEligibleParticipantIds.includes(actor.participantId)) {
      return 'Tracked shootout kicker is not eligible.'
    }
    return anonymousSlot === null ? null : 'Known participant kicker cannot use an anonymous slot.'
  }
  if (side === 'opponent' && actor.participantId) {
    return 'Opponent shootout kicker cannot reference a tracked participant.'
  }
  if (actor.kind === 'team' || (actor.kind === 'unknown' && actor.label.toLowerCase() === 'unknown')) {
    return anonymousSlot === null ? 'Anonymous shootout kicker requires a stable slot.' : null
  }
  return anonymousSlot === null ? null : 'Known labeled kicker cannot use an anonymous slot.'
}

function updateShootoutDecision(shootout: SoccerShootoutProjection): void {
  const initial = shootout.initialKicksPerSide
  const trackedRemaining = Math.max(0, initial - shootout.attempts.tracked)
  const opponentRemaining = Math.max(0, initial - shootout.attempts.opponent)
  if (shootout.score.tracked > shootout.score.opponent + opponentRemaining) {
    decideShootout(shootout, 'tracked')
    return
  }
  if (shootout.score.opponent > shootout.score.tracked + trackedRemaining) {
    decideShootout(shootout, 'opponent')
    return
  }
  if (
    shootout.attempts.tracked >= initial &&
    shootout.attempts.opponent >= initial &&
    shootout.attempts.tracked === shootout.attempts.opponent
  ) {
    if (shootout.score.tracked !== shootout.score.opponent) {
      decideShootout(
        shootout,
        shootout.score.tracked > shootout.score.opponent ? 'tracked' : 'opponent'
      )
    } else {
      shootout.suddenDeathRound = shootout.attempts.tracked - initial + 1
    }
  }
}

function decideShootout(
  shootout: SoccerShootoutProjection,
  winner: 'tracked' | 'opponent'
): void {
  shootout.decided = true
  shootout.winner = winner
}

function validateNormalMoment(
  projection: SoccerMatchProjection,
  event: SoccerNormalIncident
): string | null {
  if (!projection.openingLineupRecorded || event.elapsedMs === null) {
    return 'Normal-match incidents require an initialized lineup and canonical elapsed time.'
  }
  const segment = orderedSoccerSegments(projection.currentRules)
    .find(item => item.id === event.period.id)
  if (!segment || segment.order !== event.period.order) return 'Incident period is invalid.'
  if (!projection.startedPeriodIds.includes(event.period.id)) return 'Incident period has not started.'
  if (projection.currentPeriodId === event.period.id) {
    const maximumElapsed = projection.clock.running && projection.clock.anchorOccurredAt
      ? projection.clock.elapsedMs + Math.max(
          0,
          Date.parse(event.occurredAt) - Date.parse(projection.clock.anchorOccurredAt)
        )
      : projection.clock.elapsedMs
    if (event.elapsedMs > maximumElapsed) return 'Incident time is ahead of the canonical clock.'
  } else if (projection.suspendedContext?.periodId === event.period.id) {
    if (event.elapsedMs > projection.suspendedContext.elapsedMs) {
      return 'Incident time is after the suspended match time.'
    }
  } else {
    const periodEnd = projection.periodEndElapsedMsById[event.period.id]
    if (periodEnd === undefined || event.elapsedMs > periodEnd) {
      return 'Incident time is outside the recorded period bounds.'
    }
  }
  return null
}

function validateIncidentActor(
  projection: SoccerMatchProjection,
  actor: GameEventActor,
  side: 'tracked' | 'opponent',
  event: Pick<SoccerMatchEvent, 'period' | 'elapsedMs'>,
  allowTeam: boolean,
  allowUnknown: boolean,
  skipOnField = false
): string | null {
  if (side === 'opponent') {
    if (actor.participantId) return 'cannot reference a tracked participant for the opponent.'
    if (actor.kind === 'unknown' || (allowTeam && actor.kind === 'team')) return null
    return 'must use an opponent label or team attribution.'
  }
  if (allowTeam && actor.kind === 'team' && !actor.participantId) return null
  if (allowUnknown && actor.kind === 'unknown' && !actor.participantId) return null
  if (!actor.participantId || (actor.kind !== 'player' && actor.kind !== 'unknown')) {
    return 'must reference a tracked match participant.'
  }
  const participant = projection.participants[actor.participantId]
  if (!participant) return 'references an unknown match participant.'
  if (actor.kind === 'player' && participant.playerId !== actor.playerId) {
    return 'player identity does not match the match participant.'
  }
  if (!skipOnField && event.elapsedMs !== null && !participantWasOnField(
    participant,
    event.period.id,
    event.elapsedMs
  )) return 'was not on field at the event time.'
  return null
}

function participantWasOnField(
  participant: SoccerProjectedParticipant,
  periodId: string,
  elapsedMs: number
): boolean {
  return participant.onFieldIntervals.some(interval =>
    interval.periodId === periodId &&
    elapsedMs >= interval.startElapsedMs &&
    (interval.endElapsedMs === null || elapsedMs <= interval.endElapsedMs)
  )
}

function validateGoalkeeperCountAt(
  projection: SoccerMatchProjection,
  periodId: string,
  elapsedMs: number
): string | null {
  const goalkeepers = Object.values(projection.participants).filter(participant =>
    participantIsOnFieldAfterMoment(participant, periodId, elapsedMs) &&
    roleAt(participant, periodId, elapsedMs)?.group === 'goalkeeper'
  )
  return goalkeepers.length === 1
    ? null
    : 'Discipline resolution must leave exactly one goalkeeper on field.'
}

function onFieldCountAfterMoment(
  projection: SoccerMatchProjection,
  periodId: string,
  elapsedMs: number
): number {
  return Object.values(projection.participants).filter(participant =>
    participantIsOnFieldAfterMoment(participant, periodId, elapsedMs)
  ).length
}

function participantIsOnFieldAfterMoment(
  participant: SoccerProjectedParticipant,
  periodId: string,
  elapsedMs: number
): boolean {
  return participant.onFieldIntervals.some(interval =>
    interval.periodId === periodId &&
    elapsedMs >= interval.startElapsedMs &&
    (interval.endElapsedMs === null || elapsedMs < interval.endElapsedMs)
  )
}

function isLatestStartedPeriod(projection: SoccerMatchProjection, periodId: string): boolean {
  return projection.startedPeriodIds[projection.startedPeriodIds.length - 1] === periodId
}

function actorForRole(actors: GameEventActor[], role: string): GameEventActor | null {
  return actors.find(actor => actor.role === role) ?? null
}

function incrementActorStat(
  projection: SoccerMatchProjection,
  actor: GameEventActor,
  stat: keyof SoccerParticipantStatTotals,
  amount = 1
): void {
  if (!actor.participantId) return
  const totals = projection.participantStats[actor.participantId]
  if (totals) totals[stat] += amount
}

function disciplineActorKey(side: 'tracked' | 'opponent', actor: GameEventActor): string {
  if (actor.participantId) return `${side}:participant:${actor.participantId}`
  return `${side}:${actor.kind}:${(actor.label ?? actor.kind).trim().toLowerCase()}`
}

function shootoutActorKey(actor: GameEventActor): string {
  return actor.participantId
    ? `participant:${actor.participantId}`
    : `${actor.kind}:${(actor.label ?? actor.kind).trim().toLowerCase()}`
}

function shootoutKickerKey(actor: GameEventActor, anonymousSlot: number | null): string {
  return anonymousSlot === null ? shootoutActorKey(actor) : `anonymous:${anonymousSlot}`
}

function oppositeSide(side: 'tracked' | 'opponent'): 'tracked' | 'opponent' {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

function eventReferencesParticipant(event: SoccerMatchEvent, participantId: string): boolean {
  if (event.actors.some(actor => actor.participantId === participantId)) return true
  switch (event.eventType) {
    case 'soccer.substitution_window':
      return event.payload.changes.some(change =>
        change.playerOutParticipantId === participantId ||
        change.playerInParticipantId === participantId
      )
    case 'soccer.role_changed':
      return event.payload.changes.some(change => change.participantId === participantId)
    case 'soccer.match_roster_added':
      return event.payload.participant.id === participantId
    case 'soccer.participant_resolved':
      return event.payload.participantId === participantId
    case 'soccer.foul':
    case 'soccer.card':
      return event.payload.lineupResolution?.replacementChanges.some(change =>
        change.playerOutParticipantId === participantId ||
        change.playerInParticipantId === participantId
      ) ?? false
    case 'soccer.shootout_started':
      return event.payload.trackedEligibleParticipantIds.includes(participantId) ||
        event.payload.trackedExcludedParticipantIds.includes(participantId)
    case 'soccer.shootout_eligibility_changed':
      return event.payload.trackedEligibleParticipantIds.includes(participantId) ||
        event.payload.trackedExcludedParticipantIds.includes(participantId)
    default:
      return false
  }
}

export function roleAt(
  participant: SoccerProjectedParticipant,
  periodId: string,
  elapsedMs: number
): SoccerRole | null {
  return participant.roleIntervals.find(interval =>
    interval.periodId === periodId &&
    elapsedMs >= interval.startElapsedMs &&
    (interval.endElapsedMs === null || elapsedMs <= interval.endElapsedMs)
  )?.role ?? null
}
