import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { addGameEvent } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createGameEventStream } from '../gameEvents/stream'
import { createBasketballClockEvent } from './clockEvents'
import {
  pauseBasketballClock,
  setBasketballClock,
  startBasketballClock,
} from './clockCommands'
import {
  BASKETBALL_CLOCK_MAX_WALL_DELTA_MS,
  basketballClockRecoveryIssue,
  deriveBasketballClockDisplay,
  recordBasketballRunningClockMomentAfterEvent,
} from './clockProjection'
import { captureBasketballCourtEvent } from './commands'
import { captureBasketballDirectStat } from './directCommands'
import { captureBasketballOfficialEjection } from './ejectionCommands'
import { createBasketballLifecycleEvent } from './events'
import { captureBasketballFoul } from './foulFreeThrowCommands'
import { getBasketballRulesProfile, upgradeBasketballRulesDraftToV3 } from './profiles'
import { createBasketballSportGameState } from './state'
import { createBasketballStatEvent } from './statEvents'
import {
  applyBasketballHistoricalShot,
  buildBasketballHistoricalShotDraft,
  previewBasketballHistoricalShot,
} from './shotEditCommands'
import { captureBasketballTimeout } from './timeoutCommands'
import type {
  BasketballMatchParticipant,
  BasketballMatchSetupV1,
  BasketballMatchSetupV2,
} from './types'

const basketball = sports.find(sport => sport.id === 'basketball')!
const recorderUserId = 'recorder-1'
const periodStart = '2026-08-26T15:00:00.000Z'

describe('BKE-6A2 Basketball anchored clock projection', () => {
  it('starts and pauses from explicit wall anchors without per-second events', () => {
    const state = anchoredState()
    const started = startBasketballClock(state, {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(2),
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const paused = pauseBasketballClock(started.state, {
      recorderUserId,
      occurredAt: '2026-08-26T15:00:05.250Z',
      eventId: uuid(3),
    })
    expect(paused.ok).toBe(true)
    if (!paused.ok) return
    expect(clockOf(paused.state)).toMatchObject({
      running: false,
      elapsedMs: 5_250,
      expired: false,
      lastStartEventId: uuid(2),
      lastPauseEventId: uuid(3),
    })
    expect(paused.state.eventStream?.events).toHaveLength(3)
  })

  it('appends a pause and optional stoppage atomically with an exact relationship', () => {
    const started = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(10),
    }))
    const result = pauseBasketballClock(started, {
      recorderUserId,
      occurredAt: '2026-08-26T15:00:03.000Z',
      eventId: uuid(11),
      captureCommandId: 'pause-command',
      stoppage: {
        category: 'out_of_bounds',
        note: 'Baseline',
        eventId: uuid(12),
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.eventStream?.events.slice(-2)).toMatchObject([
      {
        id: uuid(11),
        eventType: 'basketball.clock_paused',
        payload: { captureCommandId: 'pause-command', elapsedMs: 3_000, source: 'manual' },
      },
      {
        id: uuid(12),
        eventType: 'basketball.stoppage',
        payload: {
          captureCommandId: 'pause-command',
          pauseEventId: uuid(11),
          category: 'out_of_bounds',
          note: 'Baseline',
        },
      },
    ])
    expect(clockOf(result.state).lastStoppageEventId).toBe(uuid(12))
  })

  it('pauses before Set Clock and commits the replacement in one atomic batch', () => {
    const started = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(20),
    }))
    const result = setBasketballClock(started, {
      recorderUserId,
      occurredAt: '2026-08-26T15:00:08.000Z',
      pauseEventId: uuid(21),
      eventId: uuid(22),
      captureCommandId: 'adjust-command',
      elapsedMs: 2_500,
      reason: 'Correct operator entry',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(clockOf(result.state)).toMatchObject({
      running: false,
      elapsedMs: 2_500,
      lastPauseEventId: uuid(21),
      lastAdjustmentEventId: uuid(22),
    })
    expect(result.state.eventStream?.events.slice(-2)).toMatchObject([
      { payload: { elapsedMs: 8_000, source: 'manual' } },
      { payload: { fromElapsedMs: 8_000, toElapsedMs: 2_500 } },
    ])
  })

  it('materializes expiration once and rejects a duplicate pause without changing state', () => {
    const state = anchoredState()
    const durationMs = firstDuration(state)
    const started = requireState(startBasketballClock(state, {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(30),
    }))
    const expired = pauseBasketballClock(started, {
      recorderUserId,
      occurredAt: isoAfter(periodStart, durationMs + 5_000),
      eventId: uuid(31),
    })
    expect(expired.ok).toBe(true)
    if (!expired.ok) return
    expect(clockOf(expired.state)).toMatchObject({
      running: false,
      elapsedMs: durationMs,
      expired: true,
    })
    const expiredEvents = expired.state.eventStream?.events ?? []
    expect(expiredEvents[expiredEvents.length - 1]).toMatchObject({
      payload: { elapsedMs: durationMs, source: 'expiration' },
    })

    const duplicate = pauseBasketballClock(expired.state, {
      recorderUserId,
      occurredAt: isoAfter(periodStart, durationMs + 6_000),
    })
    expect(duplicate).toMatchObject({ ok: false, state: expired.state })
  })

  it('accumulates canonical elapsed across distinct running intervals', () => {
    const firstStart = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(32),
    }))
    const firstPause = requireState(pauseBasketballClock(firstStart, {
      recorderUserId,
      occurredAt: isoAfter(periodStart, 5_000),
      eventId: uuid(33),
    }))
    const secondStart = requireState(startBasketballClock(firstPause, {
      recorderUserId,
      occurredAt: isoAfter(periodStart, 10_000),
      eventId: uuid(34),
    }))
    const secondPause = pauseBasketballClock(secondStart, {
      recorderUserId,
      occurredAt: isoAfter(periodStart, 13_000),
      eventId: uuid(35),
    })
    expect(secondPause.ok).toBe(true)
    if (secondPause.ok) expect(clockOf(secondPause.state).elapsedMs).toBe(8_000)
  })

  it('rejects an overdue replay pause whose source claims it was manual', () => {
    const state = anchoredState()
    const durationMs = firstDuration(state)
    const started = requireState(startBasketballClock(state, {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(36),
    }))
    const event = createBasketballClockEvent({
      id: uuid(37),
      eventType: 'basketball.clock_paused',
      payload: { captureCommandId: null, elapsedMs: durationMs, source: 'manual' },
      recorderUserId,
      sequence: 3,
      period: currentPeriod(started),
      elapsedMs: durationMs,
      occurredAt: isoAfter(periodStart, durationMs + 1),
    })
    const rejected = addGameEvent(started, event, gameEventRegistry, gameEventProjectors)
    expect(rejected).toMatchObject({ ok: false, state: started })
  })

  it('rejects a backward replay timestamp while display clamps and warns', () => {
    const started = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: '2026-08-26T15:00:10.000Z',
      eventId: uuid(40),
    }))
    const rejected = pauseBasketballClock(started, {
      recorderUserId,
      occurredAt: '2026-08-26T15:00:09.000Z',
      eventId: uuid(41),
    })
    expect(rejected).toMatchObject({
      ok: false,
      state: started,
      code: 'invalid_timestamp',
    })

    const clock = clockOf(started)
    const durationMs = firstDuration(started)
    expect(deriveBasketballClockDisplay(
      clock,
      durationMs,
      'count_down',
      '2026-08-26T15:00:09.000Z'
    )).toEqual({
      elapsedMs: 0,
      displayMs: durationMs,
      reachedExpiration: false,
      backwardClockWarning: true,
    })
  })

  it('recovers a running clock at its exact last-known event watermark', () => {
    const started = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(45),
    }))
    const captured = captureBasketballCourtEvent(started, {
      recorderUserId,
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: {
        kind: 'shot',
        made: true,
        shotType: '2pt',
        assistPlayerId: 'player-2',
      },
      occurredAt: isoAfter(periodStart, 12_345),
      eventIds: [uuid(46), uuid(47)],
      captureCommandId: 'clock-linked-shot',
    })
    expect(captured.ok).toBe(true)
    if (!captured.ok) return
    expect(captured.state.eventStream?.events.slice(-2)).toMatchObject([
      { elapsedMs: 12_345, occurredAt: isoAfter(periodStart, 12_345) },
      { elapsedMs: 12_345, occurredAt: isoAfter(periodStart, 12_345) },
    ])
    expect(clockOf(captured.state).lastRunningElapsedMs).toBe(12_345)

    const recovered = setBasketballClock(captured.state, {
      recorderUserId,
      occurredAt: isoAfter(periodStart, -1_000),
      pauseEventId: uuid(48),
      eventId: uuid(49),
      captureCommandId: 'clock-recovery',
      elapsedMs: 20_000,
      reason: 'Device clock moved backward',
    })
    expect(recovered.ok).toBe(true)
    if (!recovered.ok) return
    expect(recovered.state.eventStream?.events.slice(-2)).toMatchObject([
      {
        eventType: 'basketball.clock_paused',
        elapsedMs: 12_345,
        occurredAt: isoAfter(periodStart, 12_345),
        payload: { elapsedMs: 12_345, source: 'manual' },
      },
      {
        eventType: 'basketball.clock_adjusted',
        elapsedMs: 20_000,
        occurredAt: isoAfter(periodStart, 12_345),
        payload: { fromElapsedMs: 12_345, toElapsedMs: 20_000 },
      },
    ])
    expect(clockOf(recovered.state)).toMatchObject({
      running: false,
      elapsedMs: 20_000,
    })
  })

  it('routes live stat, foul, timeout, and ejection families through canonical time', () => {
    let state = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(70),
    }))

    const direct = captureBasketballDirectStat(state, {
      recorderUserId,
      playerId: 'player-1',
      statId: 'ast',
      occurredAt: isoAfter(periodStart, 1_250),
      eventId: uuid(71),
    })
    expect(direct.ok).toBe(true)
    if (!direct.ok) return
    state = direct.state

    const foul = captureBasketballFoul(state, {
      recorderUserId,
      teamSide: 'tracked',
      offender: { kind: 'player', playerId: 'player-1' },
      class: 'personal',
      context: 'common',
      occurredAt: isoAfter(periodStart, 2_500),
      eventIds: [uuid(72)],
      captureCommandId: 'clock-foul',
    })
    expect(foul.ok).toBe(true)
    if (!foul.ok) return
    state = foul.state

    const timeout = captureBasketballTimeout(state, {
      recorderUserId,
      timeout: { mode: 'neutral', kind: 'official' },
      occurredAt: isoAfter(periodStart, 3_750),
      eventId: uuid(73),
    })
    expect(timeout.ok).toBe(true)
    if (!timeout.ok) return
    state = timeout.state

    const ejection = captureBasketballOfficialEjection(state, {
      recorderUserId,
      teamSide: 'tracked',
      subject: { kind: 'staff', label: 'Assistant coach' },
      reason: 'Second technical foul',
      occurredAt: isoAfter(periodStart, 5_000),
      eventId: uuid(74),
    })
    expect(ejection.ok).toBe(true)
    if (!ejection.ok) return

    expect(ejection.state.eventStream?.events.slice(-4)).toMatchObject([
      { id: uuid(71), elapsedMs: 1_250 },
      { id: uuid(72), elapsedMs: 2_500 },
      { id: uuid(73), elapsedMs: 3_750 },
      { id: uuid(74), elapsedMs: 5_000 },
    ])
    expect(clockOf(ejection.state).lastRunningElapsedMs).toBe(5_000)
  })

  it('accepts an explicit reviewed time for a recorded-later Timeline event', () => {
    const started = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(80),
    }))
    const paused = requireState(pauseBasketballClock(started, {
      recorderUserId,
      occurredAt: isoAfter(periodStart, 5_000),
      eventId: uuid(81),
    }))
    const built = buildBasketballHistoricalShotDraft(paused)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const preview = previewBasketballHistoricalShot(
      paused,
      { ...built.value, elapsedMs: 1_000 },
      recorderUserId,
      isoAfter(periodStart, 5_000)
    )
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.value.draft.elapsedMs).toBe(1_000)
    expect(preview.value.consequenceLines.some(line => line.includes('Q1'))).toBe(true)
    const applied = applyBasketballHistoricalShot(paused, preview.value)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.state.eventStream?.events).toContainEqual(expect.objectContaining({
      id: built.value.eventId,
      payload: expect.objectContaining({ recordedLater: true }),
    }))
  })

  it('keeps recorded-later and non-active-period events out of the running watermark', () => {
    const started = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(82),
    }))
    if (started.sportGameState?.sportId !== 'basketball') throw new Error('Basketball state required')
    const projection = started.sportGameState.projection
    const recordedLater = createBasketballStatEvent({
      id: uuid(83),
      eventType: 'basketball.score_adjustment',
      payload: {
        delta: 1,
        reason: 'scoreboard_control',
        note: null,
        captureCommandId: null,
        recordedLater: true,
      },
      recorderUserId,
      sequence: 3,
      period: currentPeriod(started),
      elapsedMs: 45_000,
      occurredAt: isoAfter(periodStart, 60_000),
      teamSide: 'tracked',
      actors: [{ role: 'team', kind: 'team', label: 'Aces' }],
    })
    recordBasketballRunningClockMomentAfterEvent(projection, recordedLater)
    expect(projection.clock?.lastRunningElapsedMs).toBe(0)

    recordBasketballRunningClockMomentAfterEvent(projection, {
      ...recordedLater,
      id: uuid(84),
      period: { id: 'regulation-previous', order: 0 },
      payload: {
        delta: 1,
        reason: 'scoreboard_control',
        note: null,
        captureCommandId: null,
      },
    })
    expect(projection.clock?.lastRunningElapsedMs).toBe(0)
  })

  it('classifies backward and excessive wall-clock recovery boundaries', () => {
    const started = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(51),
    }))
    const clock = clockOf(started)
    expect(basketballClockRecoveryIssue(clock, isoAfter(periodStart, -1))).toBe('backward')
    expect(basketballClockRecoveryIssue(
      clock,
      isoAfter(periodStart, BASKETBALL_CLOCK_MAX_WALL_DELTA_MS)
    )).toBeNull()
    expect(basketballClockRecoveryIssue(
      clock,
      isoAfter(periodStart, BASKETBALL_CLOCK_MAX_WALL_DELTA_MS + 1)
    )).toBe('excessive_delta')
  })

  it('rejects canonical elapsed moving backward within one running interval', () => {
    const started = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(42),
    }))
    const firstEvent = createBasketballStatEvent({
      id: uuid(43),
      eventType: 'basketball.score_adjustment',
      payload: {
        delta: 1,
        reason: 'scoreboard_control',
        note: null,
        captureCommandId: null,
      },
      recorderUserId,
      sequence: 3,
      period: currentPeriod(started),
      elapsedMs: 60_000,
      occurredAt: isoAfter(periodStart, 60_000),
      teamSide: 'tracked',
      actors: [{ role: 'team', kind: 'team', label: 'Aces' }],
    })
    const forward = addGameEvent(
      started,
      firstEvent,
      gameEventRegistry,
      gameEventProjectors
    )
    expect(forward.ok).toBe(true)
    if (!forward.ok) return

    const secondEvent = createBasketballStatEvent({
      id: uuid(44),
      eventType: 'basketball.score_adjustment',
      payload: {
        delta: 1,
        reason: 'scoreboard_control',
        note: null,
        captureCommandId: null,
      },
      recorderUserId,
      sequence: 4,
      period: currentPeriod(forward.state),
      elapsedMs: 35_000,
      occurredAt: isoAfter(periodStart, 35_000),
      teamSide: 'tracked',
      actors: [{ role: 'team', kind: 'team', label: 'Aces' }],
    })
    const backward = addGameEvent(
      forward.state,
      secondEvent,
      gameEventRegistry,
      gameEventProjectors
    )
    expect(backward).toMatchObject({ ok: false, state: forward.state })
    expect(clockOf(forward.state).lastRunningElapsedMs).toBe(60_000)
  })

  it('uses one canonical elapsed value for count-up and count-down displays', () => {
    const started = requireState(startBasketballClock(anchoredState(), {
      recorderUserId,
      occurredAt: periodStart,
      eventId: uuid(50),
    }))
    const clock = clockOf(started)
    const durationMs = firstDuration(started)
    const now = isoAfter(periodStart, 12_345)
    expect(deriveBasketballClockDisplay(clock, durationMs, 'count_up', now)?.displayMs)
      .toBe(12_345)
    expect(deriveBasketballClockDisplay(clock, durationMs, 'count_down', now)?.displayMs)
      .toBe(durationMs - 12_345)
  })

  it('strictly validates clock payloads and rejects clock events in clockless games', () => {
    const state = anchoredState()
    const event = createBasketballClockEvent({
      id: uuid(60),
      eventType: 'basketball.clock_started',
      payload: { captureCommandId: null, anchorElapsedMs: 0 },
      recorderUserId,
      sequence: 2,
      period: currentPeriod(state),
      elapsedMs: 0,
      occurredAt: periodStart,
    })
    expect(gameEventRegistry.inspect({
      ...event,
      payload: { ...event.payload, unexpected: true },
    }).ok).toBe(false)

    const clockless = clocklessState()
    const appended = addGameEvent(clockless, event, gameEventRegistry, gameEventProjectors)
    expect(appended).toMatchObject({ ok: false, state: clockless })
  })
})

function anchoredState(): GameState {
  const v2 = getBasketballRulesProfile('nfhs', 1)!.rules
  const rules = upgradeBasketballRulesDraftToV3(v2, 'nfhs')
  const participants = trackedParticipants(5)
  const setup: BasketballMatchSetupV2 = {
    version: 2,
    trackedTeamDesignation: 'home',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSource: rulesSource(),
    rulesSnapshot: rules,
    participants,
    openingLineups: {
      tracked: { participantIds: participants.map(value => value.id), shortHandedReason: null },
      opponent: null,
    },
  }
  return startFirstPeriod(setup)
}

function clocklessState(): GameState {
  const setup: BasketballMatchSetupV1 = {
    version: 1,
    trackedTeamDesignation: 'home',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSource: rulesSource(),
    rulesSnapshot: getBasketballRulesProfile('nfhs', 1)!.rules,
    participants: trackedParticipants(5),
  }
  return startFirstPeriod(setup)
}

function startFirstPeriod(
  setup: BasketballMatchSetupV1 | BasketballMatchSetupV2
): GameState {
  const segment = setup.rulesSnapshot.regulationSegments[0]
  const players: Player[] = setup.participants.map(value => ({
    id: value.playerId!,
    name: value.displayName,
    number: value.number ?? '',
    stats: {},
  }))
  const state: GameState = {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    eventStream: createGameEventStream(),
    sportGameState: createBasketballSportGameState(setup),
    players,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-26',
    },
  }
  const started = addGameEvent(state, createBasketballLifecycleEvent({
    id: uuid(1),
    eventType: 'basketball.period_started',
    payload: { periodId: segment.id, captureCommandId: null },
    recorderUserId,
    sequence: 1,
    period: { id: segment.id, order: segment.order },
    elapsedMs: setup.version === 2 ? 0 : null,
    occurredAt: periodStart,
  }), gameEventRegistry, gameEventProjectors)
  if (!started.ok) throw new Error(started.error.message)
  return started.state
}

function trackedParticipants(count: number): BasketballMatchParticipant[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `tracked-${index + 1}`,
    playerId: `player-${index + 1}`,
    displayName: `Player ${index + 1}`,
    number: String(index + 1),
    teamSide: 'tracked',
    initialStatus: 'starter',
    position: null,
    captain: index === 0,
  }))
}

function rulesSource() {
  return {
    profileId: 'nfhs',
    profileVersion: 1,
    personalRevision: null,
    teamRevision: null,
    hasExplicitMatchOverrides: false,
  }
}

function currentPeriod(state: GameState) {
  const segment = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection.periods[0]
    : null
  if (!segment) throw new Error('Missing Basketball period')
  return { id: segment.id, order: segment.order }
}

function firstDuration(state: GameState): number {
  if (state.sportGameState?.sportId !== 'basketball') throw new Error('Missing Basketball state')
  return state.sportGameState.projection.periods[0].durationMs
}

function clockOf(state: GameState) {
  if (state.sportGameState?.sportId !== 'basketball' || !state.sportGameState.projection.clock) {
    throw new Error('Missing anchored Basketball clock')
  }
  return state.sportGameState.projection.clock
}

function requireState(result: { ok: true; state: GameState } | { ok: false; message: string }): GameState {
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function isoAfter(value: string, deltaMs: number): string {
  return new Date(Date.parse(value) + deltaMs).toISOString()
}

function uuid(value: number): string {
  return `60000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}
