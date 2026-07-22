import type { GameEventPeriod, GameEventTeamSide } from '../gameEvents/types'
import type {
  SoccerMatchEvent,
  SoccerCardSanction,
  SoccerProjectedParticipant,
  SoccerRole,
  SoccerShotSituation,
  SoccerYellowCardExitPolicy,
} from './types'

export interface SoccerShotSourceCandidate {
  eventId: string
  elapsedMs: number
  label: string
}

export type SoccerDisciplineCaptureChoice = 'stay' | 'short' | 'replace' | 'keeper_handoff'

export function soccerDisciplineCaptureChoice(
  sanction: SoccerCardSanction,
  yellowPolicy: SoccerYellowCardExitPolicy,
  goalkeeper: boolean,
  current: SoccerDisciplineCaptureChoice
): SoccerDisciplineCaptureChoice {
  if (sanction === 'yellow') {
    if (yellowPolicy === 'stay_on') return 'stay'
    if (goalkeeper) return 'replace'
    return current === 'replace' ? 'replace' : 'short'
  }
  return goalkeeper ? 'keeper_handoff' : 'short'
}

export function soccerParticipantWasOnFieldAt(
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

export function soccerParticipantRoleAt(
  participant: SoccerProjectedParticipant,
  periodId: string,
  elapsedMs: number,
  initialRole: SoccerRole = participant.role
): SoccerRole {
  const intervals = participant.roleIntervals
    .filter(interval => interval.periodId === periodId && interval.startElapsedMs <= elapsedMs)
    .sort((left, right) => right.startElapsedMs - left.startElapsedMs)
  return intervals[0]?.role ?? initialRole
}

export function soccerShotSourceCandidates(
  events: SoccerMatchEvent[],
  options: {
    teamSide: GameEventTeamSide
    situation: SoccerShotSituation
    period: GameEventPeriod
    elapsedMs: number
    excludeEventId?: string | null
  }
): SoccerShotSourceCandidate[] {
  const requiredRestart = options.situation === 'penalty'
    ? 'penalty'
    : options.situation === 'direct_free_kick'
      ? 'direct_free_kick'
      : null
  if (!requiredRestart && options.situation !== 'corner_sequence') return []
  return events
    .filter(event => event.id !== options.excludeEventId &&
      event.period.id === options.period.id &&
      event.elapsedMs !== null &&
      event.elapsedMs <= options.elapsedMs)
    .filter(event => {
      if (options.situation === 'corner_sequence') {
        return event.eventType === 'soccer.team_event' &&
          event.payload.kind === 'corner' &&
          event.teamSide === options.teamSide
      }
      return event.eventType === 'soccer.foul' &&
        event.payload.restart === requiredRestart &&
        event.teamSide !== options.teamSide
    })
    .sort((left, right) => (right.elapsedMs ?? 0) - (left.elapsedMs ?? 0) || right.sequence - left.sequence)
    .map(event => ({
      eventId: event.id,
      elapsedMs: event.elapsedMs!,
      label: event.eventType === 'soccer.team_event'
        ? 'Corner'
        : event.payload.restart === 'penalty'
          ? 'Penalty foul'
          : 'Direct-free-kick foul',
    }))
}
