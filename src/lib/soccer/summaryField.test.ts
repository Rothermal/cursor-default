import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { createInitialCloudSyncState } from '../gameReducer'
import type {
  GameEvent,
  GameEventActor,
  GameEventInspection,
  GameEventLocation,
} from '../gameEvents/types'
import {
  canEditSoccerSummaryField,
  soccerFieldReviewFamilies,
  soccerSummaryFieldReview,
  transformFieldLocation,
} from './summaryField'

const ALL_FAMILIES = ['attack', 'defense', 'restarts', 'discipline'] as const

describe('soccer summary field review', () => {
  it('classifies every located family and preserves overlapping context', () => {
    expect(soccerFieldReviewFamilies(
      event('shot', 'soccer.shot', 1, { outcome: 'goal', situation: 'open_play' })
    )).toEqual(['attack'])
    expect(soccerFieldReviewFamilies(
      event('blocked', 'soccer.shot', 2, { outcome: 'blocked', situation: 'open_play' })
    )).toEqual(['attack', 'defense'])
    expect(soccerFieldReviewFamilies(
      event('defense', 'soccer.defensive_action', 3, {
        action: 'interception',
        tackleOutcome: null,
      })
    )).toEqual(['defense'])
    expect(soccerFieldReviewFamilies(
      event('foul', 'soccer.foul', 4, {
        restart: 'direct_free_kick',
        sanction: 'yellow',
        sanctionReason: 'dissent',
        note: null,
        lineupResolution: null,
      })
    )).toEqual(['restarts', 'discipline'])
    expect(soccerFieldReviewFamilies(
      event('card', 'soccer.card', 5, {
        sanction: 'yellow',
        reason: 'dissent',
        note: null,
        lineupResolution: null,
      })
    )).toEqual(['discipline'])
    expect(soccerFieldReviewFamilies(
      event('corner', 'soccer.team_event', 6, { kind: 'corner' })
    )).toEqual(['restarts'])
    expect(soccerFieldReviewFamilies(
      event('clock', 'soccer.clock_paused', 7, { elapsedMs: 1_000 })
    )).toEqual([])
  })

  it('combines side, participant, family, and aggregate period filters', () => {
    const events = fixtureEvents()
    const review = soccerSummaryFieldReview(state(), inspection(events), {
      orientation: 'normalized',
      side: 'tracked',
      families: ['defense', 'discipline'],
      participant: 'participant-b',
      period: 'extra_time',
    })
    expect(review.events.map(item => item.event.id)).toEqual(['et-foul'])
    expect(review.locatedEvents).toHaveLength(1)
    expect(review.unknownLocationCount).toBe(0)

    const unknownOpponent = soccerSummaryFieldReview(state(), inspection(events), {
      orientation: 'original',
      side: 'opponent',
      families: ALL_FAMILIES,
      participant: 'unknown',
      period: 'full_match',
    })
    expect(unknownOpponent.events.map(item => item.event.id)).toEqual([
      'opponent-corner',
      'opponent-card',
    ])
    expect(unknownOpponent.locatedEvents.map(item => item.event.id))
      .toEqual(['opponent-corner'])
    expect(unknownOpponent.unknownLocationCount).toBe(1)
    expect(unknownOpponent.participantOptions.map(option => option.id))
      .toEqual(['all', 'unknown'])
  })

  it('counts unlocated events only after the active filters', () => {
    const events = fixtureEvents()
    const review = soccerSummaryFieldReview(state(), inspection(events), {
      orientation: 'normalized',
      side: 'tracked',
      families: ['defense'],
      participant: 'all',
      period: 'regulation',
    })
    expect(review.events.map(item => item.event.id)).toEqual([
      'tracked-blocked',
      'tracked-defense',
    ])
    expect(review.locatedEvents.map(item => item.event.id))
      .toEqual(['tracked-blocked'])
    expect(review.unknownLocationCount).toBe(1)
  })

  it('normalizes each recorded direction independently and preserves original coordinates', () => {
    const rightToLeft: GameEventLocation = {
      x: 0.2,
      y: 0.3,
      attackingDirection: 'right_to_left',
    }
    expect(transformFieldLocation(rightToLeft, 'normalized')).toEqual({
      x: 0.8,
      y: 0.7,
      attackingDirection: 'left_to_right',
    })
    expect(transformFieldLocation(rightToLeft, 'original')).toEqual(rightToLeft)
    expect(transformFieldLocation({
      x: 0.8,
      y: 0.3,
      attackingDirection: 'left_to_right',
    }, 'normalized')).toEqual({
      x: 0.8,
      y: 0.3,
      attackingDirection: 'left_to_right',
    })
  })

  it('excludes lifecycle and shootout events while exposing started period scopes', () => {
    const events = fixtureEvents().concat([
      event('clock', 'soccer.clock_paused', 20, { elapsedMs: 1_000 }),
      event(
        'shootout-card',
        'soccer.card',
        21,
        {
          sanction: 'yellow',
          reason: 'dissent',
          note: null,
          lineupResolution: null,
        },
        { periodId: 'shootout', periodOrder: 99, elapsedMs: null }
      ),
    ])
    const review = soccerSummaryFieldReview(state(), inspection(events), {
      orientation: 'normalized',
      side: 'all',
      families: ALL_FAMILIES,
      participant: 'all',
      period: 'full_match',
    })
    expect(review.events.some(item => item.event.id === 'clock')).toBe(false)
    expect(review.events.some(item => item.event.id === 'shootout-card')).toBe(false)
    expect(review.periodOptions.map(option => option.id)).toEqual([
      'full_match',
      'regulation',
      'extra_time',
      'regulation-1',
      'regulation-2',
      'extra-time-1',
    ])
  })

  it('allows field correction only for an editable local source', () => {
    expect(canEditSoccerSummaryField({ kind: 'local', editable: true })).toBe(true)
    expect(canEditSoccerSummaryField({ kind: 'local', editable: false })).toBe(false)
    expect(canEditSoccerSummaryField({ kind: 'cloud_primary', editable: false })).toBe(false)
    expect(canEditSoccerSummaryField({ kind: 'cloud_recording', editable: false })).toBe(false)
    expect(canEditSoccerSummaryField({ kind: 'canonical', editable: false })).toBe(false)
  })
})

function fixtureEvents(): GameEvent[] {
  return [
    event(
      'tracked-blocked',
      'soccer.shot',
      1,
      { outcome: 'blocked', situation: 'open_play' },
      {
        actors: [playerActor('shooter', 'participant-a', 'Alex')],
        location: {
          x: 0.2,
          y: 0.3,
          attackingDirection: 'right_to_left',
        },
      }
    ),
    event(
      'opponent-corner',
      'soccer.team_event',
      2,
      { kind: 'corner' },
      {
        teamSide: 'opponent',
        location: {
          x: 0.1,
          y: 0.1,
          attackingDirection: 'left_to_right',
        },
      }
    ),
    event(
      'tracked-defense',
      'soccer.defensive_action',
      3,
      { action: 'clearance', tackleOutcome: null },
      {
        periodId: 'regulation-2',
        periodOrder: 2,
        elapsedMs: 50 * 60_000,
        actors: [playerActor('defender', 'participant-b', 'Bailey')],
        location: null,
      }
    ),
    event(
      'et-foul',
      'soccer.foul',
      4,
      {
        restart: 'penalty',
        sanction: 'yellow',
        sanctionReason: 'dogso',
        note: null,
        lineupResolution: null,
      },
      {
        periodId: 'extra-time-1',
        periodOrder: 3,
        elapsedMs: 91 * 60_000,
        actors: [playerActor('committed_by', 'participant-b', 'Bailey')],
        location: {
          x: 0.7,
          y: 0.4,
          attackingDirection: 'left_to_right',
        },
      }
    ),
    event(
      'opponent-card',
      'soccer.card',
      5,
      {
        sanction: 'yellow',
        reason: 'dissent',
        note: null,
        lineupResolution: null,
      },
      {
        teamSide: 'opponent',
        periodId: 'extra-time-1',
        periodOrder: 3,
        elapsedMs: 92 * 60_000,
        actors: [{ role: 'recipient', kind: 'staff', label: 'Coach' }],
        location: null,
      }
    ),
  ]
}

function event(
  id: string,
  eventType: string,
  sequence: number,
  payload: GameEvent['payload'],
  options: {
    teamSide?: 'tracked' | 'opponent'
    periodId?: string
    periodOrder?: number
    elapsedMs?: number | null
    location?: GameEventLocation | null
    actors?: GameEventActor[]
  } = {}
): GameEvent {
  const timestamp = `2026-07-24T12:${String(sequence).padStart(2, '0')}:00.000Z`
  return {
    id,
    sportId: 'soccer',
    eventType,
    schemaVersion: 1,
    recorderUserId: 'recorder-1',
    sequence,
    period: {
      id: options.periodId ?? 'regulation-1',
      order: options.periodOrder ?? 1,
    },
    elapsedMs: options.elapsedMs === undefined ? sequence * 60_000 : options.elapsedMs,
    occurredAt: timestamp,
    teamSide: options.teamSide ?? 'tracked',
    location: options.location === undefined
      ? { x: 0.5, y: 0.5, attackingDirection: 'left_to_right' }
      : options.location,
    actors: options.actors ?? [],
    payload,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
}

function playerActor(
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

function inspection(activeEvents: GameEvent[]): GameEventInspection<GameEvent> {
  return {
    complete: true,
    activeEvents,
    deletedEvents: [],
    diagnostics: [],
  }
}

function state(): GameState {
  const periodStarts = [
    periodStart('regulation-1', 1, 0, 100),
    periodStart('regulation-2', 2, 45 * 60_000, 101),
    periodStart('extra-time-1', 3, 90 * 60_000, 102),
  ]
  return {
    sport: null,
    gameInfo: null,
    players: [],
    activePlayerId: null,
    opponentScore: 0,
    homeTeamScore: 0,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: createInitialCloudSyncState('idle'),
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    eventStream: { version: 1, events: periodStarts },
    sportGameState: {
      sportId: 'soccer',
      version: 2,
      setup: null,
      capturePreferences: {
        teamSide: 'tracked',
        selectedParticipantId: null,
        selectionInitialized: false,
        captureMode: 'shot',
      },
      projection: {
        currentRules: {
          regulationSegments: [
            {
              id: 'regulation-1',
              label: 'First Half',
              kind: 'regulation',
              order: 1,
              durationMs: 45 * 60_000,
            },
            {
              id: 'regulation-2',
              label: 'Second Half',
              kind: 'regulation',
              order: 2,
              durationMs: 45 * 60_000,
            },
          ],
          extraTimeSegments: [
            {
              id: 'extra-time-1',
              label: 'Extra Time 1',
              kind: 'extra_time',
              order: 3,
              durationMs: 15 * 60_000,
            },
          ],
        },
        startedPeriodIds: ['regulation-1', 'regulation-2', 'extra-time-1'],
        completedPeriodIds: ['regulation-1', 'regulation-2'],
        periodEndElapsedMsById: {
          'regulation-1': 45 * 60_000,
          'regulation-2': 90 * 60_000,
        },
        currentPeriodId: 'extra-time-1',
        clock: {
          running: false,
          elapsedMs: 93 * 60_000,
          anchorOccurredAt: null,
        },
        participants: {
          'participant-a': {
            participantId: 'participant-a',
            displayName: 'Alex',
            number: '9',
          },
          'participant-b': {
            participantId: 'participant-b',
            displayName: 'Bailey',
            number: '4',
          },
        },
      },
    },
  } as unknown as GameState
}

function periodStart(
  periodId: string,
  periodOrder: number,
  elapsedMs: number,
  sequence: number
): GameEvent {
  return event(
    `start-${periodId}`,
    'soccer.period_started',
    sequence,
    { periodId },
    { periodId, periodOrder, elapsedMs, location: null }
  )
}
