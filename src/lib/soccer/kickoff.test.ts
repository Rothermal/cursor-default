import { describe, expect, it } from 'vitest'
import type { GameState, SportConfig } from '../../types'
import { createInitialState } from '../gameReducer'
import { nextSoccerEventSequence } from './events'
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

  it('rejects incomplete match info and already-started streams without mutating state', () => {
    const setup = matchSetup()
    const incomplete = { ...gameState(setup), gameInfo: null }
    expect(prepareSoccerKickoff(incomplete, setup, { recorderUserId: 'user-1' })).toEqual({
      ok: false,
      message: 'Soccer match information is incomplete.',
    })
    expect(incomplete.eventStream).toBeNull()

    const started = {
      ...gameState(setup),
      eventStream: { version: 1 as const, events: [{ id: 'existing' }] },
    }
    expect(prepareSoccerKickoff(started, setup, { recorderUserId: 'user-1' })).toEqual({
      ok: false,
      message: 'This soccer match has already started.',
    })
    expect(started.eventStream?.events).toHaveLength(1)
  })

  it('rejects empty and oversized opening lineups before initializing the stream', () => {
    const noStarters = matchSetup()
    noStarters.participants = noStarters.participants.map(participant => ({
      ...participant,
      initialStatus: 'bench' as const,
    }))
    const beforeEmpty = gameState(noStarters)
    expect(prepareSoccerKickoff(beforeEmpty, noStarters, { recorderUserId: null })).toEqual({
      ok: false,
      message: 'Select at least one starter.',
    })
    expect(beforeEmpty.eventStream).toBeNull()

    const oversized = matchSetup()
    oversized.rulesSnapshot = resolveSoccerMatchRules({ gameOverrides: { maxOnFieldPlayers: 1 } })
    const beforeOver = gameState(oversized)
    expect(prepareSoccerKickoff(beforeOver, oversized, { recorderUserId: null })).toEqual({
      ok: false,
      message: 'The opening lineup exceeds the configured player maximum.',
    })
    expect(beforeOver.eventStream).toBeNull()
  })
})

describe('nextSoccerEventSequence', () => {
  it('advances only within the same recorder and ignores invalid sequences', () => {
    expect(nextSoccerEventSequence([], 'user-1')).toBe(0)
    expect(nextSoccerEventSequence([
      { recorderUserId: 'user-1', sequence: 0 },
      { recorderUserId: 'user-2', sequence: 9 },
      { recorderUserId: 'user-1', sequence: 2.5 },
      { recorderUserId: 'user-1', sequence: 3 },
      { notAnEvent: true },
    ], 'user-1')).toBe(4)
    expect(nextSoccerEventSequence([
      { recorderUserId: null, sequence: 1 },
      { recorderUserId: null, sequence: 4 },
    ], null)).toBe(5)
  })
})
