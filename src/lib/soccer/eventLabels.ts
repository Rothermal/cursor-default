import type { GameEvent } from '../gameEvents/types'
import type { SoccerPeriodTiming } from './live'
import { formatSoccerInputTime, soccerTeamEventReviewPresentation } from './timeline'

const EVENT_TITLES: Record<string, string> = {
  'soccer.opening_lineup': 'Opening lineup',
  'soccer.period_started': 'Period started',
  'soccer.period_ended': 'Period ended',
  'soccer.clock_started': 'Clock started',
  'soccer.clock_paused': 'Clock paused',
  'soccer.clock_adjusted': 'Clock corrected',
  'soccer.match_rules_changed': 'Rules changed',
  'soccer.substitution_window': 'Substitution window',
  'soccer.lineup_transition': 'Lineup change',
  'soccer.role_changed': 'Roles changed',
  'soccer.attacking_direction_changed': 'Direction changed',
  'soccer.match_roster_added': 'Participant added',
  'soccer.participant_resolved': 'Participant resolved',
  'soccer.match_ended': 'Match ended',
  'soccer.match_reopened': 'Match reopened',
  'soccer.shot': 'Shot',
  'soccer.own_goal': 'Own goal',
  'soccer.score_adjustment': 'Score adjustment',
  'soccer.defensive_action': 'Defensive action',
  'soccer.foul': 'Foul',
  'soccer.card': 'Card',
  'soccer.shootout_started': 'Shootout started',
  'soccer.shootout_eligibility_changed': 'Shootout eligibility',
  'soccer.shootout_goalkeeper_changed': 'Shootout goalkeeper',
  'soccer.shootout_kick': 'Shootout kick',
}

const SHOT_OUTCOME_LABELS: Record<string, string> = {
  goal: 'Goal',
  saved: 'Saved',
  blocked: 'Blocked',
  off_target: 'Off target',
  woodwork: 'Woodwork',
}

const BODY_PART_LABELS: Record<string, string> = {
  header: 'header',
  left_foot: 'left foot',
  right_foot: 'right foot',
}

/** Short row title shared by Timeline, Summary, and Field Undo. */
export function soccerEventTitle(event: GameEvent): string {
  if (event.eventType === 'soccer.team_event') {
    return soccerTeamEventReviewPresentation(event).kindLabel
  }
  return EVENT_TITLES[event.eventType] ?? event.eventType
}

/** One-line side / outcome / actor detail for a Timeline row. */
export function soccerEventDetail(event: GameEvent): string {
  const payload = event.payload as Record<string, unknown>
  switch (event.eventType) {
    case 'soccer.opening_lineup': return `${Array.isArray(payload.starters) ? payload.starters.length : 0} starters`
    case 'soccer.period_started':
    case 'soccer.period_ended': return String(payload.periodId ?? event.period.id)
    case 'soccer.substitution_window': return `${Array.isArray(payload.changes) ? payload.changes.length : 0} change(s)`
    case 'soccer.role_changed': return `${Array.isArray(payload.changes) ? payload.changes.length : 0} role(s)`
    case 'soccer.attacking_direction_changed': return payload.direction === 'left_to_right' ? 'Left to right' : 'Right to left'
    case 'soccer.match_roster_added': return String((payload.participant as { displayName?: unknown } | undefined)?.displayName ?? 'Participant')
    case 'soccer.participant_resolved': return String(payload.displayName ?? 'Roster player')
    case 'soccer.match_ended': return String(payload.reason ?? 'Ended')
    case 'soccer.match_reopened': return String(payload.reason ?? 'Reopened')
    case 'soccer.shot': {
      const shooter = event.actors.find(actor => actor.role === 'shooter')
      return `${sideLabel(event)} · ${String(payload.outcome ?? 'shot').replace('_', ' ')} · ${shooter?.label ?? 'Team'}`
    }
    case 'soccer.own_goal': return `${sideLabel(event)} benefits · ${event.actors.find(actor => actor.role === 'own_goal_by')?.label ?? 'Unknown'}`
    case 'soccer.score_adjustment': return `${sideLabel(event)} ${Number(payload.delta) > 0 ? '+' : ''}${String(payload.delta ?? '')} · ${String(payload.reason ?? 'No reason')}`
    case 'soccer.defensive_action': {
      const actor = event.actors.find(item => item.role === 'defender')
      const outcome = payload.action === 'tackle' ? ` ${String(payload.tackleOutcome ?? '')}` : ''
      return `${sideLabel(event)} / ${String(payload.action ?? 'defense').replace(/_/g, ' ')}${outcome} / ${actor?.label ?? 'Team'}`
    }
    case 'soccer.foul': {
      const actor = event.actors.find(item => item.role === 'committed_by')
      const sanction = payload.sanction === 'none' ? '' : ` / ${String(payload.sanction).replace(/_/g, ' ')}`
      return `${sideLabel(event)} / ${actor?.label ?? 'Team'} / ${String(payload.restart ?? 'none').replace(/_/g, ' ')}${sanction}`
    }
    case 'soccer.card': {
      const actor = event.actors.find(item => item.role === 'recipient')
      return `${sideLabel(event)} / ${String(payload.sanction ?? 'card').replace(/_/g, ' ')} / ${actor?.label ?? 'Team'} / ${String(payload.reason ?? '').replace(/_/g, ' ')}`
    }
    case 'soccer.team_event': {
      const presentation = soccerTeamEventReviewPresentation(event)
      return `${presentation.sideLabel} / ${presentation.actorLabel}`
    }
    case 'soccer.shootout_started': return `${String(payload.firstKickingSide)} first / ${String(payload.initialKicksPerSide)} kicks / ${String(payload.opponentEligibleCount)} eligible`
    case 'soccer.shootout_eligibility_changed': return `${String(payload.reason).replace(/_/g, ' ')} / ${Array.isArray(payload.trackedEligibleParticipantIds) ? payload.trackedEligibleParticipantIds.length : 0} each`
    case 'soccer.shootout_goalkeeper_changed': return `${event.teamSide} / ${event.actors.find(actor => actor.role === 'goalkeeper_in')?.label ?? 'Unknown'} / ${String(payload.reason).replace(/_/g, ' ')}`
    case 'soccer.shootout_kick': return `${event.teamSide} / ${event.actors.find(actor => actor.role === 'kicker')?.label ?? 'Unknown'} / ${String(payload.outcome)}`
    default: return event.period.id
  }
}

export const SOCCER_LINKED_RESTART_REMOVED = 'Linked restart removed'

export function soccerShotSourceEventId(event: Pick<GameEvent, 'eventType' | 'payload'>): string | null {
  if (event.eventType !== 'soccer.shot') return null
  const sourceEventId = (event.payload as { sourceEventId?: unknown }).sourceEventId
  return typeof sourceEventId === 'string' ? sourceEventId : null
}

/**
 * Readable restart link for a linked shot, e.g. `From corner, taker #7 Ava, 23:10`.
 * `activeEvents` must exclude removed events so a removed source reads as a diagnostic.
 */
export function soccerShotSourceLine(
  event: GameEvent,
  activeEvents: readonly GameEvent[],
  timings: readonly SoccerPeriodTiming[]
): string | null {
  const sourceEventId = soccerShotSourceEventId(event)
  if (!sourceEventId) return null
  return soccerRestartSourceLine(sourceEventId, activeEvents, timings)
}

/** Source line for a restart id, used before the shot exists (compact live sheet). */
export function soccerRestartSourceLine(
  sourceEventId: string,
  activeEvents: readonly GameEvent[],
  timings: readonly SoccerPeriodTiming[]
): string {
  const source = activeEvents.find(candidate => candidate.id === sourceEventId)
  if (!source) return SOCCER_LINKED_RESTART_REMOVED
  return `From ${restartSourceLabel(source)}${timeSuffix(source, timings)}`
}

/** Active shots linked to a restart, e.g. `Led to: Goal (header) #9 Mia, 23:14`. */
export function soccerRestartLedToLine(
  event: GameEvent,
  activeEvents: readonly GameEvent[],
  timings: readonly SoccerPeriodTiming[],
  excludeEventIds: ReadonlySet<string> = new Set()
): string | null {
  const shots = activeEvents.filter(candidate =>
    soccerShotSourceEventId(candidate) === event.id &&
    !excludeEventIds.has(candidate.id)
  )
  if (shots.length === 0) return null
  return `Led to: ${shots.map(shot => `${linkedShotLabel(shot)}${timeSuffix(shot, timings)}`).join('; ')}`
}

function restartSourceLabel(source: GameEvent): string {
  if (source.eventType === 'soccer.team_event') {
    const presentation = soccerTeamEventReviewPresentation(source)
    const taker = source.actors.find(actor => actor.role === 'taker')?.label?.trim()
    return `${presentation.kindLabel.toLowerCase()}${taker ? `, taker ${taker}` : ''}`
  }
  if (source.eventType === 'soccer.foul') {
    const restart = (source.payload as { restart?: unknown }).restart
    const kind = restart === 'penalty' ? 'penalty foul' : 'free kick foul'
    const fouled = source.actors.find(actor => actor.role === 'fouled')?.label?.trim()
    return `${kind}${fouled ? ` on ${fouled}` : ''}`
  }
  return soccerEventTitle(source).toLowerCase()
}

function linkedShotLabel(shot: GameEvent): string {
  const payload = shot.payload as { outcome?: unknown; bodyPart?: unknown }
  const outcome = typeof payload.outcome === 'string'
    ? SHOT_OUTCOME_LABELS[payload.outcome] ?? payload.outcome
    : 'Shot'
  const bodyPart = typeof payload.bodyPart === 'string' ? BODY_PART_LABELS[payload.bodyPart] : undefined
  const shooter = shot.actors.find(actor => actor.role === 'shooter')?.label?.trim()
  return `${outcome}${bodyPart ? ` (${bodyPart})` : ''}${shooter ? ` ${shooter}` : ''}`
}

function timeSuffix(event: GameEvent, timings: readonly SoccerPeriodTiming[]): string {
  if (event.elapsedMs === null) return ''
  const start = timings.find(timing => timing.period.id === event.period.id)?.startElapsedMs ?? 0
  return `, ${formatSoccerInputTime(Math.max(0, event.elapsedMs - start))}`
}

function sideLabel(event: GameEvent): string {
  return event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'
}
