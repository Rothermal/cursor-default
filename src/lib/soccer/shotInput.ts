import type { GameEvent, GameEventLocation } from '../gameEvents/types'
import type { SoccerCaptureActorSelection, SoccerShotCaptureInput } from './live'
import type { ShotDetailDraft } from './shotDetails'
import type { SoccerShotOutcome, SoccerShotSituation, SoccerTeamSide } from './types'

export const SOCCER_TEAM_ACTOR_ID = '__team__'
export const SOCCER_UNKNOWN_ACTOR_ID = '__unknown__'

/**
 * Form choices shared by the full shot dialog and the compact live sheet.
 * Tracked ids are match participant ids, `__team__`, or (blocker only)
 * `__unknown__`; opponent actors are free-text labels.
 */
export interface SoccerShotFormSelection {
  teamSide: SoccerTeamSide
  outcome: SoccerShotOutcome
  situation: SoccerShotSituation
  sourceEventId: string
  /** Location already oriented to the shooting side's scoring direction. */
  location: GameEventLocation | null
  shotDetails: ShotDetailDraft
  trackedLabel: string
  opponentTeamLabel: string
  trackedShooterId: string
  opponentShooterMode: 'unknown' | 'team'
  opponentShooterLabel: string
  primaryCreatorId: string
  secondaryCreatorId: string
  opponentCreatorLabel: string
  opponentSecondaryLabel: string
  showSecondary: boolean
  trackedBlockerId: string
  opponentBlockerLabel: string
  opponentGoalkeeperLabel: string
  trackedGoalkeeperId: string
}

export function soccerShotCreatorsAllowed(situation: SoccerShotSituation, ownGoal = false): boolean {
  return !ownGoal && situation !== 'penalty' && situation !== 'direct_free_kick'
}

export function soccerShotSourceAllowed(situation: SoccerShotSituation): boolean {
  return situation === 'penalty' ||
    situation === 'direct_free_kick' ||
    situation === 'corner_sequence'
}

export function soccerPenaltyMark(direction: 'left_to_right' | 'right_to_left'): GameEventLocation {
  return { x: direction === 'left_to_right' ? 0.87 : 0.13, y: 0.5, attackingDirection: direction }
}

/** Builds the `recordSoccerShot` / `reviseSoccerShot` input from form choices. */
export function buildSoccerShotInput(selection: SoccerShotFormSelection): SoccerShotCaptureInput {
  const {
    teamSide,
    outcome,
    situation,
    trackedLabel,
    opponentTeamLabel,
  } = selection
  const creatorsAllowed = soccerShotCreatorsAllowed(situation)
  const keeperInvolved = outcome === 'goal' || outcome === 'saved' || situation === 'penalty'
  const shooter: SoccerCaptureActorSelection = teamSide === 'tracked'
    ? selection.trackedShooterId === SOCCER_TEAM_ACTOR_ID
      ? { kind: 'team', label: trackedLabel }
      : { kind: 'participant', participantId: selection.trackedShooterId }
    : selection.opponentShooterMode === 'team'
      ? { kind: 'team', label: opponentTeamLabel }
      : { kind: 'unknown', label: selection.opponentShooterLabel || 'Unknown opponent' }
  const goalkeeper: SoccerCaptureActorSelection | null = teamSide === 'opponent'
    ? selection.trackedGoalkeeperId && keeperInvolved
      ? { kind: 'participant', participantId: selection.trackedGoalkeeperId }
      : null
    : selection.opponentGoalkeeperLabel.trim() && keeperInvolved
      ? { kind: 'unknown', label: selection.opponentGoalkeeperLabel }
      : null
  return {
    teamSide,
    outcome,
    ...selection.shotDetails,
    situation,
    sourceEventId: soccerShotSourceAllowed(situation) ? selection.sourceEventId || null : null,
    location: selection.location,
    shooter,
    primaryCreator: creatorsAllowed
      ? teamSide === 'tracked'
        ? selection.primaryCreatorId ? { kind: 'participant', participantId: selection.primaryCreatorId } : null
        : selection.opponentCreatorLabel.trim() ? { kind: 'unknown', label: selection.opponentCreatorLabel } : null
      : null,
    secondaryCreator: creatorsAllowed && outcome === 'goal' && selection.showSecondary
      ? teamSide === 'tracked'
        ? selection.secondaryCreatorId ? { kind: 'participant', participantId: selection.secondaryCreatorId } : null
        : selection.opponentSecondaryLabel.trim() ? { kind: 'unknown', label: selection.opponentSecondaryLabel } : null
      : null,
    goalkeeper,
    blocker: outcome === 'blocked'
      ? teamSide === 'opponent'
        ? selection.trackedBlockerId === SOCCER_TEAM_ACTOR_ID
          ? { kind: 'team', label: trackedLabel }
          : selection.trackedBlockerId === SOCCER_UNKNOWN_ACTOR_ID
            ? { kind: 'unknown', label: 'Unknown tracked blocker' }
            : { kind: 'participant', participantId: selection.trackedBlockerId }
        : selection.opponentBlockerLabel.trim()
          ? { kind: 'unknown', label: selection.opponentBlockerLabel }
          : null
      : null,
  }
}

/**
 * Compact live-sheet choices, filled with the same defaults the full dialog
 * uses for fields the compact sheet does not show.
 */
export function soccerQuickShotSelection(input: {
  teamSide: SoccerTeamSide
  outcome: SoccerShotOutcome
  situation: SoccerShotSituation
  sourceEventId: string | null
  location: GameEventLocation | null
  trackedLabel: string
  opponentTeamLabel: string
  shooterId: string
  primaryCreatorId: string | null
  trackedGoalkeeperId: string | null
}): SoccerShotFormSelection {
  return {
    teamSide: input.teamSide,
    outcome: input.outcome,
    situation: input.situation,
    sourceEventId: input.sourceEventId ?? '',
    location: input.location,
    shotDetails: { bodyPart: null, goalPlacement: null },
    trackedLabel: input.trackedLabel,
    opponentTeamLabel: input.opponentTeamLabel,
    trackedShooterId: input.teamSide === 'tracked' ? input.shooterId : SOCCER_TEAM_ACTOR_ID,
    opponentShooterMode: 'unknown',
    opponentShooterLabel: 'Unknown opponent',
    primaryCreatorId: input.primaryCreatorId ?? '',
    secondaryCreatorId: '',
    opponentCreatorLabel: '',
    opponentSecondaryLabel: '',
    showSecondary: false,
    trackedBlockerId: SOCCER_TEAM_ACTOR_ID,
    opponentBlockerLabel: '',
    // Opponent lineups are label-only, so a tracked shot's save names the
    // defending keeper by team; opponent shots credit the tracked keeper.
    opponentGoalkeeperLabel: input.teamSide === 'tracked' && input.outcome === 'saved'
      ? `${input.opponentTeamLabel} goalkeeper`
      : '',
    trackedGoalkeeperId: input.trackedGoalkeeperId ?? '',
  }
}

/**
 * Outcomes the compact sheet saves as soon as the shooter is chosen. Only a
 * Goal asks for an assist; a Saved shot is credited to the defending keeper.
 */
export function soccerQuickShotSavesOnShooter(
  outcome: SoccerShotOutcome,
  situation: SoccerShotSituation
): boolean {
  return !(outcome === 'goal' && soccerShotCreatorsAllowed(situation))
}

/**
 * Newest active tracked shot's participant shooter, so the compact sheet can
 * mark them. Derived from events so Undo and corrections move it back.
 */
export function soccerLastTrackedShooterId(activeEvents: readonly GameEvent[]): string | null {
  for (let index = activeEvents.length - 1; index >= 0; index -= 1) {
    const event = activeEvents[index]
    if (event.eventType !== 'soccer.shot' || event.teamSide !== 'tracked') continue
    const shooter = event.actors.find(actor => actor.role === 'shooter')
    if (shooter?.participantId) return shooter.participantId
  }
  return null
}
