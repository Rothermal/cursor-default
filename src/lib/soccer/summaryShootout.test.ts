import { describe, expect, it } from 'vitest'
import type {
  GameEventActor,
  GameEventInspection,
} from '../gameEvents/types'
import { soccerSummaryShootoutReview } from './summaryShootout'
import type {
  SoccerMatchProjection,
  SoccerShootoutKickEvent,
  SoccerShootoutKickOutcome,
  SoccerShootoutProjection,
} from './types'

describe('soccer summary shootout review', () => {
  it('returns no review until a shootout actually starts', () => {
    expect(soccerSummaryShootoutReview(
      { shootout: null } as SoccerMatchProjection,
      inspection([])
    )).toBeNull()
  })

  it('pairs early-decision rounds and preserves a missing final-side attempt', () => {
    const kicks = [
      projected('t1', 'tracked', 1, 1, 'scored'),
      projected('o1', 'opponent', 1, 1, 'missed'),
      projected('t2', 'tracked', 2, 2, 'scored'),
    ]
    const review = soccerSummaryShootoutReview(
      projection(kicks, {
        initialKicksPerSide: 2,
        attempts: { tracked: 2, opponent: 1 },
        score: { tracked: 2, opponent: 0 },
        decided: true,
        winner: 'tracked',
      }),
      inspection(kicks.map(kick => kickEvent(kick)))
    )
    expect(review?.rounds).toHaveLength(2)
    expect(review?.rounds[1]).toMatchObject({
      label: 'Round 2',
      tracked: [{ eventId: 't2' }],
      opponent: [],
    })
  })

  it('keeps retakes beneath one official attempt without advancing counts', () => {
    const kicks = [
      projected('retake', 'tracked', 1, 1, 'retake', false),
      projected('scored', 'tracked', 1, 1, 'scored'),
      projected('opponent', 'opponent', 1, 1, 'forfeited'),
    ]
    const review = soccerSummaryShootoutReview(
      projection(kicks, {
        initialKicksPerSide: 1,
        attempts: { tracked: 1, opponent: 1 },
        score: { tracked: 1, opponent: 0 },
        decided: true,
        winner: 'tracked',
      }),
      inspection(kicks.map(kick => kickEvent(kick)))
    )
    expect(review?.rounds[0].tracked.map(item => item.outcomeLabel)).toEqual([
      'Retake - did not advance',
      'Scored',
    ])
    expect(review?.attempts).toEqual({ tracked: 1, opponent: 1 })
    expect(review?.kickers.find(item => item.teamSide === 'tracked')).toMatchObject({
      attempts: 1,
      scores: 1,
      retakes: 1,
    })
    expect(review?.kickers.find(item => item.teamSide === 'opponent')).toMatchObject({
      attempts: 1,
      forfeits: 1,
    })
  })

  it('labels sudden-death rounds from the official initial-series boundary', () => {
    const kicks = [
      projected('t6', 'tracked', 6, 6, 'scored', true, true),
      projected('o6', 'opponent', 6, 6, 'missed', true, true),
    ]
    const review = soccerSummaryShootoutReview(
      projection(kicks, {
        initialKicksPerSide: 5,
        attempts: { tracked: 6, opponent: 6 },
        score: { tracked: 5, opponent: 4 },
        suddenDeathRound: 1,
        decided: true,
        winner: 'tracked',
      }),
      inspection(kicks.map(kick => kickEvent(kick)))
    )
    expect(review?.rounds[0]).toMatchObject({
      label: 'Sudden Death 1',
      suddenDeath: true,
    })
  })

  it('keeps anonymous slots distinct and derives kicker and keeper summaries', () => {
    const kicks = [
      projected('o1', 'opponent', 1, 1, 'saved', true, false, 'anonymous:1'),
      projected('o2', 'opponent', 2, 2, 'woodwork', true, false, 'anonymous:2'),
      projected('t1', 'tracked', 1, 1, 'missed', true, false, 'participant:kicker'),
    ]
    const review = soccerSummaryShootoutReview(
      projection(kicks, {
        attempts: { tracked: 1, opponent: 2 },
        score: { tracked: 0, opponent: 0 },
      }),
      inspection([
        kickEvent(kicks[0], [
          unknownActor('kicker', 'Unknown'),
          participantActor('goalkeeper', 'keeper', 'Keeper'),
        ], 1),
        kickEvent(kicks[1], [
          unknownActor('kicker', 'Unknown'),
          participantActor('goalkeeper', 'keeper', 'Keeper'),
        ], 2),
        kickEvent(kicks[2], [
          participantActor('kicker', 'kicker', 'Kicker'),
          unknownActor('goalkeeper', 'Opponent Keeper'),
        ]),
      ])
    )
    expect(review?.kickers.filter(item => item.teamSide === 'opponent').map(item => item.label))
      .toEqual(['Opponent slot 1', 'Opponent slot 2'])
    expect(review?.goalkeepers.find(item => item.teamSide === 'tracked')).toMatchObject({
      label: '#1 Keeper',
      attemptsFaced: 2,
      saves: 1,
    })
    expect(review?.kickers.find(item => item.key === 'participant:kicker')).toMatchObject({
      label: '#9 Kicker',
      attempts: 1,
      misses: 1,
    })
  })

  it('derives review without changing normal score or participant totals', () => {
    const kick = projected('t1', 'tracked', 1, 1, 'scored')
    const match = projection([kick], {
      attempts: { tracked: 1, opponent: 0 },
      score: { tracked: 1, opponent: 0 },
    })
    match.sideTotals = {
      tracked: { score: 2 },
      opponent: { score: 2 },
    } as SoccerMatchProjection['sideTotals']
    match.participantStats = {
      kicker: { goals: 1, shots: 2 },
    } as unknown as SoccerMatchProjection['participantStats']
    const normalBefore = structuredClone({
      sideTotals: match.sideTotals,
      participantStats: match.participantStats,
    })

    expect(soccerSummaryShootoutReview(
      match,
      inspection([kickEvent(kick)])
    )?.score).toEqual({ tracked: 1, opponent: 0 })
    expect({
      sideTotals: match.sideTotals,
      participantStats: match.participantStats,
    }).toEqual(normalBefore)
  })
})

function projection(
  kicks: SoccerShootoutProjection['kicks'],
  overrides: Partial<SoccerShootoutProjection> = {}
): SoccerMatchProjection {
  return {
    status: 'shootout',
    endReason: null,
    participants: {
      keeper: {
        participantId: 'keeper',
        displayName: 'Keeper',
        number: '1',
      },
      kicker: {
        participantId: 'kicker',
        displayName: 'Kicker',
        number: '9',
      },
    },
    shootout: {
      firstKickingSide: 'tracked',
      initialKicksPerSide: 5,
      trackedEligibleParticipantIds: ['keeper', 'kicker'],
      trackedExcludedParticipantIds: [],
      opponentEligibleCount: 2,
      currentGoalkeepers: {
        tracked: 'participant:keeper',
        opponent: 'unknown:opponent keeper',
      },
      kicks,
      score: { tracked: 0, opponent: 0 },
      attempts: { tracked: 0, opponent: 0 },
      saves: { tracked: 0, opponent: 0 },
      cards: {
        trackedYellow: 0,
        trackedRed: 0,
        opponentYellow: 0,
        opponentRed: 0,
      },
      nextSide: 'tracked',
      decided: false,
      winner: null,
      suddenDeathRound: null,
      ...overrides,
    },
  } as unknown as SoccerMatchProjection
}

function projected(
  eventId: string,
  teamSide: 'tracked' | 'opponent',
  kickNumber: number,
  round: number,
  outcome: SoccerShootoutKickOutcome,
  advances = true,
  suddenDeath = false,
  kickerKey = teamSide === 'tracked' ? 'participant:kicker' : 'anonymous:1'
): SoccerShootoutProjection['kicks'][number] {
  return {
    eventId,
    teamSide,
    outcome,
    kickerKey,
    goalkeeperKey: teamSide === 'tracked'
      ? 'unknown:opponent keeper'
      : 'participant:keeper',
    kickNumber,
    round,
    suddenDeath,
    advances,
    scored: outcome === 'scored',
  }
}

function kickEvent(
  kick: SoccerShootoutProjection['kicks'][number],
  actors: GameEventActor[] = [
    kick.teamSide === 'tracked'
      ? participantActor('kicker', 'kicker', 'Kicker')
      : unknownActor('kicker', 'Unknown'),
    kick.teamSide === 'tracked'
      ? unknownActor('goalkeeper', 'Opponent Keeper')
      : participantActor('goalkeeper', 'keeper', 'Keeper'),
  ],
  anonymousKickerSlot: number | null = kick.kickerKey.startsWith('anonymous:')
    ? Number(kick.kickerKey.slice('anonymous:'.length))
    : null
): SoccerShootoutKickEvent {
  return {
    id: kick.eventId,
    sportId: 'soccer',
    eventType: 'soccer.shootout_kick',
    schemaVersion: 1,
    recorderUserId: 'recorder-1',
    sequence: kick.round * 2 + (kick.teamSide === 'tracked' ? 0 : 1),
    period: { id: 'shootout', order: 99 },
    elapsedMs: null,
    occurredAt: '2026-07-24T12:00:00.000Z',
    teamSide: kick.teamSide,
    location: null,
    actors,
    payload: { outcome: kick.outcome, anonymousKickerSlot },
    revision: 1,
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
    deletedAt: null,
  }
}

function participantActor(
  role: string,
  participantId: string,
  label: string
): GameEventActor {
  return {
    role,
    kind: 'player',
    playerId: `player-${participantId}`,
    participantId,
    label,
  }
}

function unknownActor(role: string, label: string): GameEventActor {
  return { role, kind: 'unknown', label }
}

function inspection(
  activeEvents: SoccerShootoutKickEvent[]
): GameEventInspection {
  return {
    complete: true,
    activeEvents,
    deletedEvents: [],
    diagnostics: [],
  }
}
