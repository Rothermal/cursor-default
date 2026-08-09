import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { gameReducer, createInitialState } from '../gameReducer'
import { initializeGameEventStream } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { GameEventRegistry } from '../gameEvents/registry'
import { GameEventProjectorRegistry } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type { GameEventActor, GameEventPeriod } from '../gameEvents/types'
import { isAggregateCloudSyncEligible } from '../gameSyncFingerprint'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  basketballAdministrativeEventDefinitions,
  createBasketballAdministrativeEvent,
  type BasketballAdministrativePayloadByType,
} from './administrativeEvents'
import { basketballEventDefinitions, createBasketballLifecycleEvent } from './events'
import { basketballGameEventProjector } from './projector'
import { createBasketballMatchRules, DEFAULT_BASKETBALL_RULES_SOURCE } from './rules'
import { createBasketballSportGameState } from './state'
import type {
  BasketballAdministrativeEvent,
  BasketballLifecycleEvent,
  BasketballMatchEvent,
  BasketballMatchParticipant,
  BasketballMatchSetup,
  BasketballSportGameState,
  BasketballTeamSide,
} from './types'

const registry = new GameEventRegistry(basketballEventDefinitions)
const adminRegistry = new GameEventRegistry(basketballAdministrativeEventDefinitions)
const projectors = new GameEventProjectorRegistry([basketballGameEventProjector])
const period: GameEventPeriod = { id: 'regulation-1', order: 1 }
const occurredAt = '2026-08-03T12:00:00.000Z'

function participant(
  id: string,
  playerId: string | null,
  teamSide: BasketballTeamSide
): BasketballMatchParticipant {
  return {
    id,
    playerId,
    displayName: id,
    number: null,
    teamSide,
    initialStatus: 'starter',
    position: null,
    captain: false,
  }
}

function setup(options: {
  foulLimit?: number
  clockModel?: 'none' | 'anchored'
  timeoutsPerPeriod?: number | null
} = {}): BasketballMatchSetup {
  const rules = createBasketballMatchRules()
  rules.personalFoulLimit = options.foulLimit ?? 5
  rules.clockModel = options.clockModel ?? 'none'
  rules.bonusThreshold = 2
  rules.doubleBonusThreshold = 3
  if ('timeoutsPerPeriod' in options) {
    rules.timeoutsPerPeriod = options.timeoutsPerPeriod ?? null
  }
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSource: structuredClone(DEFAULT_BASKETBALL_RULES_SOURCE),
    rulesSnapshot: rules,
    participants: [
      participant('tracked-1', 'player-1', 'tracked'),
      participant('tracked-2', 'player-2', 'tracked'),
      participant('opponent-1', 'opponent-player-1', 'opponent'),
    ],
  }
}

function players(): Player[] {
  return [
    { id: TEAM_PLAYER_HOME_ID, name: 'Tracked', number: '*', stats: {}, isTeamPlayer: true },
    { id: TEAM_PLAYER_OPP_ID, name: 'Opponent', number: '*', stats: {}, isTeamPlayer: true },
    { id: 'player-1', name: 'One', number: '1', stats: {} },
    { id: 'player-2', name: 'Two', number: '2', stats: {} },
    { id: 'opponent-player-1', name: 'Opponent', number: '3', stats: {} },
  ]
}

function state(matchSetup = setup()): GameState {
  return {
    ...createInitialState(),
    sport: sports.find(sport => sport.id === 'basketball')!,
    gameInfo: {
      teamName: 'Tracked',
      opponentName: 'Opponent',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-03',
    },
    players: players(),
    activePlayerId: 'player-1',
    sportGameState: createBasketballSportGameState(matchSetup),
  }
}

function id(sequence: number): string {
  return `80000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`
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

function admin<TType extends keyof BasketballAdministrativePayloadByType>(
  sequence: number,
  eventType: TType,
  payload: BasketballAdministrativePayloadByType[TType],
  options: {
    teamSide?: BasketballTeamSide | 'neutral'
    actors?: GameEventActor[]
  } = {}
): Extract<BasketballAdministrativeEvent, { eventType: TType }> {
  return createBasketballAdministrativeEvent({
    id: id(sequence),
    eventType,
    payload,
    recorderUserId: 'recorder-1',
    sequence,
    period,
    occurredAt: at(sequence),
    teamSide: options.teamSide ?? 'tracked',
    actors: options.actors ?? [],
  })
}

function playerActor(
  role: string,
  participantId: 'tracked-1' | 'tracked-2' | 'opponent-1',
  playerId: 'player-1' | 'player-2' | 'opponent-player-1'
): GameEventActor {
  return { role, kind: 'player', participantId, playerId }
}

function teamActor(role: string, label = 'Tracked'): GameEventActor {
  return { role, kind: 'team', label }
}

function staffActor(role: string, label = 'Coach'): GameEventActor {
  return { role, kind: 'staff', label }
}

function foulPayload(
  overrides: Partial<BasketballAdministrativePayloadByType['basketball.foul']> = {}
): BasketballAdministrativePayloadByType['basketball.foul'] {
  return {
    class: 'personal',
    context: 'common',
    teamControlSide: null,
    incidentId: null,
    countingOverride: null,
    captureCommandId: null,
    ...overrides,
  }
}

function project(events: BasketballMatchEvent[], matchSetup = setup()) {
  return rebuildGameEventProjection(
    { ...state(matchSetup), eventStream: { version: 1, events } },
    registry,
    projectors
  )
}

function basketballState(value: GameState['sportGameState']): BasketballSportGameState {
  if (value?.sportId !== 'basketball') throw new Error('Expected Basketball state.')
  return value
}

describe('BKE-1B3 Basketball administration', () => {
  it('strictly validates foul, ejection, timeout, and minutes event shapes', () => {
    const charged = admin(1, 'basketball.timeout', {
      kind: 'full',
      chargedSide: 'tracked',
      label: null,
      captureCommandId: null,
    }, { actors: [teamActor('team')] })
    expect(adminRegistry.inspect(charged).ok).toBe(true)
    expect(adminRegistry.inspect({ ...charged, teamSide: 'neutral' }).ok).toBe(false)

    const neutral = admin(2, 'basketball.timeout', {
      kind: 'official',
      chargedSide: null,
      label: 'Replay review',
      captureCommandId: null,
    }, { teamSide: 'neutral' })
    expect(adminRegistry.inspect(neutral).ok).toBe(true)
    expect(adminRegistry.inspect({ ...neutral, actors: [teamActor('team')] }).ok).toBe(false)

    const malformedFoul = admin(3, 'basketball.foul', foulPayload(), {
      actors: [staffActor('subject')],
    })
    expect(adminRegistry.inspect(malformedFoul).ok).toBe(false)

    const malformedMinutes = admin(4, 'basketball.minutes_adjustment', {
      deltaMinutes: 0,
      captureCommandId: null,
    }, { actors: [playerActor('player', 'tracked-1', 'player-1')] })
    expect(adminRegistry.inspect(malformedMinutes).ok).toBe(false)
  })

  it('derives personal/team fouls, technicals, bonus, and threshold disqualification', () => {
    const matchSetup = setup({ foulLimit: 2 })
    const result = project([
      start(),
      admin(1, 'basketball.foul', foulPayload(), {
        actors: [playerActor('committed_by', 'tracked-1', 'player-1')],
      }),
      admin(2, 'basketball.foul', foulPayload({ context: 'shooting' }), {
        actors: [
          playerActor('committed_by', 'tracked-1', 'player-1'),
          playerActor('drawn_by', 'opponent-1', 'opponent-player-1'),
        ],
      }),
      admin(3, 'basketball.foul', foulPayload({
        class: 'technical',
        context: 'administrative',
        incidentId: 'incident-1',
      }), { actors: [staffActor('committed_by')] }),
    ], matchSetup)
    const projection = basketballState(result.state.sportGameState).projection

    expect(result.inspection.complete).toBe(true)
    expect(projection.participants['tracked-1']).toMatchObject({
      disqualified: true,
      ejected: false,
      stats: expect.objectContaining({ pf: 2 }),
    })
    expect(projection.periodTeamFouls[period.id]).toEqual({ tracked: 3, opponent: 0 })
    expect(projection.bonusStatusByPeriod[period.id].tracked).toBe('double_bonus')
    expect(result.state.players.find(player => player.id === TEAM_PLAYER_HOME_ID)?.stats)
      .toMatchObject({ team_foul_p1: 3, team_tech: 1 })
  })

  it('honors reasoned counting overrides without creating a second counter authority', () => {
    const result = project([
      start(),
      admin(1, 'basketball.foul', foulPayload({
        class: 'technical',
        context: 'administrative',
        countingOverride: {
          personalFoul: false,
          teamFoul: false,
          technical: true,
          reason: 'Bench warning does not count toward team bonus',
        },
      }), { actors: [staffActor('committed_by')] }),
    ])
    const projection = basketballState(result.state.sportGameState).projection

    expect(result.inspection.complete).toBe(true)
    expect(projection.periodTeamFouls[period.id]).toBeUndefined()
    expect(projection.teamActorStats.tracked.team_tech).toBe(1)
    expect(projection.sideStats.tracked.pf).toBe(0)
  })

  it('separates charged timeout inventory from neutral administration', () => {
    const result = project([
      start(),
      admin(1, 'basketball.timeout', {
        kind: 'thirty_second',
        chargedSide: 'tracked',
        label: null,
        captureCommandId: null,
      }, { actors: [teamActor('team')] }),
      admin(2, 'basketball.timeout', {
        kind: 'media',
        chargedSide: null,
        label: 'Scheduled break',
        captureCommandId: null,
      }, { teamSide: 'neutral' }),
    ])
    const projection = basketballState(result.state.sportGameState).projection

    expect(result.inspection.complete).toBe(true)
    expect(projection.periodTimeouts[period.id]).toEqual({ tracked: 1, opponent: 0 })
    expect(projection.neutralTimeouts).toBe(1)
    expect(projection.teamActorStats.tracked.team_to_used_p1).toBe(1)
  })

  it('fails closed when a stream exceeds immutable charged-timeout inventory', () => {
    const matchSetup = setup({ timeoutsPerPeriod: 1 })
    const result = project([
      start(),
      admin(1, 'basketball.timeout', {
        kind: 'full',
        chargedSide: 'tracked',
        label: 'First timeout',
        captureCommandId: null,
      }, { actors: [teamActor('team')] }),
      admin(2, 'basketball.timeout', {
        kind: 'thirty_second',
        chargedSide: 'tracked',
        label: 'Over cap',
        captureCommandId: null,
      }, { actors: [teamActor('team')] }),
    ], matchSetup)

    expect(result.inspection.complete).toBe(false)
    expect(result.inspection.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'semantic_validation_failed',
        eventId: id(2),
        message: expect.stringContaining('inventory is exhausted'),
      }),
    ]))
  })

  it('sums signed manual minutes, rejects negative totals, and ignores them for anchored clocks', () => {
    const events = [
      start(),
      admin(1, 'basketball.minutes_adjustment', {
        deltaMinutes: 5,
        captureCommandId: null,
      }, { actors: [playerActor('player', 'tracked-1', 'player-1')] }),
      admin(2, 'basketball.minutes_adjustment', {
        deltaMinutes: -2,
        captureCommandId: null,
      }, { actors: [playerActor('player', 'tracked-1', 'player-1')] }),
    ] satisfies BasketballMatchEvent[]
    const result = project(events)
    expect(result.state.players.find(player => player.id === 'player-1')?.stats.min).toBe(3)

    const negative = project([
      ...events,
      admin(3, 'basketball.minutes_adjustment', {
        deltaMinutes: -4,
        captureCommandId: null,
      }, { actors: [playerActor('player', 'tracked-1', 'player-1')] }),
    ])
    expect(negative.inspection.complete).toBe(false)
    expect(negative.inspection.diagnostics[0]?.message).toContain('below zero')

    const anchored = project(events, setup({ clockModel: 'anchored' }))
    expect(anchored.state.players.find(player => player.id === 'player-1')?.stats.min ?? 0).toBe(0)
  })

  it('projects explicit player/staff ejections and downgrades stale foul links', () => {
    const matchSetup = setup({ foulLimit: 1 })
    const foul = admin(1, 'basketball.foul', foulPayload(), {
      actors: [playerActor('committed_by', 'tracked-1', 'player-1')],
    })
    const result = project([
      start(),
      foul,
      admin(2, 'basketball.ejection', {
        reason: 'Foul limit',
        source: 'automatic_threshold',
        relatedFoulEventId: foul.id,
        captureCommandId: null,
      }, { actors: [playerActor('subject', 'tracked-1', 'player-1')] }),
      admin(3, 'basketball.ejection', {
        reason: 'Official ruling',
        source: 'official_ruling',
        relatedFoulEventId: '80000000-0000-4000-8000-000000000099',
        captureCommandId: null,
      }, { actors: [staffActor('subject')] }),
    ], matchSetup)
    const projection = basketballState(result.state.sportGameState).projection

    expect(result.inspection.complete).toBe(true)
    expect(projection.participants['tracked-1']).toMatchObject({
      disqualified: true,
      ejected: true,
    })
    expect(projection.ejections).toHaveLength(2)
    expect(projection.relationshipWarnings).toHaveLength(1)
  })

  it('registers the complete Basketball runtime and stamps durable event authority', () => {
    expect(gameEventProjectors.get('basketball')).toBeDefined()
    expect(gameEventRegistry.inspect(start()).ok).toBe(true)

    const initialized = initializeGameEventStream(state(), gameEventRegistry, gameEventProjectors)
    expect(initialized.ok).toBe(true)
    expect(initialized.state).toMatchObject({
      gameDataAuthority: 'sport_events',
      eventStream: { version: 1, events: [] },
    })
    expect(isAggregateCloudSyncEligible(initialized.state)).toBe(false)
  })

  it('quarantines marked games with missing authority data and blocks aggregate mutation fallback', () => {
    const corrupt: GameState = {
      ...state(),
      gameDataAuthority: 'sport_events',
      eventStream: null,
      sportGameState: null,
    }
    const rebuilt = rebuildGameEventProjection(corrupt, gameEventRegistry, gameEventProjectors)
    expect(rebuilt.inspection.complete).toBe(false)
    expect(rebuilt.inspection.diagnostics.map(item => item.code)).toEqual([
      'missing_authoritative_data',
      'missing_authoritative_data',
    ])
    expect(isAggregateCloudSyncEligible(corrupt)).toBe(false)
    expect(gameReducer(corrupt, {
      type: 'INCREMENT_STAT',
      playerId: 'player-1',
      statId: 'ast',
    })).toBe(corrupt)
  })
})
