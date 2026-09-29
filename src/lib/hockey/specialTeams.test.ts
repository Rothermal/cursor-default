import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { createInitialState, gameReducer } from '../gameReducer'
import {
  hockeyPenaltyBoxNow,
  pullHockeyGoalie,
  recordHockeyPenalties,
  recordHockeyShot,
  recordHockeyTeamEvent,
  recordHockeyTimeout,
  releaseHockeyPenalty,
  type HockeyPenaltyInput,
  type RecordHockeyShotInput,
} from './captureCommands'
import { createHockeyEvent } from './events'
import { hockeySportState, pauseHockeyClock, setHockeyClock, startHockeyClock, startHockeyGame, type HockeyCommandResult } from './live'
import { hockeySpecialTeams } from './penalties'
import { createHockeyMatchRules } from './profiles'
import { replayHockeyEvents } from './projector'
import { hockeyRecentEvents, undoHockeyCapture } from './recentEvents'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyMatchSetup, HockeyOnIce, HockeyProfileId, HockeyStrength } from './types'

/** A running anchored game: the clock starts at second 1, so elapsed = seconds - 1. */
function running(profile: HockeyProfileId = 'usa_hockey_youth', setup?: HockeyMatchSetup): GameState {
  const state = expectOk(startHockeyGame(initializedHockeyGame(setup ?? hockeySetup({ profile })), ctx(0)))
  return expectOk(startHockeyClock(state, ctx(1)))
}

const MINOR = { class: 'minor', infraction: 'tripping', offenderKind: 'player' } as const

function penalty(input: HockeyPenaltyInput, seconds: number) {
  return (state: GameState) => expectOk(recordHockeyPenalties(state, { penalties: [input] }, ctx(seconds)))
}

const trackedMinor = (id = 'p2', seconds = 11) => penalty({ ...MINOR, side: 'tracked', offender: { participantId: id } }, seconds)
const opponentMinor = (seconds = 11, extra: Partial<HockeyPenaltyInput> = {}) =>
  penalty({ ...MINOR, side: 'opponent', offender: { label: '#9' }, ...extra }, seconds)

function goal(state: GameState, input: Partial<RecordHockeyShotInput> & { side: RecordHockeyShotInput['side'] }, seconds: number): GameState {
  return expectOk(recordHockeyShot(state, { outcome: 'goal', ...input }, ctx(seconds)))
}

function lastEvent(state: GameState): GameEvent {
  const events = state.eventStream!.events as GameEvent[]
  return events[events.length - 1]
}

function storedStrength(state: GameState): HockeyStrength | null {
  return (lastEvent(state).payload as { strength: HockeyStrength | null }).strength
}

function stat(state: GameState, playerId: string, id: string): number {
  return state.players.find(player => player.id === playerId)?.stats[id] ?? 0
}

function hydrate(state: GameState): GameState {
  return gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
}

function rejected(result: HockeyCommandResult): string {
  if (result.ok) throw new Error('Expected a rejection')
  return result.message
}

const FIVE = ['p2', 'p3', 'p4', 'p5', 'p6']
const complete = (skaters: string[] = FIVE, goalie = 'p1'): HockeyOnIce => ({ status: 'complete', skaterParticipantIds: skaters, goalie })

describe('goal strength', () => {
  it('prefills even strength, power play and short-handed from the box', () => {
    let state = goal(running(), { side: 'tracked' }, 5)
    expect(storedStrength(state)).toBe('ev')
    state = opponentMinor(11)(state)
    state = goal(state, { side: 'tracked' }, 21)
    expect(storedStrength(state)).toBe('pp')
    state = trackedMinor('p3', 31)(state)
    // 4v5 for the tracked side after the power-play goal released the opponent's minor.
    state = goal(state, { side: 'tracked' }, 41)
    expect(storedStrength(state)).toBe('sh')
    state = goal(state, { side: 'opponent', shooter: { label: '#10' } }, 42)
    expect(storedStrength(state)).toBe('pp')
    expect(projection(state).goalsByStrength).toEqual({
      tracked: { ev: 1, pp: 1, sh: 1, unrecorded: 0 },
      opponent: { ev: 0, pp: 1, sh: 0, unrecorded: 0 },
    })
  })

  it('treats a pulled-goalie extra attacker as even strength', () => {
    let state = expectOk(pullHockeyGoalie(running(), { side: 'tracked' }, ctx(5)))
    expect(hockeyPenaltyBoxNow(hockeySportState(state)!, at(6)).strength!.tracked.skatersOnIce).toBe(6)
    state = goal(state, { side: 'tracked' }, 6)
    expect(storedStrength(state)).toBe('ev')
  })

  it('stores the recorder\'s choice and keeps it through a clock correction', () => {
    let state = opponentMinor(11)(running())
    state = goal(state, { side: 'tracked', strength: 'ev' }, 21)
    expect(storedStrength(state)).toBe('ev')
    state = goal(state, { side: 'tracked' }, 22)
    const goalId = lastEvent(state).id
    state = expectOk(pauseHockeyClock(state, ctx(23)))
    state = expectOk(setHockeyClock(state, { elapsedMs: 0, reason: 'Clock restarted wrongly' }, ctx(24)))
    const stored = (state.eventStream!.events as GameEvent[]).find(event => event.id === goalId)!
    expect((stored.payload as { strength: string }).strength).toBe('pp')
    expect(projection(state).goalsByStrength.tracked.pp).toBe(1)
  })

  it('asks clockless games with even strength preselected', () => {
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
    state = opponentMinor(5)(state)
    state = goal(state, { side: 'tracked' }, 6)
    expect(storedStrength(state)).toBe('ev')
    state = goal(state, { side: 'tracked', strength: 'pp' }, 7)
    expect(storedStrength(state)).toBe('pp')
    expect(hockeySpecialTeams(hockeySportState(state)!.setup, projection(state))).toEqual({
      powerPlayOpportunities: null,
      powerPlayGoals: { tracked: 1, opponent: 0 },
      shortHandedGoals: { tracked: 0, opponent: 0 },
    })
  })

  it('records strength on goals only', () => {
    expect(rejected(recordHockeyShot(running(), { side: 'tracked', outcome: 'saved', strength: 'pp' }, ctx(5))))
      .toBe('Only a goal records its strength.')
  })
})

describe('power-play goal release', () => {
  it('ends the short-handed side\'s minor with the least time left', () => {
    let state = opponentMinor(11)(running())
    state = penalty({ ...MINOR, side: 'opponent', offender: { label: '#4' } }, 31)(state)
    state = goal(state, { side: 'tracked' }, 41)
    const reading = hockeyPenaltyBoxNow(hockeySportState(state)!, at(41))
    expect(reading.box.opponent.map(entry => entry.label)).toEqual(['#4'])
    expect(reading.box.powerPlayReleases).toEqual([expect.objectContaining({ goalEventId: lastEvent(state).id, segment: 1 })])
    expect(`${reading.strength!.tracked.baseSkaters}v${reading.strength!.opponent.baseSkaters}`).toBe('5v4')
  })

  it('never releases a major', () => {
    let state = penalty({ side: 'opponent', class: 'major', infraction: 'boarding', offenderKind: 'player' }, 11)(running())
    state = goal(state, { side: 'tracked' }, 21)
    expect(storedStrength(state)).toBe('pp')
    expect(hockeyPenaltyBoxNow(hockeySportState(state)!, at(21)).box.opponent).toHaveLength(1)
  })

  it('releases only the segment of a double minor being served', () => {
    let state = opponentMinor(11, { class: 'double_minor' })(running())
    state = goal(state, { side: 'tracked' }, 21)
    const box = hockeyPenaltyBoxNow(hockeySportState(state)!, at(21)).box.opponent
    expect(box.map(entry => [entry.segment, entry.status, entry.remainingMs])).toEqual([[2, 'running', 120_000]])
  })

  it('keeps the minor when the rules do not release on a power-play goal', () => {
    const base = createHockeyMatchRules('usa_hockey_youth')
    const setup = hockeySetup({ rules: { penalties: { ...base.penalties, releaseMinorOnPowerPlayGoal: false } } })
    let state = opponentMinor(11)(running('usa_hockey_youth', setup))
    state = goal(state, { side: 'tracked' }, 21)
    expect(hockeyPenaltyBoxNow(hockeySportState(state)!, at(21)).box.opponent).toHaveLength(1)
  })

  it('brings the minor back when the goal is undone', () => {
    let state = opponentMinor(11)(running())
    state = goal(state, { side: 'tracked' }, 21)
    expect(hockeyPenaltyBoxNow(hockeySportState(state)!, at(21)).box.opponent).toEqual([])
    state = expectOk(undoHockeyCapture(state, at(22)))
    expect(hockeyPenaltyBoxNow(hockeySportState(state)!, at(22)).box.opponent[0].remainingMs).toBe(109_000)
  })
})

describe('penalty-shot goals', () => {
  const opponentBox = (state: GameState, seconds: number) => hockeyPenaltyBoxNow(hockeySportState(state)!, at(seconds)).box.opponent

  it('never release a minor, whether the strength is derived or chosen', () => {
    for (const strength of [undefined, 'pp'] as const) {
      let state = opponentMinor(11)(running())
      state = goal(state, { side: 'tracked', penaltyShot: true, ...(strength ? { strength } : {}) }, 21)
      expect(storedStrength(state)).toBe('pp')
      expect(projection(state).score.tracked).toBe(1)
      expect(projection(state).powerPlayGoals).toEqual([])
      expect(opponentBox(state, 21).map(entry => entry.remainingMs)).toEqual([110_000])
      expect(hockeyPenaltyBoxNow(hockeySportState(state)!, at(21)).box.powerPlayReleases).toEqual([])
    }
  })

  it('keep the minor through hydration and Undo, and a later power-play goal still releases it', () => {
    let state = opponentMinor(11)(running())
    state = goal(state, { side: 'tracked', penaltyShot: true }, 21)
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
    expect(projection(hydrated)).toEqual(projection(state))
    expect(opponentBox(hydrated, 21)).toHaveLength(1)
    const undone = expectOk(undoHockeyCapture(state, at(22)))
    expect(opponentBox(undone, 22).map(entry => entry.remainingMs)).toEqual([109_000])
    state = goal(state, { side: 'tracked' }, 31)
    expect(opponentBox(state, 31)).toEqual([])
  })
})

describe('power-play opportunities after assessment', () => {
  const opportunities = (state: GameState) =>
    hockeySpecialTeams(hockeySportState(state)!.setup, projection(state)).powerPlayOpportunities

  it('counts a power play that begins when the earlier of two opposite minors expires', () => {
    let state = trackedMinor('p2', 11)(running())
    state = opponentMinor(61)(state)
    expect(opportunities(state)).toEqual({ tracked: 0, opponent: 1 })
    state = goal(state, { side: 'tracked' }, 141)
    expect(storedStrength(state)).toBe('pp')
    expect(opportunities(state)).toEqual({ tracked: 1, opponent: 1 })
    // The opponent minor then ends by the power-play goal: nothing more to count.
    state = goal(state, { side: 'opponent', shooter: { label: '#9' } }, 150)
    expect(storedStrength(state)).toBe('ev')
    expect(opportunities(state)).toEqual({ tracked: 1, opponent: 1 })
  })

  it('shows a power play that begins by expiry on the live clock, with no goal or pause', () => {
    let state = trackedMinor('p2', 11)(running())
    state = opponentMinor(61)(state)
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved' }, ctx(141)))
    const live = (seconds: number) => {
      const sport = hockeySportState(state)!
      return hockeySpecialTeams(sport.setup, sport.projection, hockeyPenaltyBoxNow(sport, at(seconds)).box).powerPlayOpportunities
    }
    expect(live(100)).toEqual({ tracked: 0, opponent: 1 })
    expect(live(141)).toEqual({ tracked: 1, opponent: 1 })
    expect(live(150)).toEqual({ tracked: 1, opponent: 1 })
    expect(hockeyPenaltyBoxNow(hockeySportState(state)!, at(141)).box.powerPlayOpportunities).toEqual(live(141))
    // Nothing about the displayed time is stored.
    expect(hydrate(state).eventStream).toEqual(state.eventStream)
  })

  it('counts a power play that begins with an early release', () => {
    let state = trackedMinor('p2', 11)(running())
    const first = lastEvent(state).id
    state = opponentMinor(61)(state)
    state = expectOk(releaseHockeyPenalty(state, { penaltyEventId: first, reason: 'Wrong player' }, ctx(71)))
    expect(opportunities(state)).toEqual({ tracked: 1, opponent: 1 })
  })

  it('does not count minors that end together', () => {
    let state = trackedMinor('p2', 11)(running())
    state = opponentMinor(11)(state)
    state = goal(state, { side: 'tracked' }, 141)
    expect(storedStrength(state)).toBe('ev')
    expect(opportunities(state)).toEqual({ tracked: 0, opponent: 1 })
  })

  it('does not count a double minor twice when four on four ends or its second half starts', () => {
    let state = penalty({ ...MINOR, class: 'double_minor', side: 'tracked', offender: { participantId: 'p2' } }, 11)(running())
    state = opponentMinor(61)(state)
    state = goal(state, { side: 'opponent', shooter: { label: '#9' } }, 191)
    expect(storedStrength(state)).toBe('pp')
    expect(opportunities(state)).toEqual({ tracked: 0, opponent: 1 })
  })
})

describe('special teams totals and stats', () => {
  it('counts power-play opportunities, not coincidental or four-on-four minors', () => {
    let state = opponentMinor(11)(running())
    state = trackedMinor('p2', 200)(state)
    state = goal(state, { side: 'opponent', shooter: { label: '#9' } }, 210)
    state = expectOk(recordHockeyPenalties(state, {
      penalties: [{ ...MINOR, side: 'tracked', offender: { participantId: 'p3' } }, { ...MINOR, side: 'opponent', offender: { label: '#8' } }],
      coincidental: true,
    }, ctx(400)))
    const setup = hockeySportState(state)!.setup
    expect(hockeySpecialTeams(setup, projection(state))).toEqual({
      powerPlayOpportunities: { tracked: 1, opponent: 1 },
      powerPlayGoals: { tracked: 0, opponent: 1 },
      shortHandedGoals: { tracked: 0, opponent: 0 },
    })

    let nhl = expectOk(recordHockeyPenalties(running('nhl_regular'), {
      penalties: [{ ...MINOR, side: 'tracked', offender: { participantId: 'p3' } }, { ...MINOR, side: 'opponent', offender: { label: '#8' } }],
      coincidental: true,
    }, ctx(5)))
    nhl = goal(nhl, { side: 'tracked' }, 6)
    expect(storedStrength(nhl)).toBe('ev')
    expect(hockeySpecialTeams(hockeySportState(nhl)!.setup, projection(nhl)).powerPlayOpportunities).toEqual({ tracked: 0, opponent: 0 })
  })

  it('credits power-play and short-handed goals and assists', () => {
    let state = opponentMinor(11)(running())
    state = goal(state, { side: 'tracked', shooter: { participantId: 'p2' }, assists: [{ participantId: 'p3' }, { participantId: 'p4' }] }, 21)
    state = trackedMinor('p5', 31)(state)
    state = goal(state, { side: 'tracked', shooter: { participantId: 'p3' }, assists: [{ participantId: 'p2' }] }, 41)
    expect([stat(state, 'player-2', 'hky_ppg'), stat(state, 'player-2', 'hky_sha')]).toEqual([1, 1])
    expect([stat(state, 'player-3', 'hky_ppa'), stat(state, 'player-3', 'hky_shg')]).toEqual([1, 1])
    expect(stat(state, 'player-4', 'hky_ppa')).toBe(1)
    expect(hockeyRecentEvents(state)[0].label).toBe('Tracked goal (SH) by Player 3')
  })
})

describe('plus/minus', () => {
  it('counts even-strength and short-handed goals with a complete on-ice set', () => {
    let state = goal(running(), { side: 'tracked', onIce: complete() }, 5)
    state = goal(state, { side: 'opponent', shooter: { label: '#9' }, onIce: complete(['p2', 'p3', 'p4', 'p5', 'p6']) }, 6)
    state = goal(state, { side: 'tracked', onIce: complete(['p2', 'p3', 'p4', 'p5', 'p6']) }, 7)
    expect(stat(state, 'player-2', 'hky_pm')).toBe(1)
    expect(stat(state, 'player-6', 'hky_pm')).toBe(1)
    // Short-handed goal for: counts. Power-play goal against the short-handed side: does not.
    state = trackedMinor('p6', 11)(state)
    state = goal(state, { side: 'tracked', onIce: complete(['p2', 'p3', 'p4', 'p5']) }, 12)
    expect(storedStrength(state)).toBe('sh')
    state = trackedMinor('p5', 13)(state)
    state = goal(state, { side: 'opponent', shooter: { label: '#9' }, onIce: complete(['p2', 'p3', 'p4']) }, 14)
    expect(storedStrength(state)).toBe('pp')
    expect(stat(state, 'player-2', 'hky_pm')).toBe(2)
    expect(stat(state, 'player-5', 'hky_pm')).toBe(2)
    expect(stat(state, 'player-6', 'hky_pm')).toBe(1)
    expect(projection(state).plusMinusSkippedGoalIds).toEqual([])
  })

  it('counts empty-net goals and skips power-play goals for', () => {
    let state = expectOk(pullHockeyGoalie(running(), { side: 'tracked' }, ctx(5)))
    state = goal(state, { side: 'opponent', shooter: { label: '#9' }, onIce: complete(['p2', 'p3', 'p4', 'p5', 'p6', 'p7'].slice(0, 5), 'empty_net') }, 6)
    expect(stat(state, 'player-2', 'hky_pm')).toBe(-1)
    state = opponentMinor(11)(state)
    state = goal(state, { side: 'tracked', onIce: complete(['p2', 'p3', 'p4', 'p5', 'p6'], 'empty_net') }, 12)
    expect(storedStrength(state)).toBe('pp')
    expect(stat(state, 'player-2', 'hky_pm')).toBe(-1)
  })

  it('lists goals without a complete set or a recorded strength as skipped', () => {
    let state = goal(running(), { side: 'tracked', onIce: { status: 'partial', skaterParticipantIds: ['p2'], goalie: null } }, 5)
    const partial = lastEvent(state).id
    state = goal(state, { side: 'tracked' }, 6)
    const unrecorded = lastEvent(state).id
    const setup = hockeySportState(state)!.setup
    // An HKY-2 goal: complete set, no strength.
    const legacy = createHockeyEvent({
      eventType: 'hockey.shot',
      teamSide: 'tracked',
      actors: [{ role: 'goalie', kind: 'unknown', label: '#35', participantId: 'opp-goalie' }],
      payload: { captureCommandId: null, outcome: 'goal', missType: null, emptyNet: false, penaltyShot: false, strength: null, onIce: complete() },
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 6_000,
      recorderUserId: null,
      sequence: 500,
      occurredAt: at(7),
    }) as unknown as GameEvent
    const replay = replayHockeyEvents(setup, [...(state.eventStream!.events as GameEvent[]), legacy])
    expect(replay.diagnostics).toEqual([])
    expect(replay.projection.plusMinusSkippedGoalIds).toEqual([partial, unrecorded, legacy.id])
    expect(replay.projection.goalsByStrength.tracked).toEqual({ ev: 2, pp: 0, sh: 0, unrecorded: 1 })
    expect(replay.participantStats.p2.hky_pm).toBe(0)
  })
})

describe('timeouts, icing and offside', () => {
  it('pauses a running clock for a timeout and counts each side', () => {
    let state = expectOk(recordHockeyTimeout(running(), { side: 'tracked' }, ctx(31)))
    const events = state.eventStream!.events as GameEvent[]
    expect(events.slice(-2).map(event => event.eventType)).toEqual(['hockey.clock_paused', 'hockey.timeout'])
    expect(projection(state).clock!.running).toBe(false)
    state = expectOk(recordHockeyTimeout(state, { side: 'opponent' }, ctx(40)))
    expect(projection(state).timeouts).toEqual({ tracked: 1, opponent: 1 })
    expect(hockeyRecentEvents(state, { tracked: 'Blades', opponent: 'Rivals' })[0].label).toBe('Rivals timeout')
  })

  it('rejects a stored timeout while the clock runs', () => {
    const state = running()
    const timeout = createHockeyEvent({
      eventType: 'hockey.timeout',
      teamSide: 'tracked',
      payload: { captureCommandId: null },
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 9_000,
      recorderUserId: null,
      sequence: 50,
      occurredAt: at(10),
    }) as unknown as GameEvent
    const replay = replayHockeyEvents(hockeySportState(state)!.setup, [...(state.eventStream!.events as GameEvent[]), timeout])
    expect(replay.diagnostics[0].message).toBe('Pause the clock for the timeout.')
  })

  it('counts icing and offside per side, with an optional location', () => {
    let state = expectOk(recordHockeyTeamEvent(running(), { kind: 'icing', side: 'tracked', location: { x: 0.2, y: 0.5 } }, ctx(5)))
    expect(lastEvent(state).location).toMatchObject({ x: 0.2, y: 0.5, attackingDirection: 'left_to_right' })
    state = expectOk(recordHockeyTeamEvent(state, { kind: 'offside', side: 'opponent' }, ctx(6)))
    state = expectOk(recordHockeyTeamEvent(state, { kind: 'icing', side: 'opponent' }, ctx(7)))
    expect(projection(state).icings).toEqual({ tracked: 1, opponent: 1 })
    expect(projection(state).offsides).toEqual({ tracked: 0, opponent: 1 })
    expect(hockeyRecentEvents(state)[1].label).toBe('Opponent offside')
  })

  it('round-trips through hydration', () => {
    let state = opponentMinor(11)(running())
    state = goal(state, { side: 'tracked', onIce: complete() }, 21)
    state = expectOk(recordHockeyTimeout(state, { side: 'opponent' }, ctx(25)))
    state = expectOk(recordHockeyTeamEvent(state, { kind: 'offside', side: 'tracked' }, ctx(26)))
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
    expect(projection(hydrated)).toEqual(projection(state))
    expect(stat(hydrated, 'player-2', 'hky_pm')).toBe(0)
    expect(hockeyPenaltyBoxNow(hockeySportState(hydrated)!, at(26)).box.opponent).toEqual([])
  })
})
