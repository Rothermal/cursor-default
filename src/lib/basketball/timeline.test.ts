import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player, ShotRecord } from '../../types'
import { createInitialState } from '../gameReducer'
import { applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type { GameEvent } from '../gameEvents/types'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  captureBasketballCourtEvent,
  prepareBasketballGameStart,
  reopenBasketballMatch,
  suspendBasketballMatch,
} from './commands'
import { captureBasketballFoul } from './foulFreeThrowCommands'
import { captureBasketballTimeout } from './timeoutCommands'
import {
  BASKETBALL_MARKER_HIT_RADIUS_FEET,
  basketballMarkerChoicesAtPoint,
  basketballShotDetailForEvent,
  basketballTimelineCorrectionsEnabled,
  buildBasketballTimelineReview,
  filterBasketballTimelineGroups,
  groupBasketballTimelineByPeriod,
  legacyBasketballShotDetail,
  resolveBasketballMarkerActivation,
} from './timeline'

const basketball = sports.find(sport => sport.id === 'basketball')!
const startedAt = '2026-08-10T14:00:00.000Z'

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function setupState(): GameState {
  return {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-10',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
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
}

function startedState(): GameState {
  const result = prepareBasketballGameStart(setupState(), {
    recorderUserId: 'recorder-1',
    occurredAt: startedAt,
    eventId: '70000000-0000-4000-8000-000000001001',
    participantIds: [
      '70000000-0000-4000-8000-000000001101',
      '70000000-0000-4000-8000-000000001102',
    ],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function stateWithReviewFamilies(): GameState {
  const shot = captureBasketballCourtEvent(startedState(), {
    recorderUserId: 'recorder-1',
    playerId: 'player-1',
    point: { x: 0, y: 8 },
    event: { kind: 'shot', made: true, shotType: '2pt', assistPlayerId: 'player-2' },
    occurredAt: '2026-08-10T14:01:00.000Z',
    eventIds: [
      '70000000-0000-4000-8000-000000001201',
      '70000000-0000-4000-8000-000000001202',
    ],
    captureCommandId: '70000000-0000-4000-8000-000000001299',
  })
  if (!shot.ok) throw new Error(shot.message)

  const foul = captureBasketballFoul(shot.state, {
    recorderUserId: 'recorder-1',
    teamSide: 'tracked',
    offender: { kind: 'player', playerId: 'player-1' },
    class: 'personal',
    context: 'shooting',
    occurredAt: '2026-08-10T14:02:00.000Z',
    eventIds: ['70000000-0000-4000-8000-000000001301'],
  })
  if (!foul.ok) throw new Error(foul.message)

  const timeout = captureBasketballTimeout(foul.state, {
    recorderUserId: 'recorder-1',
    timeout: { mode: 'neutral', kind: 'official' },
    occurredAt: '2026-08-10T14:03:00.000Z',
    eventId: '70000000-0000-4000-8000-000000001401',
  })
  if (!timeout.ok) throw new Error(timeout.message)
  return timeout.state
}

describe('BKE-3A Basketball Timeline review', () => {
  it('groups capture commands newest-first and preserves individual event meaning', () => {
    const review = buildBasketballTimelineReview(stateWithReviewFamilies())
    const shotGroup = review.activeGroups.find(group =>
      group.captureCommandId === '70000000-0000-4000-8000-000000001299'
    )

    expect(review.complete).toBe(true)
    expect(review.defaultPeriodId).toBe('regulation-1')
    expect(shotGroup).toMatchObject({
      actorLabel: '#4 Alex One',
      periodLabel: 'Q1',
      title: 'Made 2PT + Assist',
    })
    expect(shotGroup?.events.map(event => event.title)).toEqual(['Made 2PT', 'Assist'])
    expect(review.activeGroups[0].title).toBe('Official timeout')
  })

  it('supports oldest-first period-grouped Summary review with deterministic capture labels', () => {
    const review = buildBasketballTimelineReview(stateWithReviewFamilies(), {
      groupOrder: 'oldest_first',
    })
    const sections = groupBasketballTimelineByPeriod(review.activeGroups, review.periods)
    const shotGroup = review.activeGroups.find(group =>
      group.captureCommandId === '70000000-0000-4000-8000-000000001299'
    )

    expect(review.activeGroups[0]).toMatchObject({
      title: 'Q1 started',
      sequenceLabel: 'Capture #1',
    })
    expect(review.activeGroups[review.activeGroups.length - 1]?.title).toBe('Official timeout')
    expect(shotGroup?.sequenceLabel).toBe('Captures #2-3')
    expect(shotGroup?.events.map(event => event.sequenceLabel))
      .toEqual(['Capture #2', 'Capture #3'])
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ periodId: 'regulation-1', periodLabel: 'Q1' })
    expect(sections[0].groups.map(group => group.id))
      .toEqual(review.activeGroups.map(group => group.id))
  })

  it('allows correction only for editable non-terminal authority', () => {
    const live = startedState()
    const suspended = suspendBasketballMatch(live, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-10T14:05:00.000Z',
      eventId: '70000000-0000-4000-8000-000000001599',
    })
    if (!suspended.ok) throw new Error(suspended.message)

    expect(basketballTimelineCorrectionsEnabled(live, true)).toBe(true)
    expect(basketballTimelineCorrectionsEnabled(live, false)).toBe(false)
    expect(basketballTimelineCorrectionsEnabled(suspended.state, true)).toBe(false)
  })

  it('derives period and participant filters from valid events when an incomplete stream has stale projection data', () => {
    const state = stateWithReviewFamilies()
    if (state.sportGameState?.sportId !== 'basketball' || !state.eventStream) {
      throw new Error('Expected Basketball event state')
    }
    const staleState: GameState = {
      ...state,
      eventStream: {
        ...state.eventStream,
        events: [...state.eventStream.events, null] as unknown as typeof state.eventStream.events,
      },
      sportGameState: {
        ...state.sportGameState,
        projection: {
          ...state.sportGameState.projection,
          periods: [],
          participants: {},
        },
      },
    }

    const review = buildBasketballTimelineReview(staleState)

    expect(review.complete).toBe(false)
    expect(review.periods).toContainEqual({ id: 'regulation-1', label: 'Q1' })
    expect(review.participants).toHaveLength(2)
    expect(review.defaultPeriodId).toBe('regulation-1')
    expect(review.activeGroups.length).toBeGreaterThan(0)
    expect(review.activeGroups
      .flatMap(group => group.events)
      .flatMap(event => event.warnings)
      .some(warning => warning.includes('unavailable in the authoritative match roster')))
      .toBe(false)
  })

  it('keeps dangling actor references filterable while surfacing an event warning', () => {
    const state = stateWithReviewFamilies()
    if (!state.eventStream) throw new Error('Expected event stream')
    const shotId = '70000000-0000-4000-8000-000000001201'
    const ghostId = '70000000-0000-4000-8000-000000001999'
    const ghostState: GameState = {
      ...state,
      eventStream: {
        ...state.eventStream,
        events: state.eventStream.events.map(rawEvent => {
          const event = rawEvent as GameEvent
          return event.id === shotId
            ? {
                ...event,
                actors: event.actors.map((actor, index) => index === 0
                  ? { ...actor, participantId: ghostId, label: 'Ghost Player' }
                  : actor),
              }
            : event
        }),
      },
    }

    const review = buildBasketballTimelineReview(ghostState)

    expect(review.participants).toContainEqual({
      id: ghostId,
      label: 'Unavailable: Ghost Player',
      teamSide: 'tracked',
    })
    expect(review.eventById.get(shotId)?.warnings)
      .toContain('Ghost Player is unavailable in the authoritative match roster.')
  })

  it('deduplicates repeated global stream diagnostics', () => {
    const state = stateWithReviewFamilies()
    if (!state.eventStream) throw new Error('Expected event stream')
    const malformedState: GameState = {
      ...state,
      eventStream: {
        ...state.eventStream,
        events: [
          ...state.eventStream.events,
          null,
          null,
        ] as unknown as typeof state.eventStream.events,
      },
    }

    const review = buildBasketballTimelineReview(malformedState)

    expect(review.complete).toBe(false)
    expect(new Set(review.globalWarnings).size).toBe(review.globalWarnings.length)
  })

  it('applies overlapping family, period, side, and participant filters to complete groups', () => {
    const review = buildBasketballTimelineReview(stateWithReviewFamilies())
    const scoring = filterBasketballTimelineGroups(review.activeGroups, {
      family: 'scoring',
      periodId: 'regulation-1',
      teamSide: 'tracked',
      participantId: '70000000-0000-4000-8000-000000001101',
    })
    const related = filterBasketballTimelineGroups(review.activeGroups, {
      family: 'related_stats',
      periodId: 'all',
      teamSide: 'all',
      participantId: '70000000-0000-4000-8000-000000001102',
    })
    const fouls = filterBasketballTimelineGroups(review.activeGroups, {
      family: 'fouls_free_throws',
      periodId: 'all',
      teamSide: 'all',
      participantId: 'all',
    })
    const administration = filterBasketballTimelineGroups(review.activeGroups, {
      family: 'administration',
      periodId: 'all',
      teamSide: 'all',
      participantId: 'all',
    })
    const control = filterBasketballTimelineGroups(review.activeGroups, {
      family: 'match_control',
      periodId: 'all',
      teamSide: 'all',
      participantId: 'all',
    })

    expect(scoring).toHaveLength(1)
    expect(scoring[0].events.map(event => event.title)).toEqual(['Made 2PT', 'Assist'])
    expect(related).toHaveLength(1)
    expect(fouls.map(group => group.title)).toContain('Personal foul - Shooting')
    expect(administration.map(group => group.title)).toContain('Official timeout')
    expect(control.map(group => group.title)).toContain('Q1 started')
  })

  it('keeps removed events reviewable and reports removed capture companions', () => {
    const before = stateWithReviewFamilies()
    const removed = applyGameEventMutations(
      before,
      [{ type: 'delete', eventId: '70000000-0000-4000-8000-000000001202' }],
      '2026-08-10T14:04:00.000Z',
      gameEventRegistry,
      gameEventProjectors
    )
    if (!removed.ok) throw new Error(removed.error.message)
    const review = buildBasketballTimelineReview(removed.state)
    const activeShotGroup = review.activeGroups.find(group =>
      group.captureCommandId === '70000000-0000-4000-8000-000000001299'
    )
    const removedAssistGroup = review.removedGroups.find(group =>
      group.captureCommandId === '70000000-0000-4000-8000-000000001299'
    )

    expect(activeShotGroup?.removedCompanionCount).toBe(1)
    expect(removedAssistGroup?.events[0]).toMatchObject({
      title: 'Assist',
      removed: true,
      revised: true,
    })
  })

  it('restores live period context after reopen without labelling new capture as recorded later', () => {
    const suspended = suspendBasketballMatch(startedState(), {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-10T14:05:00.000Z',
      eventId: '70000000-0000-4000-8000-000000001501',
    })
    if (!suspended.ok) throw new Error(suspended.message)
    const reopened = reopenBasketballMatch(suspended.state, {
      recorderUserId: 'recorder-1',
      reason: 'Resume after review',
      occurredAt: '2026-08-10T14:06:00.000Z',
      eventId: '70000000-0000-4000-8000-000000001502',
    })
    if (!reopened.ok) throw new Error(reopened.message)
    const liveShot = captureBasketballCourtEvent(reopened.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-10T14:07:00.000Z',
      eventIds: ['70000000-0000-4000-8000-000000001503'],
    })
    if (!liveShot.ok) throw new Error(liveShot.message)

    const review = buildBasketballTimelineReview(liveShot.state)
    expect(review.eventById.get('70000000-0000-4000-8000-000000001501')?.recordedLater).toBe(false)
    expect(review.eventById.get('70000000-0000-4000-8000-000000001502')?.recordedLater).toBe(false)
    expect(review.eventById.get('70000000-0000-4000-8000-000000001503')?.recordedLater).toBe(false)
  })

  it('builds event shot detail with full-game ordinal and active relationships', () => {
    const state = stateWithReviewFamilies()
    const detail = basketballShotDetailForEvent(
      state,
      '70000000-0000-4000-8000-000000001201'
    )

    expect(detail).toMatchObject({
      source: 'event',
      ordinalLabel: 'Field goal #1',
      periodLabel: 'Q1',
      shooterLabel: '#4 Alex One',
      resultLabel: 'Made',
      valueLabel: '2 point',
    })
    expect(detail?.relationships[0]?.label).toBe('#12 Blake Two assist')
    expect(detail?.locationLabel).toContain('Paint')
  })

  it('derives legacy ordinals from the full chart rather than the visible subset', () => {
    const state = setupState()
    state.shotChart = [
      legacyShot('shot-1', 'player-1', 1_000, true, 0, 2),
      legacyShot('shot-2', 'player-2', 2_000, false, 20, 20),
    ]

    const detail = legacyBasketballShotDetail(state, 'shot-2')

    expect(detail).toMatchObject({
      source: 'legacy',
      ordinalLabel: 'Field goal #2',
      shooterLabel: '#12 Blake Two',
      resultLabel: 'Missed',
    })
    expect(detail?.relationships).toEqual([])
  })

  it('resolves large marker hit areas by tap distance and asks only on near-equal choices', () => {
    const shots = [
      legacyShot('older', 'player-1', 1_000, true, 0, 0),
      legacyShot('newer', 'player-2', 3_000, false, BASKETBALL_MARKER_HIT_RADIUS_FEET * 2, 0),
      legacyShot('far', 'player-1', 4_000, true, 8, 8),
    ]

    expect(basketballMarkerChoicesAtPoint(shots, 'newer', { x: 0, y: 0 }).map(shot => shot.id))
      .toEqual(['older'])
    expect(basketballMarkerChoicesAtPoint(shots, 'older', {
      x: BASKETBALL_MARKER_HIT_RADIUS_FEET,
      y: 0,
    }).map(shot => shot.id)).toEqual(['newer', 'older'])
    expect(basketballMarkerChoicesAtPoint(shots, 'older', null).map(shot => shot.id))
      .toEqual(['older'])

    expect(resolveBasketballMarkerActivation(shots, 'newer', { x: 0, y: 0 }))
      .toMatchObject({ kind: 'detail', shot: { id: 'older' } })
    const ambiguous = resolveBasketballMarkerActivation(shots, 'older', {
      x: BASKETBALL_MARKER_HIT_RADIUS_FEET,
      y: 0,
    })
    expect(ambiguous?.kind).toBe('chooser')
    if (ambiguous?.kind !== 'chooser') throw new Error('Expected marker chooser')
    expect(ambiguous.shots.map(shot => shot.id)).toEqual(['newer', 'older'])
  })
})

function legacyShot(
  id: string,
  playerId: string,
  timestamp: number,
  made: boolean,
  x: number,
  y: number
): ShotRecord {
  return {
    id,
    playerId,
    timestamp,
    made,
    x,
    y,
    shotType: x >= 20 ? '3pt' : '2pt',
    zone: x >= 20 ? 'three' : y <= 4 ? 'restricted' : 'paint',
  }
}
