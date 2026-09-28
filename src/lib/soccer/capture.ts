import type { GameEvent, GameEventPeriod } from '../gameEvents/types'
import type {
  SoccerMatchEvent,
  SoccerCardSanction,
  SoccerProjectedParticipant,
  SoccerRole,
  SoccerShotSituation,
  SoccerTeamSide,
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
    teamSide: SoccerTeamSide
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

export const SOCCER_SHOT_SOURCE_SUGGESTION_WINDOW_MS = 60_000

export interface SoccerShotSourceSuggestion {
  situation: Exclude<SoccerShotSituation, 'open_play' | 'other_set_piece'>
  sourceEventId: string
}

const SOCCER_PLAY_CAPTURE_TYPES = new Set([
  'soccer.shot',
  'soccer.own_goal',
  'soccer.defensive_action',
  'soccer.foul',
  'soccer.team_event',
])

/**
 * Suggests the restart a live shot most likely came from: the newest corner
 * for the shooting side, or penalty/direct-free-kick foul by the other side,
 * when nothing but same-side non-goal shots, cards, or non-play rows followed it.
 * Only a corner carries through later shots; a penalty or direct free kick is
 * consumed by its first shot.
 */
export function suggestSoccerShotSource(
  events: SoccerMatchEvent[],
  options: {
    teamSide: SoccerTeamSide
    period: GameEventPeriod
    elapsedMs: number
  }
): SoccerShotSourceSuggestion | null {
  const newestFirst = events
    .filter(event => event.period.id === options.period.id)
    .sort((left, right) => right.sequence - left.sequence)
  let followedBySameSideShot = false
  for (const event of newestFirst) {
    const suggestion = shotSourceSuggestionFor(event, options.teamSide)
    if (suggestion) {
      // Penalties and direct free kicks are consumed by their first shot; a
      // rebound is open play and never falls back to an older restart.
      if (suggestion.situation !== 'corner_sequence' && followedBySameSideShot) return null
      return event.elapsedMs !== null &&
        event.elapsedMs <= options.elapsedMs &&
        options.elapsedMs - event.elapsedMs <= SOCCER_SHOT_SOURCE_SUGGESTION_WINDOW_MS
        ? suggestion
        : null
    }
    if (!SOCCER_PLAY_CAPTURE_TYPES.has(event.eventType)) continue
    if (
      event.eventType === 'soccer.shot' &&
      event.teamSide === options.teamSide &&
      event.payload.outcome !== 'goal'
    ) {
      followedBySameSideShot = true
      continue
    }
    return null
  }
  return null
}

function shotSourceSuggestionFor(
  event: SoccerMatchEvent,
  teamSide: SoccerTeamSide
): SoccerShotSourceSuggestion | null {
  if (
    event.eventType === 'soccer.team_event' &&
    event.payload.kind === 'corner' &&
    event.teamSide === teamSide
  ) return { situation: 'corner_sequence', sourceEventId: event.id }
  if (
    event.eventType === 'soccer.foul' &&
    event.teamSide !== teamSide &&
    (event.payload.restart === 'penalty' || event.payload.restart === 'direct_free_kick')
  ) return { situation: event.payload.restart, sourceEventId: event.id }
  return null
}

export interface SoccerPenaltyKickPrompt {
  foulId: string
  /** The fouled side, which takes the penalty kick. */
  teamSide: SoccerTeamSide
}

/** The penalty foul a live incident capture just appended, keyed to the fouled side. */
export function soccerLivePenaltyFoul(
  before: GameEvent[],
  after: GameEvent[]
): SoccerPenaltyKickPrompt | null {
  const previous = new Set(before.map(event => event.id))
  const foul = after.find(event =>
    !previous.has(event.id) &&
    event.eventType === 'soccer.foul' &&
    (event.payload as { restart?: unknown }).restart === 'penalty' &&
    (event.teamSide === 'tracked' || event.teamSide === 'opponent'))
  if (!foul) return null
  return { foulId: foul.id, teamSide: foul.teamSide === 'tracked' ? 'opponent' : 'tracked' }
}
