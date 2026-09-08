import { describe, expect, it } from 'vitest'
import { createInitialState } from '../gameReducer'
import { createSoccerSportGameState } from './state'
import { resolveSoccerMatchRules } from './rules'
import { prepareSoccerKickoff } from './kickoff'
import { soccerLineupPreset } from './lineupManager'
import type { SoccerMatchSetup } from './types'

function fixture() {
  const setup: SoccerMatchSetup = {
    version: 2, trackedTeamDesignation: 'home', firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1', sourceSeasonId: null,
    rulesSnapshot: resolveSoccerMatchRules({ gameOverrides: { maxOnFieldPlayers: 2 } }),
    participants: ['keeper', 'defender', 'forward'].map((id, index) => ({
      id, kind: 'anonymous', playerId: null, displayName: id, number: String(index + 1),
      initialStatus: index < 2 ? 'starter' : 'bench', initialRole: { group: index === 0 ? 'goalkeeper' : 'forward', label: null },
    })),
    teamDefaultLineup: { version: 1, source: 'lineup_defaults', entries: [
      { participantId: 'keeper', role: { group: 'goalkeeper', label: null } },
      { participantId: 'forward', role: { group: 'midfielder', label: null } },
    ] },
  }
  const state = { ...createInitialState(), sport: { id: 'soccer', name: 'Soccer', icon: 'S', categories: [], scoreLabel: 'Goals', theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' } }, sportGameState: createSoccerSportGameState(setup) }
  const result = prepareSoccerKickoff({ ...state, gameInfo: { teamName: 'Aces', opponentName: 'Visitors', date: '2026-09-08', tournamentName: '', tournamentId: null } }, setup, { recorderUserId: null, occurredAt: '2026-09-08T12:00:00Z' })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('lineup manager presets', () => {
  it('keeps opening and frozen team defaults distinct and clone-safe', () => {
    const state = fixture()
    expect(soccerLineupPreset(state, 'opening_lineup')?.onField.map(e => e.participantId)).toEqual(['keeper', 'defender'])
    const preset = soccerLineupPreset(state, 'team_default')!
    expect(preset.onField.map(e => e.participantId)).toEqual(['keeper', 'forward'])
    expect(preset.onField[1].role.group).toBe('midfielder')
    preset.onField[1].role.group = 'defender'
    expect(soccerLineupPreset(state, 'team_default')?.onField[1].role.group).toBe('midfielder')
  })
  it('leaves explicit vacancies for ejected and no-return players without retaining a displaced player', () => {
    const state = fixture()
    state.sportGameState.projection.participants.forward.hasExited = true
    expect(soccerLineupPreset(state, 'team_default')).toMatchObject({
      onField: [{ participantId: 'keeper' }], unavailable: [{ participantId: 'forward', reason: 'Return substitutions disabled' }],
    })
    state.sportGameState.projection.participantDiscipline.forward = { ejected: true, normalYellowCards: 0, shootoutYellowCards: 0, redCards: 1, shootoutRedCards: 0 }
    expect(soccerLineupPreset(state, 'team_default')?.unavailable[0].reason).toBe('Ejected')
  })
  it('omits absent team defaults for old matches', () => {
    const state = fixture()
    if (state.sportGameState.setup.version === 2) state.sportGameState.setup.teamDefaultLineup = null
    expect(soccerLineupPreset(state, 'team_default')).toBeNull()
    expect(soccerLineupPreset(state, 'opening_lineup')?.onField).toHaveLength(2)
  })
})
