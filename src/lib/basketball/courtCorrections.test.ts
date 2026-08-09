import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { addGameEvent } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createInitialState, gameReducer } from '../gameReducer'
import { sportGameStateForFingerprint } from '../sportGameState/state'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  abandonBasketballMatch,
  addBasketballLateParticipant,
  basketballActorForSelection,
  captureBasketballCourtEvent,
  endBasketballPeriod,
  getBasketballCommandContext,
  prepareBasketballGameStart,
  suspendBasketballMatch,
} from './commands'
import {
  basketballCourtCaptureUnits,
  basketballLiveCaptureUnits,
  canRestoreBasketballCourtUndo,
  clearBasketballShotChart,
  previewBasketballClearShotChart,
  restoreLastBasketballCourtUndo,
  undoLatestBasketballCourtCapture,
} from './courtCorrections'
import { createBasketballStatEvent } from './statEvents'

const basketball = sports.find(sport => sport.id === 'basketball')!
const baseTime = '2026-08-02T18:00:00.000Z'
const participantOne = '71000000-0000-4000-8000-000000000101'
const participantTwo = '71000000-0000-4000-8000-000000000102'

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function startedState(): GameState {
  const initial: GameState = {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-02',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces'), isTeamPlayer: true, teamSide: 'home' },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears'), isTeamPlayer: true, teamSide: 'opponent' },
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
  const result = prepareBasketballGameStart(initial, {
    recorderUserId: 'recorder-1',
    occurredAt: baseTime,
    eventId: '71000000-0000-4000-8000-000000000001',
    participantIds: [participantOne, participantTwo],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function capture(
  state: GameState,
  options: Parameters<typeof captureBasketballCourtEvent>[1]
): GameState {
  const result = captureBasketballCourtEvent(state, options)
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('BKE-1C3 Basketball court corrections', () => {
  it('groups linked facts, enforces newest-first court undo, and restores a standalone capture', () => {
    let state = capture(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt', assistPlayerId: 'player-2' },
      occurredAt: '2026-08-02T18:01:00.000Z',
      eventIds: [
        '71000000-0000-4000-8000-000000000201',
        '71000000-0000-4000-8000-000000000202',
      ],
      captureCommandId: '71000000-0000-4000-8000-000000000299',
    })
    state = capture(state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      point: { x: 0, y: 8 },
      event: { kind: 'stat', statId: 'stl' },
      occurredAt: '2026-08-02T18:02:00.000Z',
      eventIds: ['71000000-0000-4000-8000-000000000203'],
    })

    expect(basketballCourtCaptureUnits(state).map(unit => ({
      what: unit.what,
      count: unit.eventIds.length,
    }))).toEqual([
      { what: 'Steal', count: 1 },
      { what: 'Made 2PT + Assist', count: 2 },
    ])
    expect(undoLatestBasketballCourtCapture(state, '2026-08-02T18:03:00.000Z', true))
      .toMatchObject({ ok: false, state, code: 'nothing_to_undo' })

    const undone = undoLatestBasketballCourtCapture(state, '2026-08-02T18:03:00.000Z')
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.state.players.find(value => value.id === 'player-2')?.stats.stl).toBe(0)
    expect(canRestoreBasketballCourtUndo(undone.state)).toBe(true)

    const hydrated = gameReducer(createInitialState(), {
      type: 'HYDRATE_STATE',
      state: structuredClone(undone.state),
    })
    expect(canRestoreBasketballCourtUndo(hydrated)).toBe(true)
    const restored = restoreLastBasketballCourtUndo(hydrated, '2026-08-02T18:04:00.000Z')
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.state.players.find(value => value.id === 'player-2')?.stats.stl).toBe(1)
    expect(restored.state.sportGameState?.sportId === 'basketball'
      ? restored.state.sportGameState.capturePreferences.lastCourtUndo
      : undefined).toBeNull()
  })

  it('undoes and restores a linked shot capture as one atomic unit', () => {
    const captured = capture(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt', assistPlayerId: 'player-2' },
      occurredAt: '2026-08-02T18:01:00.000Z',
      eventIds: [
        '71000000-0000-4000-8000-000000000211',
        '71000000-0000-4000-8000-000000000212',
      ],
      captureCommandId: '71000000-0000-4000-8000-000000000298',
    })
    const undone = undoLatestBasketballCourtCapture(
      captured,
      '2026-08-02T18:02:00.000Z',
      true
    )
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.state.homeTeamScore).toBe(0)
    expect(undone.state.shotChart).toEqual([])
    expect(undone.state.players.find(value => value.id === 'player-2')?.stats.ast).toBe(0)
    expect(undone.state.eventStream?.events.slice(-2)).toEqual([
      expect.objectContaining({ revision: 2, deletedAt: '2026-08-02T18:02:00.000Z' }),
      expect.objectContaining({ revision: 2, deletedAt: '2026-08-02T18:02:00.000Z' }),
    ])

    const restored = restoreLastBasketballCourtUndo(undone.state, '2026-08-02T18:03:00.000Z')
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.state.homeTeamScore).toBe(2)
    expect(restored.state.shotChart).toHaveLength(1)
    expect(restored.state.players.find(value => value.id === 'player-2')?.stats.ast).toBe(1)
  })

  it('clears located shots and dependents while preserving excluded events and block totals', () => {
    let state = capture(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt', assistPlayerId: 'player-2' },
      occurredAt: '2026-08-02T18:01:00.000Z',
      eventIds: [
        '71000000-0000-4000-8000-000000000221',
        '71000000-0000-4000-8000-000000000222',
      ],
      captureCommandId: '71000000-0000-4000-8000-000000000291',
    })
    state = capture(state, {
      recorderUserId: 'recorder-1',
      playerId: TEAM_PLAYER_OPP_ID,
      point: { x: 23, y: 5 },
      event: {
        kind: 'shot',
        made: false,
        shotType: '3pt',
        rebound: { statId: 'dreb', playerId: TEAM_PLAYER_HOME_ID },
      },
      occurredAt: '2026-08-02T18:02:00.000Z',
      eventIds: [
        '71000000-0000-4000-8000-000000000223',
        '71000000-0000-4000-8000-000000000224',
      ],
      captureCommandId: '71000000-0000-4000-8000-000000000292',
    })
    state = appendExcludedAndBlockEvents(state)

    expect(previewBasketballClearShotChart(state)).toEqual({
      shotCount: 2,
      linkedAssistCount: 1,
      linkedReboundCount: 1,
      unlinkedBlockCount: 1,
    })
    const excludedIds = new Set([
      '71000000-0000-4000-8000-000000000225',
      '71000000-0000-4000-8000-000000000226',
      '71000000-0000-4000-8000-000000000227',
    ])
    const excludedBefore = state.eventStream?.events.filter(
      value => typeof value === 'object' && value !== null &&
        'id' in value && excludedIds.has(String(value.id))
    )
    const fingerprintBefore = sportGameStateForFingerprint(state.sportGameState)

    const cleared = clearBasketballShotChart(state, '2026-08-02T18:06:00.000Z')
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.state.shotChart).toEqual([])
    expect(cleared.state.homeTeamScore).toBe(3)
    expect(cleared.state.players.find(value => value.id === 'player-1')?.stats).toMatchObject({
      '2pt': 1,
      ft: 1,
      blk: 1,
    })
    const block = cleared.state.eventStream?.events.find(
      value => typeof value === 'object' && value !== null &&
        'id' in value && value.id === '71000000-0000-4000-8000-000000000228'
    )
    expect(block).toMatchObject({
      revision: 2,
      deletedAt: null,
      payload: expect.objectContaining({ relatedEventId: null }),
    })
    const excludedAfter = cleared.state.eventStream?.events.filter(
      value => typeof value === 'object' && value !== null &&
        'id' in value && excludedIds.has(String(value.id))
    )
    expect(excludedAfter).toEqual(excludedBefore)
    expect(sportGameStateForFingerprint(cleared.state.sportGameState)).toEqual(fingerprintBefore)
    expect(canRestoreBasketballCourtUndo(cleared.state)).toBe(true)

    const restored = restoreLastBasketballCourtUndo(
      cleared.state,
      '2026-08-02T18:07:00.000Z'
    )
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.state.shotChart).toHaveLength(2)
    expect(restored.state.homeTeamScore).toBe(5)
    expect(restored.state.eventStream?.events.find(
      value => typeof value === 'object' && value !== null &&
        'id' in value && value.id === '71000000-0000-4000-8000-000000000228'
    )).toMatchObject({
      revision: 3,
      payload: expect.objectContaining({
        relatedEventId: '71000000-0000-4000-8000-000000000223',
      }),
    })
  })

  it('invalidates the one-level receipt after a new successful capture', () => {
    const captured = capture(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-02T18:01:00.000Z',
      eventIds: ['71000000-0000-4000-8000-000000000231'],
    })
    const undone = undoLatestBasketballCourtCapture(captured, '2026-08-02T18:02:00.000Z')
    if (!undone.ok) throw new Error(undone.message)
    expect(canRestoreBasketballCourtUndo(undone.state)).toBe(true)

    const next = capture(undone.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      point: { x: 0, y: 8 },
      event: { kind: 'stat', statId: 'ast' },
      occurredAt: '2026-08-02T18:03:00.000Z',
      eventIds: ['71000000-0000-4000-8000-000000000232'],
    })
    expect(canRestoreBasketballCourtUndo(next)).toBe(false)
  })

  it('drops a malformed optional undo receipt without quarantining the game', () => {
    const captured = capture(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-02T18:01:00.000Z',
      eventIds: ['71000000-0000-4000-8000-000000000241'],
    })
    const undone = undoLatestBasketballCourtCapture(captured, '2026-08-02T18:02:00.000Z')
    if (!undone.ok || undone.state.sportGameState?.sportId !== 'basketball') {
      throw new Error('Fixture undo failed.')
    }
    const corrupted = structuredClone(undone.state)
    if (corrupted.sportGameState?.sportId !== 'basketball') return
    const receipt = corrupted.sportGameState.capturePreferences.lastCourtUndo
    if (!receipt) return
    receipt.entries[0].expectedRevision = 1

    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: corrupted })
    expect(hydrated.sportGameState?.sportId).toBe('basketball')
    expect(hydrated.sportGameState?.sportId === 'basketball'
      ? hydrated.sportGameState.capturePreferences.lastCourtUndo
      : undefined).toBeNull()
  })
})

describe('BKE-2A Basketball live correction boundaries', () => {
  it('renders lifecycle rows and prevents ordinary undo from crossing a period boundary', () => {
    const captured = capture(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-02T18:01:00.000Z',
      eventIds: ['71000000-0000-4000-8000-000000000401'],
    })
    const ended = endBasketballPeriod(captured, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-02T18:02:00.000Z',
      eventId: '71000000-0000-4000-8000-000000000402',
    })
    expect(ended.ok).toBe(true)
    if (!ended.ok) return

    expect(basketballLiveCaptureUnits(ended.state).map(unit => ({
      who: unit.who,
      what: unit.what,
      kind: unit.kind,
      undoable: unit.undoable,
    }))).toEqual([
      { who: 'Game', what: 'Q1 ended', kind: 'boundary', undoable: false },
      { who: '#4 Alex One', what: 'Made 2PT', kind: 'capture', undoable: true },
      { who: 'Game', what: 'Q1 started', kind: 'boundary', undoable: false },
    ])
    expect(undoLatestBasketballCourtCapture(ended.state, '2026-08-02T18:03:00.000Z'))
      .toMatchObject({ ok: false, state: ended.state, code: 'nothing_to_undo' })
    expect(ended.state.homeTeamScore).toBe(2)
  })

  it('undoes and restores a late roster addition with its selector row', () => {
    const added = addBasketballLateParticipant(startedState(), {
      recorderUserId: 'recorder-1',
      teamSide: 'opponent',
      displayName: 'Opponent Nine',
      number: '9',
      occurredAt: '2026-08-02T18:01:00.000Z',
      eventId: '71000000-0000-4000-8000-000000000411',
      participantId: '71000000-0000-4000-8000-000000000412',
      playerId: '71000000-0000-4000-8000-000000000413',
      captureCommandId: '71000000-0000-4000-8000-000000000414',
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(basketballLiveCaptureUnits(added.state)[0]).toMatchObject({
      who: 'Opponent Nine',
      what: 'Added to Bears roster',
      kind: 'capture',
      undoable: true,
    })

    const undone = undoLatestBasketballCourtCapture(
      added.state,
      '2026-08-02T18:02:00.000Z'
    )
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.state.players.some(player =>
      player.id === '71000000-0000-4000-8000-000000000413'
    )).toBe(false)
    expect(canRestoreBasketballCourtUndo(undone.state)).toBe(true)

    const restored = restoreLastBasketballCourtUndo(
      undone.state,
      '2026-08-02T18:03:00.000Z'
    )
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.state.players.find(player =>
      player.id === '71000000-0000-4000-8000-000000000413'
    )).toMatchObject({ name: 'Opponent Nine', number: '9' })
  })

  it('labels suspended and abandoned lifecycle boundaries distinctly', () => {
    const suspended = suspendBasketballMatch(startedState(), {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-02T18:01:00.000Z',
      eventId: '71000000-0000-4000-8000-000000000421',
    })
    expect(suspended.ok).toBe(true)
    if (!suspended.ok) return
    expect(basketballLiveCaptureUnits(suspended.state)[0]).toMatchObject({
      who: 'Game',
      what: 'Game suspended',
      kind: 'boundary',
      undoable: false,
    })

    const abandoned = abandonBasketballMatch(startedState(), {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-02T18:02:00.000Z',
      eventId: '71000000-0000-4000-8000-000000000422',
    })
    expect(abandoned.ok).toBe(true)
    if (!abandoned.ok) return
    expect(basketballLiveCaptureUnits(abandoned.state)[0]).toMatchObject({
      who: 'Game',
      what: 'Game abandoned',
      kind: 'boundary',
      undoable: false,
    })
  })
})

function appendExcludedAndBlockEvents(state: GameState): GameState {
  const context = getBasketballCommandContext(state, 'recorder-1', '2026-08-02T18:05:00.000Z')
  if (!context.ok) throw new Error(context.message)
  const shooter = basketballActorForSelection(
    state,
    'shooter',
    'tracked',
    { kind: 'participant', participantId: participantOne }
  )
  const blocker = basketballActorForSelection(
    state,
    'blocker',
    'tracked',
    { kind: 'participant', participantId: participantOne }
  )
  if (!shooter.ok || !blocker.ok) throw new Error('Fixture actor unavailable.')
  const common = {
    recorderUserId: 'recorder-1',
    period: context.value.period,
    occurredAt: context.value.occurredAt,
    teamSide: 'tracked' as const,
  }
  const events = [
    createBasketballStatEvent({
      ...common,
      id: '71000000-0000-4000-8000-000000000225',
      eventType: 'basketball.shot',
      payload: {
        value: 2,
        made: true,
        attempt: 'field_goal',
        valueSource: 'quick_entry',
        freeThrowTripId: null,
        tripAttemptNumber: null,
        captureCommandId: null,
      },
      sequence: context.value.nextSequence,
      actors: [shooter.value],
    }),
    createBasketballStatEvent({
      ...common,
      id: '71000000-0000-4000-8000-000000000226',
      eventType: 'basketball.shot',
      payload: {
        value: 1,
        made: true,
        attempt: 'free_throw',
        valueSource: 'free_throw',
        freeThrowTripId: null,
        tripAttemptNumber: null,
        captureCommandId: null,
      },
      sequence: context.value.nextSequence + 1,
      actors: [shooter.value],
    }),
    createBasketballStatEvent({
      ...common,
      id: '71000000-0000-4000-8000-000000000227',
      eventType: 'basketball.steal',
      payload: { relatedEventId: null, captureCommandId: null },
      sequence: context.value.nextSequence + 2,
      actors: [{ ...blocker.value, role: 'stealer' }],
    }),
    createBasketballStatEvent({
      ...common,
      id: '71000000-0000-4000-8000-000000000228',
      eventType: 'basketball.block',
      payload: {
        relatedEventId: '71000000-0000-4000-8000-000000000223',
        captureCommandId: null,
      },
      sequence: context.value.nextSequence + 3,
      actors: [blocker.value],
    }),
  ]

  let current = state
  for (const event of events) {
    const added = addGameEvent(current, event, gameEventRegistry, gameEventProjectors)
    if (!added.ok) throw new Error(added.error.message)
    current = added.state
  }
  return current
}
