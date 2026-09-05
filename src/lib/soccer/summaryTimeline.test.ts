import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import type { GameEvent, GameEventInspection } from '../gameEvents/types'
import { createInitialCloudSyncState } from '../gameReducer'
import {
  SOCCER_SUMMARY_TIMELINE_FILTERS,
  canEditSoccerSummaryTimeline,
  isSoccerSummaryTimelineEvent,
  soccerSummaryEventMatchesFilter,
  soccerSummaryTimelineReview,
  type SoccerSummaryTimelineFilter,
} from './summaryTimeline'
import { soccerTeamEventReviewPresentation } from './timeline'

const EVENT_TYPES = [
  'soccer.opening_lineup',
  'soccer.period_started',
  'soccer.period_ended',
  'soccer.clock_started',
  'soccer.clock_paused',
  'soccer.clock_adjusted',
  'soccer.match_rules_changed',
  'soccer.substitution_window',
  'soccer.role_changed',
  'soccer.attacking_direction_changed',
  'soccer.match_roster_added',
  'soccer.participant_resolved',
  'soccer.match_ended',
  'soccer.match_reopened',
  'soccer.shot',
  'soccer.own_goal',
  'soccer.score_adjustment',
  'soccer.defensive_action',
  'soccer.foul',
  'soccer.card',
  'soccer.team_event',
  'soccer.shootout_started',
  'soccer.shootout_eligibility_changed',
  'soccer.shootout_goalkeeper_changed',
  'soccer.shootout_kick',
] as const

const FOCUSED_FILTERS = SOCCER_SUMMARY_TIMELINE_FILTERS
  .map(item => item.id)
  .filter((filter): filter is Exclude<SoccerSummaryTimelineFilter, 'all'> =>
    filter !== 'all'
  )

describe('soccer summary timeline', () => {
  it('allows mutation controls only for an editable local source', () => {
    expect(canEditSoccerSummaryTimeline({ kind: 'local', editable: true })).toBe(true)
    expect(canEditSoccerSummaryTimeline({ kind: 'local', editable: false })).toBe(false)
    expect(canEditSoccerSummaryTimeline({
      kind: 'cloud_primary',
      editable: false,
    })).toBe(false)
    expect(canEditSoccerSummaryTimeline({
      kind: 'cloud_recording',
      editable: false,
    })).toBe(false)
    expect(canEditSoccerSummaryTimeline({
      kind: 'canonical',
      editable: false,
    })).toBe(false)
  })

  it('classifies every normal event type and excludes shootout kicks', () => {
    for (const eventType of EVENT_TYPES) {
      const event = eventForFilter(eventType)
      if (eventType === 'soccer.shootout_kick') {
        expect(isSoccerSummaryTimelineEvent(event)).toBe(false)
        expect(FOCUSED_FILTERS.some(filter =>
          soccerSummaryEventMatchesFilter(event, filter)
        )).toBe(false)
      } else {
        expect(isSoccerSummaryTimelineEvent(event)).toBe(true)
        expect(FOCUSED_FILTERS.some(filter =>
          soccerSummaryEventMatchesFilter(event, filter)
        )).toBe(true)
      }
    }
  })

  it('supports reviewed overlapping scoring, restart, discipline, and lineup filters', () => {
    const goal = eventForFilter('soccer.shot', {
      outcome: 'goal',
      sourceEventId: 'restart-1',
    })
    expect(soccerSummaryEventMatchesFilter(goal, 'scoring')).toBe(true)
    expect(soccerSummaryEventMatchesFilter(goal, 'attack')).toBe(true)
    expect(soccerSummaryEventMatchesFilter(goal, 'restarts')).toBe(true)

    const foul = eventForFilter('soccer.foul', {
      restart: 'direct_free_kick',
      sanction: 'yellow',
      lineupResolution: { exit: 'temporary' },
    })
    expect(soccerSummaryEventMatchesFilter(foul, 'restarts')).toBe(true)
    expect(soccerSummaryEventMatchesFilter(foul, 'discipline')).toBe(true)
    expect(soccerSummaryEventMatchesFilter(foul, 'lineup')).toBe(true)

    const noRestart = eventForFilter('soccer.foul', {
      restart: 'none',
      sanction: 'none',
    })
    expect(soccerSummaryEventMatchesFilter(noRestart, 'restarts')).toBe(false)
    expect(soccerSummaryEventMatchesFilter(noRestart, 'discipline')).toBe(false)
  })

  it('labels restart kinds, awarded sides, and known or omitted takers', () => {
    const throwIn = event(1, 'soccer.team_event', 'regulation-1', 1, 5_000)
    throwIn.payload = { kind: 'throw_in' }
    throwIn.teamSide = 'tracked'
    throwIn.actors = [{
      role: 'taker',
      kind: 'player',
      participantId: 'participant-a',
      playerId: 'player-a',
      label: '#7 Alex',
    }]
    expect(soccerTeamEventReviewPresentation(throwIn)).toEqual({
      actorLabel: '#7 Alex',
      kindLabel: 'Throw-in',
      label: 'Tracked throw-in - #7 Alex',
      sideLabel: 'Tracked',
    })

    const goalKick = event(2, 'soccer.team_event', 'regulation-1', 1, 10_000)
    goalKick.payload = { kind: 'goal_kick' }
    goalKick.teamSide = 'opponent'
    expect(soccerTeamEventReviewPresentation(goalKick)).toEqual({
      actorLabel: 'Taker not recorded',
      kindLabel: 'Goal kick',
      label: 'Opponent goal kick - Taker not recorded',
      sideLabel: 'Opponent',
    })
  })

  it('orders oldest-first, groups periods, and separates removed events', () => {
    const activeSecond = event(2, 'soccer.clock_paused', 'regulation-2', 2, 46 * 60_000)
    const activeFirst = event(1, 'soccer.period_started', 'regulation-1', 1, 0)
    const removed = {
      ...event(3, 'soccer.card', 'regulation-1', 1, 30 * 60_000),
      revision: 2,
      deletedAt: '2026-07-23T13:00:00.000Z',
    }
    const review = soccerSummaryTimelineReview(
      state(),
      inspection([activeSecond, activeFirst], [removed]),
      'all'
    )

    expect(review.activeSections.map(section => section.label)).toEqual([
      'First Half',
      'Second Half',
    ])
    expect(review.activeSections.flatMap(section => section.rows.map(row => row.event.id)))
      .toEqual(['event-1', 'event-2'])
    expect(review.activeSections[1].rows[0].timeLabel).toBe('1:00')
    expect(review.removedSections[0].rows[0]).toMatchObject({
      corrected: true,
      timeLabel: '30:00',
    })
  })

  it('keeps shootout lifecycle context without listing attempts', () => {
    const review = soccerSummaryTimelineReview(
      state(),
      inspection([
        event(1, 'soccer.shootout_started', 'shootout', 5, null),
        event(2, 'soccer.shootout_kick', 'shootout', 5, null),
        event(3, 'soccer.match_ended', 'shootout', 5, null),
      ]),
      'all'
    )
    expect(review.activeSections[0].label).toBe('Shootout')
    expect(review.activeSections[0].rows.map(row => row.event.eventType)).toEqual([
      'soccer.shootout_started',
      'soccer.match_ended',
    ])
  })
})

function eventForFilter(
  eventType: string,
  payload: Record<string, unknown> = {}
): Pick<GameEvent, 'eventType' | 'payload'> {
  const defaults: Record<string, unknown> =
    eventType === 'soccer.shot'
      ? { outcome: 'saved' }
      : eventType === 'soccer.foul'
        ? { restart: 'none', sanction: 'yellow' }
        : eventType === 'soccer.card'
          ? { sanction: 'yellow' }
          : eventType === 'soccer.team_event'
            ? { kind: 'corner' }
            : {}
  return {
    eventType,
    payload: { ...defaults, ...payload },
  } as Pick<GameEvent, 'eventType' | 'payload'>
}

function event(
  sequence: number,
  eventType: string,
  periodId: string,
  periodOrder: number,
  elapsedMs: number | null
): GameEvent {
  const timestamp = `2026-07-23T12:${String(sequence).padStart(2, '0')}:00.000Z`
  return {
    id: `event-${sequence}`,
    sportId: 'soccer',
    eventType,
    schemaVersion: 1,
    recorderUserId: 'recorder-1',
    sequence,
    period: { id: periodId, order: periodOrder },
    elapsedMs,
    occurredAt: timestamp,
    teamSide: 'tracked',
    location: null,
    actors: [],
    payload: {},
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
}

function inspection(
  activeEvents: GameEvent[],
  deletedEvents: GameEvent[] = []
): GameEventInspection<GameEvent> {
  return {
    complete: true,
    activeEvents,
    deletedEvents,
    diagnostics: [],
  }
}

function state(): GameState {
  const firstPeriod = event(10, 'soccer.period_started', 'regulation-1', 1, 0)
  firstPeriod.payload = { periodId: 'regulation-1' }
  const secondPeriod = event(
    11,
    'soccer.period_started',
    'regulation-2',
    2,
    45 * 60_000
  )
  secondPeriod.payload = { periodId: 'regulation-2' }
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
    eventStream: { version: 1, events: [firstPeriod, secondPeriod] },
    sportGameState: {
      sportId: 'soccer',
      version: 2,
      setup: null,
      projection: {
        currentRules: {
          regulationSegments: [
            { id: 'regulation-1', label: 'First Half', order: 1, durationMinutes: 45 },
            { id: 'regulation-2', label: 'Second Half', order: 2, durationMinutes: 45 },
          ],
          extraTimeSegments: [],
        },
        startedPeriodIds: ['regulation-1', 'regulation-2'],
        periodEndElapsedMsById: {
          'regulation-1': 45 * 60_000,
          'regulation-2': 90 * 60_000,
        },
        currentPeriodId: null,
        clock: {
          running: false,
          elapsedMs: 90 * 60_000,
          anchorOccurredAt: null,
        },
      },
    },
  } as unknown as GameState
}
