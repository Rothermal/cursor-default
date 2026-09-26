import { describe, expect, it } from 'vitest'
import { inspectGameEventStream } from '../gameEvents/stream'
import { gameEventRegistry } from '../gameEvents/runtime'
import type { GameState } from '../../types'
import {
  adjustBaseballScore,
  baseballSportState,
  endBaseballGame,
  initializeBaseballEventGame,
  substituteBaseball,
} from './commands'
import { replayBaseballEvents } from './projector'
import {
  ballInPlay,
  baseballSetup,
  ctx,
  expectOk,
  pitch,
  projection,
  startedGame,
  strikeout,
  threeUpThreeDown,
} from './testFixtures'
import type { BaseballMatchSetup } from './types'

function adjust(state: GameState, side: 'tracked' | 'opponent', delta: number): GameState {
  return expectOk(adjustBaseballScore(state, side, delta, 'Correction', ctx()))
}

function activeEvents(state: GameState) {
  return inspectGameEventStream(state.eventStream!, gameEventRegistry).activeEvents
}

describe('Baseball setup immutability', () => {
  it('rejects replacement rules once the event stream exists', () => {
    const state = startedGame()
    const result = initializeBaseballEventGame(state, baseballSetup({ rules: { scheduledInnings: 1 } }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('already_initialized')
    expect(result.state).toBe(state)
    expect(baseballSportState(state)?.setup.rulesSnapshot.scheduledInnings).toBe(7)
  })

  it('rejects changed participant identities', () => {
    const state = startedGame()
    const setup = baseballSetup()
    const renamed: BaseballMatchSetup = {
      ...setup,
      participants: setup.participants.map((participant, index) =>
        index === 0 ? { ...participant, playerId: 'someone-else' } : participant
      ),
    }

    const result = initializeBaseballEventGame(state, renamed)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('already_initialized')
  })

  it('treats an identical setup as an idempotent no-op', () => {
    const state = startedGame()
    const result = initializeBaseballEventGame(state, baseballSetup())

    expect(result.ok).toBe(true)
    expect(result.state).toBe(state)
    expect(result.ok && result.events).toEqual([])
  })
})

describe('Baseball runner identity', () => {
  function courtesyOnSecond(): GameState {
    // Tracked bats first; t1 pitches and t2 catches.
    let state = startedGame(baseballSetup({ trackedSide: 'away' }))
    state = ballInPlay(state, 'single')
    state = expectOk(
      substituteBaseball(state, 'tracked', { kind: 'courtesy_runner', incomingId: 't10', outgoingId: 't1' }, ctx())
    )
    state = ballInPlay(state, 'single')
    expect(projection(state).bases.second?.runnerId).toBe('t10')
    expect(projection(state).bases.first?.runnerId).toBe('t2')
    return state
  }

  it('rejects a courtesy runner who is already on base', () => {
    const state = courtesyOnSecond()
    const result = substituteBaseball(
      state,
      'tracked',
      { kind: 'courtesy_runner', incomingId: 't10', outgoingId: 't2' },
      ctx()
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/bench/)
  })

  it('rejects a pinch runner or defensive replacement who is already on base', () => {
    const state = courtesyOnSecond()
    expect(
      substituteBaseball(state, 'tracked', { kind: 'pinch_runner', incomingId: 't10', outgoingId: 't2' }, ctx()).ok
    ).toBe(false)
    expect(
      substituteBaseball(
        state,
        'tracked',
        { kind: 'defensive', position: 5, incomingId: 't10', outgoingId: null },
        ctx()
      ).ok
    ).toBe(false)
  })

  it('still accepts a bench courtesy runner', () => {
    const state = courtesyOnSecond()
    const next = expectOk(
      substituteBaseball(state, 'tracked', { kind: 'courtesy_runner', incomingId: 't11', outgoingId: 't2' }, ctx())
    )
    expect(projection(next).bases.first?.runnerId).toBe('t11')
    expect(projection(next).bases.second?.runnerId).toBe('t10')
  })
})

describe('Baseball endings after score adjustments', () => {
  const oneInning = () => baseballSetup({ rules: { scheduledInnings: 1, runRules: [] } })

  it('opens the skipped bottom half when an adjustment removes the home lead', () => {
    let state = startedGame(oneInning())
    state = adjust(state, 'tracked', 1)
    state = threeUpThreeDown(state)
    expect(projection(state).pendingEnd).toBe('regulation')

    state = adjust(state, 'opponent', 2)
    const p = projection(state)
    expect(p.pendingEnd).toBeNull()
    expect(p.half).toBe('bottom')
    expect(p.battingSide).toBe('tracked')
    expect(p.outs).toBe(0)
    expect(endBaseballGame(state, 'completed', ctx()).ok).toBe(false)

    // Play continues in the bottom half.
    state = pitch(state, { result: 'ball' })
    expect(projection(state).balls).toBe(1)
  })

  it('keeps an ending the adjusted score still supports', () => {
    let state = startedGame(oneInning())
    state = adjust(state, 'tracked', 1)
    state = threeUpThreeDown(state)
    state = adjust(state, 'tracked', 1)
    expect(projection(state).pendingEnd).toBe('regulation')
    const ended = expectOk(endBaseballGame(state, 'completed', ctx()))
    expect(projection(ended).result?.winner).toBe('tracked')
  })

  it('resumes the half when a walk-off is invalidated, and ends it when restored', () => {
    let state = startedGame(oneInning())
    state = threeUpThreeDown(state)
    expect(projection(state).half).toBe('bottom')

    state = adjust(state, 'tracked', 1)
    expect(projection(state).pendingEnd).toBe('walk_off')

    state = adjust(state, 'opponent', 1)
    let p = projection(state)
    expect(p.pendingEnd).toBeNull()
    expect(p.lineScore[p.lineScore.length - 1].complete).toBe(false)
    expect(endBaseballGame(state, 'completed', ctx()).ok).toBe(false)
    state = strikeout(state)
    expect(projection(state).outs).toBe(1)

    state = adjust(state, 'tracked', 1)
    p = projection(state)
    expect(p.pendingEnd).toBe('walk_off')
    expect(expectOk(endBaseballGame(state, 'completed', ctx())).eventStream).not.toBeNull()
  })

  it('resumes a bottom half when a mid-half run rule is invalidated', () => {
    let state = startedGame(baseballSetup({ rules: { scheduledInnings: 3, runRules: [{ afterInning: 1, lead: 2 }] } }))
    state = threeUpThreeDown(state)
    state = adjust(state, 'tracked', 2)
    expect(projection(state).pendingEnd).toBe('run_rule')

    state = adjust(state, 'opponent', 1)
    expect(projection(state).pendingEnd).toBeNull()
    expect(endBaseballGame(state, 'run_rule', ctx()).ok).toBe(false)
    state = pitch(state, { result: 'ball' })
    expect(projection(state).balls).toBe(1)
  })

  it('opens the next half when a boundary run rule is invalidated', () => {
    let state = startedGame(baseballSetup({ rules: { scheduledInnings: 3, runRules: [{ afterInning: 2, lead: 2 }] } }))
    state = threeUpThreeDown(threeUpThreeDown(state))
    expect(projection(state).inning).toBe(2)
    state = adjust(state, 'tracked', 2)
    state = threeUpThreeDown(state)
    expect(projection(state).pendingEnd).toBe('run_rule')

    state = adjust(state, 'opponent', 1)
    const p = projection(state)
    expect(p.pendingEnd).toBeNull()
    expect(p.inning).toBe(2)
    expect(p.half).toBe('bottom')
  })
})

describe('Baseball resolved actor stamps', () => {
  it('stamps batter, pitcher and referenced fielders at capture', () => {
    const state = strikeout(startedGame())
    const events = activeEvents(state)
    const last = events[events.length - 1]
    expect(last.actors.map(actor => [actor.role, actor.participantId])).toEqual([
      ['batter', 'o1'],
      ['pitcher', 't1'],
      ['fielder_1', 't1'],
      ['fielder_2', 't2'],
    ])
  })

  it('keeps fielding credit with the stamped player after a lineup correction and reports the mismatch', () => {
    const state = strikeout(startedGame())
    const events = activeEvents(state)
    const corrected = baseballSetup()
    corrected.trackedLineup.defense = { ...corrected.trackedLineup.defense, '2': 't3', '3': 't2' }

    const replay = replayBaseballEvents(corrected, events)
    expect(replay.diagnostics).toEqual([])
    expect(replay.projection.fieldingLines.t2?.po).toBe(1)
    expect(replay.projection.fieldingLines.t3?.po ?? 0).toBe(0)
    expect(replay.projection.warnings).toContainEqual(
      expect.objectContaining({
        code: 'actor_mismatch',
        role: 'fielder_2',
        recordedParticipantId: 't2',
        resolvedParticipantId: 't3',
      })
    )
  })

  it('falls back to the replayed lineup for unstamped events without warnings', () => {
    const state = strikeout(startedGame())
    const events = activeEvents(state).map(event => ({ ...event, actors: [] }))
    const corrected = baseballSetup()
    corrected.trackedLineup.defense = { ...corrected.trackedLineup.defense, '2': 't3', '3': 't2' }

    const replay = replayBaseballEvents(corrected, events)
    expect(replay.projection.fieldingLines.t3?.po).toBe(1)
    expect(replay.projection.warnings).toEqual([])
  })

  it('reports a batter mismatch without moving the batting line', () => {
    const state = strikeout(startedGame())
    const events = activeEvents(state).map(event =>
      event.eventType === 'baseball.pitch'
        ? {
            ...event,
            actors: event.actors.map(actor =>
              actor.role === 'batter' ? { ...actor, participantId: 'o5', label: 'Batter 5' } : actor
            ),
          }
        : event
    )
    const replay = replayBaseballEvents(baseballSetup(), events)
    expect(replay.projection.battingLines.o1?.k).toBe(1)
    expect(replay.projection.warnings.some(warning => warning.role === 'batter')).toBe(true)
  })
})
