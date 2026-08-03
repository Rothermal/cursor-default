import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { addGameEvent } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  addBasketballLateParticipant,
  basketballActorForSelection,
  captureBasketballCourtEvent,
  endBasketballPeriod,
  getBasketballCommandContext,
  prepareBasketballGameStart,
} from './commands'
import {
  decrementBasketballDirectStat,
  previewBasketballDirectDecrement,
  restoreLastBasketballCourtUndo,
} from './courtCorrections'
import {
  adjustBasketballScore,
  captureBasketballDirectStat,
  captureBasketballStealTurnover,
  decrementBasketballMinutes,
  type BasketballDirectStatId,
} from './directCommands'
import { createBasketballStatEvent } from './statEvents'
import { normalizeBasketballSportGameState } from './state'

const basketball = sports.find(sport => sport.id === 'basketball')!

function player(id: string, name = id, number = ''): Player {
  return { id, name, number, stats: {} }
}

function setupState(): GameState {
  return {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-03',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
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
    occurredAt: '2026-08-03T12:00:00.000Z',
    eventId: '72000000-0000-4000-8000-000000000001',
    participantIds: [
      '72000000-0000-4000-8000-000000000101',
      '72000000-0000-4000-8000-000000000102',
    ],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function withOpponent(state = startedState()): GameState {
  const result = addBasketballLateParticipant(state, {
    recorderUserId: 'recorder-1',
    teamSide: 'opponent',
    displayName: 'Opponent Nine',
    number: '9',
    occurredAt: '2026-08-03T12:01:00.000Z',
    eventId: '72000000-0000-4000-8000-000000000201',
    participantId: '72000000-0000-4000-8000-000000000202',
    playerId: 'opponent-9',
    captureCommandId: '72000000-0000-4000-8000-000000000203',
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function capture(
  state: GameState,
  statId: BasketballDirectStatId,
  playerId = 'player-1',
  index = 1
): GameState {
  const result = captureBasketballDirectStat(state, {
    recorderUserId: 'recorder-1',
    playerId,
    statId,
    occurredAt: `2026-08-03T12:${String(index + 1).padStart(2, '0')}:00.000Z`,
    eventId: `72000000-0000-4000-8000-${String(300 + index).padStart(12, '0')}`,
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('BKE-2B Basketball direct commands', () => {
  it('projects every ordinary direct grid action without creating court markers', () => {
    let state = startedState()
    const stats: BasketballDirectStatId[] = [
      'ft', 'ft_miss', '2pt', '2pt_miss', '3pt', '3pt_miss',
      'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'min',
    ]
    stats.forEach((statId, index) => {
      state = capture(state, statId, 'player-1', index + 1)
    })
    state = capture(state, 'team_turnover', TEAM_PLAYER_HOME_ID, 20)

    expect(state.players.find(candidate => candidate.id === 'player-1')?.stats).toMatchObject({
      ft: 1,
      ft_miss: 1,
      '2pt': 1,
      '2pt_miss': 1,
      '3pt': 1,
      '3pt_miss': 1,
      oreb: 1,
      dreb: 1,
      ast: 1,
      stl: 1,
      blk: 1,
      to: 1,
      min: 1,
    })
    expect(state.players.find(candidate => candidate.id === TEAM_PLAYER_HOME_ID)?.stats)
      .toMatchObject({ team_turnover: 1 })
    expect(state.homeTeamScore).toBe(6)
    expect(state.shotChart).toEqual([])
    expect(state.eventStream?.events.slice(-14).map(event =>
      typeof event === 'object' && event && 'eventType' in event ? event.eventType : null
    )).toEqual([
      'basketball.shot',
      'basketball.shot',
      'basketball.shot',
      'basketball.shot',
      'basketball.shot',
      'basketball.shot',
      'basketball.rebound',
      'basketball.rebound',
      'basketball.assist',
      'basketball.steal',
      'basketball.block',
      'basketball.turnover',
      'basketball.minutes_adjustment',
      'basketball.turnover',
    ])
  })

  it('records quick and reasoned score adjustments and rejects invalid totals unchanged', () => {
    const before = withOpponent()
    const plus = adjustBasketballScore(before, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      delta: 1,
      reason: 'scoreboard_control',
      eventId: '72000000-0000-4000-8000-000000000401',
    })
    expect(plus.ok).toBe(true)
    if (!plus.ok) return
    const minus = adjustBasketballScore(plus.state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      delta: -1,
      reason: 'scoreboard_control',
      eventId: '72000000-0000-4000-8000-000000000402',
    })
    expect(minus.ok).toBe(true)
    if (!minus.ok) return
    const official = adjustBasketballScore(minus.state, {
      recorderUserId: 'recorder-1',
      teamSide: 'opponent',
      delta: 2,
      reason: 'official_correction',
      note: 'Corrected scorer table total',
      eventId: '72000000-0000-4000-8000-000000000403',
    })
    expect(official.ok).toBe(true)
    if (!official.ok) return
    expect(official.state.homeTeamScore).toBe(0)
    expect(official.state.opponentScore).toBe(2)

    expect(adjustBasketballScore(official.state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      delta: -1,
      reason: 'scoreboard_control',
    })).toMatchObject({ ok: false, state: official.state })
    expect(adjustBasketballScore(official.state, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      delta: 1,
      reason: 'official_correction',
      note: '   ',
    })).toMatchObject({ ok: false, state: official.state })
  })

  it('captures Steal + Turnover atomically for rostered, unknown, and team actors', () => {
    let state = withOpponent()
    const rostered = captureBasketballStealTurnover(state, {
      recorderUserId: 'recorder-1',
      stealerPlayerId: 'player-1',
      turnoverTarget: { kind: 'player', playerId: 'opponent-9' },
      occurredAt: '2026-08-03T12:10:00.000Z',
      eventIds: [
        '72000000-0000-4000-8000-000000000501',
        '72000000-0000-4000-8000-000000000502',
      ],
      captureCommandId: '72000000-0000-4000-8000-000000000503',
    })
    expect(rostered.ok).toBe(true)
    if (!rostered.ok) return
    state = rostered.state
    expect(state.players.find(candidate => candidate.id === 'player-1')?.stats.stl).toBe(1)
    expect(state.players.find(candidate => candidate.id === 'opponent-9')?.stats.to).toBe(1)
    expect(state.eventStream?.events.slice(-2)).toMatchObject([
      {
        eventType: 'basketball.turnover',
        payload: { kind: 'player', captureCommandId: '72000000-0000-4000-8000-000000000503' },
      },
      {
        eventType: 'basketball.steal',
        payload: {
          relatedEventId: '72000000-0000-4000-8000-000000000501',
          captureCommandId: '72000000-0000-4000-8000-000000000503',
        },
      },
    ])

    const unknown = captureBasketballStealTurnover(state, {
      recorderUserId: 'recorder-1',
      stealerPlayerId: 'player-2',
      turnoverTarget: { kind: 'unknown', label: 'Unknown Bear' },
      eventIds: [
        '72000000-0000-4000-8000-000000000504',
        '72000000-0000-4000-8000-000000000505',
      ],
    })
    expect(unknown.ok).toBe(true)
    if (!unknown.ok) return
    const team = captureBasketballStealTurnover(unknown.state, {
      recorderUserId: 'recorder-1',
      stealerPlayerId: 'player-1',
      turnoverTarget: { kind: 'team' },
      eventIds: [
        '72000000-0000-4000-8000-000000000506',
        '72000000-0000-4000-8000-000000000507',
      ],
    })
    expect(team.ok).toBe(true)
    if (!team.ok) return
    expect(team.state.players.find(candidate => candidate.id === TEAM_PLAYER_OPP_ID)?.stats)
      .toMatchObject({ team_turnover: 1 })
    expect(team.state.players.find(candidate => candidate.id === 'player-1')?.stats.stl).toBe(2)
  })

  it('rejects wrong-side compound actors, team shots/minutes, breaks, and cloud bindings', () => {
    const before = withOpponent()
    expect(captureBasketballStealTurnover(before, {
      recorderUserId: 'recorder-1',
      stealerPlayerId: 'player-1',
      turnoverTarget: { kind: 'player', playerId: 'player-2' },
    })).toMatchObject({ ok: false, state: before, code: 'invalid_actor' })
    expect(captureBasketballDirectStat(before, {
      recorderUserId: 'recorder-1',
      playerId: TEAM_PLAYER_HOME_ID,
      statId: '2pt',
    })).toMatchObject({ ok: false, state: before, code: 'invalid_actor' })
    expect(captureBasketballDirectStat(before, {
      recorderUserId: 'recorder-1',
      playerId: TEAM_PLAYER_HOME_ID,
      statId: 'min',
    })).toMatchObject({ ok: false, state: before, code: 'invalid_actor' })

    const ended = endBasketballPeriod(before, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-03T12:20:00.000Z',
      eventId: '72000000-0000-4000-8000-000000000601',
    })
    if (!ended.ok) throw new Error(ended.message)
    expect(captureBasketballDirectStat(ended.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      statId: 'ast',
    })).toMatchObject({ ok: false, state: ended.state, code: 'invalid_period' })

    const cloud = {
      ...before,
      cloudSync: { ...before.cloudSync, gameId: 'game-1' },
    }
    expect(adjustBasketballScore(cloud, {
      recorderUserId: 'recorder-1',
      teamSide: 'tracked',
      delta: 1,
      reason: 'scoreboard_control',
    })).toMatchObject({ ok: false, state: cloud, code: 'cloud_flow_unsupported' })
  })
})

describe('BKE-2B Basketball direct decrements', () => {
  it('removes and restores the newest standalone event while minutes use signed history', () => {
    let state = capture(startedState(), 'ast', 'player-1', 1)
    state = capture(state, 'ast', 'player-1', 2)
    const preview = previewBasketballDirectDecrement(state, 'player-1', 'ast')
    expect(preview).toMatchObject({
      ok: true,
      value: { removedEventCount: 1, requiresConfirmation: false },
    })
    const decremented = decrementBasketballDirectStat(
      state,
      'player-1',
      'ast',
      '2026-08-03T12:10:00.000Z'
    )
    expect(decremented.ok).toBe(true)
    if (!decremented.ok) return
    expect(decremented.state.players.find(candidate => candidate.id === 'player-1')?.stats.ast)
      .toBe(1)
    const restored = restoreLastBasketballCourtUndo(
      decremented.state,
      '2026-08-03T12:11:00.000Z'
    )
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.state.players.find(candidate => candidate.id === 'player-1')?.stats.ast)
      .toBe(2)

    const minute = capture(restored.state, 'min', 'player-1', 12)
    const minuteDown = decrementBasketballMinutes(minute, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      occurredAt: '2026-08-03T12:13:00.000Z',
      eventId: '72000000-0000-4000-8000-000000000701',
    })
    expect(minuteDown.ok).toBe(true)
    if (!minuteDown.ok) return
    expect(minuteDown.state.players.find(candidate => candidate.id === 'player-1')?.stats.min)
      .toBe(0)
    expect(decrementBasketballMinutes(minuteDown.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
    })).toMatchObject({ ok: false, state: minuteDown.state })
  })

  it('removes a field goal with linked facts, unlinks a block, and restores the exact plan', () => {
    let state = withOpponent()
    const captured = captureBasketballCourtEvent(state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: {
        kind: 'shot',
        made: false,
        shotType: '2pt',
        rebound: { statId: 'oreb', playerId: 'player-2' },
      },
      occurredAt: '2026-08-03T12:20:00.000Z',
      eventIds: [
        '72000000-0000-4000-8000-000000000711',
        '72000000-0000-4000-8000-000000000712',
      ],
      captureCommandId: '72000000-0000-4000-8000-000000000713',
    })
    if (!captured.ok) throw new Error(captured.message)
    state = captured.state
    const context = getBasketballCommandContext(state, 'recorder-1', '2026-08-03T12:21:00.000Z')
    if (!context.ok) throw new Error(context.message)
    const opponent = state.sportGameState?.sportId === 'basketball'
      ? Object.values(state.sportGameState.projection.participants)
          .find(participant => participant.playerId === 'opponent-9')
      : null
    if (!opponent) throw new Error('Opponent fixture missing.')
    const blocker = basketballActorForSelection(
      state,
      'blocker',
      'opponent',
      { kind: 'participant', participantId: opponent.participantId }
    )
    if (!blocker.ok) throw new Error(blocker.message)
    const block = createBasketballStatEvent({
      id: '72000000-0000-4000-8000-000000000714',
      eventType: 'basketball.block',
      payload: {
        relatedEventId: '72000000-0000-4000-8000-000000000711',
        captureCommandId: null,
      },
      recorderUserId: 'recorder-1',
      sequence: context.value.nextSequence,
      period: context.value.period,
      occurredAt: context.value.occurredAt,
      teamSide: 'opponent',
      actors: [blocker.value],
    })
    const appended = addGameEvent(state, block, gameEventRegistry, gameEventProjectors)
    if (!appended.ok || !appended.inspection.complete) throw new Error('Block append failed.')
    state = appended.state

    expect(previewBasketballDirectDecrement(state, 'player-1', '2pt_miss')).toMatchObject({
      ok: true,
      value: {
        removedEventCount: 2,
        linkedReboundCount: 1,
        unlinkedBlockCount: 1,
        requiresConfirmation: true,
      },
    })
    const decremented = decrementBasketballDirectStat(
      state,
      'player-1',
      '2pt_miss',
      '2026-08-03T12:22:00.000Z'
    )
    expect(decremented.ok).toBe(true)
    if (!decremented.ok) return
    expect(decremented.state.players.find(candidate => candidate.id === 'player-1')?.stats['2pt_miss'])
      .toBe(0)
    expect(decremented.state.players.find(candidate => candidate.id === 'player-2')?.stats.oreb)
      .toBe(0)
    expect(decremented.state.players.find(candidate => candidate.id === 'opponent-9')?.stats.blk)
      .toBe(1)
    const activeBlock = decremented.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event &&
      event.id === '72000000-0000-4000-8000-000000000714'
    )
    expect(activeBlock).toMatchObject({ payload: { relatedEventId: null } })
    expect(normalizeBasketballSportGameState(decremented.state.sportGameState)
      ?.capturePreferences.lastCourtUndo?.kind).toBe('direct_decrement')

    const restored = restoreLastBasketballCourtUndo(
      decremented.state,
      '2026-08-03T12:23:00.000Z'
    )
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.state.players.find(candidate => candidate.id === 'player-1')?.stats['2pt_miss'])
      .toBe(1)
    expect(restored.state.players.find(candidate => candidate.id === 'player-2')?.stats.oreb)
      .toBe(1)
    expect(restored.state.eventStream?.events.find(event =>
      typeof event === 'object' && event && 'id' in event &&
      event.id === '72000000-0000-4000-8000-000000000714'
    )).toMatchObject({ payload: { relatedEventId: '72000000-0000-4000-8000-000000000711' } })
  })

  it('does not treat a compound Steal + Turnover member as a standalone decrement', () => {
    const state = withOpponent()
    const compound = captureBasketballStealTurnover(state, {
      recorderUserId: 'recorder-1',
      stealerPlayerId: 'player-1',
      turnoverTarget: { kind: 'team' },
      eventIds: [
        '72000000-0000-4000-8000-000000000721',
        '72000000-0000-4000-8000-000000000722',
      ],
      captureCommandId: '72000000-0000-4000-8000-000000000723',
    })
    if (!compound.ok) throw new Error(compound.message)
    expect(previewBasketballDirectDecrement(compound.state, 'player-1', 'stl'))
      .toMatchObject({ ok: false, code: 'nothing_to_undo' })
    expect(previewBasketballDirectDecrement(compound.state, TEAM_PLAYER_OPP_ID, 'team_turnover'))
      .toMatchObject({ ok: false, code: 'nothing_to_undo' })
  })
})
