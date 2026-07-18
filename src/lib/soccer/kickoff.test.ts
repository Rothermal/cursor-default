import { describe, expect, it } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { prepareSoccerKickoff } from './kickoff'
import { resolveSoccerMatchRules } from './rules'
import { createSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

const soccer: SportConfig = {
  id: 'soccer',
  name: 'Soccer',
  icon: 'S',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'Goals',
}

function matchSetup(): SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSnapshot: resolveSoccerMatchRules(),
    participants: [
      {
        id: 'participant-keeper',
        kind: 'player',
        playerId: 'keeper',
        displayName: 'Keeper',
        number: '1',
        initialStatus: 'starter',
        initialRole: { group: 'goalkeeper', label: null },
      },
      {
        id: 'participant-defender',
        kind: 'player',
        playerId: 'defender',
        displayName: 'Defender',
        number: '4',
        initialStatus: 'starter',
        initialRole: { group: 'defender', label: null },
      },
      {
        id: 'participant-bench',
        kind: 'anonymous',
        playerId: null,
        displayName: 'Late arrival',
        number: null,
        initialStatus: 'bench',
        initialRole: { group: 'forward', label: null },
      },
    ],
  }
}

function gameState(setup: SoccerMatchSetup): GameState {
  return {
    ...createInitialState(),
    sport: soccer,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: 'Friendly',
      tournamentId: null,
      date: '2026-07-18',
    },
    players: [
      { id: 'keeper', name: 'Keeper', number: '1', stats: {} },
      { id: 'defender', name: 'Defender', number: '4', stats: {} },
    ],
    sportGameState: createSoccerSportGameState(setup),
  }
}

describe('prepareSoccerKickoff', () => {
  it('atomically starts a short-handed match with lineup, period, and clock events', () => {
    const setup = matchSetup()
    const result = prepareSoccerKickoff(gameState(setup), setup, {
      recorderUserId: 'user-1',
      occurredAt: '2026-07-18T18:00:00.000Z',
      eventIds: [
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000003',
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.eventStream?.events).toHaveLength(3)
    expect(result.state.eventStream?.events).toMatchObject([
      { eventType: 'soccer.opening_lineup', sequence: 0 },
      { eventType: 'soccer.period_started', sequence: 1 },
      { eventType: 'soccer.clock_started', sequence: 2 },
    ])
    const projection = result.state.sportGameState?.projection
    expect(projection).toMatchObject({
      status: 'in_progress',
      openingLineupRecorded: true,
      currentPeriodId: 'regulation-1',
      clock: {
        running: true,
        elapsedMs: 0,
        anchorOccurredAt: '2026-07-18T18:00:00.000Z',
      },
    })
    expect(projection?.participants['participant-keeper'].status).toBe('on_field')
    expect(projection?.participants['participant-defender'].status).toBe('on_field')
    expect(projection?.participants['participant-bench'].status).toBe('bench')
  })

  it('rejects an opening lineup without exactly one goalkeeper without mutating state', () => {
    const setup = matchSetup()
    setup.participants[0]!.initialRole = { group: 'defender', label: null }
    const before = gameState(setup)
    const result = prepareSoccerKickoff(before, setup, { recorderUserId: null })

    expect(result).toEqual({
      ok: false,
      message: 'The opening lineup requires exactly one goalkeeper.',
    })
    expect(before.eventStream).toBeNull()
    expect(before.sportGameState?.projection.status).toBe('not_started')
  })
})
