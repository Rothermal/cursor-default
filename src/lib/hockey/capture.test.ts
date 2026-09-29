import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { createInitialState, gameReducer } from '../gameReducer'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import {
  adjustHockeyScore,
  changeHockeyGoalie,
  HOCKEY_ON_ICE_NOT_RECORDED,
  hockeyGoalieChoices,
  hockeyScorerChoices,
  hockeySkaterChoices,
  pullHockeyGoalie,
  recentHockeyOpponentLabels,
  recordHockeyShot,
  type RecordHockeyShotInput,
} from './captureCommands'
import { createHockeyEvent } from './events'
import {
  endHockeyMatch,
  endHockeyPeriod,
  finishDecidedHockeyGame,
  hockeySportState,
  pauseHockeyClock,
  startHockeyClock,
  startHockeyGame,
  startNextHockeyPeriod,
} from './live'
import { replayHockeyEvents } from './projector'
import { createHockeyMatchRules } from './profiles'
import { hockeyOvertimeSuddenDeath } from './rules'
import { HOCKEY_FILLED_STAT_IDS } from './stats'
import { CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyMatchSetup, HockeyOnIce, HockeyRuleOverrides } from './types'

function withExtraSkater(): HockeyMatchSetup {
  const setup = hockeySetup({ rules: CLOCKLESS })
  const extra = { id: 'p7', playerId: 'player-7', displayName: 'Player 7', number: '7', position: 'C', dressedAs: 'skater' as const }
  return { ...setup, participants: [...setup.participants, extra] }
}

function started(setup: HockeyMatchSetup = hockeySetup({ rules: CLOCKLESS })): GameState {
  return expectOk(startHockeyGame(initializedHockeyGame(setup), ctx(0)))
}

function shot(state: GameState, input: RecordHockeyShotInput, seconds = 30): GameState {
  return expectOk(recordHockeyShot(state, input, ctx(seconds)))
}

function rejected(result: ReturnType<typeof recordHockeyShot>): string {
  if (result.ok) throw new Error('Expected a rejection')
  return result.message
}

function events(state: GameState): GameEvent[] {
  return state.eventStream!.events as GameEvent[]
}

function lastEvent(state: GameState): GameEvent {
  const list = events(state)
  return list[list.length - 1]
}

/** Player stats as the generic surfaces see them, with unwritten zeros filled in. */
function playerStats(state: GameState, playerId: string): Record<string, number> {
  const stats = state.players.find(player => player.id === playerId)?.stats ?? {}
  return Object.fromEntries(HOCKEY_FILLED_STAT_IDS.map(id => [id, stats[id] ?? 0]))
}

/** NHL rules (clockless unless asked): 3 x 20, 3-on-3 sudden-death overtime, no ties. */
function inOvertime(overtime: { suddenDeath?: boolean; anchored?: boolean } = {}): GameState {
  const base = createHockeyMatchRules('nhl_regular').overtime!
  const rules: HockeyRuleOverrides = {
    ...(overtime.anchored ? {} : CLOCKLESS),
    overtime: { ...base, suddenDeath: overtime.suddenDeath ?? true },
  }
  let state = started(hockeySetup({ profile: 'nhl_regular', rules }))
  for (let period = 1; period <= 3; period++) {
    state = expectOk(endHockeyPeriod(state, overtime.anchored ? { reason: 'Fixture' } : {}, ctx(period * 10)))
    if (period < 3) state = expectOk(startNextHockeyPeriod(state, ctx(period * 10 + 1)))
  }
  return expectOk(startNextHockeyPeriod(state, ctx(40)))
}

describe('hockey shots and goals', () => {
  it('derives counts for every outcome, with stats for the tracked shooter and the stamped goalie', () => {
    let state = started()
    state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' }, assists: [{ participantId: 'p3' }, { participantId: 'p5' }] })
    state = shot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p2' } })
    state = shot(state, { side: 'tracked', outcome: 'missed', missType: 'post', shooter: { participantId: 'p2' } })
    state = shot(state, { side: 'tracked', outcome: 'blocked', shooter: { participantId: 'p2' }, blocker: { label: '#4' } })
    state = shot(state, { side: 'opponent', outcome: 'saved', shooter: { label: '#9' } })
    state = shot(state, { side: 'opponent', outcome: 'goal', shooter: { label: '#9' }, assists: [{ label: '#10' }] })
    state = shot(state, { side: 'opponent', outcome: 'blocked', shooter: { label: '#9' }, blocker: { participantId: 'p6' } })

    const p = projection(state)
    expect(p.score).toEqual({ tracked: 1, opponent: 1 })
    expect(p.shotsOnGoal).toEqual({ tracked: 2, opponent: 2 })
    expect(p.periodTotals['regulation-1']).toEqual({ goals: { tracked: 1, opponent: 1 }, shotsOnGoal: { tracked: 2, opponent: 2 } })
    expect(state.homeTeamScore).toBe(1)
    expect(state.opponentScore).toBe(1)
    expect(playerStats(state, 'player-2')).toMatchObject({ hky_g: 1, hky_pts: 1, hky_sog: 2, hky_sat: 4, hky_miss: 1, hky_blocked_by: 1 })
    expect(playerStats(state, 'player-3')).toMatchObject({ hky_a: 1, hky_a1: 1, hky_a2: 0, hky_pts: 1 })
    expect(playerStats(state, 'player-5')).toMatchObject({ hky_a: 1, hky_a1: 0, hky_a2: 1, hky_pts: 1 })
    expect(playerStats(state, 'player-6')).toMatchObject({ hky_blk: 1 })
    expect(playerStats(state, 'player-1')).toMatchObject({ hky_sa: 2, hky_sv: 1, hky_ga: 1 })
    // No on-ice set was recorded, so plus/minus stays at zero.
    expect(playerStats(state, 'player-2').hky_pm).toBe(0)
  })

  it('credits the team when no shooter is given, and rejects assists without a scorer', () => {
    let state = started()
    state = shot(state, { side: 'tracked', outcome: 'goal' })
    expect(projection(state).score.tracked).toBe(1)
    expect(lastEvent(state).actors.map(actor => actor.role)).toEqual(['goalie'])
    expect(rejected(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', assists: [{ participantId: 'p3' }] }, ctx(40))))
      .toBe('Assists need a credited scorer.')
  })

  it('rejects assists by the scorer, duplicate assisters, and assists on non-goals', () => {
    const state = started()
    expect(rejected(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' }, assists: [{ participantId: 'p2' }] }, ctx(1))))
      .toMatch(/different players/)
    expect(rejected(recordHockeyShot(state, { side: 'opponent', outcome: 'goal', shooter: { label: '#9' }, assists: [{ label: '#7' }, { label: ' #7 ' }] }, ctx(1))))
      .toMatch(/different players/)
    expect(rejected(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p2' }, assists: [{ participantId: 'p3' }] }, ctx(1))))
      .toBe('Only a goal has assists.')
  })

  it('keeps each side to its own actors', () => {
    const state = started()
    // Tracked shooters are dressed players; opponent shooters are labels; blockers defend.
    expect(rejected(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', shooter: { label: '#9' } }, ctx(1))))
      .toMatch(/dressed player/)
    expect(rejected(recordHockeyShot(state, { side: 'opponent', outcome: 'saved', shooter: { participantId: 'p2' } }, ctx(1))))
      .toMatch(/by label/)
    expect(rejected(recordHockeyShot(state, { side: 'opponent', outcome: 'blocked', blocker: { participantId: 'p1' } }, ctx(1))))
      .toMatch(/skater can block/)
    expect(rejected(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', blocker: { label: '#4' } }, ctx(1))))
      .toBe('Only a blocked shot has a blocker.')
  })

  it('stores a canonical location with the shooting side\'s direction, or none', () => {
    let state = started()
    state = shot(state, { side: 'tracked', outcome: 'saved', location: { x: 0.9, y: 0.4 } })
    expect(lastEvent(state).location).toEqual({ x: 0.9, y: 0.4, attackingDirection: 'left_to_right' })
    state = shot(state, { side: 'opponent', outcome: 'saved', location: { x: 0.1, y: 1.4 } })
    expect(lastEvent(state).location).toEqual({ x: 0.1, y: 1, attackingDirection: 'right_to_left' })
    state = shot(state, { side: 'opponent', outcome: 'missed' })
    expect(lastEvent(state).location).toBeNull()
  })

  it('stamps elapsed time from the running anchored clock', () => {
    let state = started(hockeySetup())
    state = expectOk(startHockeyClock(state, ctx(10)))
    state = shot(state, { side: 'tracked', outcome: 'saved' }, 70)
    expect(lastEvent(state).elapsedMs).toBe(60_000)
    state = expectOk(pauseHockeyClock(state, ctx(80)))
    state = shot(state, { side: 'tracked', outcome: 'saved' }, 200)
    expect(lastEvent(state).elapsedMs).toBe(70_000)
  })

  it('rejects shots outside a period', () => {
    const between = expectOk(endHockeyPeriod(started(), {}, ctx(5)))
    expect(rejected(recordHockeyShot(between, { side: 'tracked', outcome: 'saved' }, ctx(6))))
      .toBe('Shots are recorded during a period.')
  })
})

describe('hockey goalies', () => {
  it('prefills and confirms the empty net from the goalie in net', () => {
    let state = started()
    state = expectOk(pullHockeyGoalie(state, { side: 'opponent' }, ctx(10)))
    expect(projection(state).goalieInNet.opponent).toBeNull()
    state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' } }, 20)
    expect(lastEvent(state).payload).toMatchObject({ emptyNet: true })
    expect(lastEvent(state).actors.some(actor => actor.role === 'goalie')).toBe(false)

    // The recorder can override the prefill.
    state = expectOk(changeHockeyGoalie(state, { side: 'opponent', inParticipantId: 'opp-goalie' }, ctx(30)))
    expect(lastEvent(state).payload).toMatchObject({ reason: 'return' })
    state = shot(state, { side: 'tracked', outcome: 'goal', emptyNet: true }, 40)
    expect(lastEvent(state).payload).toMatchObject({ emptyNet: true })
  })

  it('does not charge the tracked goalie for empty-net goals against', () => {
    let state = started()
    state = expectOk(pullHockeyGoalie(state, { side: 'tracked' }, ctx(10)))
    state = shot(state, { side: 'opponent', outcome: 'goal', shooter: { label: '#9' } }, 20)
    expect(playerStats(state, 'player-1')).toMatchObject({ hky_ga: 0, hky_sa: 0 })
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(30)))
    state = shot(state, { side: 'opponent', outcome: 'saved', shooter: { label: '#9' } }, 40)
    expect(playerStats(state, 'player-30')).toMatchObject({ hky_sa: 1, hky_sv: 1 })
    expect(projection(state).goalieIntervals.filter(entry => entry.side === 'tracked').map(entry => entry.participantId))
      .toEqual(['p1', null, 'p30'])
  })

  it('introduces an opponent goalie once and rejects unknown or duplicate goalies', () => {
    let state = started()
    const backup = { id: 'opp-backup', label: 'Backup', number: '31' }
    state = expectOk(changeHockeyGoalie(state, { side: 'opponent', inParticipantId: backup.id, newOpponentGoalie: backup }, ctx(10)))
    expect(projection(state).opponentGoalies.map(goalie => goalie.id)).toEqual(['opp-goalie', 'opp-backup'])
    state = shot(state, { side: 'tracked', outcome: 'saved' }, 20)
    expect(lastEvent(state).actors).toEqual([{ role: 'goalie', kind: 'unknown', label: '#31 Backup', participantId: 'opp-backup' }])

    const again = changeHockeyGoalie(state, { side: 'opponent', inParticipantId: 'opp-goalie', newOpponentGoalie: { id: 'opp-goalie', label: null, number: null } }, ctx(30))
    expect(again.ok ? null : again.message).toMatch(/already in use/)
    const unknown = changeHockeyGoalie(state, { side: 'opponent', inParticipantId: 'stranger' }, ctx(30))
    expect(unknown.ok ? null : unknown.message).toMatch(/Add the opponent goalie/)
    const skater = changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p2' }, ctx(30))
    expect(skater.ok ? null : skater.message).toMatch(/dressed goalie/)
    const same = changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p1' }, ctx(30))
    expect(same.ok ? null : same.message).toMatch(/already in net/)
  })

  it('warns, without failing replay, when a stamped goalie no longer matches the goalie in net', () => {
    const state = started()
    const setup = hockeySportState(state)!.setup
    const stamped = createHockeyEvent({
      eventType: 'hockey.shot',
      teamSide: 'opponent',
      actors: [{ role: 'goalie', kind: 'player', playerId: 'player-30', participantId: 'p30' }],
      payload: { captureCommandId: null, outcome: 'saved', missType: null, emptyNet: false, penaltyShot: false, strength: null, onIce: null },
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: null,
      recorderUserId: null,
      sequence: 10,
      occurredAt: ctx(50).occurredAt,
    })
    const replay = replayHockeyEvents(setup, [...events(state), stamped as unknown as GameEvent])
    expect(replay.diagnostics).toEqual([])
    expect(replay.projection.warnings).toEqual([expect.objectContaining({
      code: 'actor_mismatch',
      recordedParticipantId: 'p30',
      resolvedParticipantId: 'p1',
    })])
    // Goalie credit follows the stamp.
    expect(replay.participantStats.p30).toMatchObject({ hky_sa: 1, hky_sv: 1 })
    expect(replay.participantStats.p1).toMatchObject({ hky_sa: 0 })
  })

  it('allows a goalie change between periods', () => {
    let state = expectOk(endHockeyPeriod(started(), {}, ctx(5)))
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(6)))
    expect(lastEvent(state)).toMatchObject({ elapsedMs: null, period: { id: 'regulation-1' } })
    state = expectOk(startNextHockeyPeriod(state, ctx(7)))
    expect(projection(state).goalieInNet.tracked).toBe('p30')
  })
})

describe('hockey score adjustments', () => {
  it('changes the score without creating player goals and rejects going below zero', () => {
    let state = started()
    state = expectOk(adjustHockeyScore(state, { side: 'opponent', delta: 1, reason: 'Missed goal' }, ctx(10)))
    expect(projection(state).score).toEqual({ tracked: 0, opponent: 1 })
    expect(projection(state).periodTotals['regulation-1']).toBeUndefined()
    const negative = adjustHockeyScore(state, { side: 'tracked', delta: -1, reason: 'Wrong goal' }, ctx(11))
    expect(negative.ok ? null : negative.message).toBe('A score cannot go below zero.')
    const noReason = adjustHockeyScore(state, { side: 'tracked', delta: 1, reason: '  ' }, ctx(11))
    expect(noReason.ok ? null : noReason.code).toBe('reason_required')
  })

  it('recomputes what may follow when the score changes between periods', () => {
    let state = inOvertime()
    state = expectOk(endHockeyPeriod(state, {}, ctx(50)))
    // NHL regular season: one overtime, then a tie still needs the shootout (HKY-3C).
    expect(projection(state)).toMatchObject({ nextPeriod: null, canEndWithoutReason: false })
    state = expectOk(adjustHockeyScore(state, { side: 'tracked', delta: 1, reason: 'Late goal' }, ctx(51)))
    expect(projection(state).nextPeriod).toBeNull()
    expect(projection(state).canEndWithoutReason).toBe(true)
  })
})

describe('hockey sudden-death overtime', () => {
  it('reads sudden death from every built-in profile with overtime', () => {
    expect(hockeyOvertimeSuddenDeath(createHockeyMatchRules('nhl_regular'))).toBe(true)
    expect(hockeyOvertimeSuddenDeath(createHockeyMatchRules('usa_hockey_youth'))).toBe(false)
  })

  it('decides the game on an overtime goal, blocks further play, and ends in one tap', () => {
    let state = inOvertime()
    state = shot(state, { side: 'opponent', outcome: 'goal', shooter: { label: '#9' } }, 45)
    expect(projection(state).decidedInPeriodId).toBe('overtime-1')
    expect(rejected(recordHockeyShot(state, { side: 'tracked', outcome: 'saved' }, ctx(46))))
      .toMatch(/decided the game/)
    state = expectOk(finishDecidedHockeyGame(state, ctx(47)))
    expect(events(state).slice(-2).map(event => event.eventType)).toEqual(['hockey.period_ended', 'hockey.match_ended'])
    expect(projection(state)).toMatchObject({ status: 'ended', statusReason: null, score: { tracked: 0, opponent: 1 } })
  })

  it('ends a decided anchored period early without a reason, pausing the running clock', () => {
    const rules = createHockeyMatchRules('nhl_regular')
    let state = started(hockeySetup({ profile: 'nhl_regular' }))
    for (let period = 1; period <= 3; period++) {
      state = expectOk(endHockeyPeriod(state, { reason: 'Fixture' }, ctx(period * 10)))
      if (period < 3) state = expectOk(startNextHockeyPeriod(state, ctx(period * 10 + 1)))
    }
    state = expectOk(startNextHockeyPeriod(state, ctx(40)))
    state = expectOk(startHockeyClock(state, ctx(41)))
    state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' } }, 101)
    expect(lastEvent(state).elapsedMs).toBe(60_000)
    state = expectOk(finishDecidedHockeyGame(state, ctx(102)))
    expect(events(state).slice(-3).map(event => event.eventType))
      .toEqual(['hockey.clock_paused', 'hockey.period_ended', 'hockey.match_ended'])
    expect(projection(state).periods[3]).toMatchObject({ endedAtElapsedMs: 61_000, earlyEndReason: null })
    expect(rules.overtime && hockeyOvertimeSuddenDeath(rules)).toBe(true)
  })

  it('plays the full overtime period when sudden death is off', () => {
    let state = inOvertime({ suddenDeath: false })
    state = shot(state, { side: 'tracked', outcome: 'goal' }, 45)
    expect(projection(state).decidedInPeriodId).toBeNull()
    state = shot(state, { side: 'opponent', outcome: 'saved' }, 46)
    const early = finishDecidedHockeyGame(state, ctx(47))
    expect(early.ok).toBe(false)
    state = expectOk(endHockeyPeriod(state, {}, ctx(48)))
    state = expectOk(endHockeyMatch(state, {}, ctx(49)))
    expect(projection(state).status).toBe('ended')
  })

  it('reopens sudden death when an adjustment undoes the deciding goal', () => {
    let state = inOvertime()
    state = shot(state, { side: 'tracked', outcome: 'goal' }, 45)
    state = expectOk(adjustHockeyScore(state, { side: 'tracked', delta: -1, reason: 'No goal' }, ctx(46)))
    expect(projection(state).decidedInPeriodId).toBeNull()
    state = shot(state, { side: 'tracked', outcome: 'saved' }, 47)
    expect(projection(state).shotsOnGoal.tracked).toBe(2)
  })

  describe.each([
    { clock: 'clockless', anchored: false },
    { clock: 'anchored', anchored: true },
  ])('with score adjustments in overtime ($clock)', ({ anchored }) => {
    it.each(['tracked', 'opponent'] as const)('a +1 %s adjustment decides, and a tying goal can no longer follow', side => {
      let state = inOvertime({ anchored })
      state = expectOk(adjustHockeyScore(state, { side, delta: 1, reason: 'Missed goal' }, ctx(45)))
      expect(projection(state).decidedInPeriodId).toBe('overtime-1')
      const other = side === 'tracked' ? 'opponent' : 'tracked'
      expect(rejected(recordHockeyShot(state, { side: other, outcome: 'goal' }, ctx(46)))).toMatch(/decided the game/)
      state = expectOk(finishDecidedHockeyGame(state, ctx(47)))
      expect(projection(state)).toMatchObject({ status: 'ended', score: { [side]: 1, [other]: 0 } })
    })

    it.each(['tracked', 'opponent'] as const)('a %s goal that ties an adjusted score never decides', side => {
      // Reached through a corrected deciding goal: 1-0 by adjustment, reopened, then a tying goal.
      let state = inOvertime({ anchored })
      const other = side === 'tracked' ? 'opponent' : 'tracked'
      state = shot(state, { side: other, outcome: 'goal' }, 45)
      state = expectOk(adjustHockeyScore(state, { side: other, delta: 1, reason: 'Two goals' }, ctx(46)))
      state = expectOk(adjustHockeyScore(state, { side: other, delta: -1, reason: 'Undo' }, ctx(47)))
      expect(projection(state).decidedInPeriodId).toBe('overtime-1')
      state = expectOk(adjustHockeyScore(state, { side, delta: 1, reason: 'Missed tying goal' }, ctx(48)))
      expect(projection(state)).toMatchObject({ decidedInPeriodId: null, score: { tracked: 1, opponent: 1 } })
      state = shot(state, { side, outcome: 'goal' }, 49)
      expect(projection(state)).toMatchObject({ decidedInPeriodId: 'overtime-1', score: { [side]: 2, [other]: 1 } })
    })

    it.each(['tracked', 'opponent'] as const)('a %s adjustment then a tying goal leaves the game open without sudden death', side => {
      let state = inOvertime({ anchored, suddenDeath: false })
      const other = side === 'tracked' ? 'opponent' : 'tracked'
      state = expectOk(adjustHockeyScore(state, { side, delta: 1, reason: 'Missed goal' }, ctx(45)))
      expect(projection(state).decidedInPeriodId).toBeNull()
      state = shot(state, { side: other, outcome: 'goal' }, 46)
      expect(projection(state)).toMatchObject({ decidedInPeriodId: null, score: { tracked: 1, opponent: 1 } })
      state = shot(state, { side, outcome: 'saved' }, 47)
      expect(projection(state).shotsOnGoal[side]).toBe(1)
    })
  })

  it('never marks a tied game decided (review reproduction)', () => {
    let state = inOvertime()
    state = expectOk(adjustHockeyScore(state, { side: 'tracked', delta: 1, reason: 'Missed goal' }, ctx(45)))
    const tying = recordHockeyShot(state, { side: 'opponent', outcome: 'goal' }, ctx(46))
    expect(tying.ok).toBe(false)
    expect(projection(state)).toMatchObject({ decidedInPeriodId: 'overtime-1', score: { tracked: 1, opponent: 0 } })
  })

  it('does not decide on a regulation goal', () => {
    const state = shot(started(), { side: 'tracked', outcome: 'goal' })
    expect(projection(state).decidedInPeriodId).toBeNull()
  })
})

describe('hockey on-ice sets', () => {
  const onIce = (status: HockeyOnIce['status'], skaters: string[], goalie: string | null): HockeyOnIce => ({
    status,
    skaterParticipantIds: skaters,
    goalie,
  })
  const goal = (state: GameState, set: HockeyOnIce | undefined, seconds = 30) =>
    recordHockeyShot(state, { side: 'tracked', outcome: 'goal', onIce: set }, ctx(seconds))

  it('accepts a complete regulation set of five skaters and the goalie', () => {
    const state = expectOk(goal(started(), onIce('complete', ['p2', 'p3', 'p4', 'p5', 'p6'], 'p1')))
    expect(lastEvent(state).payload).toMatchObject({ onIce: { status: 'complete' } })
  })

  it('accepts a complete three-on-three overtime set', () => {
    expect(goal(inOvertime(), onIce('complete', ['p2', 'p3', 'p5'], 'p1'), 45).ok).toBe(true)
  })

  it('accepts six skaters with an empty net, then puts the goalie back in net after the return', () => {
    let state = expectOk(pullHockeyGoalie(started(withExtraSkater()), { side: 'tracked' }, ctx(10)))
    state = expectOk(goal(state, onIce('complete', ['p2', 'p3', 'p4', 'p5', 'p6', 'p7'], 'empty_net'), 20))
    expect(projection(state).goalieInNet.tracked).toBeNull()
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p1' }, ctx(30)))
    expect(projection(state).goalieInNet.tracked).toBe('p1')
  })

  it('accepts a genuinely partial set and stores an untouched section as not recorded', () => {
    let state = expectOk(goal(started(), onIce('partial', ['p2', 'p3', 'p4'], null)))
    expect(lastEvent(state).payload).toMatchObject({ onIce: { status: 'partial', goalie: null } })
    state = expectOk(goal(state, undefined, 40))
    expect(lastEvent(state).payload).toMatchObject({ onIce: HOCKEY_ON_ICE_NOT_RECORDED })
  })

  it('rejects structurally impossible complete sets', () => {
    const state = started(withExtraSkater())
    const cases: HockeyOnIce[] = [
      onIce('complete', ['p2', 'p3'], 'p1'),
      onIce('complete', ['p2', 'p3', 'p4', 'p5', 'p6', 'p7'], 'p1'),
      onIce('complete', ['p2', 'p3', 'p4', 'p30'], 'p1'),
      onIce('complete', ['p2', 'p2', 'p3'], 'p1'),
      onIce('complete', ['p2', 'p3', 'p4', 'ghost'], 'p1'),
      onIce('complete', ['p2', 'p3', 'p4'], null),
    ]
    for (const set of cases) expect(goal(state, set).ok).toBe(false)
    expect(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', onIce: onIce('partial', ['p2'], null) }, ctx(1)).ok)
      .toBe(true) // onIce is dropped for non-goals
  })
})

describe('hockey actor eligibility', () => {
  it('offers every dressed skater, not just the opening five, and goalies only as goalies', () => {
    const setup = withExtraSkater()
    expect(hockeySkaterChoices(setup).map(entry => entry.id)).toEqual(['p2', 'p7', 'p3', 'p4', 'p5', 'p6'])
    expect(hockeyGoalieChoices(setup).map(entry => entry.id)).toEqual(['p1', 'p30'])
    expect(hockeyScorerChoices(setup).map(entry => entry.id)).toEqual(['p2', 'p7', 'p3', 'p4', 'p5', 'p6', 'p1', 'p30'])
  })

  it('lets a skater who did not start take every skater role in any period', () => {
    let state = started(withExtraSkater())
    state = expectOk(endHockeyPeriod(state, {}, ctx(5)))
    state = expectOk(startNextHockeyPeriod(state, ctx(6)))
    state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p7' }, assists: [{ participantId: 'p2' }, { participantId: 'p1' }] }, 7)
    state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' }, assists: [{ participantId: 'p7' }] }, 8)
    state = shot(state, { side: 'opponent', outcome: 'blocked', blocker: { participantId: 'p7' } }, 9)
    const stats = replayHockeyEvents(hockeySportState(state)!.setup, events(state)).participantStats
    expect(stats.p7).toMatchObject({ hky_g: 1, hky_a: 1, hky_blk: 1, hky_pts: 2 })
    expect(stats.p1).toMatchObject({ hky_a: 1, hky_a2: 1 })
  })

  it('lists recent opponent labels, newest first, without duplicates or goalies', () => {
    let state = started()
    state = shot(state, { side: 'opponent', outcome: 'goal', shooter: { label: '#9' }, assists: [{ label: '#10' }] }, 10)
    state = shot(state, { side: 'tracked', outcome: 'blocked', blocker: { label: '#4' } }, 20)
    state = shot(state, { side: 'opponent', outcome: 'saved', shooter: { label: '#9' } }, 30)
    expect(recentHockeyOpponentLabels(events(state))).toEqual(['#9', '#4', '#10'])
  })
})

describe('hockey capture persistence', () => {
  it('round-trips capture events through hydration with an unchanged fingerprint', () => {
    let state = started(hockeySetup())
    state = expectOk(startHockeyClock(state, ctx(1)))
    state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' }, location: { x: 0.9, y: 0.5 } }, 20)
    state = expectOk(pullHockeyGoalie(state, { side: 'opponent' }, ctx(25)))
    state = expectOk(adjustHockeyScore(state, { side: 'opponent', delta: 1, reason: 'Missed' }, ctx(26)))
    const hydrated = gameReducer(createInitialState(), {
      type: 'HYDRATE_STATE',
      state: JSON.parse(JSON.stringify(state)) as GameState,
    })
    expect(buildGameSyncFingerprint(hydrated)).toBe(buildGameSyncFingerprint(state))
    expect(projection(hydrated)).toEqual(projection(state))
    expect(playerStats(hydrated, 'player-2')).toEqual(playerStats(state, 'player-2'))
  })
})
