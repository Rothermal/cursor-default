import { describe, expect, it } from 'vitest'
import { resolveSoccerMatchRules } from './rules'
import {
  soccerLifecycleAction,
  soccerNextAnonymousKickerSlot,
  soccerShootoutPendingRetake,
  soccerShootoutSetupDefaults,
  soccerShootoutUsedKickerKeys,
} from './shootout'
import type { SoccerMatchProjection, SoccerShootoutProjection } from './types'

describe('soccer shootout helpers', () => {
  it('offers only the valid next lifecycle action', () => {
    expect(soccerLifecycleAction(projection()).kind).toBe('start_period')

    const direct = projection({
      completedPeriodIds: ['regulation-1', 'regulation-2'],
      startedPeriodIds: ['regulation-1', 'regulation-2'],
      tieResolution: 'direct_to_shootout',
    })
    expect(soccerLifecycleAction(direct)).toEqual({ kind: 'start_shootout' })

    const draw = projection({
      completedPeriodIds: ['regulation-1', 'regulation-2'],
      startedPeriodIds: ['regulation-1', 'regulation-2'],
    })
    expect(soccerLifecycleAction(draw)).toEqual({ kind: 'complete', label: 'Complete Draw' })

    const winner = projection({
      completedPeriodIds: ['regulation-1', 'regulation-2'],
      startedPeriodIds: ['regulation-1', 'regulation-2'],
      trackedScore: 2,
      opponentScore: 1,
      tieResolution: 'extra_time_then_shootout',
    })
    expect(soccerLifecycleAction(winner)).toEqual({ kind: 'complete', label: 'Complete Match' })
  })

  it('finishes begun extra time before allowing completion or a shootout', () => {
    const state = projection({
      completedPeriodIds: ['regulation-1', 'regulation-2', 'extra-time-1'],
      startedPeriodIds: ['regulation-1', 'regulation-2', 'extra-time-1'],
      trackedScore: 2,
      opponentScore: 1,
      tieResolution: 'extra_time_then_shootout',
    })
    expect(soccerLifecycleAction(state)).toMatchObject({
      kind: 'start_period',
      segment: { id: 'extra-time-2' },
    })
  })

  it('builds setup defaults from the final on-field participants', () => {
    const state = projection()
    state.participants = {
      keeper: participant('keeper', 'goalkeeper', 'on_field'),
      defender: participant('defender', 'defender', 'on_field'),
      bench: participant('bench', 'forward', 'bench'),
    }
    expect(soccerShootoutSetupDefaults(state)).toEqual({
      trackedEligibleParticipantIds: ['keeper', 'defender'],
      trackedExcludedParticipantIds: [],
      opponentEligibleCount: 2,
      trackedGoalkeeperParticipantId: 'keeper',
    })
  })

  it('tracks kicker cycles, retakes, and anonymous slots separately', () => {
    const shootout = shootoutProjection()
    shootout.kicks = [
      kick('tracked', 'participant:one', true, 'scored'),
      kick('opponent', 'anonymous:1', true, 'missed'),
      kick('tracked', 'participant:two', false, 'retake'),
    ]
    expect([...soccerShootoutUsedKickerKeys(shootout, 'tracked')]).toEqual(['participant:one'])
    expect(soccerNextAnonymousKickerSlot(shootout, 'opponent')).toBe(2)
    expect(soccerNextAnonymousKickerSlot(shootout, 'tracked')).toBe(1)
    expect(soccerShootoutPendingRetake(shootout)?.kickerKey).toBe('participant:two')
  })
})

function projection(options: {
  completedPeriodIds?: string[]
  startedPeriodIds?: string[]
  trackedScore?: number
  opponentScore?: number
  tieResolution?: 'draw_allowed' | 'extra_time_then_shootout' | 'direct_to_shootout'
} = {}): SoccerMatchProjection {
  const rules = resolveSoccerMatchRules()
  rules.tieResolution = options.tieResolution ?? 'draw_allowed'
  rules.extraTimeAvailable = rules.tieResolution === 'extra_time_then_shootout'
  rules.shootoutAvailable = rules.tieResolution !== 'draw_allowed'
  return {
    status: 'period_break',
    currentRules: rules,
    completedPeriodIds: options.completedPeriodIds ?? [],
    startedPeriodIds: options.startedPeriodIds ?? [],
    sideTotals: {
      tracked: { score: options.trackedScore ?? 0 },
      opponent: { score: options.opponentScore ?? 0 },
    },
    participants: {},
    shootout: null,
  } as unknown as SoccerMatchProjection
}

function participant(id: string, group: 'goalkeeper' | 'defender' | 'forward', status: 'on_field' | 'bench') {
  return {
    participantId: id,
    status,
    role: { group, label: null },
  } as SoccerMatchProjection['participants'][string]
}

function shootoutProjection(): SoccerShootoutProjection {
  return {
    firstKickingSide: 'tracked',
    initialKicksPerSide: 5,
    trackedEligibleParticipantIds: ['one', 'two'],
    trackedExcludedParticipantIds: [],
    opponentEligibleCount: 2,
    currentGoalkeepers: { tracked: 'participant:keeper', opponent: 'unknown:unknown' },
    kicks: [],
    score: { tracked: 0, opponent: 0 },
    attempts: { tracked: 0, opponent: 0 },
    saves: { tracked: 0, opponent: 0 },
    cards: { trackedYellow: 0, trackedRed: 0, opponentYellow: 0, opponentRed: 0 },
    nextSide: 'tracked',
    decided: false,
    winner: null,
    suddenDeathRound: null,
  }
}

function kick(
  teamSide: 'tracked' | 'opponent',
  kickerKey: string,
  advances: boolean,
  outcome: 'scored' | 'missed' | 'retake'
): SoccerShootoutProjection['kicks'][number] {
  return {
    eventId: `${teamSide}-${kickerKey}-${outcome}`,
    teamSide,
    outcome,
    kickerKey,
    goalkeeperKey: 'unknown:unknown',
    kickNumber: 1,
    round: 1,
    suddenDeath: false,
    advances,
    scored: outcome === 'scored',
  }
}
