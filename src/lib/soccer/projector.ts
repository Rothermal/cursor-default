import type { GameState } from '../../types'
import type {
  GameEvent,
  GameEventActor,
  GameEventDiagnostic,
  GameEventProjection,
  SportGameEventProjectionResult,
  SportGameEventProjector,
} from '../gameEvents/types'
import { normalizeSoccerMatchRules, orderedSoccerSegments, validateSoccerMatchRules } from './rules'
import { createSoccerMatchProjection, emptyParticipantStats } from './state'
import {
  applySoccerBlockedShotTotals,
  applySoccerNormalIncident,
  applySoccerShootoutEvent,
  compareSoccerIncidentTime,
  createSoccerSoc4ProjectionContext,
  isSoccerNormalIncident,
  isSoccerShootoutEvent,
  validateSoccerShotSource,
  type SoccerSoc4ProjectionContext,
} from './soc4'
import type {
  SoccerAttackingDirection,
  SoccerMatchEvent,
  SoccerMatchProjection,
  SoccerMatchRules,
  SoccerParticipantStatTotals,
  SoccerProjectedParticipant,
  SoccerRole,
  SoccerSportGameState,
} from './types'

export const soccerGameEventProjector: SportGameEventProjector<GameEvent> = {
  sportId: 'soccer',
  requiresSportGameState: true,
  project: projectSoccerMatchEvents,
}

export function projectSoccerMatchEvents(
  state: GameState,
  events: GameEvent[]
): SportGameEventProjectionResult {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'soccer') {
    return {
      projection: emptyProjection(state, state.sportGameState),
      diagnostics: [diagnostic(null, 'Soccer event projection requires a valid soccer setup.')],
    }
  }

  const soccerEvents = [...events]
    .filter((event): event is SoccerMatchEvent => event.sportId === 'soccer')
    .sort(compareSoccerCaptureOrder)
  let projection = createSoccerMatchProjection(sportState.setup)
  const diagnostics: GameEventDiagnostic[] = []
  const seenSequences = new Set<string>()
  const soc4Context = createSoccerSoc4ProjectionContext(soccerEvents)
  const pendingIncidents: SoccerMatchEvent[] = []
  let failedEvent: SoccerMatchEvent | null = null
  let failureMessage: string | null = null

  for (const event of soccerEvents) {
    const sequenceKey = `${event.recorderUserId ?? 'local'}\u0000${event.sequence}`
    if (seenSequences.has(sequenceKey)) {
      failedEvent = event
      failureMessage = `Capture sequence ${event.sequence} is duplicated for this recorder.`
      break
    }
    seenSequences.add(sequenceKey)

    if (isNormalStatEvent(event)) {
      pendingIncidents.push(event)
      continue
    }
    // Apply timed incidents before later lifecycle or lineup mutations close their intervals.
    const flushed = flushSoccerIncidents(
      projection,
      pendingIncidents,
      sportState,
      state,
      soc4Context
    )
    projection = flushed.projection
    if (flushed.errorEvent) {
      failedEvent = flushed.errorEvent
      failureMessage = flushed.message
      break
    }
    const next = structuredClone(projection)
    const error = applySoccerEvent(next, sportState, event, state, soc4Context)
    if (error) {
      failedEvent = event
      failureMessage = error
      break
    }
    projection = next
  }

  if (!failedEvent) {
    const flushed = flushSoccerIncidents(
      projection,
      pendingIncidents,
      sportState,
      state,
      soc4Context
    )
    projection = flushed.projection
    failedEvent = flushed.errorEvent
    failureMessage = flushed.message
  }

  if (!failedEvent && projection.status === 'ended' && projection.endReason === 'completed') {
    const outcomeError = deriveCompletedMatchOutcome(projection)
    if (outcomeError) {
      failedEvent = [...soccerEvents].reverse().find(event =>
        event.eventType === 'soccer.match_ended' && event.payload.reason === 'completed'
      ) ?? null
      failureMessage = outcomeError
    }
  }

  if (failedEvent && failureMessage) {
    diagnostics.push(diagnostic(failedEvent.id, failureMessage))
    for (const unprojected of soccerEvents.filter(event => event.id !== failedEvent?.id)) {
      if (unprojected.sequence <= failedEvent.sequence) continue
      diagnostics.push({
        code: 'unprojected_event',
        message: 'Event was preserved but not projected because earlier match history is invalid.',
        eventId: unprojected.id,
      })
    }
  }

  const nextSportState: SoccerSportGameState = {
    ...sportState,
    projection,
  }
  return {
    projection: buildProjection(state, nextSportState),
    diagnostics,
  }
}

function applySoccerEvent(
  projection: SoccerMatchProjection,
  sportState: SoccerSportGameState,
  event: SoccerMatchEvent,
  gameState: GameState,
  soc4Context: SoccerSoc4ProjectionContext
): string | null {
  const statEvent = isAttackingEvent(event) || isSoccerNormalIncident(event) || isSoccerShootoutEvent(event)
  if (!statEvent && projection.clock.running && event.eventType === 'soccer.clock_adjusted') {
    const error = advanceRunningClock(projection, event.payload.fromElapsedMs, event.occurredAt)
    if (error) return error
  }
  if (!statEvent && projection.clock.running && event.elapsedMs !== null && ![
    'soccer.clock_paused',
    'soccer.clock_adjusted',
  ].includes(event.eventType)) {
    const error = advanceRunningClock(projection, event.elapsedMs, event.occurredAt)
    if (error) return error
  }

  switch (event.eventType) {
    case 'soccer.opening_lineup':
      return applyOpeningLineup(projection, sportState, event.payload.starters)
    case 'soccer.period_started':
      return applyPeriodStarted(projection, event.payload.periodId, event.period.id)
    case 'soccer.period_ended':
      return applyPeriodEnded(projection, event.payload.periodId, event.period.id)
    case 'soccer.clock_started':
      return applyClockStarted(projection, event.payload.anchorElapsedMs, event.elapsedMs, event.occurredAt)
    case 'soccer.clock_paused':
      return applyClockPaused(projection, event.payload.elapsedMs, event.elapsedMs)
    case 'soccer.clock_adjusted':
      return applyClockAdjusted(projection, event.payload.fromElapsedMs, event.payload.toElapsedMs, event.elapsedMs, event.occurredAt)
    case 'soccer.match_rules_changed':
      return applyRulesChanged(projection, event.payload.rules)
    case 'soccer.substitution_window':
      return applySubstitutionWindow(projection, event.payload.changes, event.payload.halftime, event.elapsedMs)
    case 'soccer.role_changed':
      return applyRoleChanges(projection, event.payload.changes, event.elapsedMs)
    case 'soccer.attacking_direction_changed':
      if (projection.status !== 'in_progress' && projection.status !== 'period_break') {
        return 'Attacking direction can only change during an active match.'
      }
      projection.attackingDirection = event.payload.direction
      return null
    case 'soccer.match_roster_added':
      return applyRosterAddition(projection, event.payload.participant, event.payload.destination, event.elapsedMs)
    case 'soccer.participant_resolved':
      return applyParticipantResolution(projection, event.payload, gameState)
    case 'soccer.match_ended':
      return applyMatchEnded(projection, event.payload.reason, event.occurredAt)
    case 'soccer.match_reopened':
      return applyMatchReopened(projection)
    case 'soccer.shot':
      {
        const sourceError = validateSoccerShotSource(event, soc4Context)
        if (sourceError) return sourceError
        const shotError = applyShot(projection, event)
        if (!shotError) applySoccerBlockedShotTotals(projection, event)
        return shotError
      }
    case 'soccer.own_goal':
      return applyOwnGoal(projection, event)
    case 'soccer.score_adjustment':
      return applyScoreAdjustment(projection, event)
    case 'soccer.defensive_action':
    case 'soccer.foul':
    case 'soccer.team_event':
      return applySoccerNormalIncident(projection, event, soc4Context)
    case 'soccer.card':
      return event.period.id === 'shootout'
        ? applySoccerShootoutEvent(projection, event, soc4Context)
        : applySoccerNormalIncident(projection, event, soc4Context)
    case 'soccer.shootout_started':
    case 'soccer.shootout_eligibility_changed':
    case 'soccer.shootout_goalkeeper_changed':
    case 'soccer.shootout_kick':
      return applySoccerShootoutEvent(projection, event, soc4Context)
  }
}

function isNormalStatEvent(event: SoccerMatchEvent): boolean {
  return isAttackingEvent(event) || isSoccerNormalIncident(event)
}

function flushSoccerIncidents(
  projection: SoccerMatchProjection,
  pendingIncidents: SoccerMatchEvent[],
  sportState: SoccerSportGameState,
  state: GameState,
  context: SoccerSoc4ProjectionContext
): {
  projection: SoccerMatchProjection
  errorEvent: SoccerMatchEvent | null
  message: string | null
} {
  const incidents = pendingIncidents.splice(0).sort(compareSoccerIncidentTime)
  let nextProjection = projection
  for (const event of incidents) {
    const candidate = structuredClone(nextProjection)
    const error = applySoccerEvent(candidate, sportState, event, state, context)
    if (error) return { projection: nextProjection, errorEvent: event, message: error }
    nextProjection = candidate
  }
  return { projection: nextProjection, errorEvent: null, message: null }
}

function applyOpeningLineup(
  projection: SoccerMatchProjection,
  sportState: SoccerSportGameState,
  starters: Array<{ participantId: string; role: SoccerRole }>
): string | null {
  if (projection.status !== 'not_started' || projection.openingLineupRecorded) {
    return 'Opening lineup can only be recorded once before the match starts.'
  }
  const expected = sportState.setup.participants
    .filter(participant => participant.initialStatus === 'starter')
    .map(participant => participant.id)
    .sort()
  const actual = starters.map(starter => starter.participantId).sort()
  if (new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    return 'Opening lineup must exactly match the setup starters.'
  }
  if (starters.length > projection.currentRules.maxOnFieldPlayers) {
    return 'Opening lineup exceeds the configured on-field player maximum.'
  }
  for (const starter of starters) {
    const participant = projection.participants[starter.participantId]
    if (!participant) return `Opening lineup references unknown participant ${starter.participantId}.`
    participant.status = 'on_field'
    participant.role = structuredClone(starter.role)
    participant.started = true
    participant.appearances = 1
  }
  const goalkeeperError = validateOnFieldGoalkeeper(projection)
  if (goalkeeperError) return goalkeeperError
  projection.openingLineupRecorded = true
  return null
}

function applyPeriodStarted(
  projection: SoccerMatchProjection,
  periodId: string,
  envelopePeriodId: string
): string | null {
  if (!projection.openingLineupRecorded || projection.clock.running || projection.currentPeriodId) {
    return 'A period cannot start in the current match state.'
  }
  if (projection.status !== 'not_started' && projection.status !== 'period_break') {
    return 'A period can only start before kickoff or during a period break.'
  }
  if (periodId !== envelopePeriodId) return 'Period payload and envelope ids must match.'
  const nextSegment = orderedSoccerSegments(projection.currentRules)
    .find(segment => !projection.completedPeriodIds.includes(segment.id))
  if (!nextSegment || nextSegment.id !== periodId) return 'The requested period is not the next available segment.'

  projection.currentPeriodId = periodId
  if (!projection.startedPeriodIds.includes(periodId)) projection.startedPeriodIds.push(periodId)
  projection.status = 'in_progress'
  projection.attackingDirection = directionForSegment(projection, nextSegment.id)
  projection.endedAt = null
  openOnFieldIntervals(projection, periodId, projection.clock.elapsedMs)
  return null
}

function applyPeriodEnded(
  projection: SoccerMatchProjection,
  periodId: string,
  envelopePeriodId: string
): string | null {
  if (projection.status !== 'in_progress' || projection.clock.running) {
    return 'Pause the clock before ending the active period.'
  }
  if (!projection.currentPeriodId || projection.currentPeriodId !== periodId || periodId !== envelopePeriodId) {
    return 'Only the active period can be ended.'
  }
  closeOnFieldIntervals(projection, periodId, projection.clock.elapsedMs)
  projection.periodEndElapsedMsById[periodId] = projection.clock.elapsedMs
  projection.completedPeriodIds.push(periodId)
  projection.currentPeriodId = null
  projection.status = 'period_break'
  return null
}

function applyClockStarted(
  projection: SoccerMatchProjection,
  anchorElapsedMs: number,
  eventElapsedMs: number | null,
  occurredAt: string
): string | null {
  if (projection.status !== 'in_progress' || !projection.currentPeriodId || projection.clock.running) {
    return 'Clock can only start in an active stopped period.'
  }
  if (eventElapsedMs !== anchorElapsedMs || anchorElapsedMs !== projection.clock.elapsedMs) {
    return 'Clock start must use the current canonical elapsed time.'
  }
  projection.clock = { running: true, elapsedMs: anchorElapsedMs, anchorOccurredAt: occurredAt }
  for (const participant of onFieldParticipants(projection)) {
    participant.activeSinceElapsedMs = anchorElapsedMs
  }
  return null
}

function applyClockPaused(
  projection: SoccerMatchProjection,
  elapsedMs: number,
  eventElapsedMs: number | null
): string | null {
  if (!projection.clock.running || eventElapsedMs !== elapsedMs) {
    return 'Clock pause requires a running clock and matching canonical elapsed time.'
  }
  if (elapsedMs < projection.clock.elapsedMs) return 'Clock pause cannot move elapsed time backward.'
  closeActiveIntervals(projection, elapsedMs)
  projection.clock = { running: false, elapsedMs, anchorOccurredAt: null }
  return null
}

function applyClockAdjusted(
  projection: SoccerMatchProjection,
  fromElapsedMs: number,
  toElapsedMs: number,
  eventElapsedMs: number | null,
  occurredAt: string
): string | null {
  if (fromElapsedMs !== projection.clock.elapsedMs || eventElapsedMs !== toElapsedMs) {
    return 'Clock correction must identify the current and corrected canonical times.'
  }
  if (projection.clock.running) {
    for (const participant of onFieldParticipants(projection)) {
      if (participant.activeSinceElapsedMs !== null && participant.activeSinceElapsedMs > toElapsedMs) {
        return 'Clock correction would place an active participant before their entry time.'
      }
    }
    projection.clock = { running: true, elapsedMs: toElapsedMs, anchorOccurredAt: occurredAt }
  } else {
    for (const participant of onFieldParticipants(projection)) {
      const interval = lastItem(participant.onFieldIntervals)
      if (interval?.endElapsedMs === null && interval.startElapsedMs > toElapsedMs) {
        return 'Clock correction would place an on-field participant before their entry time.'
      }
    }
    projection.clock = { running: false, elapsedMs: toElapsedMs, anchorOccurredAt: null }
  }
  return null
}

function applyRulesChanged(
  projection: SoccerMatchProjection,
  rules: SoccerMatchRules
): string | null {
  const normalizedRules = normalizeSoccerMatchRules(rules)
  const rulesError = normalizedRules ? null : validateSoccerMatchRules(rules)
  if (rulesError) return rulesError
  if (!normalizedRules) return 'Soccer match rules are invalid.'
  const oldSegments = orderedSoccerSegments(projection.currentRules)
  const nextSegments = orderedSoccerSegments(normalizedRules)
  for (const periodId of [...projection.completedPeriodIds, projection.currentPeriodId].filter(Boolean)) {
    const oldSegment = oldSegments.find(segment => segment.id === periodId)
    const nextSegment = nextSegments.find(segment => segment.id === periodId)
    if (!oldSegment || !nextSegment || JSON.stringify(oldSegment) !== JSON.stringify(nextSegment)) {
      return 'Completed and active period definitions cannot be rewritten mid-match.'
    }
  }
  if (onFieldParticipants(projection).length > normalizedRules.maxOnFieldPlayers) {
    return 'The new player maximum is below the current on-field count.'
  }
  if (normalizedRules.substitutionLimit !== null && normalizedRules.substitutionLimit < projection.substitutionCount) {
    return 'The new substitution limit is below substitutions already used.'
  }
  if (normalizedRules.substitutionWindowLimit !== null && normalizedRules.substitutionWindowLimit < projection.substitutionWindowCount) {
    return 'The new window limit is below windows already used.'
  }
  projection.currentRules = structuredClone(normalizedRules)
  return null
}

function applySubstitutionWindow(
  projection: SoccerMatchProjection,
  changes: Array<{
    playerOutParticipantId: string | null
    playerInParticipantId: string | null
    playerInRole: SoccerRole | null
  }>,
  halftime: boolean,
  elapsedMs: number | null
): string | null {
  if (projection.status !== 'in_progress' && projection.status !== 'period_break') {
    return 'Substitutions require an active match or period break.'
  }
  if (projection.status === 'in_progress' && elapsedMs === null) {
    return 'In-period substitutions require canonical elapsed time.'
  }
  if (!projection.clock.running && elapsedMs !== projection.clock.elapsedMs) {
    return 'A stopped-clock substitution must use the current canonical elapsed time.'
  }
  if (halftime && projection.status !== 'period_break') {
    return 'Halftime substitutions can only be recorded during a period break.'
  }
  const ids = changes.flatMap(change => [change.playerOutParticipantId, change.playerInParticipantId]).filter(Boolean)
  if (new Set(ids).size !== ids.length) return 'A participant can appear only once in a substitution window.'
  const incomingCount = changes.filter(change => change.playerInParticipantId !== null).length
  const nextSubstitutionCount = projection.substitutionCount + incomingCount
  const nextWindowCount = projection.substitutionWindowCount + (halftime ? 0 : 1)
  if (projection.currentRules.substitutionLimit !== null && nextSubstitutionCount > projection.currentRules.substitutionLimit) {
    return 'This substitution exceeds the configured match limit.'
  }
  if (projection.currentRules.substitutionWindowLimit !== null && nextWindowCount > projection.currentRules.substitutionWindowLimit) {
    return 'This substitution exceeds the configured window limit.'
  }

  for (const change of changes) {
    if (change.playerOutParticipantId) {
      const outgoing = projection.participants[change.playerOutParticipantId]
      if (!outgoing || outgoing.status !== 'on_field') return 'Every outgoing participant must be on field.'
      closeParticipantInterval(outgoing, elapsedMs ?? projection.clock.elapsedMs)
      closeOnFieldParticipantInterval(
        outgoing,
        projection.currentPeriodId,
        elapsedMs ?? projection.clock.elapsedMs
      )
      closeRoleInterval(outgoing, projection.currentPeriodId, elapsedMs ?? projection.clock.elapsedMs)
      outgoing.status = 'left'
      outgoing.hasExited = true
    }
    if (change.playerInParticipantId) {
      const incoming = projection.participants[change.playerInParticipantId]
      if (!incoming || incoming.status === 'on_field') return 'Every incoming participant must be off field.'
      if (incoming.hasExited && !projection.currentRules.allowReturnSubstitutions) {
        return 'Return substitutions are disabled for this match.'
      }
      incoming.status = 'on_field'
      incoming.role = structuredClone(change.playerInRole ?? incoming.role)
      incoming.appearances = Math.max(1, incoming.appearances)
      incoming.activeSinceElapsedMs = projection.clock.running ? elapsedMs : null
      if (projection.currentPeriodId) {
        openOnFieldParticipantInterval(incoming, projection.currentPeriodId, elapsedMs ?? projection.clock.elapsedMs)
        openRoleInterval(incoming, projection.currentPeriodId, elapsedMs ?? projection.clock.elapsedMs)
      }
    }
  }
  if (onFieldParticipants(projection).length > projection.currentRules.maxOnFieldPlayers) {
    return 'Substitution leaves too many players on field.'
  }
  const goalkeeperError = validateOnFieldGoalkeeper(projection)
  if (goalkeeperError) return goalkeeperError
  projection.substitutionCount = nextSubstitutionCount
  projection.substitutionWindowCount = nextWindowCount
  return null
}

function applyRoleChanges(
  projection: SoccerMatchProjection,
  changes: Array<{ participantId: string; role: SoccerRole }>,
  elapsedMs: number | null
): string | null {
  if (projection.status === 'not_started' || projection.status === 'ended') {
    return 'Roles can only change during an active match.'
  }
  if (new Set(changes.map(change => change.participantId)).size !== changes.length) {
    return 'A role-change event cannot repeat a participant.'
  }
  for (const change of changes) {
    const participant = projection.participants[change.participantId]
    if (!participant) return `Role change references unknown participant ${change.participantId}.`
    if (participant.status === 'on_field' && projection.currentPeriodId) {
      closeRoleInterval(participant, projection.currentPeriodId, elapsedMs ?? projection.clock.elapsedMs)
    }
    participant.role = structuredClone(change.role)
    if (participant.status === 'on_field' && projection.currentPeriodId) {
      openRoleInterval(participant, projection.currentPeriodId, elapsedMs ?? projection.clock.elapsedMs)
    }
  }
  return validateOnFieldGoalkeeper(projection)
}

function applyRosterAddition(
  projection: SoccerMatchProjection,
  participant: {
    id: string
    kind: 'player' | 'anonymous'
    playerId: string | null
    displayName: string
    number: string | null
    initialStatus: 'starter' | 'bench'
    initialRole: SoccerRole
  },
  destination: 'bench' | 'on_field',
  elapsedMs: number | null
): string | null {
  if (projection.status === 'not_started' || projection.status === 'ended') {
    return 'Late roster additions require an active match.'
  }
  if (projection.participants[participant.id]) return 'Participant id already exists in this match.'
  if (participant.playerId && Object.values(projection.participants).some(item => item.playerId === participant.playerId)) {
    return 'Roster player is already represented in this match.'
  }
  if (destination === 'on_field' && projection.status === 'in_progress' && elapsedMs === null) {
    return 'An in-period entry requires canonical elapsed time.'
  }
  projection.participants[participant.id] = {
    participantId: participant.id,
    playerId: participant.playerId,
    displayName: participant.displayName,
    number: participant.number,
    status: destination,
    role: structuredClone(participant.initialRole),
    started: false,
    appearances: destination === 'on_field' ? 1 : 0,
    totalActiveMs: 0,
    activeSinceElapsedMs: destination === 'on_field' && projection.clock.running ? elapsedMs : null,
    onFieldIntervals: [],
    roleIntervals: [],
    hasExited: false,
  }
  projection.participantStats[participant.id] = emptyParticipantStats()
  if (destination === 'on_field' && projection.currentPeriodId) {
    openOnFieldParticipantInterval(
      projection.participants[participant.id],
      projection.currentPeriodId,
      elapsedMs ?? projection.clock.elapsedMs
    )
    openRoleInterval(
      projection.participants[participant.id],
      projection.currentPeriodId,
      elapsedMs ?? projection.clock.elapsedMs
    )
  }
  if (onFieldParticipants(projection).length > projection.currentRules.maxOnFieldPlayers) {
    return 'Roster addition leaves too many players on field.'
  }
  return validateOnFieldGoalkeeper(projection)
}

function applyParticipantResolution(
  projection: SoccerMatchProjection,
  payload: { participantId: string; playerId: string; displayName: string; number: string | null },
  gameState: GameState
): string | null {
  const participant = projection.participants[payload.participantId]
  if (!participant || participant.playerId !== null) {
    return 'Only an unresolved anonymous participant can be mapped to a player.'
  }
  if (!gameState.players.some(player => player.id === payload.playerId)) {
    return 'Resolved player must exist in the active game roster.'
  }
  if (Object.values(projection.participants).some(item => item.playerId === payload.playerId)) {
    return 'Resolved player is already represented in this match.'
  }
  participant.playerId = payload.playerId
  participant.displayName = payload.displayName
  participant.number = payload.number
  return null
}

type SoccerAttackingEvent = Extract<
  SoccerMatchEvent,
  { eventType: 'soccer.shot' | 'soccer.own_goal' | 'soccer.score_adjustment' }
>

function isAttackingEvent(event: SoccerMatchEvent): event is SoccerAttackingEvent {
  return event.eventType === 'soccer.shot' ||
    event.eventType === 'soccer.own_goal' ||
    event.eventType === 'soccer.score_adjustment'
}

function applyShot(
  projection: SoccerMatchProjection,
  event: Extract<SoccerMatchEvent, { eventType: 'soccer.shot' }>
): string | null {
  const momentError = validateAttackingMoment(projection, event)
  if (momentError) return momentError

  const shooter = actorForRole(event.actors, 'shooter')
  const primary = actorForRole(event.actors, 'creator_primary')
  const secondary = actorForRole(event.actors, 'creator_secondary')
  const goalkeeper = actorForRole(event.actors, 'goalkeeper')
  const blocker = actorForRole(event.actors, 'blocker')
  if (!shooter) return 'A shot requires exactly one shooter.'

  const shooterError = validateActorSide(
    projection,
    shooter,
    event.teamSide,
    event,
    true
  )
  if (shooterError) return `Shooter ${shooterError}`

  if (primary || secondary) {
    if (event.payload.situation === 'penalty' || event.payload.situation === 'direct_free_kick') {
      return 'Penalty and direct-free-kick shots cannot have creators.'
    }
    if (secondary && (!primary || event.payload.outcome !== 'goal')) {
      return 'A secondary creator requires a primary creator on a goal.'
    }
    if (primary && secondary && sameActor(primary, secondary)) {
      return 'Primary and secondary creators must be different actors.'
    }
    if (event.payload.outcome !== 'goal' && secondary) {
      return 'A non-goal shot can have only one creator.'
    }
    const creatorCount = Number(Boolean(primary)) + Number(Boolean(secondary))
    if (event.payload.outcome === 'goal' && creatorCount > projection.currentRules.maxAssistsPerGoal) {
      return 'Creator count exceeds the configured match maximum.'
    }
    for (const creator of [primary, secondary].filter((actor): actor is GameEventActor => Boolean(actor))) {
      const creatorError = validateActorSide(projection, creator, event.teamSide, event, false)
      if (creatorError) return `Creator ${creatorError}`
      if (sameActor(shooter, creator)) return 'The shooter cannot also be a creator.'
    }
  }

  const oppositeSide = oppositeTeamSide(event.teamSide)
  const goalkeeperRequired = event.teamSide === 'opponent' && (
    event.payload.outcome === 'goal' ||
    event.payload.outcome === 'saved' ||
    event.payload.situation === 'penalty'
  )
  if (goalkeeperRequired && !goalkeeper) {
    return 'This opponent attempt requires the tracked goalkeeper.'
  }
  if (goalkeeper) {
    if (event.payload.outcome !== 'goal' && event.payload.outcome !== 'saved' && event.payload.situation !== 'penalty') {
      return 'A goalkeeper link is not applicable to this shot.'
    }
    const goalkeeperError = validateActorSide(
      projection,
      goalkeeper,
      oppositeSide,
      event,
      false
    )
    if (goalkeeperError) return `Goalkeeper ${goalkeeperError}`
    if (oppositeSide === 'tracked' && !actorHadRole(projection, goalkeeper, event, 'goalkeeper')) {
      return 'Goalkeeper actor did not have the goalkeeper role at the event time.'
    }
  }

  if (event.payload.outcome === 'blocked') {
    if (event.teamSide === 'opponent' && !blocker) {
      return 'A blocked opponent shot requires a tracked blocker or team attribution.'
    }
    if (blocker) {
      const blockerError = validateActorSide(
        projection,
        blocker,
        oppositeSide,
        event,
        true,
        event.teamSide === 'opponent'
      )
      if (blockerError) return `Blocker ${blockerError}`
    }
  } else if (blocker) {
    return 'Only a blocked shot can link a blocker.'
  }

  const totals = projection.sideTotals[event.teamSide]
  totals.shots += 1
  if (event.payload.outcome === 'goal' || event.payload.outcome === 'saved') {
    totals.shotsOnTarget += 1
  }
  if (event.payload.outcome === 'goal') {
    totals.goals += 1
    totals.score += 1
  } else if (event.payload.outcome === 'saved') {
    totals.saved += 1
  } else if (event.payload.outcome === 'blocked') {
    totals.blocked += 1
  } else if (event.payload.outcome === 'off_target') {
    totals.offTarget += 1
  } else {
    totals.woodwork += 1
  }
  if (event.payload.situation === 'penalty') {
    totals.penaltyAttempts += 1
    if (event.payload.outcome === 'goal') totals.penaltyGoals += 1
  }
  if (event.payload.situation === 'direct_free_kick') {
    totals.directFreeKickAttempts += 1
    if (event.payload.outcome === 'goal') totals.directFreeKickGoals += 1
  }

  if (event.teamSide === 'tracked') {
    incrementActorStat(projection, shooter, 'shots')
    if (event.payload.outcome === 'goal' || event.payload.outcome === 'saved') {
      incrementActorStat(projection, shooter, 'shotsOnTarget')
    }
    if (event.payload.outcome === 'goal') incrementActorStat(projection, shooter, 'goals')
    if (event.payload.situation === 'penalty') {
      incrementActorStat(projection, shooter, 'penaltyAttempts')
      if (event.payload.outcome === 'goal') incrementActorStat(projection, shooter, 'penaltyGoals')
    }
    if (event.payload.situation === 'direct_free_kick') {
      incrementActorStat(projection, shooter, 'directFreeKickAttempts')
      if (event.payload.outcome === 'goal') incrementActorStat(projection, shooter, 'directFreeKickGoals')
    }
    if (primary) {
      incrementActorStat(
        projection,
        primary,
        event.payload.outcome === 'goal' ? 'primaryAssists' : 'keyPasses'
      )
    }
    if (secondary) incrementActorStat(projection, secondary, 'secondaryAssists')
  }

  if (event.teamSide === 'opponent' && goalkeeper) {
    if (event.payload.outcome === 'saved') {
      incrementActorStat(projection, goalkeeper, 'goalkeeperSaves')
    }
    if (event.payload.outcome === 'goal') {
      incrementActorStat(projection, goalkeeper, 'goalkeeperGoalsAllowed')
    }
    if (event.payload.outcome === 'goal' || event.payload.outcome === 'saved') {
      incrementActorStat(projection, goalkeeper, 'goalkeeperShotsOnTargetFaced')
    }
    if (event.payload.situation === 'penalty') {
      incrementActorStat(projection, goalkeeper, 'goalkeeperPenaltiesFaced')
      if (event.payload.outcome === 'saved') {
        incrementActorStat(projection, goalkeeper, 'goalkeeperPenaltySaves')
      }
    }
  }
  return null
}

function applyOwnGoal(
  projection: SoccerMatchProjection,
  event: Extract<SoccerMatchEvent, { eventType: 'soccer.own_goal' }>
): string | null {
  const momentError = validateAttackingMoment(projection, event)
  if (momentError) return momentError
  const ownGoalBy = actorForRole(event.actors, 'own_goal_by')
  const goalkeeper = actorForRole(event.actors, 'goalkeeper')
  if (!ownGoalBy) return 'An own goal requires an own-goal actor.'

  const actorSide = oppositeTeamSide(event.teamSide)
  const actorError = validateActorSide(projection, ownGoalBy, actorSide, event, false)
  if (actorError) return `Own-goal actor ${actorError}`

  if (event.teamSide === 'opponent') {
    if (!goalkeeper) return 'A tracked own goal requires the tracked goalkeeper link.'
    const goalkeeperError = validateActorSide(projection, goalkeeper, 'tracked', event, false)
    if (goalkeeperError) return `Goalkeeper ${goalkeeperError}`
    if (!actorHadRole(projection, goalkeeper, event, 'goalkeeper')) {
      return 'Goalkeeper actor did not have the goalkeeper role at the event time.'
    }
    incrementActorStat(projection, ownGoalBy, 'ownGoals')
    incrementActorStat(projection, goalkeeper, 'goalkeeperGoalsAllowed')
  } else if (goalkeeper) {
    return 'An opponent own goal cannot add a tracked goalkeeper statistic.'
  }

  projection.sideTotals[event.teamSide].score += 1
  return null
}

function applyScoreAdjustment(
  projection: SoccerMatchProjection,
  event: Extract<SoccerMatchEvent, { eventType: 'soccer.score_adjustment' }>
): string | null {
  const momentError = validateAttackingMoment(projection, event)
  if (momentError) return momentError
  const nextScore = projection.sideTotals[event.teamSide].score + event.payload.delta
  if (nextScore < 0) return 'A score adjustment cannot make the score negative.'
  projection.sideTotals[event.teamSide].score = nextScore
  return null
}

function validateAttackingMoment(
  projection: SoccerMatchProjection,
  event: SoccerAttackingEvent
): string | null {
  if (!projection.openingLineupRecorded || event.elapsedMs === null) {
    return 'Attacking events require an initialized lineup and canonical elapsed time.'
  }
  const segment = orderedSoccerSegments(projection.currentRules)
    .find(item => item.id === event.period.id)
  if (!segment || segment.order !== event.period.order) return 'Attacking event period is invalid.'
  const eligible = projection.startedPeriodIds.includes(event.period.id)
  if (!eligible) return 'Attacking event period has not started.'

  if (projection.currentPeriodId === event.period.id) {
    const maximumElapsed = projection.clock.running && projection.clock.anchorOccurredAt
      ? projection.clock.elapsedMs + Math.max(
        0,
        Date.parse(event.occurredAt) - Date.parse(projection.clock.anchorOccurredAt)
      )
      : projection.clock.elapsedMs
    if (event.elapsedMs > maximumElapsed) return 'Attacking event time is ahead of the live clock.'
  } else if (projection.suspendedContext?.periodId === event.period.id) {
    if (event.elapsedMs > projection.suspendedContext.elapsedMs) {
      return 'Attacking event time is after the suspended match time.'
    }
  } else {
    const periodEnd = projection.periodEndElapsedMsById[event.period.id]
    if (periodEnd === undefined || event.elapsedMs > periodEnd) {
      return 'Attacking event time is outside the recorded period bounds.'
    }
  }
  return null
}

function validateActorSide(
  projection: SoccerMatchProjection,
  actor: GameEventActor,
  side: 'tracked' | 'opponent',
  event: SoccerAttackingEvent,
  allowTeam: boolean,
  allowUnknownFallback = false
): string | null {
  if (side === 'opponent') {
    if (actor.participantId) return 'cannot reference a tracked participant for the opponent.'
    if (actor.kind === 'unknown' || (allowTeam && actor.kind === 'team')) return null
    return 'must use an opponent label or team attribution.'
  }
  if (allowTeam && actor.kind === 'team' && !actor.participantId) return null
  if (allowUnknownFallback && actor.kind === 'unknown' && !actor.participantId) return null
  if (!actor.participantId || (actor.kind !== 'player' && actor.kind !== 'unknown')) {
    return 'must reference a tracked match participant.'
  }
  const participant = projection.participants[actor.participantId]
  if (!participant) return 'references an unknown match participant.'
  if (actor.kind === 'player' && participant.playerId !== actor.playerId) {
    return 'player identity does not match the match participant.'
  }
  if (!participantWasOnField(participant, event.period.id, event.elapsedMs ?? -1)) {
    return 'was not on field at the event time.'
  }
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

function actorHadRole(
  projection: SoccerMatchProjection,
  actor: GameEventActor,
  event: SoccerAttackingEvent,
  roleGroup: SoccerRole['group']
): boolean {
  const elapsedMs = event.elapsedMs
  if (!actor.participantId || elapsedMs === null) return false
  const participant = projection.participants[actor.participantId]
  return Boolean(participant?.roleIntervals.some(interval =>
    interval.periodId === event.period.id &&
    interval.role.group === roleGroup &&
    elapsedMs >= interval.startElapsedMs &&
    (interval.endElapsedMs === null || elapsedMs <= interval.endElapsedMs)
  ))
}

function actorForRole(actors: GameEventActor[], role: string): GameEventActor | null {
  return actors.find(actor => actor.role === role) ?? null
}

function sameActor(left: GameEventActor, right: GameEventActor): boolean {
  if (left.participantId || right.participantId) {
    return Boolean(left.participantId && left.participantId === right.participantId)
  }
  return left.kind === right.kind && left.label === right.label
}

function oppositeTeamSide(side: 'tracked' | 'opponent'): 'tracked' | 'opponent' {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

function incrementActorStat(
  projection: SoccerMatchProjection,
  actor: GameEventActor,
  stat: keyof SoccerParticipantStatTotals
): void {
  if (!actor.participantId) return
  const totals = projection.participantStats[actor.participantId]
  if (totals) totals[stat] += 1
}

function applyMatchEnded(
  projection: SoccerMatchProjection,
  reason: 'completed' | 'suspended' | 'abandoned',
  occurredAt: string
): string | null {
  if (
    projection.status !== 'period_break' &&
    projection.status !== 'in_progress' &&
    projection.status !== 'shootout' &&
    projection.status !== 'suspended'
  ) {
    return 'Only an active match can be ended.'
  }
  if (projection.clock.running) return 'Pause the clock before ending the match.'
  if (reason === 'suspended') {
    if (projection.status !== 'in_progress' && projection.status !== 'period_break') {
      return 'Only normal match play can be suspended.'
    }
    projection.suspendedContext = projection.currentPeriodId
      ? { periodId: projection.currentPeriodId, elapsedMs: projection.clock.elapsedMs }
      : null
    if (projection.currentPeriodId) {
      closeOnFieldIntervals(projection, projection.currentPeriodId, projection.clock.elapsedMs)
    }
    projection.status = 'suspended'
    projection.currentPeriodId = null
    projection.endedAt = occurredAt
    projection.endReason = null
    projection.result = 'suspended'
    projection.decidedStage = null
    return null
  }
  if (reason === 'completed' && projection.status !== 'period_break' && projection.status !== 'shootout') {
    return 'A completed match must end from a period break.'
  }
  if (reason === 'completed') {
    const regulationIds = projection.currentRules.regulationSegments.map(segment => segment.id)
    if (!regulationIds.every(periodId => projection.completedPeriodIds.includes(periodId))) {
      return 'A completed match requires every regulation period to be complete.'
    }
    const extraTimeIds = projection.currentRules.extraTimeSegments.map(segment => segment.id)
    const extraTimeBegan = extraTimeIds.some(periodId => projection.completedPeriodIds.includes(periodId))
    if (extraTimeBegan && !extraTimeIds.every(periodId => projection.completedPeriodIds.includes(periodId))) {
      return 'Began extra time must be completed before ending the match as completed.'
    }
    const outcomeError = deriveCompletedMatchOutcome(projection)
    if (outcomeError) return outcomeError
  }
  if (projection.currentPeriodId) {
    closeOnFieldIntervals(projection, projection.currentPeriodId, projection.clock.elapsedMs)
    projection.periodEndElapsedMsById[projection.currentPeriodId] = projection.clock.elapsedMs
  }
  projection.status = 'ended'
  projection.currentPeriodId = null
  projection.endedAt = occurredAt
  projection.endReason = reason === 'abandoned' ? 'abandoned' : 'completed'
  projection.suspendedContext = null
  if (reason === 'abandoned') {
    projection.result = 'abandoned'
    projection.decidedStage = null
  }
  return null
}

function deriveCompletedMatchOutcome(projection: SoccerMatchProjection): string | null {
  const trackedScore = projection.sideTotals.tracked.score
  const opponentScore = projection.sideTotals.opponent.score
  const extraTimeIds = projection.currentRules.extraTimeSegments.map(segment => segment.id)
  const extraTimeBegan = extraTimeIds.some(periodId => projection.completedPeriodIds.includes(periodId))
  if (projection.shootout && trackedScore !== opponentScore) {
    return 'A match with a shootout must retain a tied normal match score.'
  }
  if (trackedScore === opponentScore) {
    if (
      projection.currentRules.tieResolution === 'extra_time_then_shootout' &&
      !extraTimeIds.every(periodId => projection.completedPeriodIds.includes(periodId))
    ) return 'A tied winner-required match must complete extra time.'
    if (projection.currentRules.tieResolution !== 'draw_allowed') {
      if (!projection.shootout?.decided || !projection.shootout.winner) {
        return 'A tied winner-required match must complete its shootout.'
      }
      projection.result = projection.shootout.winner === 'tracked'
        ? 'tracked_win'
        : 'opponent_win'
      projection.decidedStage = 'shootout'
    } else {
      projection.result = 'draw'
      projection.decidedStage = extraTimeBegan ? 'extra_time' : 'regulation'
    }
  } else {
    projection.result = trackedScore > opponentScore ? 'tracked_win' : 'opponent_win'
    projection.decidedStage = extraTimeBegan ? 'extra_time' : 'regulation'
  }
  return null
}

function applyMatchReopened(projection: SoccerMatchProjection): string | null {
  if (projection.status === 'suspended') {
    const context = projection.suspendedContext
    projection.status = context ? 'in_progress' : 'period_break'
    projection.currentPeriodId = context?.periodId ?? null
    if (context) {
      projection.clock = { running: false, elapsedMs: context.elapsedMs, anchorOccurredAt: null }
      openOnFieldIntervals(projection, context.periodId, context.elapsedMs)
    }
  } else if (projection.status === 'ended') {
    projection.status = projection.shootout ? 'shootout' : 'period_break'
    projection.currentPeriodId = null
  } else {
    return 'Only an ended or suspended match can be reopened.'
  }
  projection.endedAt = null
  projection.endReason = null
  projection.suspendedContext = null
  projection.result = 'unresolved'
  projection.decidedStage = null
  return null
}

function advanceRunningClock(
  projection: SoccerMatchProjection,
  elapsedMs: number,
  occurredAt: string
): string | null {
  if (elapsedMs < projection.clock.elapsedMs) return 'Event elapsed time predates the running clock anchor.'
  projection.clock.elapsedMs = elapsedMs
  projection.clock.anchorOccurredAt = occurredAt
  return null
}

function closeActiveIntervals(projection: SoccerMatchProjection, elapsedMs: number): void {
  for (const participant of onFieldParticipants(projection)) {
    closeParticipantInterval(participant, elapsedMs)
  }
}

function closeParticipantInterval(participant: SoccerProjectedParticipant, elapsedMs: number): void {
  if (participant.activeSinceElapsedMs === null) return
  participant.totalActiveMs += Math.max(0, elapsedMs - participant.activeSinceElapsedMs)
  participant.activeSinceElapsedMs = null
}

function openOnFieldIntervals(
  projection: SoccerMatchProjection,
  periodId: string,
  elapsedMs: number
): void {
  for (const participant of onFieldParticipants(projection)) {
    openOnFieldParticipantInterval(participant, periodId, elapsedMs)
    openRoleInterval(participant, periodId, elapsedMs)
  }
}

function openOnFieldParticipantInterval(
  participant: SoccerProjectedParticipant,
  periodId: string,
  elapsedMs: number
): void {
  const current = lastItem(participant.onFieldIntervals)
  if (current?.endElapsedMs === null) return
  participant.onFieldIntervals.push({
    periodId,
    startElapsedMs: elapsedMs,
    endElapsedMs: null,
  })
}

function closeOnFieldIntervals(
  projection: SoccerMatchProjection,
  periodId: string,
  elapsedMs: number
): void {
  for (const participant of onFieldParticipants(projection)) {
    closeOnFieldParticipantInterval(participant, periodId, elapsedMs)
    closeRoleInterval(participant, periodId, elapsedMs)
  }
}

function openRoleInterval(
  participant: SoccerProjectedParticipant,
  periodId: string,
  elapsedMs: number
): void {
  const current = lastItem(participant.roleIntervals)
  if (current?.endElapsedMs === null) return
  participant.roleIntervals.push({
    periodId,
    startElapsedMs: elapsedMs,
    endElapsedMs: null,
    role: structuredClone(participant.role),
  })
}

function closeRoleInterval(
  participant: SoccerProjectedParticipant,
  periodId: string | null,
  elapsedMs: number
): void {
  if (!periodId) return
  const current = lastItem(participant.roleIntervals)
  if (!current || current.endElapsedMs !== null || current.periodId !== periodId) return
  current.endElapsedMs = Math.max(current.startElapsedMs, elapsedMs)
}

function closeOnFieldParticipantInterval(
  participant: SoccerProjectedParticipant,
  periodId: string | null,
  elapsedMs: number
): void {
  if (!periodId) return
  const current = lastItem(participant.onFieldIntervals)
  if (!current || current.endElapsedMs !== null || current.periodId !== periodId) return
  current.endElapsedMs = Math.max(current.startElapsedMs, elapsedMs)
}

function onFieldParticipants(projection: SoccerMatchProjection): SoccerProjectedParticipant[] {
  return Object.values(projection.participants).filter(participant => participant.status === 'on_field')
}

function lastItem<T>(items: T[]): T | undefined {
  return items[items.length - 1]
}

function validateOnFieldGoalkeeper(projection: SoccerMatchProjection): string | null {
  const onField = onFieldParticipants(projection)
  const goalkeepers = onField.filter(participant => participant.role.group === 'goalkeeper')
  return goalkeepers.length !== 1
    ? 'The on-field lineup must contain exactly one goalkeeper.'
    : null
}

function directionForSegment(
  projection: SoccerMatchProjection,
  segmentId: string
): SoccerAttackingDirection {
  const index = orderedSoccerSegments(projection.currentRules)
    .findIndex(segment => segment.id === segmentId)
  const base = projection.firstPeriodAttackingDirection
  return index % 2 === 0 ? base : oppositeDirection(base)
}

function oppositeDirection(direction: SoccerAttackingDirection): SoccerAttackingDirection {
  return direction === 'left_to_right' ? 'right_to_left' : 'left_to_right'
}

function compareSoccerCaptureOrder(left: SoccerMatchEvent, right: SoccerMatchEvent): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence
  return left.id.localeCompare(right.id)
}

function buildProjection(
  state: GameState,
  sportGameState: SoccerSportGameState
): GameEventProjection {
  const statsByPlayerId: Record<string, Record<string, number>> = Object.fromEntries(
    state.players.map(player => [player.id, {}])
  )
  for (const participant of Object.values(sportGameState.projection.participants)) {
    if (!participant.playerId || !statsByPlayerId[participant.playerId]) continue
    const stats = statsByPlayerId[participant.playerId]
    stats.soc_start = (stats.soc_start ?? 0) + (participant.started ? 1 : 0)
    stats.soc_app = (stats.soc_app ?? 0) + participant.appearances
    const activeMs = participant.totalActiveMs + (
      participant.activeSinceElapsedMs === null
        ? 0
        : Math.max(0, sportGameState.projection.clock.elapsedMs - participant.activeSinceElapsedMs)
    )
    stats.soc_min_sec = (stats.soc_min_sec ?? 0) + Math.floor(activeMs / 1_000)
    const attacking = sportGameState.projection.participantStats[participant.participantId]
    if (!attacking) continue
    stats.soc_goal = (stats.soc_goal ?? 0) + attacking.goals
    stats.soc_own_goal = (stats.soc_own_goal ?? 0) + attacking.ownGoals
    stats.soc_ast_primary = (stats.soc_ast_primary ?? 0) + attacking.primaryAssists
    stats.soc_ast_secondary = (stats.soc_ast_secondary ?? 0) + attacking.secondaryAssists
    stats.soc_ast = (stats.soc_ast ?? 0) + attacking.primaryAssists + attacking.secondaryAssists
    stats.soc_shot = (stats.soc_shot ?? 0) + attacking.shots
    stats.soc_sot = (stats.soc_sot ?? 0) + attacking.shotsOnTarget
    stats.soc_key_pass = (stats.soc_key_pass ?? 0) + attacking.keyPasses
    stats.soc_chance_created = (stats.soc_chance_created ?? 0) +
      attacking.keyPasses + attacking.primaryAssists
    stats.soc_pen_att = (stats.soc_pen_att ?? 0) + attacking.penaltyAttempts
    stats.soc_pen_goal = (stats.soc_pen_goal ?? 0) + attacking.penaltyGoals
    stats.soc_dfk_att = (stats.soc_dfk_att ?? 0) + attacking.directFreeKickAttempts
    stats.soc_dfk_goal = (stats.soc_dfk_goal ?? 0) + attacking.directFreeKickGoals
    stats.soc_gk_save = (stats.soc_gk_save ?? 0) + attacking.goalkeeperSaves
    stats.soc_gk_ga = (stats.soc_gk_ga ?? 0) + attacking.goalkeeperGoalsAllowed
    stats.soc_gk_sot_faced = (stats.soc_gk_sot_faced ?? 0) +
      attacking.goalkeeperShotsOnTargetFaced
    stats.soc_gk_pen_faced = (stats.soc_gk_pen_faced ?? 0) + attacking.goalkeeperPenaltiesFaced
    stats.soc_gk_pen_save = (stats.soc_gk_pen_save ?? 0) + attacking.goalkeeperPenaltySaves
    stats.soc_tkl_att = (stats.soc_tkl_att ?? 0) + attacking.tacklesAttempted
    stats.soc_tkl_won = (stats.soc_tkl_won ?? 0) + attacking.tacklesWon
    stats.soc_tkl_lost = (stats.soc_tkl_lost ?? 0) + attacking.tacklesLost
    stats.soc_int = (stats.soc_int ?? 0) + attacking.interceptions
    stats.soc_clear = (stats.soc_clear ?? 0) + attacking.clearances
    stats.soc_recovery = (stats.soc_recovery ?? 0) + attacking.recoveries
    stats.soc_block = (stats.soc_block ?? 0) + attacking.blockedShots
    stats.soc_foul_committed = (stats.soc_foul_committed ?? 0) + attacking.foulsCommitted
    stats.soc_foul_drawn = (stats.soc_foul_drawn ?? 0) + attacking.foulsDrawn
    stats.soc_yellow = (stats.soc_yellow ?? 0) + attacking.yellowCards
    stats.soc_red = (stats.soc_red ?? 0) + attacking.redCards
  }
  return {
    playerStatsById: statsByPlayerId,
    opponentScore: sportGameState.projection.sideTotals.opponent.score,
    homeTeamScore: sportGameState.projection.sideTotals.tracked.score,
    shotChart: [],
    sportGameState,
  }
}

function emptyProjection(
  state: GameState,
  sportGameState: GameState['sportGameState']
): GameEventProjection {
  return {
    playerStatsById: Object.fromEntries(state.players.map(player => [player.id, {}])),
    opponentScore: 0,
    homeTeamScore: 0,
    shotChart: [],
    sportGameState,
  }
}

function diagnostic(eventId: string | null, message: string): GameEventDiagnostic {
  return { code: 'semantic_validation_failed', message, eventId }
}
