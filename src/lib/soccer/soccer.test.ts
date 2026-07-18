import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../gameEvents/types'
import { addGameEvents, initializeGameEventStream } from '../gameEvents/mutations'
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

  it('registers all SOC-2 match-state schemas and rejects malformed payloads', () => {
    expect(soccerEventDefinitions).toHaveLength(14)
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

  it('preserves invalid and later events while projecting only through the last valid point', () => {
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

    const result = addGameEvents(initializedState(), events, gameEventRegistry, gameEventProjectors)
    if (!result.ok) throw new Error(result.error.message)

    expect(result.state.eventStream?.events).toHaveLength(events.length)
    expect(result.inspection.complete).toBe(false)
    expect(result.inspection.diagnostics.map(item => item.code)).toEqual([
      'semantic_validation_failed',
      'unprojected_event',
    ])
    const projection = result.state.sportGameState?.projection
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

  it('keeps event-backed matches out of legacy aggregate cloud sync', () => {
    expect(isAggregateCloudSyncEligible(state())).toBe(true)
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
