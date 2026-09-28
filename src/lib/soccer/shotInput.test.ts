import { describe, expect, it } from 'vitest'
import {
  buildSoccerShotInput,
  soccerPenaltyMark,
  soccerQuickShotSavesOnShooter,
  soccerQuickShotSelection,
  type SoccerShotFormSelection,
} from './shotInput'

// The full dialog's state after a live open with the same choices and no edits.
function fullDialogSelection(overrides: Partial<SoccerShotFormSelection>): SoccerShotFormSelection {
  return {
    teamSide: 'tracked',
    outcome: 'goal',
    situation: 'open_play',
    sourceEventId: '',
    location: null,
    shotDetails: { bodyPart: null, goalPlacement: null },
    trackedLabel: 'Aces',
    opponentTeamLabel: 'Bears',
    trackedShooterId: '__team__',
    opponentShooterMode: 'unknown',
    opponentShooterLabel: 'Unknown opponent',
    primaryCreatorId: '',
    secondaryCreatorId: '',
    opponentCreatorLabel: '',
    opponentSecondaryLabel: '',
    showSecondary: false,
    trackedBlockerId: '__team__',
    opponentBlockerLabel: '',
    opponentGoalkeeperLabel: '',
    trackedGoalkeeperId: 'keeper',
    ...overrides,
  }
}

function quick(overrides: Partial<Parameters<typeof soccerQuickShotSelection>[0]>) {
  return soccerQuickShotSelection({
    teamSide: 'tracked',
    outcome: 'goal',
    situation: 'open_play',
    sourceEventId: null,
    location: null,
    trackedLabel: 'Aces',
    opponentTeamLabel: 'Bears',
    shooterId: '__team__',
    primaryCreatorId: null,
    trackedGoalkeeperId: 'keeper',
    ...overrides,
  })
}

describe('soccer shot input builder', () => {
  it('builds the same input from compact and full-dialog choices', () => {
    const location = { x: 0.8, y: 0.4, attackingDirection: 'left_to_right' as const }
    const cases: Array<[Parameters<typeof quick>[0], Partial<SoccerShotFormSelection>]> = [
      [
        { outcome: 'goal', shooterId: 'mia', primaryCreatorId: 'ava', location },
        { outcome: 'goal', trackedShooterId: 'mia', primaryCreatorId: 'ava', location },
      ],
      [
        { outcome: 'blocked', shooterId: '__team__' },
        { outcome: 'blocked' },
      ],
      [
        { outcome: 'saved', situation: 'corner_sequence', sourceEventId: 'corner-1', shooterId: 'mia' },
        { outcome: 'saved', situation: 'corner_sequence', sourceEventId: 'corner-1', trackedShooterId: 'mia' },
      ],
      [
        { teamSide: 'opponent', outcome: 'saved' },
        { teamSide: 'opponent', outcome: 'saved' },
      ],
      [
        { teamSide: 'opponent', outcome: 'blocked' },
        { teamSide: 'opponent', outcome: 'blocked' },
      ],
    ]
    for (const [compact, full] of cases) {
      expect(buildSoccerShotInput(quick(compact))).toEqual(buildSoccerShotInput(fullDialogSelection(full)))
    }
  })

  it('drops creators for penalties and the source for open play', () => {
    const penalty = buildSoccerShotInput(quick({
      situation: 'penalty',
      sourceEventId: 'foul-1',
      shooterId: 'mia',
      primaryCreatorId: 'ava',
    }))
    expect(penalty.primaryCreator).toBeNull()
    expect(penalty.sourceEventId).toBe('foul-1')
    expect(buildSoccerShotInput(quick({ sourceEventId: 'corner-1' })).sourceEventId).toBeNull()
  })

  it('attributes opponent shots to the tracked keeper only when the keeper is involved', () => {
    expect(buildSoccerShotInput(quick({ teamSide: 'opponent', outcome: 'goal' })).goalkeeper)
      .toEqual({ kind: 'participant', participantId: 'keeper' })
    expect(buildSoccerShotInput(quick({ teamSide: 'opponent', outcome: 'off_target' })).goalkeeper).toBeNull()
    expect(buildSoccerShotInput(quick({ teamSide: 'opponent', outcome: 'blocked' })).blocker)
      .toEqual({ kind: 'team', label: 'Aces' })
    expect(buildSoccerShotInput(quick({ teamSide: 'opponent', outcome: 'saved' })).shooter)
      .toEqual({ kind: 'unknown', label: 'Unknown opponent' })
  })

  it('asks for an assist only after a Goal or Saved outside penalty and direct free kick', () => {
    expect(soccerQuickShotSavesOnShooter('goal', 'open_play')).toBe(false)
    expect(soccerQuickShotSavesOnShooter('saved', 'corner_sequence')).toBe(false)
    expect(soccerQuickShotSavesOnShooter('blocked', 'open_play')).toBe(true)
    expect(soccerQuickShotSavesOnShooter('off_target', 'open_play')).toBe(true)
    expect(soccerQuickShotSavesOnShooter('woodwork', 'open_play')).toBe(true)
    expect(soccerQuickShotSavesOnShooter('goal', 'penalty')).toBe(true)
    expect(soccerQuickShotSavesOnShooter('saved', 'direct_free_kick')).toBe(true)
  })

  it('places the penalty mark toward the scoring goal', () => {
    expect(soccerPenaltyMark('left_to_right')).toEqual({ x: 0.87, y: 0.5, attackingDirection: 'left_to_right' })
    expect(soccerPenaltyMark('right_to_left').x).toBe(0.13)
  })
})
