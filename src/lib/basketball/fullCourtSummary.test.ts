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
import { basketballFullCourtFeet } from './fullCourtView'
import { buildBasketballTimelineReview } from './timeline'
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

function flip(state: GameState): GameState {
  const current = state.sportGameState
  if (current?.sportId !== 'basketball') throw new Error('not basketball')
  return {
    ...state,
    sportGameState: { ...current, capturePreferences: { ...current.capturePreferences, courtOrientation: 'flipped' } },
  }
}

/** The basket nearer a summary-court marker, as drawn (feet, before or after the flip). */
function shownEnd(x: number, flipped: boolean): 'left' | 'right' {
  const shown = flipped ? 94 - x : x
  return shown > 47 ? 'right' : 'left'
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
  describe('summary location text matches the marker (review fix)', () => {
    const cases = (['tracked', 'opponent'] as const).flatMap(side =>
      (['left_to_right', 'right_to_left'] as const).flatMap(tipOff =>
        [false, true].map(flipped => ({ side, tipOff, flipped }))
      )
    )

    it.each(cases)('$side side, tip-off $tipOff, flipped $flipped', ({ side, tipOff, flipped }) => {
      const playerId = side === 'tracked' ? 'player-1' : TEAM_PLAYER_OPP_ID
      let state = started(tipOff)
      // A steal near each end, then a shot at the basket this side attacks right now.
      for (const [x, n] of [[0.1, 301], [0.85, 302]] as const) {
        const result = captureBasketballCourtEvent(state, {
          recorderUserId: recorder,
          playerId,
          fullCourtPoint: { x, y: 0.5 },
          event: { kind: 'stat', statId: 'stl' },
          occurredAt: at(n - 290),
          eventIds: [id(n)],
        })
        if (!result.ok) throw new Error(result.message)
        state = result.state
      }
      const trackedRight = tipOff === 'left_to_right'
      const attacksRight = side === 'tracked' ? trackedRight : !trackedRight
      state = shoot(state, playerId, { x: attacksRight ? 0.93 : 0.07, y: 0.45 }, 30, id(303))
      if (flipped) state = flip(state)

      const storedBefore = state.eventStream!.events.map(event => (event as { location?: unknown }).location)
      const timeline = buildBasketballTimelineReview(state)

      const plays = basketballSummaryPlayReview(state).plays
      expect(plays).toHaveLength(2)
      for (const play of plays) {
        const marker = basketballFullCourtFeet(play.point)
        const end = shownEnd(marker.x, flipped)
        // List row and detail read the same review copy.
        expect(play.review.spotLabel).toMatch(new RegExp(` ft from the ${end} basket$`))
        // The Timeline keeps the recorded frame's text.
        expect(timeline.eventById.get(play.id)!.spotLabel).not.toBeNull()
      }

      const shot = basketballSummaryShotReview(state).shots[0]
      const marker = shot.fullCourtMarker!
      const end = shownEnd(marker.x, flipped)
      // The summary court always puts this side at its summary basket.
      expect(end).toBe((side === 'tracked') !== flipped ? 'right' : 'left')
      expect(shot.detail.locationLabel).toContain(`at the ${end} basket`)

      // Stored events are untouched.
      expect(state.eventStream!.events.map(event => (event as { location?: unknown }).location)).toEqual(storedBefore)
    })

    it('leaves Timeline text in the recorded frame', () => {
      // Tracked attacks left: a steal at the left end reads "left" on the Timeline and
      // turns to the right end of the summary court.
      let state = started('right_to_left')
      const result = captureBasketballCourtEvent(state, {
        recorderUserId: recorder,
        playerId: 'player-1',
        fullCourtPoint: { x: 0.1, y: 0.5 },
        event: { kind: 'stat', statId: 'stl' },
        occurredAt: at(10),
        eventIds: [id(301)],
      })
      if (!result.ok) throw new Error(result.message)
      state = result.state
      expect(buildBasketballTimelineReview(state).eventById.get(id(301))!.spotLabel).toMatch(/left basket$/)
      expect(basketballSummaryPlayReview(state).plays[0].review.spotLabel).toMatch(/right basket$/)
    })
  })
})
