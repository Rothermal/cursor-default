import { describe, expect, it } from 'vitest'
import { createInitialState } from '../gameReducer'
import { sports } from '../../config/sports'
import { prepareBasketballGameStart } from './commands'
import { canReviewCurrentBasketballSetup } from './setupRecovery'
import type { GameState } from '../../types'

function fixture(): GameState {
  return { ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!,
    gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Home', opponentName: 'Away', tournamentName: '', tournamentId: null, date: '2026-09-22' },
    players: [{ id: 'p1', name: 'Alex', number: '1', stats: {} }] }
}
describe('current Basketball setup recovery route', () => {
  it('allows explicit recovery of the current pre-start event game', () => {
    expect(canReviewCurrentBasketballSetup(fixture(), new URLSearchParams('reviewCurrent=1'))).toBe(true)
  })
  it.each(['', 'reviewCurrent=0', 'reviewCurrent=1&teamId=another-team', 'reviewCurrent=1&sport=basketball'])('rejects non-recovery or new-game routes: %s', query => {
    expect(canReviewCurrentBasketballSetup(fixture(), new URLSearchParams(query))).toBe(false)
  })
  it('does not suppress normal setup restoration for legacy or other sports', () => {
    const state = fixture()
    state.gameDataAuthority = undefined
    expect(canReviewCurrentBasketballSetup(state, new URLSearchParams('reviewCurrent=1'))).toBe(false)
    state.gameDataAuthority = 'sport_events'
    state.sport = sports.find(sport => sport.id === 'soccer')!
    expect(canReviewCurrentBasketballSetup(state, new URLSearchParams('reviewCurrent=1'))).toBe(false)
  })
  it('refuses recovery after the match has started', () => {
    const started = prepareBasketballGameStart(fixture(), { recorderUserId: null })
    if (!started.ok) throw Error(started.message)
    expect(canReviewCurrentBasketballSetup(started.state, new URLSearchParams('reviewCurrent=1'))).toBe(false)
  })
})
