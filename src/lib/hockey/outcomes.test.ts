import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import {
  adjustHockeyScore,
  changeHockeyGoalie,
  hockeyPenaltyBoxNow,
  recordHockeyPenalties,
  recordHockeyShootoutAttempt,
  recordHockeyShot,
  startHockeyShootout,
  type HockeyActorChoice,
  type HockeyPenaltyInput,
  type RecordHockeyShotInput,
} from './captureCommands'
import {
  endHockeyMatch,
  endHockeyPeriod,
  finishDecidedHockeyGame,
  hockeySportState,
  interruptHockeyMatch,
  reopenHockeyMatch,
  startHockeyClock,
  startHockeyGame,
  startNextHockeyPeriod,
  type HockeyCommandResult,
} from './live'
import { hockeyOnIceLimits } from './penalties'
import { createHockeyMatchRules } from './profiles'
import { hockeyActivePeriod } from './projector'
import { hockeyRecentEvents, undoHockeyCapture } from './recentEvents'
import { formatHockeyFinalScore, hockeyShootoutEligibleShooters } from './shootout'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyOnIce, HockeyProfileId, HockeyRuleOverrides, HockeyShootoutOutcome } from './types'

function rejected(result: HockeyCommandResult): string {
  if (result.ok) throw new Error('Expected a rejection')
  return result.message
}

function stat(state: GameState, playerId: string, id: string): number {
  return state.players.find(player => player.id === playerId)?.stats[id] ?? 0
}

function hydrate(state: GameState): GameState {
  return gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
}

/** Plays regulation (and `overtimes` overtime periods) with nothing recorded, clockless unless anchored. */
function played(profile: HockeyProfileId, options: { rules?: HockeyRuleOverrides; overtimes?: number } = {}): GameState {
  let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile, rules: { ...CLOCKLESS, ...options.rules } })), ctx(0)))
  let second = 1
  for (let period = 1; period <= 3 + (options.overtimes ?? 0); period++) {
    if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(second++)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(second++)))
  }
  return state
}

const toShootout = (rules?: HockeyRuleOverrides) => played('nhl_regular', { rules, overtimes: 1 })

function attempt(state: GameState, outcome: HockeyShootoutOutcome, shooter: HockeyActorChoice | null = null, seconds = 100): GameState {
  return expectOk(recordHockeyShootoutAttempt(state, { outcome, shooter }, ctx(seconds)))
}

function shootout(state: GameState) {
  return projection(state).shootout!
}

describe('shootout', () => {
  it('is offered only after overtime ends tied, when the rules have one and ties are not allowed', () => {
    const state = toShootout()
    expect(projection(state)).toMatchObject({ shootoutAvailable: true, canEndWithoutReason: false, nextPeriod: null })
    expect(projection(played('usa_hockey_youth')).shootoutAvailable).toBe(false)
    expect(projection(played('ncaa', { overtimes: 1 })).shootoutAvailable).toBe(false)
    let lead = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile: 'nhl_regular', rules: CLOCKLESS })), ctx(0)))
    lead = expectOk(recordHockeyShot(lead, { side: 'tracked', outcome: 'goal' }, ctx(1)))
    for (let period = 1; period <= 3; period++) {
      if (period > 1) lead = expectOk(startNextHockeyPeriod(lead, ctx(period * 2)))
      lead = expectOk(endHockeyPeriod(lead, {}, ctx(period * 2 + 1)))
    }
    expect(projection(lead)).toMatchObject({ shootoutAvailable: false, canEndWithoutReason: true })
    expect(rejected(startHockeyShootout(lead, { firstSide: 'tracked' }, ctx(20)))).toMatch(/after overtime ends tied/)
  })

  it('wins early once the other side cannot catch up, outside player and goalie totals', () => {
    let state = expectOk(startHockeyShootout(toShootout(), { firstSide: 'tracked' }, ctx(100)))
    expect(shootout(state)).toMatchObject({ nextSide: 'tracked', round: 1, suddenDeath: false, winner: null })
    state = attempt(state, 'goal', { participantId: 'p2' })
    expect(shootout(state).nextSide).toBe('opponent')
    state = attempt(state, 'missed', { label: '#9' })
    state = attempt(state, 'goal', { participantId: 'p3' })
    expect(shootout(state).winner).toBeNull()
    state = attempt(state, 'saved', { label: '#10' })
    // 2-0 with one opponent attempt left: decided.
    expect(shootout(state)).toMatchObject({ winner: 'tracked', nextSide: null, goals: { tracked: 2, opponent: 0 } })
    expect(hockeyRecentEvents(state).slice(0, 2).map(row => row.label)).toEqual(['Opponent shootout #10: saved', 'Tracked shootout Player 3: goal'])
    expect(rejected(recordHockeyShootoutAttempt(state, { outcome: 'goal' }, ctx(101)))).toBe('The shootout is decided.')
    expect(projection(state)).toMatchObject({ canEndWithoutReason: true, score: { tracked: 0, opponent: 0 } })
    expect(projection(state).shotsOnGoal).toEqual({ tracked: 0, opponent: 0 })
    expect([stat(state, 'player-2', 'hky_g'), stat(state, 'player-2', 'hky_sog'), stat(state, 'player-1', 'hky_sv')]).toEqual([0, 0, 0])

    state = expectOk(endHockeyMatch(state, {}, ctx(102)))
    const result = projection(state).result!
    expect(result).toEqual({ outcome: 'win', decidedIn: 'shootout', finalScore: { tracked: 1, opponent: 0 } })
    expect(formatHockeyFinalScore(result)).toBe('1-0 (SO)')
    expect(projection(state).goalieOfRecord).toBe('p1')
  })

  it('goes to sudden death after the rounds, deciding only on a complete round', () => {
    let state = expectOk(startHockeyShootout(toShootout(), { firstSide: 'opponent' }, ctx(100)))
    const shooters = ['p2', 'p3', 'p4']
    for (let round = 0; round < 3; round++) {
      state = attempt(state, 'saved', { label: `#${round + 1}` })
      state = attempt(state, 'missed', { participantId: shooters[round] })
    }
    expect(shootout(state)).toMatchObject({ round: 4, suddenDeath: true, nextSide: 'opponent', winner: null })
    state = attempt(state, 'goal', { label: '#4' })
    expect(shootout(state).winner).toBeNull()
    state = attempt(state, 'goal', { participantId: 'p5' })
    expect(shootout(state).winner).toBeNull()
    state = attempt(state, 'goal', { label: '#5' })
    state = attempt(state, 'saved', { participantId: 'p6' })
    expect(shootout(state)).toMatchObject({ winner: 'opponent', goals: { tracked: 1, opponent: 2 } })
    state = expectOk(endHockeyMatch(state, {}, ctx(101)))
    expect(projection(state).result).toEqual({ outcome: 'loss', decidedIn: 'shootout', finalScore: { tracked: 0, opponent: 1 } })
    expect(projection(state).goalieOfRecord).toBe('p1')
  })

  it('lets a tracked skater repeat only after every eligible teammate has shot', () => {
    let state = expectOk(startHockeyShootout(toShootout(), { firstSide: 'tracked' }, ctx(100)))
    const sport = () => hockeySportState(state)!
    state = attempt(state, 'saved', { participantId: 'p2' })
    state = attempt(state, 'saved', { label: '#9' })
    expect(hockeyShootoutEligibleShooters(sport().setup, sport().projection).map(entry => entry.id)).toEqual(['p3', 'p4', 'p5', 'p6'])
    expect(rejected(recordHockeyShootoutAttempt(state, { outcome: 'goal', shooter: { participantId: 'p2' } }, ctx(101))))
      .toBe('Player 2 can shoot again once every other skater has shot.')
    expect(rejected(recordHockeyShootoutAttempt(state, { outcome: 'goal', shooter: { participantId: 'p1' } }, ctx(101))))
      .toBe('A shootout shooter is a dressed skater still in the game.')
  })

  it('refuses any repeat under never, including opponent labels', () => {
    const rules = { shootout: { rounds: 3, repeatShooters: 'never' as const } }
    let state = expectOk(startHockeyShootout(toShootout(rules), { firstSide: 'opponent' }, ctx(100)))
    state = attempt(state, 'saved', { label: '#9' })
    state = attempt(state, 'saved', { participantId: 'p2' })
    expect(rejected(recordHockeyShootoutAttempt(state, { outcome: 'goal', shooter: { label: ' #9 ' } }, ctx(101))))
      .toBe('#9 has already shot.')
  })

  it('blocks score adjustments, undoes attempts and the start, and round-trips through hydration', () => {
    let state = expectOk(startHockeyShootout(toShootout(), { firstSide: 'tracked' }, ctx(100)))
    expect(rejected(adjustHockeyScore(state, { side: 'tracked', delta: 1, reason: 'Late goal' }, ctx(100))))
      .toBe('Undo the shootout before adjusting the score.')
    state = attempt(state, 'goal', { participantId: 'p2' })
    expect(hydrate(state).eventStream).toEqual(state.eventStream)
    expect(projection(hydrate(state))).toEqual(projection(state))
    state = expectOk(undoHockeyCapture(state, at(101)))
    expect(shootout(state)).toMatchObject({ attempts: [], nextSide: 'tracked' })
    state = expectOk(undoHockeyCapture(state, at(102)))
    expect(projection(state)).toMatchObject({ shootout: null, shootoutAvailable: true })
  })

  it('changes either goalie after overtime and during the shootout, stamping the next attempt', () => {
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile: 'nhl_regular', rules: CLOCKLESS })), ctx(0)))
    for (let period = 1; period <= 4; period++) {
      if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(period * 10)))
      // Overtime ends with the tracked goalie pulled.
      if (period === 4) state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: null, reason: 'pulled' }, ctx(period * 10 + 2)))
      state = expectOk(endHockeyPeriod(state, {}, ctx(period * 10 + 5)))
    }
    expect(projection(state)).toMatchObject({ activePeriodId: null, shootoutAvailable: true, goalieInNet: { tracked: null } })

    // Before the start: the backup takes the net in place of the pulled starter.
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(90)))
    expect(projection(state).goalieInNet.tracked).toBe('p30')
    state = expectOk(startHockeyShootout(state, { firstSide: 'opponent' }, ctx(91)))
    state = attempt(state, 'saved', { label: '#9' }, 92)
    expect(shootout(state).attempts[0].goalieId).toBe('p30')

    // During the shootout: the opponent pulls its goalie, then a backup returns before the next attempt.
    state = expectOk(changeHockeyGoalie(state, { side: 'opponent', inParticipantId: null, reason: 'pulled' }, ctx(93)))
    const backup = { id: 'opp-backup', label: null, number: '1' }
    state = expectOk(changeHockeyGoalie(state, { side: 'opponent', inParticipantId: backup.id, newOpponentGoalie: backup }, ctx(94)))
    state = attempt(state, 'saved', { participantId: 'p2' }, 95)
    expect(shootout(state).attempts[1].goalieId).toBe('opp-backup')

    state = attempt(state, 'saved', { label: '#10' }, 96)
    state = attempt(state, 'goal', { participantId: 'p3' }, 97)
    state = attempt(state, 'missed', { label: '#11' }, 98)
    expect(shootout(state).winner).toBe('tracked')
    state = expectOk(endHockeyMatch(state, {}, ctx(100)))
    expect(projection(state).goalieOfRecord).toBe('p30')
    expect(hydrate(state).eventStream).toEqual(state.eventStream)
    expect(rejected(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p1' }, ctx(101))))
      .toBe('Goalie changes are recorded while the match is in progress.')
  })
})

describe('result and goalie of record', () => {
  const goal = (state: GameState, input: Partial<RecordHockeyShotInput> & { side: RecordHockeyShotInput['side'] }, seconds: number) =>
    expectOk(recordHockeyShot(state, { outcome: 'goal', ...input }, ctx(seconds)))

  function youthToEnd(record: (state: GameState) => GameState): GameState {
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
    state = record(state)
    for (let period = 1; period <= 3; period++) {
      if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(50 + period * 2)))
      state = expectOk(endHockeyPeriod(state, {}, ctx(51 + period * 2)))
    }
    return expectOk(endHockeyMatch(state, {}, ctx(80)))
  }

  it("credits the goalie in net at the winner's (loser's final goals + 1)th goal", () => {
    const win = youthToEnd(state => {
      state = goal(state, { side: 'tracked' }, 1)
      state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(2)))
      state = goal(state, { side: 'opponent' }, 3)
      return goal(state, { side: 'tracked' }, 4)
    })
    expect(projection(win).result).toEqual({ outcome: 'win', decidedIn: 'regulation', finalScore: { tracked: 2, opponent: 1 } })
    expect(projection(win).goalieOfRecord).toBe('p30')

    const loss = youthToEnd(state => {
      state = goal(state, { side: 'opponent' }, 1)
      state = goal(state, { side: 'opponent' }, 2)
      state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(3)))
      return goal(state, { side: 'opponent' }, 4)
    })
    expect(projection(loss).result!.outcome).toBe('loss')
    expect(projection(loss).goalieOfRecord).toBe('p1')
  })

  it('picks the goal by the final score, not by when the lead was taken', () => {
    // 1-0 (p1), change to p30, 2-0, 2-1: the winner's second goal decides, although the
    // tracked side led from the first goal on.
    const win = youthToEnd(state => {
      state = goal(state, { side: 'tracked' }, 1)
      state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(2)))
      state = goal(state, { side: 'tracked' }, 3)
      return goal(state, { side: 'opponent' }, 4)
    })
    expect(projection(win).result!.finalScore).toEqual({ tracked: 2, opponent: 1 })
    expect(projection(win).goalieOfRecord).toBe('p30')
  })

  it('keeps a pulled goalie as the goalie of record', () => {
    const loss = youthToEnd(state => {
      state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: null, reason: 'pulled' }, ctx(1)))
      return goal(state, { side: 'opponent' }, 2)
    })
    expect(projection(loss).goalieOfRecord).toBe('p1')
  })

  it('ends youth in a tie with no goalie of record', () => {
    const tie = youthToEnd(state => state)
    expect(projection(tie).result).toEqual({ outcome: 'tie', decidedIn: 'regulation', finalScore: { tracked: 0, opponent: 0 } })
    expect(projection(tie).goalieOfRecord).toBeNull()
  })

  it('decides NHL playoffs in a second overtime', () => {
    let state = played('nhl_playoffs', { overtimes: 1 })
    expect(projection(state).nextPeriod).toEqual({ kind: 'overtime', number: 2 })
    state = expectOk(startNextHockeyPeriod(state, ctx(50)))
    state = goal(state, { side: 'tracked' }, 51)
    state = expectOk(finishDecidedHockeyGame(state, ctx(52)))
    const result = projection(state).result!
    expect(result).toEqual({ outcome: 'win', decidedIn: 'overtime', finalScore: { tracked: 1, opponent: 0 } })
    expect(formatHockeyFinalScore(result)).toBe('1-0 (OT)')
  })

  it('keeps no result while suspended, and clears it on reopen', () => {
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
    state = expectOk(interruptHockeyMatch(state, { kind: 'suspended', reason: 'Power cut' }, ctx(1)))
    expect(projection(state).result).toBeNull()
    const ended = youthToEnd(s => s)
    const reopened = expectOk(reopenHockeyMatch(ended, { reason: 'Wrong score' }, ctx(90)))
    expect(projection(reopened)).toMatchObject({ result: null, goalieOfRecord: null })
  })
})

describe('overtime strength', () => {
  const MINOR = { class: 'minor', infraction: 'tripping', offenderKind: 'player' } as const
  const minor = (side: 'tracked' | 'opponent', offender: string): HockeyPenaltyInput =>
    side === 'tracked'
      ? { ...MINOR, side, offender: { participantId: offender } }
      : { ...MINOR, side, offender: { label: offender } }

  /** Anchored NHL regular season in a running 3-on-3 overtime; the clock starts at second 1001. */
  function overtime(): GameState {
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile: 'nhl_regular' })), ctx(0)))
    for (let period = 1; period <= 3; period++) {
      if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(period * 10)))
      state = expectOk(endHockeyPeriod(state, { reason: 'Fixture' }, ctx(period * 10 + 1)))
    }
    state = expectOk(startNextHockeyPeriod(state, ctx(1000)))
    return expectOk(startHockeyClock(state, ctx(1001)))
  }

  const strength = (state: GameState, seconds: number) => {
    const reading = hockeyPenaltyBoxNow(hockeySportState(state)!, at(seconds)).strength!
    return `${reading.tracked.skatersOnIce}v${reading.opponent.skatersOnIce}`
  }
  const penalize = (state: GameState, input: HockeyPenaltyInput, seconds: number) =>
    expectOk(recordHockeyPenalties(state, { penalties: [input] }, ctx(seconds)))
  const onIce = (skaters: string[], goalie = 'p1'): HockeyOnIce => ({ status: 'complete', skaterParticipantIds: skaters, goalie })

  it('adds a skater to the other side for each penalty, up to five on three', () => {
    let state = overtime()
    expect(strength(state, 1002)).toBe('3v3')
    state = penalize(state, minor('tracked', 'p2'), 1010)
    expect(strength(state, 1011)).toBe('3v4')
    state = penalize(state, minor('tracked', 'p3'), 1012)
    expect(strength(state, 1013)).toBe('3v5')
    state = penalize(state, minor('tracked', 'p4'), 1014)
    expect(strength(state, 1015)).toBe('3v5')
    // Two tracked minors running against one opponent minor: four on three.
    state = penalize(state, minor('opponent', '#9'), 1016)
    expect(strength(state, 1017)).toBe('3v4')
  })

  it('accepts four- and five-skater sets only while the box allows them, at capture, replay and hydration', () => {
    let state = overtime()
    expect(rejected(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', onIce: onIce(['p2', 'p3', 'p4', 'p5']) }, ctx(1002))))
      .toBe('A complete set has 3-3 skaters in this period.')
    state = penalize(state, minor('opponent', '#9'), 1010)
    state = penalize(state, minor('opponent', '#10'), 1011)
    const sport = hockeySportState(state)!
    const active = hockeyActivePeriod(sport.projection)!
    expect(hockeyOnIceLimits(sport.setup, sport.projection, active, 11_000)).toEqual({ minimum: 3, maximum: 5 })
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', onIce: onIce(['p2', 'p3', 'p4', 'p5', 'p6']) }, ctx(1012)))
    expect(projection(hydrate(state))).toEqual(projection(state))
    // The power-play goal releases one minor: 4 on 3.
    expect(strength(state, 1013)).toBe('4v3')
  })

  it('counts the empty-net attacker once: 4 in a penalty-free 3-on-3, 6 in regulation', () => {
    const state = overtime()
    expect(expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', onIce: onIce(['p2', 'p3', 'p4', 'p5'], 'empty_net') }, ctx(1002))))
      .toBeTruthy()
    expect(rejected(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', onIce: onIce(['p2', 'p3', 'p4', 'p5', 'p6'], 'empty_net') }, ctx(1002))))
      .toBe('A complete set has 3-4 skaters in this period.')
    const setup = hockeySetup({ profile: 'nhl_regular', rules: CLOCKLESS })
    const regulation = expectOk(startHockeyGame(initializedHockeyGame({
      ...setup,
      participants: [...setup.participants, { id: 'p7', playerId: 'player-7', displayName: 'Player 7', number: '7', position: 'C', dressedAs: 'skater' }],
    }), ctx(0)))
    const six = ['p2', 'p3', 'p4', 'p5', 'p6', 'p7']
    expect(expectOk(recordHockeyShot(regulation, { side: 'tracked', outcome: 'goal', onIce: onIce(six, 'empty_net') }, ctx(1)))).toBeTruthy()
  })

  it('widens clockless overtime to full strength', () => {
    const state = expectOk(startNextHockeyPeriod(played('nhl_regular'), ctx(50)))
    const sport = hockeySportState(state)!
    expect(hockeyOnIceLimits(sport.setup, sport.projection, hockeyActivePeriod(sport.projection)!, null))
      .toEqual({ minimum: 3, maximum: 5 })
    expect(expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', onIce: onIce(['p2', 'p3', 'p4', 'p5', 'p6']) }, ctx(51)))).toBeTruthy()
  })

  it('keeps regulation strength unchanged', () => {
    const rules = createHockeyMatchRules('nhl_regular')
    expect(rules.overtime!.skaters).toBe(3)
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile: 'nhl_regular' })), ctx(0)))
    state = expectOk(startHockeyClock(state, ctx(1)))
    state = penalize(state, minor('tracked', 'p2'), 5)
    state = penalize(state, minor('opponent', '#9'), 6)
    expect(strength(state, 7)).toBe('4v4')
  })
})
