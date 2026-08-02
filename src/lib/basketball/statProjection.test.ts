import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player, ShotRecord } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import { GameEventProjectorRegistry, rebuildGameEventProjection } from '../gameEvents/projection'
import { GameEventRegistry } from '../gameEvents/registry'
import type { GameEventActor, GameEventLocation, GameEventPeriod } from '../gameEvents/types'
import { getDisplayedHomeScore } from '../gameScore'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  basketballEventDefinitions,
  createBasketballLifecycleEvent,
} from './events'
import { courtFeetToNormalizedLocation } from './courtGeometry'
import { basketballGameEventProjector } from './projector'
import {
  createBasketballMatchRules,
  DEFAULT_BASKETBALL_RULES_SOURCE,
} from './rules'
import {
  createBasketballStatEvent,
  type BasketballStatPayloadByType,
} from './statEvents'
import { createBasketballSportGameState } from './state'
import type {
  BasketballLifecycleEvent,
  BasketballMatchEvent,
  BasketballMatchParticipant,
  BasketballMatchSetup,
  BasketballSportGameState,
  BasketballStatEvent,
  BasketballTeamSide,
} from './types'

const registry = new GameEventRegistry(basketballEventDefinitions)
const projectors = new GameEventProjectorRegistry([basketballGameEventProjector])
const period: GameEventPeriod = { id: 'regulation-1', order: 1 }
const occurredAt = '2026-08-02T12:00:00.000Z'

function participant(
  id: string,
  playerId: string | null,
  teamSide: BasketballTeamSide,
  initialStatus: 'starter' | 'bench' | 'dnp' = 'starter'
): BasketballMatchParticipant {
  return {
    id,
    playerId,
    displayName: id,
    number: null,
    teamSide,
    initialStatus,
    position: null,
    captain: false,
  }
}

function setup(): BasketballMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSource: structuredClone(DEFAULT_BASKETBALL_RULES_SOURCE),
    rulesSnapshot: createBasketballMatchRules(),
    participants: [
      participant('tracked-1', 'player-1', 'tracked'),
      participant('tracked-2', 'player-2', 'tracked'),
      participant('opponent-1', null, 'opponent'),
    ],
  }
}

function players(): Player[] {
  return [
    {
      id: TEAM_PLAYER_HOME_ID,
      name: 'Tracked',
      number: '*',
      stats: {},
      isTeamPlayer: true,
      teamSide: 'home',
    },
    {
      id: TEAM_PLAYER_OPP_ID,
      name: 'Opponent',
      number: '*',
      stats: {},
      isTeamPlayer: true,
      teamSide: 'opponent',
    },
    { id: 'player-1', name: 'One', number: '1', stats: {} },
    { id: 'player-2', name: 'Two', number: '2', stats: {} },
  ]
}

function state(): GameState {
  return {
    ...createInitialState(),
    sport: sports.find(sport => sport.id === 'basketball')!,
    gameInfo: {
      teamName: 'Tracked',
      opponentName: 'Opponent',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-02',
    },
    players: players(),
    activePlayerId: 'player-1',
    sportGameState: createBasketballSportGameState(setup()),
  }
}

function id(sequence: number): string {
  return `70000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`
}

function at(sequence: number): string {
  return new Date(Date.parse(occurredAt) + sequence * 1_000).toISOString()
}

function start(sequence = 0): BasketballLifecycleEvent {
  return createBasketballLifecycleEvent({
    id: id(sequence),
    eventType: 'basketball.period_started',
    payload: { periodId: period.id, captureCommandId: null },
    recorderUserId: 'recorder-1',
    sequence,
    period,
    occurredAt: at(sequence),
  })
}

function end(sequence: number): BasketballLifecycleEvent {
  return createBasketballLifecycleEvent({
    id: id(sequence),
    eventType: 'basketball.match_ended',
    payload: { reason: 'completed', captureCommandId: null },
    recorderUserId: 'recorder-1',
    sequence,
    period,
    occurredAt: at(sequence),
  })
}

interface StatOptions {
  teamSide?: BasketballTeamSide
  actors?: GameEventActor[]
  location?: GameEventLocation | null
}

function stat<TType extends keyof BasketballStatPayloadByType>(
  sequence: number,
  eventType: TType,
  payload: BasketballStatPayloadByType[TType],
  options: StatOptions = {}
): Extract<BasketballStatEvent, { eventType: TType }> {
  return createBasketballStatEvent({
    id: id(sequence),
    eventType,
    payload,
    recorderUserId: 'recorder-1',
    sequence,
    period,
    occurredAt: at(sequence),
    teamSide: options.teamSide ?? 'tracked',
    actors: options.actors ?? [],
    location: options.location ?? null,
  })
}

function playerActor(
  role: string,
  participantId: 'tracked-1' | 'tracked-2',
  playerId: 'player-1' | 'player-2'
): GameEventActor {
  return { role, kind: 'player', participantId, playerId }
}

function unknownActor(role: string, label: string, participantId?: string): GameEventActor {
  return { role, kind: 'unknown', label, ...(participantId ? { participantId } : {}) }
}

function teamActor(role: string, label = 'Tracked'): GameEventActor {
  return { role, kind: 'team', label }
}

function location(x: number, y: number): GameEventLocation {
  return { ...courtFeetToNormalizedLocation({ x, y }), attackingDirection: 'unknown' }
}

function shotPayload(
  made: boolean,
  value: 2 | 3,
  valueSource: 'court' | 'manual_override' | 'quick_entry' = 'court'
): BasketballStatPayloadByType['basketball.shot'] {
  return {
    value,
    made,
    attempt: 'field_goal',
    valueSource,
    freeThrowTripId: null,
    tripAttemptNumber: null,
    captureCommandId: null,
  }
}

function freeThrowPayload(
  made: boolean,
  tripId: string | null,
  attemptNumber: number | null
): BasketballStatPayloadByType['basketball.shot'] {
  return {
    value: 1,
    made,
    attempt: 'free_throw',
    valueSource: 'free_throw',
    freeThrowTripId: tripId,
    tripAttemptNumber: attemptNumber,
    captureCommandId: null,
  }
}

function project(events: BasketballMatchEvent[]) {
  return rebuildGameEventProjection(
    { ...state(), eventStream: { version: 1, events } },
    registry,
    projectors
  )
}

function basketballState(value: GameState['sportGameState']): BasketballSportGameState {
  if (value?.sportId !== 'basketball') throw new Error('Expected Basketball state.')
  return value
}

describe('BKE-1B2 Basketball stat projection', () => {
  it('projects mixed scoring, shooting, links, defense, team events, and result', () => {
    const madeShot = stat(1, 'basketball.shot', shotPayload(true, 2), {
      actors: [playerActor('shooter', 'tracked-1', 'player-1')],
      location: location(0, 8),
    })
    const opponentMiss = stat(3, 'basketball.shot', shotPayload(false, 3), {
      teamSide: 'opponent',
      actors: [unknownActor('shooter', 'Opponent shooter')],
      location: location(23, 5),
    })
    const opponentTurnover = stat(6, 'basketball.turnover', {
      kind: 'player',
      captureCommandId: null,
    }, {
      teamSide: 'opponent',
      actors: [unknownActor('committed_by', 'Opponent ballhandler')],
    })
    const trip = stat(8, 'basketball.free_throw_trip', {
      maximumAttempts: 2,
      oneAndOne: false,
      sourceFoulEventId: null,
      technical: false,
      possessionRetained: false,
      captureCommandId: null,
    })
    const result = project([
      start(),
      madeShot,
      stat(2, 'basketball.assist', {
        relatedEventId: madeShot.id,
        captureCommandId: null,
      }, { actors: [playerActor('assister', 'tracked-2', 'player-2')] }),
      opponentMiss,
      stat(4, 'basketball.block', {
        relatedEventId: opponentMiss.id,
        captureCommandId: null,
      }, { actors: [playerActor('blocker', 'tracked-1', 'player-1')] }),
      stat(5, 'basketball.rebound', {
        kind: 'defensive',
        relatedEventId: opponentMiss.id,
        captureCommandId: null,
      }, { actors: [teamActor('rebounder')] }),
      opponentTurnover,
      stat(7, 'basketball.steal', {
        relatedEventId: opponentTurnover.id,
        captureCommandId: null,
      }, { actors: [playerActor('stealer', 'tracked-2', 'player-2')] }),
      trip,
      stat(9, 'basketball.shot', freeThrowPayload(true, trip.id, 1), {
        actors: [playerActor('shooter', 'tracked-1', 'player-1')],
      }),
      stat(10, 'basketball.shot', freeThrowPayload(false, trip.id, 2), {
        actors: [playerActor('shooter', 'tracked-1', 'player-1')],
      }),
      stat(11, 'basketball.turnover', {
        kind: 'team',
        captureCommandId: null,
      }, { actors: [teamActor('committed_by')] }),
      stat(12, 'basketball.score_adjustment', {
        delta: 1,
        reason: 'scoreboard_control',
        note: null,
        captureCommandId: null,
      }, { actors: [teamActor('team')] }),
      stat(13, 'basketball.score_adjustment', {
        delta: 2,
        reason: 'unattributed_score',
        note: null,
        captureCommandId: null,
      }, { teamSide: 'opponent', actors: [teamActor('team', 'Opponent')] }),
      end(14),
    ])
    const projection = basketballState(result.state.sportGameState).projection

    expect(result.inspection.complete).toBe(true)
    expect(result.state.homeTeamScore).toBe(4)
    expect(result.state.opponentScore).toBe(2)
    expect(result.state.players.find(player => player.id === 'player-1')?.stats).toMatchObject({
      '2pt': 1,
      ft: 1,
      ft_miss: 1,
      blk: 1,
    })
    expect(result.state.players.find(player => player.id === 'player-2')?.stats).toMatchObject({
      ast: 1,
      stl: 1,
    })
    expect(result.state.players.find(player => player.id === TEAM_PLAYER_HOME_ID)?.stats)
      .toMatchObject({ dreb: 1, team_turnover: 1 })
    expect(projection.sideStats.tracked).toMatchObject({
      '2pt': 1,
      ft: 1,
      ft_miss: 1,
      ast: 1,
      dreb: 1,
      stl: 1,
      blk: 1,
      to: 1,
    })
    expect(projection.relationshipWarnings).toEqual([])
    expect(projection.result).toBe('tracked_win')
    expect(result.state.shotChart).toEqual([
      expect.objectContaining({ id: madeShot.id, playerId: 'player-1', zone: 'paint' }),
      expect.objectContaining({ id: opponentMiss.id, playerId: TEAM_PLAYER_OPP_ID, zone: 'three' }),
    ])
  })

  it('validates shot geometry, free throws, score corrections, and team turnovers strictly', () => {
    const courtThreeAtTwoPointLocation = stat(1, 'basketball.shot', shotPayload(true, 3), {
      actors: [playerActor('shooter', 'tracked-1', 'player-1')],
      location: location(0, 8),
    })
    expect(registry.inspect(courtThreeAtTwoPointLocation).ok).toBe(false)
    expect(registry.inspect({
      ...courtThreeAtTwoPointLocation,
      payload: { ...courtThreeAtTwoPointLocation.payload, valueSource: 'manual_override' },
    }).ok).toBe(true)

    const malformedFreeThrow = stat(2, 'basketball.shot', freeThrowPayload(true, null, null), {
      actors: [playerActor('shooter', 'tracked-1', 'player-1')],
      location: location(0, 8),
    })
    expect(registry.inspect(malformedFreeThrow).ok).toBe(false)

    const correction = stat(3, 'basketball.score_adjustment', {
      delta: 1,
      reason: 'official_correction',
      note: null,
      captureCommandId: null,
    }, { actors: [teamActor('team')] })
    expect(registry.inspect(correction).ok).toBe(false)

    const malformedTeamTurnover = stat(4, 'basketball.turnover', {
      kind: 'team',
      captureCommandId: null,
    }, { actors: [unknownActor('committed_by', 'Unknown')] })
    expect(registry.inspect(malformedTeamTurnover).ok).toBe(false)

    const malformedOneAndOne = stat(5, 'basketball.free_throw_trip', {
      maximumAttempts: 3,
      oneAndOne: true,
      sourceFoulEventId: null,
      technical: false,
      possessionRetained: false,
      captureCommandId: null,
    })
    expect(registry.inspect(malformedOneAndOne).ok).toBe(false)
  })

  it('preserves legacy shot type and zone compatibility for manual value overrides', () => {
    const overriddenThree = stat(1, 'basketball.shot', shotPayload(true, 3, 'manual_override'), {
      actors: [playerActor('shooter', 'tracked-1', 'player-1')],
      location: location(0, 8),
    })
    const overriddenTwo = stat(2, 'basketball.shot', shotPayload(true, 2, 'manual_override'), {
      actors: [playerActor('shooter', 'tracked-1', 'player-1')],
      location: location(23, 5),
    })
    const result = project([start(), overriddenThree, overriddenTwo])

    expect(result.inspection.complete).toBe(true)
    expect(result.state.shotChart).toEqual([
      expect.objectContaining({ shotType: '3pt', zone: 'three' }),
      expect.objectContaining({ shotType: '2pt', zone: 'mid_range' }),
    ])
    expect(result.state.homeTeamScore).toBe(5)
  })

  it('counts unlocated quick entries without fabricating chart records', () => {
    const quick = stat(1, 'basketball.shot', shotPayload(true, 2, 'quick_entry'), {
      actors: [playerActor('shooter', 'tracked-1', 'player-1')],
    })
    const result = project([start(), quick])

    expect(result.inspection.complete).toBe(true)
    expect(result.state.homeTeamScore).toBe(2)
    expect(result.state.players.find(player => player.id === 'player-1')?.stats['2pt']).toBe(1)
    expect(result.state.shotChart).toEqual([])
  })

  it('downgrades stale advisory links without dropping their independent totals', () => {
    const madeShot = stat(1, 'basketball.shot', shotPayload(true, 2, 'quick_entry'), {
      actors: [playerActor('shooter', 'tracked-1', 'player-1')],
    })
    const selfAssist = stat(2, 'basketball.assist', {
      relatedEventId: madeShot.id,
      captureCommandId: null,
    }, { actors: [playerActor('assister', 'tracked-1', 'player-1')] })
    const danglingRebound = stat(3, 'basketball.rebound', {
      kind: 'offensive',
      relatedEventId: '70000000-0000-4000-8000-000000000099',
      captureCommandId: null,
    }, { actors: [playerActor('rebounder', 'tracked-2', 'player-2')] })
    const laterShot = stat(5, 'basketball.shot', shotPayload(true, 2, 'quick_entry'), {
      actors: [playerActor('shooter', 'tracked-1', 'player-1')],
    })
    const futureAssist = stat(4, 'basketball.assist', {
      relatedEventId: laterShot.id,
      captureCommandId: null,
    }, { actors: [playerActor('assister', 'tracked-2', 'player-2')] })
    const result = project([
      start(),
      madeShot,
      selfAssist,
      danglingRebound,
      futureAssist,
      laterShot,
    ])
    const projection = basketballState(result.state.sportGameState).projection

    expect(result.inspection.complete).toBe(true)
    expect(result.state.players.find(player => player.id === 'player-1')?.stats.ast).toBe(1)
    expect(result.state.players.find(player => player.id === 'player-2')?.stats)
      .toMatchObject({ oreb: 1, ast: 1 })
    expect(projection.relationshipWarnings).toHaveLength(3)
  })

  it('flags duplicate free-throw positions while preserving attempt totals', () => {
    const trip = stat(1, 'basketball.free_throw_trip', {
      maximumAttempts: 2,
      oneAndOne: false,
      sourceFoulEventId: null,
      technical: false,
      possessionRetained: false,
      captureCommandId: null,
    })
    const result = project([
      start(),
      trip,
      stat(2, 'basketball.shot', freeThrowPayload(true, trip.id, 1), {
        actors: [playerActor('shooter', 'tracked-1', 'player-1')],
      }),
      stat(3, 'basketball.shot', freeThrowPayload(false, trip.id, 1), {
        actors: [playerActor('shooter', 'tracked-1', 'player-1')],
      }),
    ])
    const projection = basketballState(result.state.sportGameState).projection

    expect(result.inspection.complete).toBe(true)
    expect(result.state.players.find(player => player.id === 'player-1')?.stats)
      .toMatchObject({ ft: 1, ft_miss: 1 })
    expect(projection.relationshipWarnings[0]?.message).toContain('duplicate')
  })

  it('fails closed when an actor references a participant on the wrong side', () => {
    const wrongSide = stat(1, 'basketball.shot', shotPayload(true, 2, 'quick_entry'), {
      actors: [unknownActor('shooter', 'Opponent', 'opponent-1')],
    })
    const later = stat(2, 'basketball.assist', {
      relatedEventId: null,
      captureCommandId: null,
    }, { actors: [playerActor('assister', 'tracked-2', 'player-2')] })
    const result = project([start(), wrongSide, later])

    expect(result.inspection.complete).toBe(false)
    expect(result.inspection.diagnostics[0]?.message).toContain('wrong team side')
    expect(result.inspection.diagnostics[1]).toMatchObject({
      code: 'unprojected_event',
      eventId: later.id,
    })
  })

  it('matches the legacy reducer for an equivalent no-adjustment stat sequence', () => {
    const chartShot: ShotRecord = {
      id: id(1),
      x: 0,
      y: 8,
      made: true,
      shotType: '2pt',
      zone: 'paint',
      playerId: 'player-1',
      timestamp: Date.parse(at(1)),
    }
    let legacy: GameState = { ...state(), sportGameState: null }
    legacy = gameReducer(legacy, { type: 'ADD_SHOT', shot: chartShot })
    legacy = gameReducer(legacy, { type: 'INCREMENT_STAT', playerId: 'player-2', statId: 'ast' })
    legacy = gameReducer(legacy, {
      type: 'INCREMENT_STAT',
      playerId: TEAM_PLAYER_HOME_ID,
      statId: 'dreb',
    })
    legacy = gameReducer(legacy, { type: 'INCREMENT_STAT', playerId: 'player-2', statId: 'stl' })
    legacy = gameReducer(legacy, { type: 'INCREMENT_STAT', playerId: 'player-1', statId: 'blk' })
    legacy = gameReducer(legacy, { type: 'INCREMENT_STAT', playerId: 'player-2', statId: 'to' })

    const projected = project([
      start(),
      stat(1, 'basketball.shot', shotPayload(true, 2), {
        actors: [playerActor('shooter', 'tracked-1', 'player-1')],
        location: location(0, 8),
      }),
      stat(2, 'basketball.assist', {
        relatedEventId: null,
        captureCommandId: null,
      }, { actors: [playerActor('assister', 'tracked-2', 'player-2')] }),
      stat(3, 'basketball.rebound', {
        kind: 'defensive',
        relatedEventId: null,
        captureCommandId: null,
      }, { actors: [teamActor('rebounder')] }),
      stat(4, 'basketball.steal', {
        relatedEventId: null,
        captureCommandId: null,
      }, {
        actors: [
          playerActor('stealer', 'tracked-2', 'player-2'),
          unknownActor('turnover_by', 'Opponent ballhandler'),
        ],
      }),
      stat(5, 'basketball.block', {
        relatedEventId: null,
        captureCommandId: null,
      }, { actors: [playerActor('blocker', 'tracked-1', 'player-1')] }),
      stat(6, 'basketball.turnover', {
        kind: 'player',
        captureCommandId: null,
      }, { actors: [playerActor('committed_by', 'tracked-2', 'player-2')] }),
    ]).state

    for (const playerId of ['player-1', 'player-2', TEAM_PLAYER_HOME_ID]) {
      const legacyStats = legacy.players.find(player => player.id === playerId)?.stats ?? {}
      const projectedStats = projected.players.find(player => player.id === playerId)?.stats ?? {}
      for (const statId of ['2pt', 'ast', 'dreb', 'stl', 'blk', 'to']) {
        expect(projectedStats[statId] ?? 0).toBe(legacyStats[statId] ?? 0)
      }
    }
    expect(displayedHomeScore(projected)).toBe(displayedHomeScore(legacy))
    expect(projected.shotChart).toEqual([chartShot])
  })
})

function displayedHomeScore(gameState: GameState): number {
  if (!gameState.sport) throw new Error('Expected Basketball sport config.')
  return getDisplayedHomeScore(
    gameState.sport,
    gameState.players,
    gameState.homeTeamScore,
    gameState.homeScoreAdjustment
  )
}
