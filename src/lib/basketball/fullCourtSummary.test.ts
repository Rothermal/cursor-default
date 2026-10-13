import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { captureBasketballCourtEvent, prepareBasketballGameStart } from './commands'
import {
  basketballSummaryCourtPoint,
  basketballSummaryHalfCourtPoint,
  basketballSummaryPlayReview,
  filterBasketballSummaryPlays,
  DEFAULT_BASKETBALL_SUMMARY_PLAY_FILTERS,
} from './summaryCourt'
import { basketballSummaryShotReview } from './summaryShots'
import type { BasketballAttackingDirection } from './types'

const basketball = sports.find(sport => sport.id === 'basketball')!
const recorder = 'recorder-1'
const base = Date.parse('2026-01-10T14:00:00.000Z')
const at = (seconds: number) => new Date(base + seconds * 1000).toISOString()
const id = (value: number) => `79000000-0000-4000-8000-${String(value).padStart(12, '0')}`

function player(playerId: string, name: string, number = ''): Player {
  return { id: playerId, name, number, stats: {} }
}

function started(tipOffDirection?: BasketballAttackingDirection): GameState {
  const setup: GameState = {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Aces', opponentName: 'Bears', tournamentName: '', tournamentId: null, date: '2026-10-12' },
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
  const result = prepareBasketballGameStart(setup, {
    recorderUserId: recorder,
    occurredAt: at(0),
    eventId: id(1),
    tipOffEventId: id(2),
    participantIds: [id(101), id(102)],
    tipOffDirection,
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function shoot(state: GameState, playerId: string, point: { x: number; y: number }, seconds: number, eventId: string, shotType: '2pt' | '3pt' = '2pt'): GameState {
  const result = captureBasketballCourtEvent(state, {
    recorderUserId: recorder,
    playerId,
    fullCourtPoint: point,
    event: { kind: 'shot', made: true, shotType },
    occurredAt: at(seconds),
    eventIds: [eventId],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('BKE-7D summary court', () => {
  it('puts the tracked team attacking right and the opponent left, turning other halves', () => {
    expect(basketballSummaryCourtPoint({ x: 0.9, y: 0.3, attackingDirection: 'left_to_right' }, 'tracked'))
      .toEqual({ x: 0.9, y: 0.3 })
    const turned = basketballSummaryCourtPoint({ x: 0.1, y: 0.3, attackingDirection: 'right_to_left' }, 'tracked')
    expect(turned.x).toBeCloseTo(0.9)
    expect(turned.y).toBeCloseTo(0.7)
    expect(basketballSummaryCourtPoint({ x: 0.1, y: 0.3, attackingDirection: 'right_to_left' }, 'opponent'))
      .toEqual({ x: 0.1, y: 0.3 })
  })

  it('places half-court-frame shots from older games at their side’s summary basket', () => {
    const old = { x: 0.5, y: 0.1, attackingDirection: 'unknown' as const }
    expect(basketballSummaryCourtPoint(old, 'tracked').x).toBeGreaterThan(0.8)
    expect(basketballSummaryCourtPoint(old, 'opponent').x).toBeLessThan(0.2)
    expect(basketballSummaryHalfCourtPoint(old)).not.toBeNull()
  })

  it('draws every shot on the full court and lists heaves beyond half court for the half court', () => {
    // Tracked shoots left first: its layup and heave turn to the right end of the summary.
    let state = started('right_to_left')
    state = shoot(state, 'player-1', { x: 0.05, y: 0.5 }, 10, id(201))
    state = shoot(state, 'player-1', { x: 0.7, y: 0.5 }, 20, id(202), '3pt')
    state = shoot(state, TEAM_PLAYER_OPP_ID, { x: 0.95, y: 0.5 }, 30, id(203))
    const review = basketballSummaryShotReview(state)
    const byId = new Map(review.shots.map(shot => [shot.id, shot]))
    expect(review.shots).toHaveLength(3)

    expect(byId.get(id(201))!.fullCourtMarker!.x).toBeCloseTo(0.95 * 94)
    expect(byId.get(id(201))!.marker).not.toBeNull()
    expect(byId.get(id(201))!.beyondHalfCourt).toBe(false)

    const heave = byId.get(id(202))!
    expect(heave.beyondHalfCourt).toBe(true)
    expect(heave.marker).toBeNull()
    expect(heave.fullCourtMarker!.x).toBeLessThan(47)
    expect(heave.value).toBe(3)

    // The opponent attacked right in this half, so it turns to the left end.
    expect(byId.get(id(203))!.fullCourtMarker!.x).toBeCloseTo(0.05 * 94)
  })

  it('maps located plays with side, player, period and play filters', () => {
    let state = started('left_to_right')
    for (const [statId, playerId, point, seconds, n] of [
      ['stl', 'player-1', { x: 0.6, y: 0.5 }, 10, 301],
      ['dreb', TEAM_PLAYER_OPP_ID, { x: 0.1, y: 0.4 }, 20, 302],
      ['ast', 'player-2', { x: 0.8, y: 0.5 }, 30, 303],
      ['to', 'player-2', undefined, 40, 304],
    ] as const) {
      const result = captureBasketballCourtEvent(state, {
        recorderUserId: recorder,
        playerId,
        fullCourtPoint: point,
        event: { kind: 'stat', statId },
        occurredAt: at(seconds),
        eventIds: [id(n)],
      })
      if (!result.ok) throw new Error(result.message)
      state = result.state
    }
    const review = basketballSummaryPlayReview(state)
    // The assist and the unlocated turnover stay off the map.
    expect(review.plays.map(play => play.kind)).toEqual(['steal', 'rebound'])
    expect(review.plays[0]).toMatchObject({ teamSide: 'tracked', point: { x: 0.6, y: 0.5 } })
    // The opponent attacks left in this half already: no turn.
    expect(review.plays[1]).toMatchObject({ teamSide: 'opponent', point: { x: 0.1, y: 0.4 } })
    expect(filterBasketballSummaryPlays(review, { ...DEFAULT_BASKETBALL_SUMMARY_PLAY_FILTERS, kind: 'steal' }))
      .toHaveLength(1)
    expect(filterBasketballSummaryPlays(review, { ...DEFAULT_BASKETBALL_SUMMARY_PLAY_FILTERS, teamSide: 'opponent' }))
      .toHaveLength(1)
    expect(review.participants.map(participant => participant.teamSide)).toEqual(['tracked'])
  })

  it('has no plays in a half-court game', () => {
    const state = started()
    expect(basketballSummaryPlayReview(state).plays).toEqual([])
  })
})
