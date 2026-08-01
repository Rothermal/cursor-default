import { describe, expect, it } from 'vitest'
import type { GameEvent, GameEventActor, JsonObject } from '../gameEvents/types'
import {
  addGameEvent,
  addGameEvents,
  deleteGameEvent,
  initializeGameEventStream,
  restoreGameEvent,
  updateGameEvent,
} from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createInitialState, gameReducer } from '../gameReducer'
import type { GameState, SportConfig } from '../../types'
import { buildGameSyncFingerprint, isAggregateCloudSyncEligible } from '../gameSyncFingerprint'
import { createSoccerEvent, soccerEventDefinitions } from './events'
import { DEFAULT_SOCCER_MATCH_RULES, resolveSoccerMatchRules, validateSoccerMatchRules } from './rules'
import { createSoccerSportGameState, elapsedSoccerClockMs } from './state'
import type {
  SoccerEventPayloadByType,
  SoccerMatchParticipant,
  SoccerMatchSetup,
  SoccerTeamSide,
} from './index'

const soccer: SportConfig = {
  id: 'soccer',
  name: 'Soccer',
  icon: 'S',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'G',
}

const participants: SoccerMatchParticipant[] = [
  participant('match-p1', 'p1', 'Keeper', '1', 'starter', 'goalkeeper'),
  participant('match-p2', 'p2', 'Defender', '2', 'starter', 'defender'),
  participant('match-p3', 'p3', 'Midfielder', '3', 'bench', 'midfielder'),
]

function participant(
  id: string,
  playerId: string | null,
  displayName: string,
  number: string | null,
  initialStatus: 'starter' | 'bench',
  role: 'goalkeeper' | 'defender' | 'midfielder' | 'forward'
): SoccerMatchParticipant {
  return {
    id,
    kind: playerId ? 'player' : 'anonymous',
    playerId,
    displayName,
    number,
    initialStatus,
    initialRole: { group: role, label: null },
  }
}

function setup(): SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSnapshot: resolveSoccerMatchRules({
      gameOverrides: { maxOnFieldPlayers: 2 },
    }),
    participants: structuredClone(participants),
  }
}

function state(): GameState {
  return {
    ...createInitialState(),
    sport: soccer,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-07-18',
    },
    players: [
      { id: 'p1', name: 'Keeper', number: '1', stats: {} },
      { id: 'p2', name: 'Defender', number: '2', stats: {} },
      { id: 'p3', name: 'Midfielder', number: '3', stats: {} },
      { id: 'p4', name: 'Late Player', number: '4', stats: {} },
    ],
    sportGameState: createSoccerSportGameState(setup()),
  }
}

function matchEvent<TType extends keyof SoccerEventPayloadByType>(
  sequence: number,
  eventType: TType,
  payload: SoccerEventPayloadByType[TType],
  elapsedMs: number | null,
  periodId = 'regulation-1'
): Extract<GameEvent, { eventType: TType }> {
  return createSoccerEvent({
    id: `10000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    eventType,
    payload,
    recorderUserId: 'user-1',
    sequence,
    period: { id: periodId, order: periodId === 'regulation-1' ? 1 : 2 },
    elapsedMs,
    occurredAt: new Date(Date.parse('2026-07-18T12:00:00.000Z') + sequence * 1_000).toISOString(),
  }) as Extract<GameEvent, { eventType: TType }>
}

function attackingEvent<TType extends 'soccer.shot' | 'soccer.own_goal' | 'soccer.score_adjustment'>(
  sequence: number,
  eventType: TType,
  payload: SoccerEventPayloadByType[TType],
  teamSide: SoccerTeamSide,
  actors: GameEventActor[],
  elapsedMs: number,
  location: { x: number; y: number; attackingDirection: 'left_to_right' | 'right_to_left' } | null = {
    x: 0.8,
    y: 0.5,
    attackingDirection: 'left_to_right',
  },
  periodId = 'regulation-1'
): GameEvent<JsonObject, string, string> {
  return createSoccerEvent({
    id: `20000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    eventType,
    payload,
    recorderUserId: 'user-1',
    sequence,
    period: { id: periodId, order: periodId === 'regulation-1' ? 1 : 2 },
    elapsedMs,
    occurredAt: new Date(Date.parse('2026-07-18T12:00:00.000Z') + sequence * 1_000).toISOString(),
    teamSide,
    location,
    actors,
  })
}

function trackedActor(role: string, participantId: string, playerId: string): GameEventActor {
  return { role, kind: 'player', participantId, playerId }
}

function opponentActor(role: string, label: string): GameEventActor {
  return { role, kind: 'unknown', label }
}

function initializedState(): GameState {
  const initialized = initializeGameEventStream(state(), gameEventRegistry, gameEventProjectors)
  if (!initialized.ok) throw new Error(initialized.error.message)
  return initialized.state
}

function kickoffEvents(): GameEvent[] {
  return [
    matchEvent(0, 'soccer.opening_lineup', {
      starters: [
        { participantId: 'match-p1', role: { group: 'goalkeeper', label: null } },
        { participantId: 'match-p2', role: { group: 'defender', label: null } },
      ],
    }, 0),
    matchEvent(1, 'soccer.period_started', { periodId: 'regulation-1' }, 0),
    matchEvent(2, 'soccer.clock_started', { anchorElapsedMs: 0 }, 0),
  ]
}

describe('soccer rules and production schemas', () => {
  it('resolves editable game overrides without mutating app defaults', () => {
    const rules = resolveSoccerMatchRules({
      gameOverrides: {
        maxOnFieldPlayers: 7,
        clockDirection: 'count_down',
        regulationSegments: [
          { id: 'regulation-1', label: 'Quarter 1', kind: 'regulation', order: 1, durationMs: 12 * 60_000 },
          { id: 'regulation-2', label: 'Quarter 2', kind: 'regulation', order: 2, durationMs: 12 * 60_000 },
          { id: 'regulation-3', label: 'Quarter 3', kind: 'regulation', order: 3, durationMs: 12 * 60_000 },
          { id: 'regulation-4', label: 'Quarter 4', kind: 'regulation', order: 4, durationMs: 12 * 60_000 },
        ],
        extraTimeSegments: [],
      },
    })

    expect(rules.maxOnFieldPlayers).toBe(7)
    expect(rules.clockDirection).toBe('count_down')
    expect(rules.regulationSegments).toHaveLength(4)
    expect(DEFAULT_SOCCER_MATCH_RULES.maxOnFieldPlayers).toBe(11)
    expect(validateSoccerMatchRules({ ...rules, maxOnFieldPlayers: 0 })).toMatch(/positive/)
  })

  it('registers the SOC-2 and SOC-3A schemas and rejects malformed payloads', () => {
    expect(soccerEventDefinitions).toHaveLength(25)
    const malformed = matchEvent(
      0,
      'soccer.opening_lineup',
      { starters: [] },
      0
    )
    expect(gameEventRegistry.inspect(malformed)).toMatchObject({
      ok: false,
      diagnostic: { code: 'validation_failed' },
    })
    const duplicateActors = attackingEvent(
      1,
      'soccer.shot',
      { outcome: 'goal', situation: 'open_play' },
      'tracked',
      [
        trackedActor('shooter', 'match-p1', 'p1'),
        trackedActor('shooter', 'match-p2', 'p2'),
      ],
      0
    )
    expect(gameEventRegistry.inspect(duplicateActors)).toMatchObject({
      ok: false,
      diagnostic: { code: 'validation_failed' },
    })
    const missingShooter = attackingEvent(
      2,
      'soccer.shot',
      { outcome: 'goal', situation: 'open_play' },
      'tracked',
      [],
      0
    )
    const missingOwnGoalActor = attackingEvent(
      3,
      'soccer.own_goal',
      {},
      'tracked',
      [],
      0
    )
    expect(gameEventRegistry.inspect(missingShooter)).toMatchObject({
      ok: false,
      diagnostic: { code: 'validation_failed' },
    })
    expect(gameEventRegistry.inspect(missingOwnGoalActor)).toMatchObject({
      ok: false,
      diagnostic: { code: 'validation_failed' },
    })
  })
})

describe('soccer attacking event projection', () => {
  it('supports team-attributed goals and separate primary and secondary assists', () => {
    const customState = state()
    const customSetup = setup()
    customSetup.rulesSnapshot = resolveSoccerMatchRules({
      gameOverrides: { maxOnFieldPlayers: 3, maxAssistsPerGoal: 2 },
    })
    customSetup.participants[2].initialStatus = 'starter'
    customState.sportGameState = createSoccerSportGameState(customSetup)
    const initialized = initializeGameEventStream(customState, gameEventRegistry, gameEventProjectors)
    if (!initialized.ok) throw new Error(initialized.error.message)
    const events: GameEvent[] = [
      matchEvent(0, 'soccer.opening_lineup', {
        starters: [
          { participantId: 'match-p1', role: { group: 'goalkeeper', label: null } },
          { participantId: 'match-p2', role: { group: 'defender', label: null } },
          { participantId: 'match-p3', role: { group: 'midfielder', label: null } },
        ],
      }, 0),
      matchEvent(1, 'soccer.period_started', { periodId: 'regulation-1' }, 0),
      matchEvent(2, 'soccer.clock_started', { anchorElapsedMs: 0 }, 0),
      attackingEvent(3, 'soccer.shot', { outcome: 'goal', situation: 'open_play' }, 'tracked', [{
        role: 'shooter',
        kind: 'team',
        label: 'Aces',
      }], 1_000),
      attackingEvent(4, 'soccer.shot', { outcome: 'goal', situation: 'open_play' }, 'tracked', [
        trackedActor('shooter', 'match-p3', 'p3'),
        trackedActor('creator_primary', 'match-p2', 'p2'),
        trackedActor('creator_secondary', 'match-p1', 'p1'),
      ], 2_000),
    ]

    const result = addGameEvents(initialized.state, events, gameEventRegistry, gameEventProjectors)
    if (!result.ok) throw new Error(result.error.message)

    expect(result.state.homeTeamScore).toBe(2)
    expect(result.state.sportGameState?.projection.sideTotals.tracked).toMatchObject({
      score: 2,
      goals: 2,
      shots: 2,
      shotsOnTarget: 2,
    })
    expect(result.state.players.find(player => player.id === 'p3')?.stats.soc_goal).toBe(1)
    expect(result.state.players.find(player => player.id === 'p2')?.stats).toMatchObject({
      soc_ast_primary: 1,
      soc_ast: 1,
      soc_chance_created: 1,
    })
    expect(result.state.players.find(player => player.id === 'p1')?.stats).toMatchObject({
      soc_ast_secondary: 1,
      soc_ast: 1,
      soc_chance_created: 0,
    })
  })

  it('projects every shot outcome and situation without inventing restart events', () => {
    const events: GameEvent[] = [
      ...kickoffEvents(),
      attackingEvent(3, 'soccer.shot', { outcome: 'goal', situation: 'penalty' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
      ], 1_000),
      attackingEvent(4, 'soccer.shot', { outcome: 'off_target', situation: 'direct_free_kick' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
      ], 2_000),
      attackingEvent(5, 'soccer.shot', { outcome: 'blocked', situation: 'corner_sequence' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
        opponentActor('blocker', 'Opponent block'),
      ], 3_000),
      attackingEvent(6, 'soccer.shot', { outcome: 'woodwork', situation: 'other_set_piece' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
      ], 4_000),
      attackingEvent(7, 'soccer.shot', { outcome: 'saved', situation: 'open_play' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
      ], 5_000),
    ]

    const result = addGameEvents(initializedState(), events, gameEventRegistry, gameEventProjectors)
    if (!result.ok) throw new Error(result.error.message)

    expect(result.state.sportGameState?.projection.sideTotals.tracked).toMatchObject({
      score: 1,
      shots: 5,
      shotsOnTarget: 2,
      goals: 1,
      saved: 1,
      blocked: 1,
      offTarget: 1,
      woodwork: 1,
      penaltyAttempts: 1,
      penaltyGoals: 1,
      directFreeKickAttempts: 1,
      directFreeKickGoals: 0,
    })
    expect(result.state.players.find(player => player.id === 'p2')?.stats).toMatchObject({
      soc_goal: 1,
      soc_shot: 5,
      soc_sot: 2,
      soc_pen_att: 1,
      soc_pen_goal: 1,
      soc_dfk_att: 1,
      soc_dfk_goal: 0,
    })
  })

  it('derives score, attempts, creators, goalkeeper totals, and own goals for both sides', () => {
    const events: GameEvent[] = [
      ...kickoffEvents(),
      attackingEvent(3, 'soccer.shot', { outcome: 'saved', situation: 'open_play' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
        trackedActor('creator_primary', 'match-p1', 'p1'),
      ], 1_000),
      attackingEvent(4, 'soccer.shot', { outcome: 'goal', situation: 'open_play' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
        trackedActor('creator_primary', 'match-p1', 'p1'),
      ], 2_000),
      attackingEvent(5, 'soccer.shot', { outcome: 'saved', situation: 'penalty' }, 'opponent', [
        opponentActor('shooter', 'Opponent 9'),
        trackedActor('goalkeeper', 'match-p1', 'p1'),
      ], 3_000),
      attackingEvent(6, 'soccer.shot', { outcome: 'goal', situation: 'open_play' }, 'opponent', [
        opponentActor('shooter', 'Opponent 10'),
        trackedActor('goalkeeper', 'match-p1', 'p1'),
      ], 4_000),
      attackingEvent(7, 'soccer.own_goal', {}, 'opponent', [
        trackedActor('own_goal_by', 'match-p2', 'p2'),
        trackedActor('goalkeeper', 'match-p1', 'p1'),
      ], 5_000),
      attackingEvent(8, 'soccer.own_goal', {}, 'tracked', [
        opponentActor('own_goal_by', 'Opponent 4'),
      ], 6_000),
      attackingEvent(9, 'soccer.score_adjustment', {
        delta: -1,
        reason: 'Corrected official score',
      }, 'tracked', [], 7_000, null),
    ]

    const result = addGameEvents(initializedState(), events, gameEventRegistry, gameEventProjectors)
    if (!result.ok) throw new Error(result.error.message)

    expect(result.state.homeTeamScore).toBe(1)
    expect(result.state.opponentScore).toBe(2)
    expect(result.state.sportGameState?.projection.sideTotals).toMatchObject({
      tracked: { score: 1, shots: 2, shotsOnTarget: 2, goals: 1, saved: 1 },
      opponent: {
        score: 2,
        shots: 2,
        shotsOnTarget: 2,
        goals: 1,
        saved: 1,
        penaltyAttempts: 1,
      },
    })
    expect(result.state.players.find(player => player.id === 'p2')?.stats).toMatchObject({
      soc_goal: 1,
      soc_own_goal: 1,
      soc_shot: 2,
      soc_sot: 2,
    })
    expect(result.state.players.find(player => player.id === 'p1')?.stats).toMatchObject({
      soc_ast_primary: 1,
      soc_ast: 1,
      soc_key_pass: 1,
      soc_chance_created: 2,
      soc_gk_save: 1,
      soc_gk_ga: 2,
      soc_gk_sot_faced: 2,
      soc_gk_pen_faced: 1,
      soc_gk_pen_save: 1,
    })
  })

  it('accepts a historical shot after period end without rewinding the match clock', () => {
    const events: GameEvent[] = [
      ...kickoffEvents(),
      matchEvent(3, 'soccer.clock_paused', { elapsedMs: 1_000 }, 1_000),
      matchEvent(4, 'soccer.period_ended', { periodId: 'regulation-1' }, 1_000),
      attackingEvent(5, 'soccer.shot', { outcome: 'off_target', situation: 'open_play' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
      ], 500),
    ]

    const result = addGameEvents(initializedState(), events, gameEventRegistry, gameEventProjectors)
    if (!result.ok) throw new Error(result.error.message)

    expect(result.state.sportGameState?.projection.status).toBe('period_break')
    expect(result.state.sportGameState?.projection.clock.elapsedMs).toBe(1_000)
    expect(result.state.players.find(player => player.id === 'p2')?.stats.soc_shot).toBe(1)
  })

  it('accepts historical attacking events from a suspended in-progress period', () => {
    const events: GameEvent[] = [
      ...kickoffEvents(),
      matchEvent(3, 'soccer.clock_paused', { elapsedMs: 1_000 }, 1_000),
      matchEvent(4, 'soccer.match_ended', { reason: 'suspended' }, 1_000),
      attackingEvent(5, 'soccer.shot', { outcome: 'off_target', situation: 'open_play' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
      ], 500),
    ]

    const result = addGameEvents(initializedState(), events, gameEventRegistry, gameEventProjectors)
    if (!result.ok) throw new Error(result.error.message)

    expect(result.state.sportGameState?.projection.status).toBe('suspended')
    expect(result.state.sportGameState?.projection.startedPeriodIds).toEqual(['regulation-1'])
    expect(result.state.sportGameState?.projection.periodEndElapsedMsById).toEqual({})
    expect(result.state.sportGameState?.projection.suspendedContext).toEqual({
      periodId: 'regulation-1',
      elapsedMs: 1_000,
    })
    expect(result.state.players.find(player => player.id === 'p2')?.stats.soc_shot).toBe(1)
  })

  it('keeps participant attribution stable when an anonymous player is resolved later', () => {
    const anonymous = state()
    const anonymousSetup = setup()
    anonymousSetup.participants[1] = participant(
      'match-p2',
      null,
      'Guest defender',
      '2',
      'starter',
      'defender'
    )
    anonymous.sportGameState = createSoccerSportGameState(anonymousSetup)
    const initialized = initializeGameEventStream(anonymous, gameEventRegistry, gameEventProjectors)
    if (!initialized.ok) throw new Error(initialized.error.message)
    const events: GameEvent[] = [
      ...kickoffEvents(),
      attackingEvent(3, 'soccer.shot', { outcome: 'goal', situation: 'open_play' }, 'tracked', [{
        role: 'shooter',
        kind: 'unknown',
        participantId: 'match-p2',
        label: 'Guest defender',
      }], 1_000),
      matchEvent(4, 'soccer.participant_resolved', {
        participantId: 'match-p2',
        playerId: 'p2',
        displayName: 'Defender',
        number: '2',
      }, 1_000),
    ]

    const result = addGameEvents(initialized.state, events, gameEventRegistry, gameEventProjectors)
    if (!result.ok) throw new Error(result.error.message)

    expect(result.state.players.find(player => player.id === 'p2')?.stats).toMatchObject({
      soc_goal: 1,
      soc_shot: 1,
      soc_sot: 1,
    })
  })

  it('reprojects attacking totals when an event is deleted and restored', () => {
    const shot = attackingEvent(
      3,
      'soccer.shot',
      { outcome: 'goal', situation: 'direct_free_kick' },
      'tracked',
      [trackedActor('shooter', 'match-p2', 'p2')],
      1_000
    )
    const added = addGameEvents(
      initializedState(),
      [...kickoffEvents(), shot],
      gameEventRegistry,
      gameEventProjectors
    )
    if (!added.ok) throw new Error(added.error.message)

    const deleted = deleteGameEvent(
      added.state,
      shot.id,
      '2026-07-18T12:10:00.000Z',
      gameEventRegistry,
      gameEventProjectors
    )
    if (!deleted.ok) throw new Error(deleted.error.message)
    expect(deleted.state.homeTeamScore).toBe(0)
    expect(deleted.state.players.find(player => player.id === 'p2')?.stats.soc_shot).toBe(0)

    const restored = restoreGameEvent(
      deleted.state,
      shot.id,
      '2026-07-18T12:11:00.000Z',
      gameEventRegistry,
      gameEventProjectors
    )
    if (!restored.ok) throw new Error(restored.error.message)
    expect(restored.state.homeTeamScore).toBe(1)
    expect(restored.state.players.find(player => player.id === 'p2')?.stats).toMatchObject({
      soc_shot: 1,
      soc_sot: 1,
      soc_dfk_att: 1,
      soc_dfk_goal: 1,
    })
  })

  it('preserves an invalid attacking correction with projection diagnostics', () => {
    const shot = attackingEvent(
      3,
      'soccer.shot',
      { outcome: 'goal', situation: 'open_play' },
      'tracked',
      [trackedActor('shooter', 'match-p2', 'p2')],
      1_000
    )
    const added = addGameEvents(
      initializedState(),
      [...kickoffEvents(), shot],
      gameEventRegistry,
      gameEventProjectors
    )
    if (!added.ok) throw new Error(added.error.message)

    const edited = updateGameEvent(
      added.state,
      shot.id,
      { actors: [trackedActor('shooter', 'match-p3', 'p3')] },
      '2026-07-18T12:10:00.000Z',
      gameEventRegistry,
      gameEventProjectors
    )
    if (!edited.ok) throw new Error(edited.error.message)

    expect(edited.inspection.complete).toBe(false)
    expect(edited.inspection.diagnostics).toEqual([
      expect.objectContaining({ code: 'semantic_validation_failed', eventId: shot.id }),
    ])
    const revised = edited.state.eventStream?.events.find(
      event => typeof event === 'object' && event !== null && 'id' in event && event.id === shot.id
    )
    expect(revised).toMatchObject({ revision: 2 })
    expect(edited.state.homeTeamScore).toBe(0)
  })

  it('rejects negative score and tracked actors who were not on field', () => {
    const negative = addGameEvents(initializedState(), [
      ...kickoffEvents(),
      attackingEvent(3, 'soccer.score_adjustment', {
        delta: -1,
        reason: 'Invalid correction',
      }, 'tracked', [], 1_000, null),
    ], gameEventRegistry, gameEventProjectors)
    expect(negative).toMatchObject({ ok: false, error: { code: 'incomplete_projection' } })

    const benchShot = addGameEvents(initializedState(), [
      ...kickoffEvents(),
      attackingEvent(3, 'soccer.shot', { outcome: 'off_target', situation: 'open_play' }, 'tracked', [
        trackedActor('shooter', 'match-p3', 'p3'),
      ], 1_000),
    ], gameEventRegistry, gameEventProjectors)
    expect(benchShot).toMatchObject({ ok: false, error: { code: 'incomplete_projection' } })

    const duplicateCreators = addGameEvents(initializedState(), [
      ...kickoffEvents(),
      attackingEvent(3, 'soccer.shot', { outcome: 'goal', situation: 'open_play' }, 'tracked', [
        trackedActor('shooter', 'match-p2', 'p2'),
        trackedActor('creator_primary', 'match-p1', 'p1'),
        trackedActor('creator_secondary', 'match-p1', 'p1'),
      ], 1_000),
    ], gameEventRegistry, gameEventProjectors)
    expect(duplicateCreators).toMatchObject({ ok: false, error: { code: 'incomplete_projection' } })
  })
})

describe('soccer match projection', () => {
  it('projects a complete clock, substitution, correction, and lifecycle history', () => {
    const rulesWithReturns = resolveSoccerMatchRules({
      gameOverrides: { maxOnFieldPlayers: 2, allowReturnSubstitutions: true },
    })
    const lateAnonymous = participant(
      'match-late',
      null,
      'Late arrival',
      null,
      'bench',
      'forward'
    )
    const events: GameEvent[] = [
      ...kickoffEvents(),
      matchEvent(3, 'soccer.clock_paused', { elapsedMs: 60_000 }, 60_000),
      matchEvent(4, 'soccer.substitution_window', {
        changes: [{
          playerOutParticipantId: 'match-p2',
          playerInParticipantId: 'match-p3',
          playerInRole: { group: 'midfielder', label: null },
        }],
        halftime: false,
      }, 60_000),
      matchEvent(5, 'soccer.clock_started', { anchorElapsedMs: 60_000 }, 60_000),
      matchEvent(6, 'soccer.role_changed', {
        changes: [{ participantId: 'match-p3', role: { group: 'defender', label: null } }],
      }, 75_000),
      matchEvent(7, 'soccer.attacking_direction_changed', { direction: 'right_to_left' }, 75_000),
      matchEvent(8, 'soccer.clock_adjusted', { fromElapsedMs: 75_000, toElapsedMs: 74_000 }, 74_000),
      matchEvent(9, 'soccer.clock_paused', { elapsedMs: 90_000 }, 90_000),
      matchEvent(10, 'soccer.match_roster_added', {
        participant: lateAnonymous,
        destination: 'bench',
      }, 90_000),
      matchEvent(11, 'soccer.participant_resolved', {
        participantId: 'match-late',
        playerId: 'p4',
        displayName: 'Late Player',
        number: '4',
      }, 90_000),
      matchEvent(12, 'soccer.match_rules_changed', { rules: rulesWithReturns }, 90_000),
      matchEvent(13, 'soccer.period_ended', { periodId: 'regulation-1' }, 90_000),
      matchEvent(14, 'soccer.period_started', { periodId: 'regulation-2' }, 90_000, 'regulation-2'),
      matchEvent(15, 'soccer.clock_started', { anchorElapsedMs: 90_000 }, 90_000, 'regulation-2'),
      matchEvent(16, 'soccer.clock_paused', { elapsedMs: 120_000 }, 120_000, 'regulation-2'),
      matchEvent(17, 'soccer.period_ended', { periodId: 'regulation-2' }, 120_000, 'regulation-2'),
      matchEvent(18, 'soccer.match_ended', { reason: 'completed' }, 120_000, 'regulation-2'),
      matchEvent(19, 'soccer.match_reopened', { reason: 'Correction review' }, 120_000, 'regulation-2'),
    ]

    const result = addGameEvents(initializedState(), events, gameEventRegistry, gameEventProjectors)
    if (!result.ok) throw new Error(result.error.message)

    expect(result.inspection.complete).toBe(true)
    expect(result.state.eventStream?.events).toHaveLength(events.length)
    const projection = result.state.sportGameState?.projection
    expect(projection?.status).toBe('period_break')
    expect(projection?.completedPeriodIds).toEqual(['regulation-1', 'regulation-2'])
    expect(projection?.attackingDirection).toBe('right_to_left')
    expect(projection?.substitutionCount).toBe(1)
    expect(projection?.substitutionWindowCount).toBe(1)
    expect(projection?.participants['match-late'].playerId).toBe('p4')
    expect(result.state.players.find(player => player.id === 'p1')?.stats).toMatchObject({
      soc_start: 1,
      soc_app: 1,
      soc_min_sec: 120,
    })
    expect(result.state.players.find(player => player.id === 'p2')?.stats.soc_min_sec).toBe(60)
    expect(result.state.players.find(player => player.id === 'p3')?.stats).toMatchObject({
      soc_start: 0,
      soc_app: 1,
      soc_min_sec: 60,
    })
  })

  it('rolls back a semantically invalid event batch', () => {
    const events: GameEvent[] = [
      ...kickoffEvents(),
      matchEvent(3, 'soccer.clock_paused', { elapsedMs: 60_000 }, 60_000),
      matchEvent(4, 'soccer.substitution_window', {
        changes: [{
          playerOutParticipantId: 'match-p1',
          playerInParticipantId: 'match-p3',
          playerInRole: { group: 'midfielder', label: null },
        }],
        halftime: false,
      }, 60_000),
      matchEvent(5, 'soccer.period_ended', { periodId: 'regulation-1' }, 60_000),
    ]

    const before = initializedState()
    const result = addGameEvents(before, events, gameEventRegistry, gameEventProjectors)

    expect(result).toMatchObject({ ok: false, error: { code: 'incomplete_projection' } })
    expect(result.state).toBe(before)
    expect(result.state.eventStream?.events).toEqual([])
  })

  it('preserves incomplete history after an existing event is edited', () => {
    const events: GameEvent[] = [
      ...kickoffEvents(),
      matchEvent(3, 'soccer.clock_paused', { elapsedMs: 60_000 }, 60_000),
      matchEvent(4, 'soccer.substitution_window', {
        changes: [{
          playerOutParticipantId: 'match-p2',
          playerInParticipantId: 'match-p3',
          playerInRole: { group: 'midfielder', label: null },
        }],
        halftime: false,
      }, 60_000),
      matchEvent(5, 'soccer.period_ended', { periodId: 'regulation-1' }, 60_000),
    ]
    const valid = addGameEvents(initializedState(), events, gameEventRegistry, gameEventProjectors)
    if (!valid.ok) throw new Error(valid.error.message)

    const edited = updateGameEvent(
      valid.state,
      events[4].id,
      {
        payload: {
          changes: [{
            playerOutParticipantId: 'match-p1',
            playerInParticipantId: 'match-p3',
            playerInRole: { group: 'midfielder', label: null },
          }],
          halftime: false,
        },
      },
      '2026-07-18T12:10:00.000Z',
      gameEventRegistry,
      gameEventProjectors
    )
    if (!edited.ok) throw new Error(edited.error.message)

    expect(edited.state.eventStream?.events).toHaveLength(events.length)
    expect(edited.inspection.complete).toBe(false)
    expect(edited.inspection.diagnostics.map(item => item.code)).toEqual([
      'semantic_validation_failed',
      'unprojected_event',
    ])
    const projection = edited.state.sportGameState?.projection
    expect(projection?.clock.running).toBe(false)
    expect(projection?.currentPeriodId).toBe('regulation-1')
    expect(projection?.participants['match-p1'].status).toBe('on_field')
    expect(projection?.participants['match-p3'].status).toBe('bench')
  })

  it('rejects an invalid event batch atomically', () => {
    const duplicate = kickoffEvents()
    duplicate[1] = { ...duplicate[1], id: duplicate[0].id }
    const before = initializedState()
    const result = addGameEvents(before, duplicate, gameEventRegistry, gameEventProjectors)

    expect(result).toMatchObject({ ok: false, error: { code: 'duplicate_event_id' } })
    expect(result.state.eventStream?.events).toEqual([])
  })

  it('rolls back a semantically invalid single append', () => {
    const before = initializedState()
    const result = addGameEvent(
      before,
      matchEvent(0, 'soccer.period_started', { periodId: 'regulation-1' }, 0),
      gameEventRegistry,
      gameEventProjectors
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'incomplete_projection' } })
    expect(result.state).toBe(before)
  })

  it('requires resolved soccer setup before initializing the authoritative stream', () => {
    const withoutSetup = { ...state(), sportGameState: null }
    const result = initializeGameEventStream(withoutSetup, gameEventRegistry, gameEventProjectors)

    expect(result).toMatchObject({ ok: false, error: { code: 'sport_setup_required' } })
    expect(result.state.eventStream).toBeNull()
  })

  it('derives a running clock from its persisted anchor without mutating state', () => {
    const result = addGameEvents(
      initializedState(),
      kickoffEvents(),
      gameEventRegistry,
      gameEventProjectors
    )
    if (!result.ok) throw new Error(result.error.message)
    const projection = result.state.sportGameState?.projection
    if (!projection?.clock.anchorOccurredAt) throw new Error('clock did not start')

    expect(elapsedSoccerClockMs(projection, Date.parse(projection.clock.anchorOccurredAt) + 12_345)).toBe(12_345)
    expect(projection.clock.elapsedMs).toBe(0)
  })

  it('keeps setup-only and event-backed matches out of legacy aggregate cloud sync', () => {
    expect(isAggregateCloudSyncEligible({ ...state(), sportGameState: null })).toBe(false)
    expect(isAggregateCloudSyncEligible(state())).toBe(false)
    expect(isAggregateCloudSyncEligible(initializedState())).toBe(false)
  })

  it('blocks legacy aggregate mutations and setup replacement after event capture begins', () => {
    const result = addGameEvents(
      initializedState(),
      kickoffEvents(),
      gameEventRegistry,
      gameEventProjectors
    )
    if (!result.ok) throw new Error(result.error.message)

    expect(gameReducer(result.state, {
      type: 'INCREMENT_STAT',
      playerId: 'p1',
      statId: 'goal',
    })).toBe(result.state)
    expect(gameReducer(result.state, {
      type: 'SET_SPORT_GAME_STATE',
      sportGameState: createSoccerSportGameState(setup()),
    })).toBe(result.state)
  })

  it('fingerprints authoritative setup but excludes the rebuildable soccer projection', () => {
    const baseline = state()
    const changedProjection = structuredClone(baseline)
    if (!changedProjection.sportGameState) throw new Error('missing soccer state')
    changedProjection.sportGameState.projection.status = 'ended'
    changedProjection.sportGameState.projection.clock.elapsedMs = 999_000

    expect(buildGameSyncFingerprint(changedProjection)).toBe(buildGameSyncFingerprint(baseline))
    changedProjection.sportGameState.setup.trackedTeamDesignation = 'away'
    expect(buildGameSyncFingerprint(changedProjection)).not.toBe(buildGameSyncFingerprint(baseline))
  })
})
