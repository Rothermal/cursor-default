import type { GameState } from '../../types'
import type {
  GameEvent,
  GameEventDiagnostic,
  GameEventProjection,
  SportGameEventProjectionResult,
  SportGameEventProjector,
} from '../gameEvents/types'
import { orderedSoccerSegments, validateSoccerMatchRules } from './rules'
import { createSoccerMatchProjection } from './state'
import type {
  SoccerAttackingDirection,
  SoccerMatchEvent,
  SoccerMatchProjection,
  SoccerMatchRules,
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

  for (let index = 0; index < soccerEvents.length; index += 1) {
    const event = soccerEvents[index]
    const sequenceKey = `${event.recorderUserId ?? 'local'}\u0000${event.sequence}`
    const next = structuredClone(projection)
    const error = seenSequences.has(sequenceKey)
      ? `Capture sequence ${event.sequence} is duplicated for this recorder.`
      : applySoccerEvent(next, sportState, event, state)
    if (error) {
      diagnostics.push(diagnostic(event.id, error))
      for (const unprojected of soccerEvents.slice(index + 1)) {
        diagnostics.push({
          code: 'unprojected_event',
          message: 'Event was preserved but not projected because earlier match history is invalid.',
          eventId: unprojected.id,
        })
      }
      break
    }
    seenSequences.add(sequenceKey)
    projection = next
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
  gameState: GameState
): string | null {
  if (projection.clock.running && event.elapsedMs !== null && ![
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
      return applyRoleChanges(projection, event.payload.changes)
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
  }
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
  projection.status = 'in_progress'
  projection.attackingDirection = directionForSegment(projection, nextSegment.id)
  projection.endedAt = null
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
    projection.clock = { running: false, elapsedMs: toElapsedMs, anchorOccurredAt: null }
  }
  return null
}

function applyRulesChanged(
  projection: SoccerMatchProjection,
  rules: SoccerMatchRules
): string | null {
  const rulesError = validateSoccerMatchRules(rules)
  if (rulesError) return rulesError
  const oldSegments = orderedSoccerSegments(projection.currentRules)
  const nextSegments = orderedSoccerSegments(rules)
  for (const periodId of [...projection.completedPeriodIds, projection.currentPeriodId].filter(Boolean)) {
    const oldSegment = oldSegments.find(segment => segment.id === periodId)
    const nextSegment = nextSegments.find(segment => segment.id === periodId)
    if (!oldSegment || !nextSegment || JSON.stringify(oldSegment) !== JSON.stringify(nextSegment)) {
      return 'Completed and active period definitions cannot be rewritten mid-match.'
    }
  }
  if (onFieldParticipants(projection).length > rules.maxOnFieldPlayers) {
    return 'The new player maximum is below the current on-field count.'
  }
  if (rules.substitutionLimit !== null && rules.substitutionLimit < projection.substitutionCount) {
    return 'The new substitution limit is below substitutions already used.'
  }
  if (rules.substitutionWindowLimit !== null && rules.substitutionWindowLimit < projection.substitutionWindowCount) {
    return 'The new window limit is below windows already used.'
  }
  projection.currentRules = structuredClone(rules)
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
  changes: Array<{ participantId: string; role: SoccerRole }>
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
    participant.role = structuredClone(change.role)
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
    hasExited: false,
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

function applyMatchEnded(
  projection: SoccerMatchProjection,
  reason: 'completed' | 'suspended' | 'abandoned',
  occurredAt: string
): string | null {
  if (projection.status !== 'period_break' && projection.status !== 'in_progress') {
    return 'Only an active match can be ended.'
  }
  if (projection.clock.running) return 'Pause the clock before ending the match.'
  if (reason === 'completed' && projection.status !== 'period_break') {
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
  }
  projection.status = 'ended'
  projection.currentPeriodId = null
  projection.endedAt = occurredAt
  return null
}

function applyMatchReopened(projection: SoccerMatchProjection): string | null {
  if (projection.status !== 'ended') return 'Only an ended match can be reopened.'
  projection.status = 'period_break'
  projection.currentPeriodId = null
  projection.endedAt = null
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

function onFieldParticipants(projection: SoccerMatchProjection): SoccerProjectedParticipant[] {
  return Object.values(projection.participants).filter(participant => participant.status === 'on_field')
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
  }
  return {
    playerStatsById: statsByPlayerId,
    opponentScore: 0,
    homeTeamScore: 0,
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
