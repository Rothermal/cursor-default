import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  endBasketballPeriod,
  prepareBasketballGameStart,
  startNextBasketballPeriod,
} from './commands'
import {
  basketballLiveCaptureUnits,
  restoreLastBasketballCourtUndo,
} from './courtCorrections'
import { basketballTimeoutCap } from './rules'
import { getBasketballRulesProfile } from './profiles'
import {
  basketballTimeoutInventory,
  captureBasketballTimeout,
  previewBasketballTimeoutDecrement,
  removeBasketballTimeout,
} from './timeoutCommands'
import type { BasketballTimeoutEvent } from './types'

const basketball = sports.find(sport => sport.id === 'basketball')!

function id(value: number): string {
  return `75000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

function player(playerId: string, name: string): Player {
  return { id: playerId, name, number: '', stats: {} }
}

function startedState(timeoutsPerPeriod: number | null = 2): GameState {
  const initial: GameState = {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-09',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One'),
      player('player-2', 'Blake Two'),
    ],
    teamStatsConfig: {
      periodsPerGame: 4,
      periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeLabel: 'OT',
      overtimeFoulsReset: true,
      timeoutsPerPeriod,
      timeoutsPerOvertime: null,
    },
  }
  const result = prepareBasketballGameStart(initial, {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-09T12:00:00.000Z',
    eventId: id(1),
    participantIds: [id(101), id(102)],
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function capture(
  state: GameState,
  timeout: Parameters<typeof captureBasketballTimeout>[1]['timeout'],
  value: number
): GameState {
  const result = captureBasketballTimeout(state, {
    recorderUserId: 'recorder-1',
    timeout,
    occurredAt: `2026-08-09T12:${String(value).padStart(2, '0')}:00.000Z`,
    eventId: id(value),
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function activeTimeouts(state: GameState): BasketballTimeoutEvent[] {
  if (!state.eventStream) return []
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  return inspection.activeEvents.filter(
    (event): event is BasketballTimeoutEvent => event.eventType === 'basketball.timeout'
  )
}

describe('BKE-2C4 Basketball timeouts', () => {
  it('enforces finite charged inventory while neutral timeouts consume none', () => {
    let state = startedState()
    state = capture(state, { mode: 'charged', teamSide: 'tracked', kind: 'full' }, 2)
    state = capture(state, { mode: 'charged', teamSide: 'tracked', kind: 'thirty_second' }, 3)
    const exhausted = captureBasketballTimeout(state, {
      recorderUserId: 'recorder-1',
      timeout: { mode: 'charged', teamSide: 'tracked', kind: 'full' },
      occurredAt: '2026-08-09T12:04:00.000Z',
    })
    expect(exhausted).toMatchObject({ ok: false, code: 'command_failed', state })

    state = capture(state, { mode: 'neutral', kind: 'media' }, 5)
    state = capture(state, { mode: 'neutral', kind: 'official' }, 6)
    expect(basketballTimeoutInventory(state)).toEqual({
      periodId: 'regulation-1',
      scopeLabel: 'Q1',
      tracked: { used: 2, cap: 2, remaining: 0, exhausted: true },
      opponent: { used: 0, cap: 2, remaining: 2, exhausted: false },
      neutralMedia: 1,
      neutralOfficial: 1,
    })
    expect(activeTimeouts(state).map(event => ({
      kind: event.payload.kind,
      label: event.payload.label,
      side: event.teamSide,
    }))).toEqual([
      { kind: 'full', label: 'Full timeout', side: 'tracked' },
      { kind: 'thirty_second', label: '30-second timeout', side: 'tracked' },
      { kind: 'media', label: 'Media timeout', side: 'neutral' },
      { kind: 'official', label: 'Official timeout', side: 'neutral' },
    ])
    expect(basketballLiveCaptureUnits(state).slice(0, 2).map(unit => ({
      who: unit.who,
      what: unit.what,
    }))).toEqual([
      { who: 'Game administration', what: 'Official timeout' },
      { who: 'Game administration', what: 'Media timeout' },
    ])
  })

  it('keeps unlimited inventory distinct from an exhausted zero cap', () => {
    let unlimited = startedState(null)
    unlimited = capture(unlimited, { mode: 'charged', teamSide: 'opponent', kind: 'full' }, 2)
    unlimited = capture(unlimited, { mode: 'charged', teamSide: 'opponent', kind: 'full' }, 3)
    unlimited = capture(unlimited, { mode: 'charged', teamSide: 'opponent', kind: 'full' }, 4)
    expect(basketballTimeoutInventory(unlimited)?.opponent).toEqual({
      used: 3,
      cap: null,
      remaining: null,
      exhausted: false,
    })

    const none = startedState(0)
    expect(basketballTimeoutInventory(none)?.tracked).toEqual({
      used: 0,
      cap: 0,
      remaining: 0,
      exhausted: true,
    })
    expect(captureBasketballTimeout(none, {
      recorderUserId: 'recorder-1',
      timeout: { mode: 'charged', teamSide: 'tracked', kind: 'full' },
    })).toMatchObject({ ok: false, state: none })
  })

  it('uses explicit overtime inventory or falls back to the regulation snapshot', () => {
    const state = startedState(3)
    if (state.sportGameState?.sportId !== 'basketball') {
      throw new Error('Basketball state missing.')
    }
    const rules = state.sportGameState.setup.rulesSnapshot
    expect(basketballTimeoutCap(rules, 'regulation')).toBe(3)
    expect(basketballTimeoutCap(rules, 'overtime')).toBe(3)
    expect(basketballTimeoutCap({
      ...rules,
      timeoutsPerOvertime: 1,
    }, 'overtime')).toBe(1)
  })

  it('removes the newest matching current-period timeout and restores the exact event', () => {
    let state = startedState()
    state = capture(state, { mode: 'charged', teamSide: 'tracked', kind: 'full' }, 2)
    state = capture(state, { mode: 'charged', teamSide: 'tracked', kind: 'thirty_second' }, 3)
    state = capture(state, { mode: 'neutral', kind: 'media' }, 4)
    state = capture(state, { mode: 'neutral', kind: 'official' }, 5)
    state = capture(state, { mode: 'neutral', kind: 'media' }, 6)

    const chargedTarget = { mode: 'charged', teamSide: 'tracked' } as const
    expect(previewBasketballTimeoutDecrement(state, chargedTarget)).toMatchObject({
      ok: true,
      value: {
        eventId: id(3),
        label: '30-second timeout',
        ownerLabel: 'Aces',
        chargedRemainingAfter: 1,
      },
    })
    const removed = removeBasketballTimeout(state, chargedTarget, '2026-08-09T12:07:00.000Z')
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(basketballTimeoutInventory(removed.state)?.tracked).toMatchObject({ used: 1, remaining: 1 })

    const restored = restoreLastBasketballCourtUndo(
      structuredClone(removed.state),
      '2026-08-09T12:08:00.000Z'
    )
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(basketballTimeoutInventory(restored.state)?.tracked).toMatchObject({ used: 2, remaining: 0 })
    expect(activeTimeouts(restored.state).find(event => event.id === id(3))).toMatchObject({
      revision: 3,
      deletedAt: null,
      payload: { kind: 'thirty_second', label: '30-second timeout' },
    })

    const mediaTarget = { mode: 'neutral', kind: 'media' } as const
    expect(previewBasketballTimeoutDecrement(restored.state, mediaTarget)).toMatchObject({
      ok: true,
      value: { eventId: id(6), label: 'Media timeout' },
    })
    const mediaRemoved = removeBasketballTimeout(
      restored.state,
      mediaTarget,
      '2026-08-09T12:09:00.000Z'
    )
    expect(mediaRemoved.ok).toBe(true)
    if (!mediaRemoved.ok) return
    expect(basketballTimeoutInventory(mediaRemoved.state)).toMatchObject({
      tracked: { used: 2 },
      neutralMedia: 1,
      neutralOfficial: 1,
    })
  })

  it('labels shared pools and removes the newest charged timeout across their periods', () => {
    let state = withProfile(startedState(), 'fiba')
    state = capture(state, { mode: 'charged', teamSide: 'tracked', kind: 'full' }, 2)
    const ended = endBasketballPeriod(state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-09T12:10:00.000Z',
      eventId: id(10),
    })
    if (!ended.ok) throw new Error(ended.message)
    const periodTwo = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-09T12:11:00.000Z',
      eventId: id(11),
    })
    if (!periodTwo.ok) throw new Error(periodTwo.message)

    expect(basketballTimeoutInventory(periodTwo.state)).toMatchObject({
      periodId: 'regulation-2',
      scopeLabel: 'First half',
      tracked: { used: 1, cap: 2, remaining: 1 },
    })
    const target = { mode: 'charged', teamSide: 'tracked' } as const
    expect(previewBasketballTimeoutDecrement(periodTwo.state, target)).toMatchObject({
      ok: true,
      value: { eventId: id(2), periodLabel: 'Q1', chargedRemainingAfter: 2 },
    })
    const removed = removeBasketballTimeout(
      periodTwo.state,
      target,
      '2026-08-09T12:12:00.000Z'
    )
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(basketballTimeoutInventory(removed.state)?.tracked).toMatchObject({
      used: 0,
      remaining: 2,
    })
  })

  it('does not correct earlier periods and rejects inactive or cloud-bound capture', () => {
    const periodOne = capture(
      startedState(),
      { mode: 'charged', teamSide: 'tracked', kind: 'full' },
      2
    )
    const ended = endBasketballPeriod(periodOne, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-09T12:10:00.000Z',
      eventId: id(10),
    })
    if (!ended.ok) throw new Error(ended.message)
    expect(basketballTimeoutInventory(ended.state)).toBeNull()
    expect(captureBasketballTimeout(ended.state, {
      recorderUserId: 'recorder-1',
      timeout: { mode: 'neutral', kind: 'official' },
    })).toMatchObject({ ok: false, code: 'invalid_period', state: ended.state })

    const periodTwo = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-09T12:11:00.000Z',
      eventId: id(11),
    })
    if (!periodTwo.ok) throw new Error(periodTwo.message)
    expect(previewBasketballTimeoutDecrement(
      periodTwo.state,
      { mode: 'charged', teamSide: 'tracked' }
    )).toMatchObject({ ok: false, code: 'nothing_to_undo' })

    const cloud = {
      ...periodTwo.state,
      cloudSync: { ...periodTwo.state.cloudSync, gameId: 'cloud-game', gameStatus: 'final' },
    }
    expect(captureBasketballTimeout(cloud, {
      recorderUserId: 'recorder-1',
      timeout: { mode: 'charged', teamSide: 'tracked', kind: 'full' },
    })).toMatchObject({ ok: false, code: 'cloud_flow_unsupported', state: cloud })
    expect(removeBasketballTimeout(
      cloud,
      { mode: 'charged', teamSide: 'tracked' }
    )).toMatchObject({ ok: false, code: 'cloud_flow_unsupported', state: cloud })
  })
})

function withProfile(state: GameState, profileId: 'fiba'): GameState {
  if (state.sportGameState?.sportId !== 'basketball') {
    throw new Error('Basketball state missing.')
  }
  const profile = getBasketballRulesProfile(profileId, 1)
  if (!profile) throw new Error('Basketball profile missing.')
  const candidate: GameState = {
    ...state,
    sportGameState: {
      ...state.sportGameState,
      setup: {
        ...state.sportGameState.setup,
        rulesSource: {
          profileId,
          profileVersion: profile.profileVersion,
          personalRevision: null,
          teamRevision: null,
          hasExplicitMatchOverrides: false,
        },
        rulesSnapshot: profile.rules,
      },
    },
  }
  const rebuilt = rebuildGameEventProjection(candidate, gameEventRegistry, gameEventProjectors)
  if (!rebuilt.inspection.complete) throw new Error('Basketball profile state did not project.')
  return rebuilt.state
}
