import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { isAggregateCloudSyncEligible } from '../gameSyncFingerprint'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  basketballActorForSelection,
  createBasketballCaptureCommandId,
  getBasketballCommandContext,
  hasStartedBasketballEventGame,
  isBasketballEventSetupIntent,
  nextBasketballEventSequence,
  normalizeBasketballCourtLocation,
  prepareBasketballGameStart,
  setBasketballEventCreationIntent,
} from './commands'

const basketball = sports.find(sport => sport.id === 'basketball')!
const occurredAt = '2026-08-02T15:30:00.000Z'

function player(id: string, name = id, number = ''): Player {
  return { id, name, number, stats: {} }
}

function freshState(): GameState {
  return { ...createInitialState(), sport: basketball }
}

function setupState(): GameState {
  return {
    ...freshState(),
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-02',
    },
    players: [
      {
        ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'),
        isTeamPlayer: true,
      },
      {
        ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'),
        isTeamPlayer: true,
      },
      player('player-1', 'Alex One', '4'),
      player('player-2', 'Blake Two', '12'),
    ],
    teamStatsConfig: {
      periodsPerGame: 4,
      periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeLabel: 'OT',
      overtimeFoulsReset: true,
      timeoutsPerPeriod: null,
      timeoutsPerOvertime: null,
    },
  }
}

function startedState(): GameState {
  const result = prepareBasketballGameStart(setupState(), {
    recorderUserId: 'recorder-1',
    occurredAt,
    eventId: '70000000-0000-4000-8000-000000000001',
    participantIds: [
      '70000000-0000-4000-8000-000000000101',
      '70000000-0000-4000-8000-000000000102',
    ],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('BKE-1C1 Basketball commands', () => {
  it('stamps local event authority before game information exists', () => {
    const before = freshState()
    const result = setBasketballEventCreationIntent(before, true)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.gameDataAuthority).toBe('sport_events')
    expect(isBasketballEventSetupIntent(result.state)).toBe(true)
    expect(isAggregateCloudSyncEligible(result.state)).toBe(false)
    expect(before.gameDataAuthority).toBeNull()
  })

  it('allows only uninitialized local setup intent to be cleared', () => {
    const marked = setupState()
    const cleared = setBasketballEventCreationIntent(marked, false)
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.state.gameDataAuthority).toBeNull()

    const initialized = startedState()
    const rejected = setBasketballEventCreationIntent(initialized, false)
    expect(rejected).toMatchObject({
      ok: false,
      state: initialized,
      code: 'creation_intent_unavailable',
    })
  })

  it('recognizes only a complete initialized Basketball event game as started', () => {
    const started = startedState()
    expect(hasStartedBasketballEventGame(started)).toBe(true)
    expect(hasStartedBasketballEventGame({ ...started, sportGameState: null })).toBe(false)
    expect(hasStartedBasketballEventGame({ ...started, eventStream: null })).toBe(false)
  })

  it('does not convert an aggregate setup or cloud-bound game', () => {
    const aggregateSetup = {
      ...freshState(),
      gameInfo: setupState().gameInfo,
    }
    expect(setBasketballEventCreationIntent(aggregateSetup, true)).toMatchObject({
      ok: false,
      state: aggregateSetup,
      code: 'creation_intent_unavailable',
    })

    const cloudBound = {
      ...freshState(),
      cloudSync: { ...freshState().cloudSync, teamId: 'team-1' },
    }
    expect(setBasketballEventCreationIntent(cloudBound, true)).toMatchObject({
      ok: false,
      state: cloudBound,
      code: 'cloud_flow_unsupported',
    })
  })

  it('atomically creates setup, participants, stream, and Period 1', () => {
    const before = setupState()
    const result = prepareBasketballGameStart(before, {
      recorderUserId: 'recorder-1',
      occurredAt,
      eventId: '70000000-0000-4000-8000-000000000001',
      participantIds: [
        '70000000-0000-4000-8000-000000000101',
        '70000000-0000-4000-8000-000000000102',
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(before.eventStream).toBeNull()
    expect(before.sportGameState).toBeNull()
    expect(result.state).toMatchObject({
      gameDataAuthority: 'sport_events',
      currentPeriod: 1,
      actionLog: [],
      shotChart: [],
    })
    expect(result.state.eventStream?.events).toHaveLength(1)
    expect(result.state.eventStream?.events[0]).toMatchObject({
      id: '70000000-0000-4000-8000-000000000001',
      eventType: 'basketball.period_started',
      recorderUserId: 'recorder-1',
      sequence: 1,
      period: { id: 'regulation-1', order: 1 },
      occurredAt,
      payload: { periodId: 'regulation-1', captureCommandId: null },
    })

    if (result.state.sportGameState?.sportId !== 'basketball') {
      throw new Error('Expected Basketball sport state.')
    }
    expect(result.state.sportGameState.setup).toMatchObject({
      trackedTeamDesignation: 'home',
      sourceTeamId: null,
      sourceSeasonId: null,
      rulesSnapshot: { periodsPerGame: 4, periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'] },
    })
    expect(result.state.sportGameState.setup.participants).toEqual([
      expect.objectContaining({
        id: '70000000-0000-4000-8000-000000000101',
        playerId: 'player-1',
        displayName: 'Alex One',
        number: '4',
        teamSide: 'tracked',
        initialStatus: 'bench',
      }),
      expect.objectContaining({
        id: '70000000-0000-4000-8000-000000000102',
        playerId: 'player-2',
        displayName: 'Blake Two',
        number: '12',
        teamSide: 'tracked',
        initialStatus: 'bench',
      }),
    ])
    expect(result.state.sportGameState.projection).toMatchObject({
      status: 'in_progress',
      currentPeriodId: 'regulation-1',
      startedPeriodIds: ['regulation-1'],
    })
  })

  it('returns the original state when setup, cloud, or projection checks fail', () => {
    const noRoster = { ...setupState(), players: [] }
    expect(prepareBasketballGameStart(noRoster, { recorderUserId: null })).toMatchObject({
      ok: false,
      state: noRoster,
      code: 'setup_incomplete',
    })

    const cloud = {
      ...setupState(),
      cloudSync: { ...setupState().cloudSync, gameId: 'game-1' },
    }
    expect(prepareBasketballGameStart(cloud, { recorderUserId: null })).toMatchObject({
      ok: false,
      state: cloud,
      code: 'cloud_flow_unsupported',
    })

    const aggregateActivity = structuredClone(setupState())
    aggregateActivity.players[2].stats.ast = 1
    expect(prepareBasketballGameStart(aggregateActivity, { recorderUserId: null })).toMatchObject({
      ok: false,
      state: aggregateActivity,
      code: 'legacy_activity_present',
    })

    const invalidRules = {
      ...setupState(),
      teamStatsConfig: {
        ...(setupState().teamStatsConfig ?? {}),
        bonusThreshold: 10,
        doubleBonusThreshold: 5,
      },
    }
    expect(() => prepareBasketballGameStart(invalidRules, { recorderUserId: null }))
      .not.toThrow()
    expect(prepareBasketballGameStart(invalidRules, { recorderUserId: null })).toMatchObject({
      ok: false,
      state: invalidRules,
      code: 'invalid_setup',
    })
  })

  it('centralizes current period, recorder sequence, actors, ids, and court normalization', () => {
    const started = startedState()
    const context = getBasketballCommandContext(started, 'recorder-1', occurredAt)
    expect(context).toMatchObject({
      ok: true,
      value: {
        period: { id: 'regulation-1', order: 1 },
        nextSequence: 2,
        occurredAt,
      },
    })
    expect(nextBasketballEventSequence([
      { recorderUserId: 'other', sequence: 20 },
      { recorderUserId: 'recorder-1', sequence: 4 },
      { recorderUserId: 'recorder-1', sequence: 'bad' },
    ], 'recorder-1')).toBe(5)

    const participantId = started.sportGameState?.sportId === 'basketball'
      ? started.sportGameState.setup.participants[0].id
      : ''
    expect(basketballActorForSelection(
      started,
      'shooter',
      'tracked',
      { kind: 'participant', participantId }
    )).toMatchObject({
      ok: true,
      value: { kind: 'player', playerId: 'player-1', participantId },
    })
    expect(basketballActorForSelection(
      started,
      'rebounder',
      'opponent',
      { kind: 'team' }
    )).toMatchObject({ ok: true, value: { kind: 'team', label: 'Bears' } })
    expect(basketballActorForSelection(
      started,
      'shooter',
      'opponent',
      { kind: 'participant', participantId }
    )).toMatchObject({ ok: false, code: 'invalid_actor' })

    expect(normalizeBasketballCourtLocation({ x: 0, y: 0 })).toMatchObject({
      ok: true,
      value: { x: 0.5, attackingDirection: 'unknown' },
    })
    expect(normalizeBasketballCourtLocation({ x: Number.NaN, y: 0 })).toMatchObject({
      ok: false,
      code: 'invalid_location',
    })
    expect(createBasketballCaptureCommandId()).not.toBe('')
  })
})
