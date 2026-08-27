import type { GameEventDiagnostic } from '../gameEvents/types'
import { isBasketballMatchRulesV3, resolveBasketballPeriodSegment } from './rules'
import type {
  BasketballEqualPlayViolation,
  BasketballEqualPlayViolationCode,
  BasketballLineupEvent,
  BasketballLineupSideProjection,
  BasketballMatchEvent,
  BasketballMatchProjection,
  BasketballSportGameState,
  BasketballTeamSide,
} from './types'

export function isBasketballLineupEvent(
  event: BasketballMatchEvent
): event is BasketballLineupEvent {
  return [
    'basketball.lineup_confirmed',
    'basketball.substitution',
    'basketball.role_changed',
    'basketball.equal_play_override',
  ].includes(event.eventType)
}

export function validatePendingBasketballEqualPlayOverride(
  projection: BasketballMatchProjection,
  event: BasketballMatchEvent
): string | null {
  const pending = projection.lineup?.pendingEqualPlayOverride
  if (!pending || event.eventType === 'basketball.lineup_confirmed') return null
  return 'Basketball equal-play override must immediately precede its lineup confirmation.'
}

export function basketballLineupClockStartError(
  projection: BasketballMatchProjection
): string | null {
  if (!projection.lineup) return null
  for (const side of enabledSides(projection)) {
    if (side.boundaryConfirmationRequired) {
      return `${sideLabel(side.teamSide)} lineup requires boundary confirmation before the clock starts.`
    }
    if (side.replacementRequiredParticipantIds.length > 0) {
      return `${sideLabel(side.teamSide)} lineup requires an eligible replacement before the clock starts.`
    }
    if (side.currentParticipantIds.length === 0 || side.currentParticipantIds.length > 5) {
      return `${sideLabel(side.teamSide)} lineup must contain one through five participants.`
    }
    if (side.currentParticipantIds.length < 5 && !side.currentShortHandedReason) {
      return `${sideLabel(side.teamSide)} short-handed lineup requires a reason before the clock starts.`
    }
  }
  return null
}

export function applyBasketballLineupEvent(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: BasketballLineupEvent
): string | null {
  if (!projection.lineup || !projection.clock) {
    return 'Basketball lineup events require anchored lineup authority.'
  }
  if (projection.clock.running) return 'Pause the Basketball clock before changing the lineup.'
  if (projection.status !== 'in_progress' || event.period.id !== projection.currentPeriodId) {
    return 'Basketball lineup event requires the active period.'
  }
  const side = projection.lineup.sides[event.teamSide]
  if (!side) return `${sideLabel(event.teamSide)} lineup authority is unavailable.`

  switch (event.eventType) {
    case 'basketball.substitution':
      return applySubstitution(projection, sportState, side, event)
    case 'basketball.role_changed':
      return applyRoleChange(projection, side, event)
    case 'basketball.equal_play_override':
      return applyEqualPlayOverride(projection, sportState, side, event)
    case 'basketball.lineup_confirmed':
      return applyLineupConfirmation(projection, sportState, side, event)
  }
}

export function applyBasketballLineupEffectsAfterEvent(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  event: BasketballMatchEvent
): string | null {
  if (!projection.lineup || !projection.clock) return null
  switch (event.eventType) {
    case 'basketball.period_started':
      return openPeriodLineups(projection, sportState, event.id, event.payload.periodId)
    case 'basketball.period_ended':
      closePeriodLineups(projection, event.id, event.elapsedMs!)
      return null
    case 'basketball.clock_started':
      projection.lineup.runningClockIntervals.push({
        periodId: event.period.id,
        startElapsedMs: event.elapsedMs!,
        endElapsedMs: null,
        startEventId: event.id,
        endEventId: null,
      })
      enabledSides(projection).forEach(side => { side.clockStartedInPeriod = true })
      return null
    case 'basketball.clock_paused':
      return closeRunningClockInterval(projection, event.id, event.elapsedMs!)
    case 'basketball.clock_adjusted':
      splitLineupsAtAdjustment(
        projection,
        event.id,
        event.payload.fromElapsedMs,
        event.payload.toElapsedMs
      )
      return null
    case 'basketball.match_roster_added':
      ensureParticipantProjection(projection, event.payload.participant.id, event.payload.participant.teamSide)
      return null
    case 'basketball.foul':
    case 'basketball.ejection':
      refreshReplacementRequirements(projection)
      return null
    default:
      return null
  }
}

export function basketballLineupProjectionDiagnostics(
  projection: BasketballMatchProjection
): GameEventDiagnostic[] {
  const pending = projection.lineup?.pendingEqualPlayOverride
  return pending
    ? [{
        code: 'semantic_validation_failed',
        eventId: pending.eventId,
        message: 'Basketball equal-play override is dangling without its lineup confirmation.',
      }]
    : []
}

export function evaluateBasketballEqualPlayCandidate(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  periodId: string,
  candidateParticipantIds: string[]
): BasketballEqualPlayViolation[] {
  const rules = sportState.setup.rulesSnapshot
  if (!isBasketballMatchRulesV3(rules) || rules.equalPlayPolicy.mode === 'off') return []
  const segment = resolveBasketballPeriodSegment(rules, periodId)
  if (!segment || segment.kind !== 'regulation') return []
  const tracked = projection.lineup?.sides.tracked
  if (!tracked) return []
  const policy = rules.equalPlayPolicy
  const regulation = rules.regulationSegments
  const openingEligible = sportState.setup.participants.filter(participant =>
    participant.teamSide === 'tracked' &&
    participant.initialStatus !== 'dnp' &&
    !projection.participants[participant.id]?.ejected &&
    !projection.participants[participant.id]?.disqualified
  )
  const openingIds = openingEligible.map(value => value.id)
  const candidate = new Set(candidateParticipantIds)
  const projectedCounts = new Map<string, number>()
  for (const participantId of openingIds) {
    const participation = tracked.participationByParticipantId[participantId]
    const priorCount = participation?.creditedPeriodIds.filter(id =>
      regulation.some(segmentRule => segmentRule.id === id)
    ).length ?? 0
    projectedCounts.set(participantId, priorCount + (candidate.has(participantId) ? 1 : 0))
  }

  const violations: BasketballEqualPlayViolation[] = []
  if (policy.minimumPeriods !== null) {
    const remainingAfter = Math.max(0, regulation.length - segment.order)
    const ids = openingIds.filter(id =>
      (projectedCounts.get(id) ?? 0) + remainingAfter < policy.minimumPeriods!
    )
    if (ids.length > 0) violations.push({ code: 'minimum_periods', participantIds: ids })
  }
  if (policy.maximumConsecutivePeriods !== null) {
    const ids = candidateParticipantIds.filter(id => {
      const participation = tracked.participationByParticipantId[id]
      if (!participation) return false
      const credited = new Set(participation.creditedPeriodIds)
      let streak = 1
      for (let order = segment.order - 1; order >= 1; order -= 1) {
        const prior = regulation.find(value => value.order === order)
        if (!prior || !credited.has(prior.id)) break
        streak += 1
      }
      return streak > policy.maximumConsecutivePeriods!
    })
    if (ids.length > 0) {
      violations.push({
        code: 'maximum_consecutive_periods',
        participantIds: canonicalParticipantIds(projection, 'tracked', ids),
      })
    }
  }
  if (policy.maximumPeriodImbalance !== null && projectedCounts.size > 1) {
    const counts = [...projectedCounts.values()]
    if (Math.max(...counts) - Math.min(...counts) > policy.maximumPeriodImbalance) {
      const min = Math.min(...counts)
      const ids = openingIds.filter(id => (projectedCounts.get(id) ?? 0) === min)
      violations.push({ code: 'maximum_period_imbalance', participantIds: ids })
    }
  }
  return violations
}

function applySubstitution(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  side: BasketballLineupSideProjection,
  event: Extract<BasketballLineupEvent, { eventType: 'basketball.substitution' }>
): string | null {
  const canonical = canonicalParticipantIds(projection, event.teamSide, event.payload.participantIds)
  if (!sameIds(canonical, event.payload.participantIds)) {
    return 'Basketball substitution lineup must use unique side participants in setup order.'
  }
  const invalid = canonical.find(id => {
    const participant = projection.participants[id]
    return !participant || participant.openingStatus === 'dnp' || participant.ejected || participant.disqualified
  })
  if (invalid) return 'Basketball substitution includes an unavailable participant.'
  if (canonical.length === 0 || canonical.length > 5) {
    return 'Basketball substitution must leave one through five participants on court.'
  }
  if (canonical.length < 5 && !event.payload.reason) {
    return 'Basketball short-handed substitution requires a reason.'
  }
  if (sameIds(canonical, side.currentParticipantIds)) {
    return 'Basketball substitution must change the current lineup.'
  }
  const prior = new Set(side.currentParticipantIds)
  const next = new Set(canonical)
  const exits = side.currentParticipantIds.filter(id => !next.has(id))
  const entries = canonical.filter(id => !prior.has(id))
  if (event.payload.mode === 'balanced' && (exits.length === 0 || exits.length !== entries.length)) {
    return 'Balanced Basketball substitution requires the same number of entries and exits.'
  }
  if (event.payload.mode === 'exit_only' && (entries.length > 0 || exits.length === 0)) {
    return 'Exit-only Basketball substitution cannot add participants.'
  }
  if (event.payload.mode === 'entry_only' && (exits.length > 0 || entries.length === 0)) {
    return 'Entry-only Basketball substitution cannot remove participants.'
  }
  const currentSegment = resolveBasketballPeriodSegment(
    sportState.setup.rulesSnapshot,
    event.period.id
  )
  if (event.payload.mode === 'boundary' &&
      (!currentSegment || !lineupChangeBoundary(sportState, currentSegment.id) || side.clockStartedInPeriod)) {
    return 'Boundary Basketball substitution requires an unstarted lineup-change boundary.'
  }

  closeOpenLineupInterval(
    side,
    event.id,
    event.elapsedMs!,
    event.payload.mode === 'current_lineup_recovery'
  )
  if (event.payload.mode === 'current_lineup_recovery') {
    addUnique(side.incompletePeriodIds, event.period.id)
    for (const participation of Object.values(side.participationByParticipantId)) {
      participation.complete = false
    }
  }
  side.currentParticipantIds = canonical
  side.currentShortHandedReason = canonical.length < 5 ? event.payload.reason : null
  openLineupInterval(side, event.period.id, event.elapsedMs!, event.id,
    event.payload.mode !== 'current_lineup_recovery')
  if (side.boundaryConfirmedPeriodId === event.period.id && !side.clockStartedInPeriod) {
    side.boundaryConfirmationRequired = true
    side.boundaryConfirmedPeriodId = null
  }
  refreshReplacementRequirements(projection)
  return null
}

function applyRoleChange(
  projection: BasketballMatchProjection,
  side: BasketballLineupSideProjection,
  event: Extract<BasketballLineupEvent, { eventType: 'basketball.role_changed' }>
): string | null {
  for (const change of event.payload.changes) {
    const participant = projection.participants[change.participantId]
    if (!participant || participant.teamSide !== event.teamSide) {
      return 'Basketball role change references a participant on the wrong side.'
    }
  }
  for (const change of event.payload.changes) {
    const participant = projection.participants[change.participantId]
    participant.position = change.position
    participant.captain = change.captain
    const history = side.roleHistoryByParticipantId[change.participantId] ??= []
    history.push({
      eventId: event.id,
      periodId: event.period.id,
      elapsedMs: event.elapsedMs!,
      position: change.position,
      captain: change.captain,
    })
  }
  return null
}

function applyEqualPlayOverride(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  side: BasketballLineupSideProjection,
  event: Extract<BasketballLineupEvent, { eventType: 'basketball.equal_play_override' }>
): string | null {
  if (projection.lineup!.pendingEqualPlayOverride) {
    return 'Basketball equal-play override is already pending.'
  }
  if (!side.boundaryConfirmationRequired || event.payload.boundaryPeriodId !== event.period.id) {
    return 'Basketball equal-play override does not target the pending boundary.'
  }
  if (!sameIds(event.payload.candidateParticipantIds, side.currentParticipantIds)) {
    return 'Basketball equal-play override candidate does not match the current lineup.'
  }
  const rules = sportState.setup.rulesSnapshot
  if (!isBasketballMatchRulesV3(rules) || rules.equalPlayPolicy.mode !== 'enforced') {
    return 'Basketball equal-play override requires enforced equal-play rules.'
  }
  const violations = evaluateBasketballEqualPlayCandidate(
    projection,
    sportState,
    event.period.id,
    side.currentParticipantIds
  )
  const codes = violationCodes(violations)
  if (codes.length === 0 || !sameIds(codes, event.payload.violationCodes)) {
    return 'Basketball equal-play override does not match the projector violations.'
  }
  projection.lineup!.pendingEqualPlayOverride = {
    eventId: event.id,
    captureCommandId: event.payload.captureCommandId,
    boundaryPeriodId: event.payload.boundaryPeriodId,
    candidateParticipantIds: [...event.payload.candidateParticipantIds],
    violationCodes: [...event.payload.violationCodes],
  }
  projection.lineup!.enforcedOverridesComplete = false
  return null
}

function applyLineupConfirmation(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  side: BasketballLineupSideProjection,
  event: Extract<BasketballLineupEvent, { eventType: 'basketball.lineup_confirmed' }>
): string | null {
  if (!side.boundaryConfirmationRequired || event.payload.boundaryPeriodId !== event.period.id) {
    return 'Basketball lineup confirmation does not target a pending boundary.'
  }
  if (!sameIds(event.payload.participantIds, side.currentParticipantIds)) {
    return 'Basketball lineup confirmation does not match the current lineup.'
  }
  const violations = event.teamSide === 'tracked'
    ? evaluateBasketballEqualPlayCandidate(projection, sportState, event.period.id, event.payload.participantIds)
    : []
  const rules = sportState.setup.rulesSnapshot
  const mode = isBasketballMatchRulesV3(rules) ? rules.equalPlayPolicy.mode : 'off'
  const pending = projection.lineup!.pendingEqualPlayOverride
  if (mode === 'enforced' && violations.length > 0) {
    const codes = violationCodes(violations)
    if (!pending ||
        pending.captureCommandId !== event.payload.captureCommandId ||
        pending.boundaryPeriodId !== event.period.id ||
        !sameIds(pending.candidateParticipantIds, event.payload.participantIds) ||
        !sameIds(pending.violationCodes, codes)) {
      return 'Basketball enforced equal-play violation requires its exact atomic override.'
    }
  } else if (pending) {
    return 'Basketball equal-play override is not valid for this lineup confirmation.'
  }

  projection.lineup!.equalPlayReviews.push({
    periodId: event.period.id,
    candidateParticipantIds: [...event.payload.participantIds],
    violations: structuredClone(violations),
    confirmationEventId: event.id,
    overrideEventId: pending?.eventId ?? null,
  })
  if (violations.length > 0) projection.lineup!.equalPlayCompliant = false
  projection.lineup!.pendingEqualPlayOverride = null
  projection.lineup!.enforcedOverridesComplete = mode !== 'enforced' ||
    projection.lineup!.equalPlayReviews.every(review =>
      review.violations.length === 0 || review.overrideEventId !== null
    )
  side.boundaryConfirmationRequired = false
  side.boundaryConfirmedPeriodId = event.period.id
  return null
}

function openPeriodLineups(
  projection: BasketballMatchProjection,
  sportState: BasketballSportGameState,
  eventId: string,
  periodId: string
): string | null {
  const segment = resolveBasketballPeriodSegment(sportState.setup.rulesSnapshot, periodId)
  if (!segment) return 'Basketball lineup period is invalid.'
  for (const side of enabledSides(projection)) {
    if (projection.startedPeriodIds.length > 1) {
      const previousIds = [...side.currentParticipantIds]
      side.currentParticipantIds = side.currentParticipantIds.filter(id => {
        const participant = projection.participants[id]
        return participant && !participant.ejected && !participant.disqualified
      })
      if (!sameIds(previousIds, side.currentParticipantIds)) side.currentShortHandedReason = null
    }
    side.clockStartedInPeriod = false
    side.boundaryConfirmationRequired = projection.startedPeriodIds.length > 1 &&
      lineupChangeBoundary(sportState, periodId)
    side.boundaryConfirmedPeriodId = side.boundaryConfirmationRequired ? null : periodId
    openLineupInterval(side, periodId, 0, eventId, true)
    for (const participantId of side.currentParticipantIds) {
      const participant = projection.participants[participantId]
      const history = side.roleHistoryByParticipantId[participantId] ??= []
      if (history.length === 0) {
        history.push({
          eventId,
          periodId,
          elapsedMs: 0,
          position: participant.position,
          captain: participant.captain,
        })
      }
    }
  }
  refreshReplacementRequirements(projection)
  return null
}

function closePeriodLineups(
  projection: BasketballMatchProjection,
  eventId: string,
  elapsedMs: number
): void {
  enabledSides(projection).forEach(side => closeOpenLineupInterval(side, eventId, elapsedMs))
}

function closeRunningClockInterval(
  projection: BasketballMatchProjection,
  eventId: string,
  elapsedMs: number
): string | null {
  const intervals = projection.lineup!.runningClockIntervals
  const interval = intervals[intervals.length - 1]
  if (!interval || interval.endElapsedMs !== null) {
    return 'Basketball running-clock interval is unavailable for this pause.'
  }
  if (elapsedMs < interval.startElapsedMs) {
    return 'Basketball running-clock interval cannot end before it starts.'
  }
  interval.endElapsedMs = elapsedMs
  interval.endEventId = eventId
  const durationMs = elapsedMs - interval.startElapsedMs
  for (const side of enabledSides(projection)) {
    for (const participantId of side.currentParticipantIds) {
      const participation = side.participationByParticipantId[participantId]
      if (!participation) continue
      participation.intervals.push({
        periodId: interval.periodId,
        startElapsedMs: interval.startElapsedMs,
        endElapsedMs: elapsedMs,
        durationMs,
        startEventId: interval.startEventId,
        endEventId: eventId,
      })
    }
    refreshSideParticipationTotals(projection, side)
  }
  return null
}

function splitLineupsAtAdjustment(
  projection: BasketballMatchProjection,
  eventId: string,
  fromElapsedMs: number,
  toElapsedMs: number
): void {
  const periodId = projection.currentPeriodId!
  if (toElapsedMs < fromElapsedMs) {
    projection.lineup!.runningClockIntervals = trimIntervalsAfterElapsed(
      projection.lineup!.runningClockIntervals,
      periodId,
      toElapsedMs,
      eventId
    )
  }
  for (const side of enabledSides(projection)) {
    if (toElapsedMs < fromElapsedMs) {
      side.onCourtIntervals = trimIntervalsAfterElapsed(
        side.onCourtIntervals,
        periodId,
        toElapsedMs,
        eventId
      )
      for (const participation of Object.values(side.participationByParticipantId)) {
        participation.intervals = trimIntervalsAfterElapsed(
          participation.intervals,
          periodId,
          toElapsedMs,
          eventId
        )
      }
      refreshSideParticipationTotals(projection, side)
    } else {
      closeOpenLineupInterval(side, eventId, fromElapsedMs)
    }
    openLineupInterval(side, periodId, toElapsedMs, eventId, true)
  }
}

function trimIntervalsAfterElapsed<
  T extends {
    periodId: string
    startElapsedMs: number
    endElapsedMs: number | null
    endEventId: string | null
  },
>(
  intervals: T[],
  periodId: string,
  elapsedMs: number,
  eventId: string
): T[] {
  return intervals.flatMap(interval => {
    if (interval.periodId !== periodId) return [interval]
    if (interval.startElapsedMs >= elapsedMs) return []
    if (interval.endElapsedMs !== null && interval.endElapsedMs <= elapsedMs) return [interval]
    const endElapsedMs = elapsedMs
    return [{
      ...interval,
      endElapsedMs,
      endEventId: eventId,
      ...('durationMs' in interval
        ? { durationMs: endElapsedMs - interval.startElapsedMs }
        : {}),
    }]
  })
}

function refreshSideParticipationTotals(
  projection: BasketballMatchProjection,
  side: BasketballLineupSideProjection
): void {
  for (const participation of Object.values(side.participationByParticipantId)) {
    const periodParticipationMs: Record<string, number> = {}
    const creditedPeriodIds: string[] = []
    let participationMs = 0
    for (const interval of participation.intervals) {
      participationMs += interval.durationMs
      periodParticipationMs[interval.periodId] =
        (periodParticipationMs[interval.periodId] ?? 0) + interval.durationMs
      if (interval.durationMs > 0) addUnique(creditedPeriodIds, interval.periodId)
    }
    participation.participationMs = participationMs
    participation.participationSeconds = participationMs / 1_000
    participation.periodParticipationMs = periodParticipationMs
    participation.creditedPeriodIds = creditedPeriodIds
    participation.appeared = participationMs > 0
    projection.participants[participation.participantId].stats.min = participationMs / 60_000
  }
  projection.sideStats[side.teamSide].min = Object.values(side.participationByParticipantId)
    .reduce((total, value) => total + value.participationMs, 0) / 60_000
}

function ensureParticipantProjection(
  projection: BasketballMatchProjection,
  participantId: string,
  teamSide: BasketballTeamSide
): void {
  const side = projection.lineup?.sides[teamSide]
  if (!side || side.participationByParticipantId[participantId]) return
  side.participationByParticipantId[participantId] = {
    participantId,
    started: false,
    appeared: false,
    participationMs: 0,
    participationSeconds: 0,
    periodParticipationMs: {},
    creditedPeriodIds: [],
    intervals: [],
    complete: true,
  }
  side.roleHistoryByParticipantId[participantId] = []
}

function refreshReplacementRequirements(projection: BasketballMatchProjection): void {
  for (const side of enabledSides(projection)) {
    side.replacementRequiredParticipantIds = side.currentParticipantIds.filter(id => {
      const participant = projection.participants[id]
      return !participant || participant.ejected || participant.disqualified
    })
  }
}

function openLineupInterval(
  side: BasketballLineupSideProjection,
  periodId: string,
  elapsedMs: number,
  eventId: string,
  complete: boolean
): void {
  side.onCourtIntervals.push({
    periodId,
    participantIds: [...side.currentParticipantIds],
    startElapsedMs: elapsedMs,
    endElapsedMs: null,
    startEventId: eventId,
    endEventId: null,
    complete,
  })
}

function closeOpenLineupInterval(
  side: BasketballLineupSideProjection,
  eventId: string,
  elapsedMs: number,
  preserveZeroDuration = false
): void {
  const interval = side.onCourtIntervals[side.onCourtIntervals.length - 1]
  if (!interval || interval.endElapsedMs !== null) return
  if (!preserveZeroDuration && interval.startElapsedMs === elapsedMs) {
    side.onCourtIntervals.pop()
    return
  }
  interval.endElapsedMs = elapsedMs
  interval.endEventId = eventId
}

function canonicalParticipantIds(
  projection: BasketballMatchProjection,
  teamSide: BasketballTeamSide,
  participantIds: readonly string[]
): string[] {
  const requested = new Set(participantIds)
  return Object.values(projection.participants)
    .filter(value => value.teamSide === teamSide && requested.has(value.participantId))
    .map(value => value.participantId)
}

function lineupChangeBoundary(sportState: BasketballSportGameState, periodId: string): boolean {
  const rules = sportState.setup.rulesSnapshot
  if (!isBasketballMatchRulesV3(rules)) return false
  const regulation = rules.regulationSegments.find(value => value.id === periodId)
  if (regulation) return regulation.lineupChangeBoundary
  return rules.overtimeTemplate.lineupChangeBoundary
}

function violationCodes(violations: BasketballEqualPlayViolation[]): BasketballEqualPlayViolationCode[] {
  return violations.map(value => value.code)
}

function enabledSides(projection: BasketballMatchProjection): BasketballLineupSideProjection[] {
  if (!projection.lineup) return []
  return [projection.lineup.sides.tracked, projection.lineup.sides.opponent]
    .filter((value): value is BasketballLineupSideProjection => value !== null)
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value)
}

function sideLabel(side: BasketballTeamSide): string {
  return side === 'tracked' ? 'Tracked' : 'Opponent'
}
