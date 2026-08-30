import type { GameState } from '../../types'
import type {
  GameEvent,
  GameEventDiagnostic,
  GameEventProjection,
  SportGameEventProjectionResult,
  SportGameEventProjector,
} from '../gameEvents/types'
import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { resolveBasketballPeriodSegment } from './rules'
import {
  applyBasketballClockEvent,
  clearPendingBasketballStoppageAfterEvent,
  recordBasketballRunningClockMomentAfterEvent,
  startBasketballClockPeriod,
  validateBasketballEventClockMoment,
} from './clockProjection'
import {
  applyBasketballAdministrativeEvent,
  updateBasketballBonusStatus,
} from './administrativeProjection'
import {
  applyBasketballStatEvent,
  createBasketballStatProjectionContext,
  registerProjectedBasketballEvent,
} from './statProjection'
import {
  applyBasketballLineupEffectsAfterEvent,
  applyBasketballLineupEvent,
  basketballLineupClockStartError,
  basketballLineupProjectionDiagnostics,
  finalizeBasketballLineupParticipation,
  isBasketballLineupEvent,
  validatePendingBasketballEqualPlayOverride,
} from './lineupProjection'
import {
  isRecordedLaterBasketballLineupEvent,
  orderBasketballEventsForProjection,
} from './lineupReplay'
import {
  createBasketballMatchProjection,
  projectedBasketballParticipant,
} from './state'
import type {
  BasketballLifecycleEvent,
  BasketballClockEvent,
  BasketballAdministrativeEvent,
  BasketballMatchEvent,
  BasketballMatchProjection,
  BasketballStatEvent,
  BasketballSportGameState,
} from './types'

export const basketballGameEventProjector: SportGameEventProjector<GameEvent> = {
  sportId: 'basketball',
  requiresSportGameState: true,
  project: projectBasketballEvents,
}

export const basketballLifecycleProjector = basketballGameEventProjector

export function projectBasketballEvents(
  state: GameState,
  events: GameEvent[]
): SportGameEventProjectionResult {
  const sportState = state.sportGameState
  if (!sportState || sportState.sportId !== 'basketball') {
    return {
      projection: emptyProjection(state, state.sportGameState),
      diagnostics: [diagnostic(null, 'Basketball event projection requires a valid setup.')],
    }
  }

  const captureOrderedEvents = [...events]
    .filter((event): event is BasketballMatchEvent => event.sportId === 'basketball')
    .sort(compareGameEventCaptureOrder)
  const basketballEvents = orderBasketballEventsForProjection(captureOrderedEvents)
  let projection = createBasketballMatchProjection(sportState.setup)
  const statContext = createBasketballStatProjectionContext()
  const seenSequences = new Set<string>()
  let failedEvent: BasketballMatchEvent | null = null
  let failureMessage: string | null = null

  for (const event of basketballEvents) {
    const sequenceKey = `${event.recorderUserId ?? 'local'}\u0000${event.sequence}`
    if (seenSequences.has(sequenceKey)) {
      failedEvent = event
      failureMessage = `Capture sequence ${event.sequence} is duplicated for this recorder.`
      break
    }
    seenSequences.add(sequenceKey)

    const clockMomentError = isRecordedLaterBasketballLineupEvent(event)
      ? validateRecordedLaterLineupMoment(captureOrderedEvents, sportState, event)
      : validateBasketballEventClockMoment(projection, sportState, event)
    if (clockMomentError) {
      failedEvent = event
      failureMessage = clockMomentError
      break
    }
    const pendingOverrideError = validatePendingBasketballEqualPlayOverride(projection, event)
    if (pendingOverrideError) {
      failedEvent = event
      failureMessage = pendingOverrideError
      break
    }
    if (event.eventType === 'basketball.clock_started') {
      const lineupError = basketballLineupClockStartError(projection)
      if (lineupError) {
        failedEvent = event
        failureMessage = lineupError
        break
      }
    }

    const next = structuredClone(projection)
    let error = isBasketballClockEvent(event)
      ? applyBasketballClockEvent(next, sportState, event)
      : isBasketballLineupEvent(event)
        ? applyBasketballLineupEvent(next, sportState, event)
      : isBasketballAdministrativeEvent(event)
      ? applyBasketballAdministrativeEvent(
          next,
          event,
          statContext,
          sportState.setup.rulesSnapshot
        )
      : isBasketballStatEvent(event)
        ? applyBasketballStatEvent(next, event, statContext)
        : applyLifecycleEvent(next, sportState, event)
    if (!error) error = applyBasketballLineupEffectsAfterEvent(next, sportState, event)
    if (error) {
      failedEvent = event
      failureMessage = error
      break
    }
    clearPendingBasketballStoppageAfterEvent(next, event)
    recordBasketballRunningClockMomentAfterEvent(next, event)
    projection = next
    registerProjectedBasketballEvent(statContext, event)
  }

  const diagnostics: GameEventDiagnostic[] = []
  if (failedEvent && failureMessage) {
    diagnostics.push(diagnostic(failedEvent.id, failureMessage))
    let failureSeen = false
    for (const event of basketballEvents) {
      if (event.id === failedEvent.id) {
        failureSeen = true
        continue
      }
      if (!failureSeen) continue
      diagnostics.push({
        code: 'unprojected_event',
        message: 'Event was preserved but not projected because earlier match history is invalid.',
        eventId: event.id,
      })
    }
  } else {
    finalizeBasketballLineupParticipation(projection)
    diagnostics.push(...basketballLineupProjectionDiagnostics(projection))
  }

  const nextSportState: BasketballSportGameState = { ...sportState, projection }
  return {
    projection: buildProjection(state, nextSportState, statContext.shotChart),
    diagnostics,
  }
}

function validateRecordedLaterLineupMoment(
  events: BasketballMatchEvent[],
  sportState: BasketballSportGameState,
  event: BasketballMatchEvent
): string | null {
  if (event.elapsedMs === null) return 'Recorded-later Basketball lineup events require a clock time.'
  const segment = resolveBasketballPeriodSegment(
    sportState.setup.rulesSnapshot,
    event.period.id
  )
  if (!segment || event.elapsedMs < 0 || event.elapsedMs > segment.durationMs) {
    return 'Recorded-later Basketball lineup event is outside the selected period.'
  }
  const started = events.some(candidate =>
    candidate.eventType === 'basketball.period_started' &&
    candidate.payload.periodId === event.period.id &&
    candidate.deletedAt === null
  )
  const completed = events.some(candidate =>
    candidate.eventType === 'basketball.period_ended' &&
    candidate.payload.periodId === event.period.id &&
    candidate.deletedAt === null
  )
  let terminalPeriodId: string | null = null
  for (const candidate of events) {
    if (candidate.deletedAt !== null) continue
    if (candidate.eventType === 'basketball.match_ended') terminalPeriodId = candidate.period.id
    if (candidate.eventType === 'basketball.match_reopened') terminalPeriodId = null
  }
  const activePeriodId = [...events]
    .filter(candidate => candidate.deletedAt === null)
    .reduce<string | null>((current, candidate) => {
      if (candidate.eventType === 'basketball.period_started') return candidate.payload.periodId
      if (candidate.eventType === 'basketball.period_ended' && current === candidate.payload.periodId) return null
      if (candidate.eventType === 'basketball.match_ended') return null
      if (candidate.eventType === 'basketball.match_reopened') return candidate.period.id
      return current
    }, null)
  if (!started || (!completed && terminalPeriodId !== event.period.id && activePeriodId !== event.period.id)) {
    return 'Recorded-later Basketball lineup event does not target a started period.'
  }
  if (!completed && terminalPeriodId !== event.period.id && activePeriodId === event.period.id) {
    const watermark = recordedLaterLineupCurrentWatermark(events, event, segment.durationMs)
    if (watermark === null || event.elapsedMs > watermark) {
      return 'Recorded-later Basketball lineup event exceeds the current clock watermark.'
    }
  }
  return null
}

function recordedLaterLineupCurrentWatermark(
  events: BasketballMatchEvent[],
  event: BasketballMatchEvent,
  durationMs: number
): number | null {
  let periodId: string | null = null
  let running = false
  let elapsedMs = 0
  let anchorElapsedMs: number | null = null
  let anchorOccurredAt: string | null = null
  let lastRunningElapsedMs: number | null = null

  for (const candidate of events) {
    if (candidate.deletedAt !== null) continue
    if (candidate.eventType === 'basketball.period_started') {
      periodId = candidate.payload.periodId
      running = false
      elapsedMs = 0
      anchorElapsedMs = null
      anchorOccurredAt = null
      lastRunningElapsedMs = null
      continue
    }
    if (candidate.period.id !== periodId) continue
    if (candidate.eventType === 'basketball.clock_started') {
      running = true
      elapsedMs = candidate.elapsedMs ?? candidate.payload.anchorElapsedMs
      anchorElapsedMs = candidate.payload.anchorElapsedMs
      anchorOccurredAt = candidate.occurredAt
      lastRunningElapsedMs = elapsedMs
      continue
    }
    if (candidate.eventType === 'basketball.clock_paused') {
      running = false
      elapsedMs = candidate.payload.elapsedMs
      anchorElapsedMs = null
      anchorOccurredAt = null
      lastRunningElapsedMs = null
      continue
    }
    if (candidate.eventType === 'basketball.clock_adjusted') {
      running = false
      elapsedMs = candidate.payload.toElapsedMs
      anchorElapsedMs = null
      anchorOccurredAt = null
      lastRunningElapsedMs = null
      continue
    }
    if (
      running &&
      candidate.payload.recordedLater !== true &&
      candidate.elapsedMs !== null
    ) {
      lastRunningElapsedMs = Math.max(lastRunningElapsedMs ?? 0, candidate.elapsedMs)
    }
  }

  if (periodId !== event.period.id) return null
  if (!running) return elapsedMs
  if (anchorElapsedMs === null || anchorOccurredAt === null) return null
  const targetMs = Date.parse(event.occurredAt)
  const anchorMs = Date.parse(anchorOccurredAt)
  if (!Number.isFinite(targetMs) || !Number.isFinite(anchorMs) || targetMs < anchorMs) {
    return lastRunningElapsedMs
  }
  const runningMoment = Math.min(durationMs, anchorElapsedMs + targetMs - anchorMs)
  return Math.max(runningMoment, lastRunningElapsedMs ?? 0)
}

function isBasketballClockEvent(event: BasketballMatchEvent): event is BasketballClockEvent {
  return [
    'basketball.clock_started',
    'basketball.clock_paused',
    'basketball.clock_adjusted',
    'basketball.stoppage',
  ].includes(event.eventType)
}

function isBasketballAdministrativeEvent(
  event: BasketballMatchEvent
): event is BasketballAdministrativeEvent {
  return [
    'basketball.foul',
    'basketball.ejection',
    'basketball.timeout',
    'basketball.minutes_adjustment',
  ].includes(event.eventType)
}

function isBasketballStatEvent(event: BasketballMatchEvent): event is BasketballStatEvent {
  return [
    'basketball.free_throw_trip',
    'basketball.shot',
    'basketball.assist',
    'basketball.rebound',
    'basketball.steal',
    'basketball.block',
    'basketball.turnover',
    'basketball.score_adjustment',
  ].includes(event.eventType)
}

function applyLifecycleEvent(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: BasketballLifecycleEvent
): string | null {
  switch (event.eventType) {
    case 'basketball.period_started':
      return applyPeriodStarted(projection, sportState, event)
    case 'basketball.period_ended':
      return applyPeriodEnded(projection, sportState, event)
    case 'basketball.match_roster_added':
      return applyRosterAdded(projection, sportState, event)
    case 'basketball.participant_resolved':
      return applyParticipantResolved(projection, sportState, event)
    case 'basketball.match_ended':
      return applyMatchEnded(projection, sportState, event)
    case 'basketball.match_reopened':
      return applyMatchReopened(projection, sportState, event)
  }
}

function applyPeriodStarted(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: Extract<BasketballLifecycleEvent, { eventType: 'basketball.period_started' }>
): string | null {
  if (projection.status !== 'not_started' && projection.status !== 'period_break') {
    return 'A Basketball period can start only before the match or during a period break.'
  }
  const segment = resolveBasketballPeriodSegment(sportState.setup.rulesSnapshot, event.payload.periodId)
  if (!segment || segment.id !== event.period.id || segment.order !== event.period.order) {
    return 'Basketball period start does not match the rules snapshot.'
  }
  if (projection.startedPeriodIds.includes(segment.id)) return 'Basketball period already started.'
  const previous = projection.periods[projection.periods.length - 1]
  if (previous && (
    !projection.completedPeriodIds.includes(previous.id) || segment.order !== previous.order + 1
  )) {
    return 'Basketball periods must start in order after the previous period ends.'
  }
  if (!previous && segment.order !== 1) return 'The first Basketball period must have order 1.'

  projection.periods.push(segment)
  projection.startedPeriodIds.push(segment.id)
  projection.currentPeriodId = segment.id
  projection.status = 'in_progress'
  startBasketballClockPeriod(projection, segment.id)
  updateBasketballBonusStatus(projection, segment.id, sportState.setup.rulesSnapshot)
  return null
}

function applyPeriodEnded(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: Extract<BasketballLifecycleEvent, { eventType: 'basketball.period_ended' }>
): string | null {
  const periodError = validateCurrentPeriod(projection, sportState, event)
  if (periodError) return periodError
  if (projection.status !== 'in_progress') return 'Only an active Basketball period can end.'
  if (projection.clock?.running) return 'Pause the Basketball clock before ending the period.'
  if (projection.completedPeriodIds.includes(event.payload.periodId)) {
    return 'Basketball period already ended.'
  }
  projection.completedPeriodIds.push(event.payload.periodId)
  projection.status = 'period_break'
  return null
}

function applyRosterAdded(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: Extract<BasketballLifecycleEvent, { eventType: 'basketball.match_roster_added' }>
): string | null {
  const momentError = validateActiveMoment(projection, sportState, event)
  if (momentError) return momentError
  if (projection.clock?.running) return 'Pause the Basketball clock before adding a participant.'
  if (projection.participants[event.payload.participant.id]) {
    return 'Basketball participant id already exists.'
  }
  if (
    event.payload.participant.playerId &&
    Object.values(projection.participants).some(candidate =>
      candidate.playerId === event.payload.participant.playerId
    )
  ) {
    return 'Basketball player id is already resolved to another participant.'
  }
  projection.participants[event.payload.participant.id] = projectedBasketballParticipant(
    event.payload.participant,
    true
  )
  return null
}

function applyParticipantResolved(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: Extract<BasketballLifecycleEvent, { eventType: 'basketball.participant_resolved' }>
): string | null {
  const momentError = validateActiveMoment(projection, sportState, event)
  if (momentError) return momentError
  const participant = projection.participants[event.payload.participantId]
  if (!participant) return 'Basketball participant resolution references an unknown participant.'
  const duplicate = Object.values(projection.participants).find(candidate =>
    candidate.participantId !== participant.participantId &&
    candidate.playerId === event.payload.playerId
  )
  if (duplicate) return 'Basketball player id is already resolved to another participant.'
  participant.playerId = event.payload.playerId
  participant.displayName = event.payload.displayName
  participant.number = event.payload.number
  return null
}

function applyMatchEnded(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: Extract<BasketballLifecycleEvent, { eventType: 'basketball.match_ended' }>
): string | null {
  const momentError = validateActiveMoment(projection, sportState, event)
  if (momentError) return momentError
  projection.status = event.payload.reason === 'suspended' ? 'suspended' : 'ended'
  projection.endedAt = event.occurredAt
  projection.endReason = event.payload.reason
  projection.result = resultForEnd(projection, event.payload.reason)
  return null
}

function applyMatchReopened(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: Extract<BasketballLifecycleEvent, { eventType: 'basketball.match_reopened' }>
): string | null {
  const periodError = validateEventPeriod(projection, sportState, event)
  if (periodError) return periodError
  if (projection.status !== 'ended' && projection.status !== 'suspended') {
    return 'Only an ended or suspended Basketball match can reopen.'
  }
  projection.status = projection.currentPeriodId &&
    !projection.completedPeriodIds.includes(projection.currentPeriodId)
    ? 'in_progress'
    : 'period_break'
  projection.endedAt = null
  projection.endReason = null
  projection.result = 'unresolved'
  return null
}

function validateActiveMoment(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: BasketballLifecycleEvent
): string | null {
  if (projection.status === 'not_started') return 'Basketball match has not started.'
  if (projection.status === 'ended' || projection.status === 'suspended') {
    return 'Basketball match is not open for lifecycle events.'
  }
  return validateCurrentPeriod(projection, sportState, event)
}

function validateCurrentPeriod(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: BasketballLifecycleEvent
): string | null {
  const periodError = validateEventPeriod(projection, sportState, event)
  if (periodError) return periodError
  if (event.period.id !== projection.currentPeriodId) {
    return 'Basketball event does not target the current period.'
  }
  return null
}

function validateEventPeriod(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: BasketballLifecycleEvent
): string | null {
  const segment = resolveBasketballPeriodSegment(sportState.setup.rulesSnapshot, event.period.id)
  if (!segment || segment.order !== event.period.order) return 'Basketball event period is invalid.'
  if (!projection.startedPeriodIds.includes(event.period.id)) {
    return 'Basketball event period has not started.'
  }
  return null
}

function resultForEnd(
  projection: BasketballMatchProjection,
  reason: BasketballMatchProjection['endReason']
): BasketballMatchProjection['result'] {
  if (reason === 'suspended') return 'suspended'
  if (reason === 'abandoned') return 'abandoned'
  if (reason !== 'completed') return 'unresolved'
  if (projection.score.tracked > projection.score.opponent) return 'tracked_win'
  if (projection.score.opponent > projection.score.tracked) return 'opponent_win'
  return 'draw'
}

function buildProjection(
  state: GameState,
  sportGameState: BasketballSportGameState,
  shotChart: GameEventProjection['shotChart']
): GameEventProjection {
  const playerStatsById: Record<string, Record<string, number>> = Object.fromEntries(
    state.players.map(player => [player.id, {}])
  )
  for (const participant of Object.values(sportGameState.projection.participants)) {
    if (!participant.playerId || !playerStatsById[participant.playerId]) continue
    playerStatsById[participant.playerId] = structuredClone(participant.stats)
  }
  if (playerStatsById[TEAM_PLAYER_HOME_ID]) {
    playerStatsById[TEAM_PLAYER_HOME_ID] = structuredClone(
      sportGameState.projection.teamActorStats.tracked
    )
  }
  if (playerStatsById[TEAM_PLAYER_OPP_ID]) {
    playerStatsById[TEAM_PLAYER_OPP_ID] = structuredClone(
      sportGameState.projection.teamActorStats.opponent
    )
  }
  return {
    playerStatsById,
    opponentScore: sportGameState.projection.score.opponent,
    homeTeamScore: sportGameState.projection.score.tracked,
    shotChart,
    currentPeriod: currentBasketballPeriodOrder(sportGameState),
    sportGameState,
  }
}

function currentBasketballPeriodOrder(sportGameState: BasketballSportGameState): number {
  const currentId = sportGameState.projection.currentPeriodId
  return sportGameState.projection.periods.find(period => period.id === currentId)?.order ?? 1
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
