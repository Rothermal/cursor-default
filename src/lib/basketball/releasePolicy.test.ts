import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import { createInitialState } from '../gameReducer'
import { getBasketballEventCreationPolicy } from '../sportAvailability'
import { setBasketballEventCreationIntent } from './commands'
import { canCommitBasketballSetup } from './releasePolicy'

const basketball = sports.find(sport => sport.id === 'basketball')!
const internalProduction = getBasketballEventCreationPolicy(true, {
  development: false,
  releaseStage: 'internal',
})

function committedEventSetupState() {
  const result = setBasketballEventCreationIntent({
    ...createInitialState(),
    sport: basketball,
  }, true)
  if (!result.ok) throw new Error(result.message)
  return {
    ...result.state,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-25',
    },
  }
}

describe('Basketball Event setup release policy', () => {
  it('allows Legacy and opted-in new Event commits', () => {
    const state = createInitialState()
    expect(canCommitBasketballSetup({
      authority: 'legacy',
      policy: internalProduction,
      draftCommittedLocalGameId: null,
      activeLocalGameId: null,
      activeState: state,
    })).toBe(true)

    expect(canCommitBasketballSetup({
      authority: 'sport_events',
      policy: getBasketballEventCreationPolicy(true, {
        development: true,
        releaseStage: 'internal',
      }),
      draftCommittedLocalGameId: null,
      activeLocalGameId: null,
      activeState: state,
    })).toBe(true)
  })

  it('blocks uncommitted and mismatched Event drafts when creation is unavailable', () => {
    const state = committedEventSetupState()
    expect(canCommitBasketballSetup({
      authority: 'sport_events',
      policy: internalProduction,
      draftCommittedLocalGameId: null,
      activeLocalGameId: 'local-1',
      activeState: state,
    })).toBe(false)
    expect(canCommitBasketballSetup({
      authority: 'sport_events',
      policy: internalProduction,
      draftCommittedLocalGameId: 'local-2',
      activeLocalGameId: 'local-1',
      activeState: state,
    })).toBe(false)
  })

  it('allows only the exact committed pre-start Event record to continue', () => {
    const committed = committedEventSetupState()
    expect(canCommitBasketballSetup({
      authority: 'sport_events',
      policy: internalProduction,
      draftCommittedLocalGameId: 'local-1',
      activeLocalGameId: 'local-1',
      activeState: committed,
    })).toBe(true)

    expect(canCommitBasketballSetup({
      authority: 'sport_events',
      policy: internalProduction,
      draftCommittedLocalGameId: 'local-1',
      activeLocalGameId: 'local-1',
      activeState: { ...committed, eventStream: { version: 1, events: [] } },
    })).toBe(false)
  })
})
