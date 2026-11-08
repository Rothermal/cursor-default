import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import { BASKETBALL_TEAM_STATS_DEFAULTS } from '../../config/teamStatsDefaults'
import { createInitialState } from '../gameReducer'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import type { GameState } from '../../types'
import {
  captureBasketballCourtEvent,
  endBasketballPeriod,
  prepareBasketballGameStart,
  startNextBasketballPeriod,
} from './commands'
import { basketballLiveChartPeriod, basketballShotsInPeriod } from './liveShotChartPeriod'

const id = (n: number) => `af060000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (n: number) => new Date(Date.parse('2026-11-07T12:00:00Z') + n * 1000).toISOString()

function ok(result: { ok: boolean; state: GameState; message?: string }) {
  if (!result.ok) throw Error(result.message)
  return result.state
}

function started() {
  return ok(prepareBasketballGameStart({
    ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!,
    gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Aces', opponentName: 'Bears', tournamentName: '', tournamentId: null, date: '2026-11-07' },
    players: [
      { id: TEAM_PLAYER_HOME_ID, name: 'Aces', number: '', stats: {}, isTeamPlayer: true },
      { id: TEAM_PLAYER_OPP_ID, name: 'Bears', number: '', stats: {}, isTeamPlayer: true, teamSide: 'opponent' },
      { id: 'player-1', name: 'Alex One', number: '4', stats: {} },
    ],
    teamStatsConfig: { ...structuredClone(BASKETBALL_TEAM_STATS_DEFAULTS) },
  }, { recorderUserId: null, tipOffDirection: 'left_to_right', participantIds: [id(101)], eventId: id(1), tipOffEventId: id(2), occurredAt: at(0) }))
}

function shoot(state: GameState, n: number) {
  return ok(captureBasketballCourtEvent(state, {
    recorderUserId: null, playerId: 'player-1', fullCourtPoint: { x: 0.8, y: 0.5 },
    event: { kind: 'shot', made: true, shotType: '2pt' }, eventIds: [id(n)], occurredAt: at(n),
  }))
}

describe('live basketball shot chart period scope', () => {
  it('scopes to the period in progress, then holds the finished period until the next starts', () => {
    let state = shoot(shoot(started(), 10), 11)
    const first = basketballLiveChartPeriod(state)!
    expect(first).not.toBeNull()
    expect(basketballShotsInPeriod(state, state.shotChart, first.id).map(shot => shot.id)).toEqual([id(10), id(11)])

    state = ok(endBasketballPeriod(state, { recorderUserId: null, occurredAt: at(20), eventId: id(20) }))
    expect(basketballLiveChartPeriod(state)?.id).toBe(first.id)
    expect(basketballShotsInPeriod(state, state.shotChart, first.id)).toHaveLength(2)

    state = ok(startNextBasketballPeriod(state, { recorderUserId: null, occurredAt: at(30), eventId: id(30) }))
    const second = basketballLiveChartPeriod(state)!
    expect(second.id).not.toBe(first.id)
    expect(basketballShotsInPeriod(state, state.shotChart, second.id)).toEqual([])

    state = shoot(state, 40)
    expect(state.shotChart).toHaveLength(3)
    expect(basketballShotsInPeriod(state, state.shotChart, second.id).map(shot => shot.id)).toEqual([id(40)])
  })

  it('has no period before a basketball event game starts', () => {
    expect(basketballLiveChartPeriod(createInitialState())).toBeNull()
  })
})
