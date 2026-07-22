import type { GameEventPeriod } from '../gameEvents/types'
import { orderedSoccerSegments } from './rules'
import type {
  SoccerMatchProjection,
  SoccerMatchSegment,
  SoccerShootoutProjection,
} from './types'

export type SoccerLifecycleAction =
  | { kind: 'start_period'; segment: SoccerMatchSegment }
  | { kind: 'start_shootout' }
  | { kind: 'complete'; label: 'Complete Match' | 'Complete Draw' }
  | { kind: 'none' }

export interface SoccerShootoutSetupDefaults {
  trackedEligibleParticipantIds: string[]
  trackedExcludedParticipantIds: string[]
  opponentEligibleCount: number
  trackedGoalkeeperParticipantId: string | null
}

export function soccerLifecycleAction(projection: SoccerMatchProjection): SoccerLifecycleAction {
  if (projection.status === 'shootout') {
    return projection.shootout?.decided
      ? { kind: 'complete', label: 'Complete Match' }
      : { kind: 'none' }
  }
  if (projection.status !== 'period_break') return { kind: 'none' }

  const regulation = projection.currentRules.regulationSegments
  const nextRegulation = regulation.find(segment => !projection.completedPeriodIds.includes(segment.id))
  if (nextRegulation) return { kind: 'start_period', segment: nextRegulation }

  const tied = projection.sideTotals.tracked.score === projection.sideTotals.opponent.score
  const extraTime = projection.currentRules.extraTimeSegments
  const extraTimeBegan = extraTime.some(segment => projection.startedPeriodIds.includes(segment.id))
  const nextExtraTime = extraTime.find(segment => !projection.completedPeriodIds.includes(segment.id))
  if (extraTimeBegan && nextExtraTime) return { kind: 'start_period', segment: nextExtraTime }
  if (!tied) return { kind: 'complete', label: 'Complete Match' }

  if (projection.currentRules.tieResolution === 'draw_allowed') {
    return { kind: 'complete', label: 'Complete Draw' }
  }
  if (projection.currentRules.tieResolution === 'extra_time_then_shootout' && nextExtraTime) {
    return { kind: 'start_period', segment: nextExtraTime }
  }
  return { kind: 'start_shootout' }
}

export function soccerShootoutPeriod(projection: SoccerMatchProjection): GameEventPeriod {
  return {
    id: 'shootout',
    order: Math.max(...orderedSoccerSegments(projection.currentRules).map(segment => segment.order), 0) + 1,
  }
}

export function soccerShootoutSetupDefaults(
  projection: SoccerMatchProjection
): SoccerShootoutSetupDefaults {
  const trackedEligibleParticipantIds = Object.values(projection.participants)
    .filter(participant => participant.status === 'on_field')
    .map(participant => participant.participantId)
  const goalkeeper = trackedEligibleParticipantIds
    .map(id => projection.participants[id])
    .find(participant => participant.role.group === 'goalkeeper')
  return {
    trackedEligibleParticipantIds,
    trackedExcludedParticipantIds: [],
    opponentEligibleCount: trackedEligibleParticipantIds.length,
    trackedGoalkeeperParticipantId: goalkeeper?.participantId ?? null,
  }
}

export function soccerShootoutUsedKickerKeys(
  shootout: SoccerShootoutProjection,
  side: 'tracked' | 'opponent'
): Set<string> {
  const uniqueCount = side === 'tracked'
    ? shootout.trackedEligibleParticipantIds.length
    : shootout.opponentEligibleCount
  if (uniqueCount <= 0) return new Set()
  const completed = shootout.kicks.filter(kick => kick.teamSide === side && kick.advances)
  const cycleStart = Math.floor(completed.length / uniqueCount) * uniqueCount
  return new Set(completed.slice(cycleStart).map(kick => kick.kickerKey))
}

export function soccerShootoutPendingRetake(
  shootout: SoccerShootoutProjection
): SoccerShootoutProjection['kicks'][number] | null {
  const latest = shootout.kicks[shootout.kicks.length - 1]
  return latest?.outcome === 'retake' ? latest : null
}

export function soccerNextAnonymousKickerSlot(
  shootout: SoccerShootoutProjection,
  side: 'tracked' | 'opponent'
): number {
  const used = soccerShootoutUsedKickerKeys(shootout, side)
  const eligibleCount = side === 'tracked'
    ? shootout.trackedEligibleParticipantIds.length
    : shootout.opponentEligibleCount
  for (let slot = 1; slot <= eligibleCount; slot += 1) {
    if (!used.has(`anonymous:${slot}`)) return slot
  }
  return 1
}
