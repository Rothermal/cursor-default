import { describe, expect, it } from 'vitest'
import type { GameEvent, GameEventActor, GameEventPeriod, JsonObject } from '../gameEvents/types'
import {
  addGameEvents,
  initializeGameEventStream,
  updateGameEvent,
} from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createInitialState } from '../gameReducer'
import type { SportConfig } from '../../types'
import { createSoccerEvent, soccerEventDefinitions, type SoccerEventPayloadByType } from './events'
import {
  requireSoccerEventGameState,
  type SoccerEventGameState,
  type SoccerGameState,
} from './gameState'
import {
  endSoccerMatch,
  recordCheckedSoccerEvent,
  recordSoccerScoreAdjustment,
  recordSoccerShootoutKick,
  reopenSoccerMatch,
  reviseSoccerScoreAdjustment,
  startSoccerShootout,
} from './live'
import { resolveSoccerMatchRules, type SoccerMatchRulesOverride } from './rules'
import { createSoccerSportGameState, normalizeSoccerSportGameState } from './state'
import type { SoccerMatchParticipant, SoccerMatchSetup } from './types'

const soccer: SportConfig = {
  id: 'soccer',
  name: 'Soccer',
  icon: 'S',
  theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' },
  categories: [],
  scoreLabel: 'G',
}

const participants: SoccerMatchParticipant[] = [
  {
    id: 'match-keeper',
    kind: 'player',
    playerId: 'keeper',
    displayName: 'Keeper',
    number: '1',
    initialStatus: 'starter',
    initialRole: { group: 'goalkeeper', label: null },
  },
  {
    id: 'match-defender',
    kind: 'player',
    playerId: 'defender',
    displayName: 'Defender',
    number: '4',
    initialStatus: 'starter',
    initialRole: { group: 'defender', label: null },
  },
  {
    id: 'match-forward',
    kind: 'player',
    playerId: 'forward',
    displayName: 'Forward',
    number: '9',
    initialStatus: 'bench',
    initialRole: { group: 'forward', label: null },
  },
]

function setup(
  tieResolution: SoccerMatchSetup['rulesSnapshot']['tieResolution'] = 'draw_allowed',
  ruleOverrides: SoccerMatchRulesOverride = {}
):
SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSnapshot: resolveSoccerMatchRules({
      gameOverrides: {
        maxOnFieldPlayers: 2,
        tieResolution,
        shootoutInitialKicksPerSide: tieResolution === 'draw_allowed' ? 5 : 1,
        ...ruleOverrides,
      },
    }),
    participants: structuredClone(participants),
  }
}

function initializedState(
  tieResolution: SoccerMatchSetup['rulesSnapshot']['tieResolution'] = 'draw_allowed',
  ruleOverrides: SoccerMatchRulesOverride = {}
):
SoccerEventGameState {
  const state: SoccerGameState = {
    ...createInitialState(),
    sport: soccer,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-07-21',
    },
    players: [
      { id: 'keeper', name: 'Keeper', number: '1', stats: {} },
      { id: 'defender', name: 'Defender', number: '4', stats: {} },
      { id: 'forward', name: 'Forward', number: '9', stats: {} },
    ],
    sportGameState: createSoccerSportGameState(setup(tieResolution, ruleOverrides)),
  }
  const initialized = initializeGameEventStream(state, gameEventRegistry, gameEventProjectors)
  if (!initialized.ok) throw new Error(initialized.error.message)
  return requireSoccerEventGameState(initialized.state)
}

function event<TType extends keyof SoccerEventPayloadByType>(
  sequence: number,
  eventType: TType,
  payload: SoccerEventPayloadByType[TType],
  options: {
    elapsedMs?: number | null
    period?: GameEventPeriod
    teamSide?: 'tracked' | 'opponent'
    actors?: GameEventActor[]
  } = {}
): GameEvent<JsonObject, string, string> {
  return createSoccerEvent({
    id: `40000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    eventType,
    payload,
    recorderUserId: 'user-1',
    sequence,
    period: options.period ?? { id: 'regulation-1', order: 1 },
    elapsedMs: options.elapsedMs === undefined ? sequence * 500 : options.elapsedMs,
    occurredAt: new Date(Date.parse('2026-07-21T12:00:00.000Z') + sequence * 1_000).toISOString(),
    teamSide: options.teamSide,
    actors: options.actors,
  })
}

function participantActor(role: string, participantId: string, playerId: string): GameEventActor {
  return { role, kind: 'player', participantId, playerId }
}

function unknownActor(role: string, label: string): GameEventActor {
  return { role, kind: 'unknown', label }
}

function kickoffEvents(): GameEvent[] {
  return [
    event(0, 'soccer.opening_lineup', {
      starters: [
        { participantId: 'match-keeper', role: { group: 'goalkeeper', label: null } },
        { participantId: 'match-defender', role: { group: 'defender', label: null } },
      ],
    }, { elapsedMs: 0 }),
    event(1, 'soccer.period_started', { periodId: 'regulation-1' }, { elapsedMs: 0 }),
    event(2, 'soccer.clock_started', { anchorElapsedMs: 0 }, { elapsedMs: 0 }),
  ]
}

function completedRegulationEvents(): GameEvent[] {
  const first = { id: 'regulation-1', order: 1 }
  const second = { id: 'regulation-2', order: 2 }
  return [
    ...kickoffEvents(),
    event(3, 'soccer.clock_paused', { elapsedMs: 1_000 }, { elapsedMs: 1_000, period: first }),
    event(4, 'soccer.period_ended', { periodId: first.id }, { elapsedMs: 1_000, period: first }),
    event(5, 'soccer.period_started', { periodId: second.id }, { elapsedMs: 1_000, period: second }),
    event(6, 'soccer.clock_started', { anchorElapsedMs: 1_000 }, { elapsedMs: 1_000, period: second }),
    event(7, 'soccer.clock_paused', { elapsedMs: 2_000 }, { elapsedMs: 2_000, period: second }),
    event(8, 'soccer.period_ended', { periodId: second.id }, { elapsedMs: 2_000, period: second }),
  ]
}

function append(state: SoccerEventGameState, events: GameEvent[]): SoccerEventGameState {
  const result = addGameEvents(state, events, gameEventRegistry, gameEventProjectors)
  if (!result.ok) throw new Error(result.error.message)
  return requireSoccerEventGameState(result.state)
}

function activeShootoutState(): SoccerEventGameState {
  const regulation = append(initializedState('direct_to_shootout'), completedRegulationEvents())
  const started = startSoccerShootout(regulation, {
    firstKickingSide: 'tracked',
    trackedEligibleParticipantIds: ['match-keeper', 'match-defender'],
    trackedExcludedParticipantIds: [],
    opponentEligibleCount: 2,
    trackedGoalkeeperParticipantId: 'match-keeper',
    opponentGoalkeeperLabel: 'Unknown',
  }, {
    recorderUserId: 'user-1',
    nowMs: Date.parse('2026-07-21T12:03:00.000Z'),
    eventIds: ['50000000-0000-4000-8000-000000000020'],
  })
  if (!started.ok) throw new Error(started.message)
  return started.state
}

describe('SOC-4A rules, state, and schemas', () => {
  it('normalizes legacy v1 soccer state into resolved v2 rules and capture defaults', () => {
    const legacy = structuredClone(createSoccerSportGameState(setup())) as unknown as Record<string, unknown>
    legacy.version = 1
    const legacySetup = legacy.setup as Record<string, unknown>
    const legacyRules = legacySetup.rulesSnapshot as Record<string, unknown>
    delete legacyRules.yellowCardExitPolicy
    delete legacyRules.redCardReplacementPolicy
    delete legacyRules.tieResolution
    delete legacyRules.shootoutInitialKicksPerSide
    delete legacyRules.allowUnusedGoalkeeperShootoutReplacement
    legacyRules.extraTimeAvailable = true
    legacyRules.shootoutAvailable = true
    delete (legacy.capturePreferences as Record<string, unknown>).captureMode

    const normalized = normalizeSoccerSportGameState(legacy)

    expect(normalized?.version).toBe(2)
    expect(normalized?.setup.rulesSnapshot.tieResolution).toBe('extra_time_then_shootout')
    expect(normalized?.setup.rulesSnapshot.shootoutInitialKicksPerSide).toBe(5)
    expect(normalized?.setup.rulesSnapshot.yellowCardExitPolicy).toBe('stay_on')
    expect(normalized?.capturePreferences.captureMode).toBe('shot')
  })

  it('registers every SOC-4 schema and rejects malformed conditional payloads', () => {
    expect(soccerEventDefinitions).toHaveLength(25)
    const malformed = event(0, 'soccer.defensive_action', {
      action: 'interception',
      tackleOutcome: 'won',
    }, {
      actors: [participantActor('defender', 'match-defender', 'defender')],
    })
    const inspected = gameEventRegistry.inspect(malformed)
    expect(inspected.ok).toBe(false)
  })
})

describe('SOC-4A normal-match projection', () => {
  it('appends hidden SOC-4 events through the checked pure API', () => {
    const kickedOff = append(initializedState(), kickoffEvents())
    const result = recordCheckedSoccerEvent(kickedOff, {
      eventType: 'soccer.defensive_action',
      payload: { action: 'interception', tackleOutcome: null },
      actors: [participantActor('defender', 'match-defender', 'defender')],
    }, {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-21T12:00:03.000Z'),
      eventIds: ['50000000-0000-4000-8000-000000000001'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.sportGameState!.projection.participantStats['match-defender'].interceptions)
      .toBe(1)
  })

  it('derives defensive, foul, discipline, team, penalty, and linked-block totals', () => {
    const foulId = '40000000-0000-4000-8000-000000000005'
    const events = [
      ...kickoffEvents(),
      event(3, 'soccer.defensive_action', { action: 'tackle', tackleOutcome: 'won' }, {
        elapsedMs: 500,
        actors: [participantActor('defender', 'match-defender', 'defender')],
      }),
      event(4, 'soccer.foul', {
        restart: 'penalty',
        sanction: 'none',
        sanctionReason: null,
        note: null,
        lineupResolution: null,
      }, {
        elapsedMs: 1_000,
        teamSide: 'opponent',
        actors: [
          unknownActor('committed_by', 'Opponent 6'),
          participantActor('fouled', 'match-defender', 'defender'),
        ],
      }),
      event(5, 'soccer.card', {
        sanction: 'yellow',
        reason: 'unsporting_behavior',
        note: null,
        lineupResolution: {
          cardedParticipantId: 'match-defender',
          exit: 'none',
          replacementChanges: [],
          countsAsSubstitutionWindow: false,
        },
      }, {
        elapsedMs: 1_500,
        actors: [participantActor('recipient', 'match-defender', 'defender')],
      }),
      event(6, 'soccer.team_event', { kind: 'corner' }, {
        elapsedMs: 2_000,
      }),
      event(7, 'soccer.shot', {
        outcome: 'blocked',
        situation: 'penalty',
        sourceEventId: foulId,
      }, {
        elapsedMs: 2_500,
        actors: [
          participantActor('shooter', 'match-defender', 'defender'),
          unknownActor('blocker', 'Opponent block'),
        ],
      }),
    ]

    const state = append(initializedState(), events)
    const projection = state.sportGameState!.projection
    const defender = projection.participantStats['match-defender']

    expect(defender.tacklesAttempted).toBe(1)
    expect(defender.tacklesWon).toBe(1)
    expect(defender.foulsDrawn).toBe(1)
    expect(defender.yellowCards).toBe(1)
    expect(projection.sideTotals.tracked).toMatchObject({
      tacklesAttempted: 1,
      tacklesWon: 1,
      foulsDrawn: 1,
      penaltiesWon: 1,
      yellowCards: 1,
      corners: 1,
    })
    expect(projection.sideTotals.opponent).toMatchObject({
      foulsCommitted: 1,
      penaltiesConceded: 1,
      blockedShots: 1,
    })
  })

  it('derives second-yellow red and applies the atomic tracked-player ejection', () => {
    const state = append(initializedState(), [
      ...kickoffEvents(),
      event(3, 'soccer.card', {
        sanction: 'yellow',
        reason: 'dissent',
        note: null,
        lineupResolution: {
          cardedParticipantId: 'match-defender',
          exit: 'none',
          replacementChanges: [],
          countsAsSubstitutionWindow: false,
        },
      }, {
        elapsedMs: 500,
        actors: [participantActor('recipient', 'match-defender', 'defender')],
      }),
      event(4, 'soccer.card', {
        sanction: 'second_yellow_red',
        reason: 'second_caution',
        note: null,
        lineupResolution: {
          cardedParticipantId: 'match-defender',
          exit: 'ejected',
          replacementChanges: [],
          countsAsSubstitutionWindow: false,
        },
      }, {
        elapsedMs: 1_000,
        actors: [participantActor('recipient', 'match-defender', 'defender')],
      }),
    ])

    const projection = state.sportGameState!.projection
    expect(projection.participantStats['match-defender']).toMatchObject({
      yellowCards: 2,
      redCards: 1,
    })
    expect(projection.participants['match-defender'].status).toBe('left')
    expect(projection.participantDiscipline['match-defender'].ejected).toBe(true)
  })

  it('preserves a revised historical ejection and diagnoses later dependent activity', () => {
    const card = event(4, 'soccer.card', {
      sanction: 'straight_red',
      reason: 'serious_foul_play',
      note: null,
      lineupResolution: {
        cardedParticipantId: 'match-defender',
        exit: 'ejected',
        replacementChanges: [],
        countsAsSubstitutionWindow: false,
      },
    }, {
      elapsedMs: 1_500,
      actors: [participantActor('recipient', 'match-defender', 'defender')],
    })
    const valid = append(initializedState(), [
      ...kickoffEvents(),
      event(3, 'soccer.shot', { outcome: 'off_target', situation: 'open_play' }, {
        elapsedMs: 500,
        actors: [participantActor('shooter', 'match-defender', 'defender')],
      }),
      card,
    ])

    const revised = updateGameEvent(
      valid,
      card.id,
      { elapsedMs: 250 },
      '2026-07-21T13:00:00.000Z',
      gameEventRegistry,
      gameEventProjectors
    )

    expect(revised.ok).toBe(true)
    if (!revised.ok) return
    expect(revised.inspection.complete).toBe(false)
    expect(revised.inspection.diagnostics.some(item =>
      item.message.includes('depends on the carded participant')
    )).toBe(true)
  })

  it('rejects a shot whose optional restart source does not exist', () => {
    const result = addGameEvents(initializedState(), [
      ...kickoffEvents(),
      event(3, 'soccer.shot', {
        outcome: 'off_target',
        situation: 'corner_sequence',
        sourceEventId: 'missing-event',
      }, {
        elapsedMs: 500,
        actors: [participantActor('shooter', 'match-defender', 'defender')],
      }),
    ], gameEventRegistry, gameEventProjectors)

    expect(result.ok).toBe(false)
  })

  it('projects every defensive action and keeps Team or Unknown credit side-only', () => {
    const state = append(initializedState(), [
      ...kickoffEvents(),
      event(3, 'soccer.defensive_action', { action: 'interception', tackleOutcome: null }, {
        elapsedMs: 250,
        actors: [participantActor('defender', 'match-defender', 'defender')],
      }),
      event(4, 'soccer.defensive_action', { action: 'clearance', tackleOutcome: null }, {
        elapsedMs: 500,
        actors: [{ role: 'defender', kind: 'team', label: 'Aces' }],
      }),
      event(5, 'soccer.defensive_action', { action: 'recovery', tackleOutcome: null }, {
        elapsedMs: 750,
        actors: [unknownActor('defender', 'Unknown defender')],
      }),
      event(6, 'soccer.team_event', { kind: 'offside' }, {
        elapsedMs: 1_000,
        teamSide: 'opponent',
        actors: [unknownActor('offside_player', 'Opponent 9')],
      }),
    ])

    const projection = state.sportGameState!.projection
    expect(projection.participantStats['match-defender'].interceptions).toBe(1)
    expect(projection.sideTotals.tracked).toMatchObject({
      interceptions: 1,
      clearances: 1,
      recoveries: 1,
      teamAttributedDefensiveActions: 1,
      unknownAttributedDefensiveActions: 1,
    })
    expect(projection.sideTotals.opponent.offsides).toBe(1)
  })

  it('applies a must-leave yellow with an atomic entry-only replacement', () => {
    const state = append(initializedState('draw_allowed', {
      yellowCardExitPolicy: 'must_leave_may_replace',
      allowReturnSubstitutions: true,
    }), [
      ...kickoffEvents(),
      event(3, 'soccer.card', {
        sanction: 'yellow',
        reason: 'persistent_offenses',
        note: null,
        lineupResolution: {
          cardedParticipantId: 'match-defender',
          exit: 'temporary',
          replacementChanges: [{
            playerOutParticipantId: null,
            playerInParticipantId: 'match-forward',
            playerInRole: { group: 'forward', label: null },
          }],
          countsAsSubstitutionWindow: true,
        },
      }, {
        elapsedMs: 500,
        actors: [participantActor('recipient', 'match-defender', 'defender')],
      }),
    ])

    const projection = state.sportGameState!.projection
    expect(projection.participants['match-defender'].status).toBe('left')
    expect(projection.participants['match-forward'].status).toBe('on_field')
    expect(projection.substitutionCount).toBe(1)
    expect(projection.substitutionWindowCount).toBe(1)
  })

  it('requires a goalkeeper red-card handoff to preserve one goalkeeper and play short', () => {
    const state = append(initializedState(), [
      ...kickoffEvents(),
      event(3, 'soccer.card', {
        sanction: 'straight_red',
        reason: 'dogso',
        note: null,
        lineupResolution: {
          cardedParticipantId: 'match-keeper',
          exit: 'ejected',
          replacementChanges: [{
            playerOutParticipantId: 'match-defender',
            playerInParticipantId: 'match-forward',
            playerInRole: { group: 'goalkeeper', label: null },
          }],
          countsAsSubstitutionWindow: true,
        },
      }, {
        elapsedMs: 500,
        actors: [participantActor('recipient', 'match-keeper', 'keeper')],
      }),
    ])

    const projection = state.sportGameState!.projection
    expect(Object.values(projection.participants).filter(item => item.status === 'on_field')).toHaveLength(1)
    expect(projection.participants['match-forward']).toMatchObject({
      status: 'on_field',
      role: { group: 'goalkeeper', label: null },
    })
  })

  it('preserves a mid-period ejection when the period later ends', () => {
    const state = append(initializedState(), [
      ...kickoffEvents(),
      event(3, 'soccer.card', {
        sanction: 'straight_red',
        reason: 'serious_foul_play',
        note: null,
        lineupResolution: {
          cardedParticipantId: 'match-defender',
          exit: 'ejected',
          replacementChanges: [],
          countsAsSubstitutionWindow: false,
        },
      }, {
        elapsedMs: 500,
        actors: [participantActor('recipient', 'match-defender', 'defender')],
      }),
      event(4, 'soccer.clock_paused', { elapsedMs: 1_000 }, { elapsedMs: 1_000 }),
      event(5, 'soccer.period_ended', { periodId: 'regulation-1' }, { elapsedMs: 1_000 }),
    ])

    const projection = state.sportGameState!.projection
    expect(projection.status).toBe('period_break')
    expect(projection.participants['match-defender'].onFieldIntervals).toEqual([{
      periodId: 'regulation-1',
      startElapsedMs: 0,
      endElapsedMs: 500,
    }])
    expect(projection.participants['match-defender'].totalActiveMs).toBe(500)
    expect(projection.participants['match-defender'].activeSinceElapsedMs).toBeNull()
    expect(projection.participantDiscipline['match-defender'].ejected).toBe(true)
  })

  it('preserves incident and discipline history through suspend and resume', () => {
    const state = append(initializedState(), [
      ...kickoffEvents(),
      event(3, 'soccer.defensive_action', { action: 'interception', tackleOutcome: null }, {
        elapsedMs: 250,
        actors: [participantActor('defender', 'match-defender', 'defender')],
      }),
      event(4, 'soccer.card', {
        sanction: 'straight_red',
        reason: 'serious_foul_play',
        note: null,
        lineupResolution: {
          cardedParticipantId: 'match-defender',
          exit: 'ejected',
          replacementChanges: [],
          countsAsSubstitutionWindow: false,
        },
      }, {
        elapsedMs: 500,
        actors: [participantActor('recipient', 'match-defender', 'defender')],
      }),
      event(5, 'soccer.clock_paused', { elapsedMs: 1_000 }, { elapsedMs: 1_000 }),
      event(6, 'soccer.match_ended', { reason: 'suspended' }, { elapsedMs: 1_000 }),
      event(7, 'soccer.match_reopened', { reason: 'Match resumed' }, { elapsedMs: 1_000 }),
    ])

    const projection = state.sportGameState!.projection
    expect(projection.status).toBe('in_progress')
    expect(projection.participantStats['match-defender'].interceptions).toBe(1)
    expect(projection.participantDiscipline['match-defender'].ejected).toBe(true)
    expect(projection.participants['match-defender'].status).toBe('left')
    expect(projection.participants['match-defender'].onFieldIntervals).toEqual([{
      periodId: 'regulation-1',
      startElapsedMs: 0,
      endElapsedMs: 500,
    }])
  })

  it('rejects an offside actor on a corner during schema inspection', () => {
    const corner = event(3, 'soccer.team_event', { kind: 'corner' }, {
      elapsedMs: 500,
      actors: [unknownActor('offside_player', 'Unknown player')],
    })

    expect(gameEventRegistry.inspect(corner).ok).toBe(false)
  })

  it('rebuilds the same projection when raw events arrive in a different array order', () => {
    const events = [
      ...kickoffEvents(),
      event(3, 'soccer.defensive_action', { action: 'recovery', tackleOutcome: null }, {
        elapsedMs: 250,
        actors: [participantActor('defender', 'match-defender', 'defender')],
      }),
      event(4, 'soccer.team_event', { kind: 'corner' }, { elapsedMs: 500 }),
    ]
    const ordered = append(initializedState(), events)
    const reversed = append(initializedState(), [...events].reverse())

    expect(reversed.sportGameState?.projection).toEqual(ordered.sportGameState?.projection)
  })
})

describe('SOC-4A shootout projection', () => {
  it('keeps shootout score separate and derives a structured winner', () => {
    const first = { id: 'regulation-1', order: 1 }
    const second = { id: 'regulation-2', order: 2 }
    const shootout = { id: 'shootout', order: 3 }
    const state = append(initializedState('direct_to_shootout'), [
      ...kickoffEvents(),
      event(3, 'soccer.clock_paused', { elapsedMs: 1_000 }, { elapsedMs: 1_000, period: first }),
      event(4, 'soccer.period_ended', { periodId: first.id }, { elapsedMs: 1_000, period: first }),
      event(5, 'soccer.period_started', { periodId: second.id }, { elapsedMs: 1_000, period: second }),
      event(6, 'soccer.clock_started', { anchorElapsedMs: 1_000 }, { elapsedMs: 1_000, period: second }),
      event(7, 'soccer.clock_paused', { elapsedMs: 2_000 }, { elapsedMs: 2_000, period: second }),
      event(8, 'soccer.period_ended', { periodId: second.id }, { elapsedMs: 2_000, period: second }),
      event(9, 'soccer.shootout_started', {
        firstKickingSide: 'tracked',
        initialKicksPerSide: 1,
        trackedEligibleParticipantIds: ['match-keeper', 'match-defender'],
        trackedExcludedParticipantIds: [],
        opponentEligibleCount: 2,
        trackedGoalkeeperParticipantId: 'match-keeper',
      }, { elapsedMs: null, period: shootout }),
      event(10, 'soccer.shootout_kick', {
        outcome: 'scored',
        anonymousKickerSlot: null,
      }, {
        elapsedMs: null,
        period: shootout,
        actors: [
          participantActor('kicker', 'match-defender', 'defender'),
          unknownActor('goalkeeper', 'Unknown'),
        ],
      }),
      event(11, 'soccer.shootout_kick', {
        outcome: 'missed',
        anonymousKickerSlot: 1,
      }, {
        elapsedMs: null,
        period: shootout,
        teamSide: 'opponent',
        actors: [
          unknownActor('kicker', 'Unknown'),
          participantActor('goalkeeper', 'match-keeper', 'keeper'),
        ],
      }),
      event(12, 'soccer.match_ended', { reason: 'completed' }, {
        elapsedMs: null,
        period: shootout,
      }),
    ])

    const projection = state.sportGameState!.projection
    expect(projection.sideTotals.tracked.score).toBe(0)
    expect(projection.sideTotals.opponent.score).toBe(0)
    expect(projection.shootout?.score).toEqual({ tracked: 1, opponent: 0 })
    expect(projection.shootout?.decided).toBe(true)
    expect(projection.result).toBe('tracked_win')
    expect(projection.decidedStage).toBe('shootout')
    expect(projection.status).toBe('ended')
  })

  it('keeps a retake in the same slot and treats a forfeit as a counted miss', () => {
    const shootout = { id: 'shootout', order: 3 }
    const state = append(initializedState('direct_to_shootout'), [
      ...completedRegulationEvents(),
      event(9, 'soccer.shootout_started', {
        firstKickingSide: 'tracked',
        initialKicksPerSide: 1,
        trackedEligibleParticipantIds: ['match-keeper', 'match-defender'],
        trackedExcludedParticipantIds: [],
        opponentEligibleCount: 2,
        trackedGoalkeeperParticipantId: 'match-keeper',
      }, { elapsedMs: null, period: shootout }),
      event(10, 'soccer.shootout_kick', { outcome: 'retake', anonymousKickerSlot: null }, {
        elapsedMs: null,
        period: shootout,
        actors: [
          participantActor('kicker', 'match-defender', 'defender'),
          unknownActor('goalkeeper', 'Unknown'),
        ],
      }),
      event(11, 'soccer.shootout_kick', { outcome: 'scored', anonymousKickerSlot: null }, {
        elapsedMs: null,
        period: shootout,
        actors: [
          participantActor('kicker', 'match-defender', 'defender'),
          unknownActor('goalkeeper', 'Unknown'),
        ],
      }),
      event(12, 'soccer.shootout_kick', { outcome: 'forfeited', anonymousKickerSlot: 1 }, {
        elapsedMs: null,
        period: shootout,
        teamSide: 'opponent',
        actors: [
          unknownActor('kicker', 'Unknown'),
          participantActor('goalkeeper', 'match-keeper', 'keeper'),
        ],
      }),
    ])

    expect(state.sportGameState!.projection.shootout).toMatchObject({
      attempts: { tracked: 1, opponent: 1 },
      score: { tracked: 1, opponent: 0 },
      decided: true,
    })
    expect(state.sportGameState!.projection.shootout?.kicks.map(kick => kick.advances)).toEqual([
      false,
      true,
      true,
    ])
  })

  it('rejects a repeated kicker before every eligible slot has kicked', () => {
    const shootout = { id: 'shootout', order: 3 }
    const result = addGameEvents(initializedState('direct_to_shootout', {
      shootoutInitialKicksPerSide: 2,
    }), [
      ...completedRegulationEvents(),
      event(9, 'soccer.shootout_started', {
        firstKickingSide: 'tracked',
        initialKicksPerSide: 2,
        trackedEligibleParticipantIds: ['match-keeper', 'match-defender'],
        trackedExcludedParticipantIds: [],
        opponentEligibleCount: 2,
        trackedGoalkeeperParticipantId: 'match-keeper',
      }, { elapsedMs: null, period: shootout }),
      event(10, 'soccer.shootout_kick', { outcome: 'scored', anonymousKickerSlot: null }, {
        elapsedMs: null,
        period: shootout,
        actors: [
          participantActor('kicker', 'match-defender', 'defender'),
          unknownActor('goalkeeper', 'Unknown'),
        ],
      }),
      event(11, 'soccer.shootout_kick', { outcome: 'scored', anonymousKickerSlot: 1 }, {
        elapsedMs: null,
        period: shootout,
        teamSide: 'opponent',
        actors: [
          unknownActor('kicker', 'Unknown'),
          participantActor('goalkeeper', 'match-keeper', 'keeper'),
        ],
      }),
      event(12, 'soccer.shootout_kick', { outcome: 'scored', anonymousKickerSlot: null }, {
        elapsedMs: null,
        period: shootout,
        actors: [
          participantActor('kicker', 'match-defender', 'defender'),
          unknownActor('goalkeeper', 'Unknown'),
        ],
      }),
    ], gameEventRegistry, gameEventProjectors)

    expect(result.ok).toBe(false)
  })

  it('requires a sent-off shootout goalkeeper to be replaced before the next kick', () => {
    const shootout = { id: 'shootout', order: 3 }
    const result = addGameEvents(initializedState('direct_to_shootout'), [
      ...completedRegulationEvents(),
      event(9, 'soccer.shootout_started', {
        firstKickingSide: 'opponent',
        initialKicksPerSide: 1,
        trackedEligibleParticipantIds: ['match-keeper', 'match-defender'],
        trackedExcludedParticipantIds: [],
        opponentEligibleCount: 2,
        trackedGoalkeeperParticipantId: 'match-keeper',
      }, { elapsedMs: null, period: shootout }),
      event(10, 'soccer.card', {
        sanction: 'straight_red',
        reason: 'other_not_recorded',
        note: null,
        lineupResolution: null,
      }, {
        elapsedMs: null,
        period: shootout,
        actors: [participantActor('recipient', 'match-keeper', 'keeper')],
      }),
      event(11, 'soccer.shootout_eligibility_changed', {
        reason: 'sent_off',
        trackedEligibleParticipantIds: ['match-defender'],
        trackedExcludedParticipantIds: ['match-keeper'],
        opponentEligibleCount: 1,
      }, { elapsedMs: null, period: shootout }),
      event(12, 'soccer.shootout_kick', { outcome: 'missed', anonymousKickerSlot: 1 }, {
        elapsedMs: null,
        period: shootout,
        teamSide: 'opponent',
        actors: [
          unknownActor('kicker', 'Unknown'),
          participantActor('goalkeeper', 'match-keeper', 'keeper'),
        ],
      }),
    ], gameEventRegistry, gameEventProjectors)

    expect(result).toMatchObject({ ok: false, error: { code: 'incomplete_projection' } })
  })

  it('runs the checked shootout lifecycle through a completed result', () => {
    const regulation = append(initializedState('direct_to_shootout'), completedRegulationEvents())
    const started = startSoccerShootout(regulation, {
      firstKickingSide: 'tracked',
      trackedEligibleParticipantIds: ['match-keeper', 'match-defender'],
      trackedExcludedParticipantIds: [],
      opponentEligibleCount: 2,
      trackedGoalkeeperParticipantId: 'match-keeper',
      opponentGoalkeeperLabel: 'Unknown',
    }, {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-21T12:03:00.000Z'),
      eventIds: ['50000000-0000-4000-8000-000000000010'],
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const trackedKick = recordSoccerShootoutKick(started.state, {
      outcome: 'scored',
      kicker: { kind: 'participant', participantId: 'match-defender' },
      goalkeeper: { kind: 'unknown', label: 'Unknown' },
      anonymousKickerSlot: null,
    }, {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-21T12:03:10.000Z'),
      eventIds: ['50000000-0000-4000-8000-000000000011'],
    })
    expect(trackedKick.ok).toBe(true)
    if (!trackedKick.ok) return

    const opponentKick = recordSoccerShootoutKick(trackedKick.state, {
      outcome: 'missed',
      kicker: { kind: 'unknown', label: 'Unknown' },
      goalkeeper: { kind: 'participant', participantId: 'match-keeper' },
      anonymousKickerSlot: 1,
    }, {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-21T12:03:20.000Z'),
      eventIds: ['50000000-0000-4000-8000-000000000012'],
    })
    expect(opponentKick.ok).toBe(true)
    if (!opponentKick.ok) return
    expect(opponentKick.state.sportGameState?.projection.shootout).toMatchObject({
      score: { tracked: 1, opponent: 0 },
      decided: true,
      winner: 'tracked',
    })

    const completed = endSoccerMatch(opponentKick.state, 'completed', {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-21T12:03:30.000Z'),
      eventIds: ['50000000-0000-4000-8000-000000000013'],
    })
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.sportGameState?.projection).toMatchObject({
      status: 'ended',
      result: 'tracked_win',
      decidedStage: 'shootout',
    })
  })

  it('reopens an abandoned undecided shootout into its existing workspace', () => {
    const abandoned = endSoccerMatch(activeShootoutState(), 'abandoned', {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-21T12:03:10.000Z'),
      eventIds: ['50000000-0000-4000-8000-000000000021'],
    })
    expect(abandoned.ok).toBe(true)
    if (!abandoned.ok) return

    const reopened = reopenSoccerMatch(abandoned.state, 'Resume shootout', {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-21T12:03:20.000Z'),
      eventIds: ['50000000-0000-4000-8000-000000000022'],
    })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.state.sportGameState?.projection).toMatchObject({
      status: 'shootout',
      endReason: null,
      shootout: { decided: false, nextSide: 'tracked' },
    })
  })

  it('blocks normal score adjustments and out-of-range anonymous slots after shootout starts', () => {
    const state = activeShootoutState()
    const adjusted = recordSoccerScoreAdjustment(state, {
      teamSide: 'tracked',
      delta: 1,
      reason: 'Late normal-score correction',
    }, {
      period: { id: 'regulation-2', order: 2 },
      elapsedMs: 2_000,
    }, {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-21T12:03:10.000Z'),
      eventIds: ['50000000-0000-4000-8000-000000000023'],
    })
    expect(adjusted).toMatchObject({
      ok: false,
      message: 'Remove the shootout events before correcting the normal match score.',
    })
    expect(reviseSoccerScoreAdjustment(state, '50000000-0000-4000-8000-000000000099', {
      teamSide: 'tracked',
      delta: -1,
      reason: 'Revised correction',
    }, {
      period: { id: 'regulation-2', order: 2 },
      elapsedMs: 2_000,
    })).toMatchObject({
      ok: false,
      message: 'Remove the shootout events before correcting the normal match score.',
    })

    const invalidSlot = recordSoccerShootoutKick(state, {
      outcome: 'scored',
      kicker: { kind: 'unknown', label: 'Unknown' },
      goalkeeper: { kind: 'unknown', label: 'Unknown' },
      anonymousKickerSlot: 3,
    }, {
      recorderUserId: 'user-1',
      nowMs: Date.parse('2026-07-21T12:03:10.000Z'),
      eventIds: ['50000000-0000-4000-8000-000000000024'],
    })
    expect(invalidSlot.ok).toBe(false)
    expect(invalidSlot.state.eventStream?.events).toHaveLength(state.eventStream!.events.length)
  })

  it('completes a tied draw-allowed match without entering a shootout', () => {
    const state = append(initializedState(), [
      ...completedRegulationEvents(),
      event(9, 'soccer.match_ended', { reason: 'completed' }, {
        elapsedMs: 2_000,
        period: { id: 'regulation-2', order: 2 },
      }),
    ])

    expect(state.sportGameState!.projection).toMatchObject({
      status: 'ended',
      endReason: 'completed',
      result: 'draw',
      decidedStage: 'regulation',
      shootout: null,
    })
  })
})
