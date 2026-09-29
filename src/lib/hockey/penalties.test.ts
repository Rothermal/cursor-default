import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { gameEventRegistry } from '../gameEvents/runtime'
import type { GameEvent } from '../gameEvents/types'
import { createInitialState, gameReducer } from '../gameReducer'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import {
  changeHockeyGoalie,
  hockeyAvailableParticipants,
  hockeyPenaltyBoxNow,
  hockeySkaterChoices,
  pullHockeyGoalie,
  recordHockeyPenalties,
  recordHockeyShot,
  releaseHockeyPenalty,
  type HockeyPenaltyInput,
  type RecordHockeyPenaltiesInput,
} from './captureCommands'
import { createHockeyEvent } from './events'
import {
  endHockeyPeriod,
  hockeySportState,
  pauseHockeyClock,
  setHockeyClock,
  startHockeyClock,
  startHockeyGame,
  startNextHockeyPeriod,
  type HockeyCommandResult,
} from './live'
import { formatHockeyStrength, hockeyPenaltyBoxAt } from './penalties'
import { replayHockeyEvents } from './projector'
import { hockeyRecentEvents, restoreHockeyCapture, undoHockeyCapture } from './recentEvents'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyMatchSetup, HockeyProfileId } from './types'

/** A running anchored game: the clock starts at second 1, so elapsed = seconds - 1. */
function running(profile: HockeyProfileId = 'usa_hockey_youth', setup?: HockeyMatchSetup): GameState {
  const state = expectOk(startHockeyGame(initializedHockeyGame(setup ?? hockeySetup({ profile })), ctx(0)))
  return expectOk(startHockeyClock(state, ctx(1)))
}

const TRIP: Omit<HockeyPenaltyInput, 'side'> = { class: 'minor', infraction: 'tripping', offenderKind: 'player' }

function trackedMinor(participantId = 'p2'): HockeyPenaltyInput {
  return { ...TRIP, side: 'tracked', offender: { participantId } }
}

function opponentMinor(label = '#9'): HockeyPenaltyInput {
  return { ...TRIP, side: 'opponent', offender: { label } }
}

function penalize(state: GameState, input: RecordHockeyPenaltiesInput | HockeyPenaltyInput, seconds: number): GameState {
  const unit = 'penalties' in input ? input : { penalties: [input] }
  return expectOk(recordHockeyPenalties(state, unit, ctx(seconds)))
}

function rejected(result: HockeyCommandResult): string {
  if (result.ok) throw new Error('Expected a rejection')
  return result.message
}

/** Box and strength at `seconds` on the running clock. */
function boxAt(state: GameState, seconds: number) {
  return hockeyPenaltyBoxNow(hockeySportState(state)!, at(seconds))
}

function strengthAt(state: GameState, seconds: number): string {
  return formatHockeyStrength(boxAt(state, seconds).strength!)
}

function events(state: GameState): GameEvent[] {
  return state.eventStream!.events as GameEvent[]
}

function penaltyIds(state: GameState): string[] {
  return projection(state).penalties.map(record => record.eventId)
}

function playerStat(state: GameState, playerId: string, stat: string): number {
  return state.players.find(player => player.id === playerId)?.stats[stat] ?? 0
}

describe('hockey penalty events', () => {
  it('records a minor with PIM, the penalty taken and the penalty drawn', () => {
    let state = running()
    state = penalize(state, { ...trackedMinor(), drawnBy: { label: '#9' } }, 61)
    state = penalize(state, { ...opponentMinor(), drawnBy: { participantId: 'p3' } }, 71)
    const [tracked, opponent] = projection(state).penalties
    expect(tracked).toMatchObject({ side: 'tracked', class: 'minor', durationMs: 120_000, offenderParticipantId: 'p2', elapsedMs: 60_000, gameTimeMs: 60_000 })
    expect(opponent).toMatchObject({ side: 'opponent', offenderLabel: '#9', gameTimeMs: 70_000 })
    expect(projection(state).penaltyTotals).toEqual({
      tracked: { penalties: 1, pimMs: 120_000 },
      opponent: { penalties: 1, pimMs: 120_000 },
    })
    expect(playerStat(state, 'player-2', 'hky_pim')).toBe(2)
    expect(playerStat(state, 'player-2', 'hky_pen')).toBe(1)
    expect(playerStat(state, 'player-3', 'hky_pend')).toBe(1)
  })

  it('stamps the rules length, allows an override, and needs a label for Other', () => {
    let state = running()
    state = penalize(state, { side: 'tracked', class: 'major', infraction: 'fighting', offenderKind: 'player', offender: { participantId: 'p2' } }, 11)
    state = penalize(state, { ...trackedMinor('p3'), durationMs: 90_000 }, 12)
    state = penalize(state, { side: 'opponent', class: 'penalty_shot', infraction: 'hooking', offenderKind: 'player', durationMs: 120_000 }, 13)
    expect(projection(state).penalties.map(record => record.durationMs)).toEqual([300_000, 90_000, 0])
    expect(rejected(recordHockeyPenalties(state, { penalties: [{ ...opponentMinor(), infraction: 'other' }] }, ctx(14))))
      .toBe('Name the infraction.')
    state = penalize(state, { ...opponentMinor(), infraction: 'other', infractionLabel: ' Head contact ' }, 14)
    expect(projection(state).penalties[3]).toMatchObject({ infraction: 'other', infractionLabel: 'Head contact' })
  })

  it('needs a server for goalie, bench and staff penalties and for a match penalty', () => {
    const state = running()
    expect(rejected(recordHockeyPenalties(state, { penalties: [{ ...TRIP, side: 'tracked', offenderKind: 'goalie', offender: { participantId: 'p1' } }] }, ctx(5))))
      .toBe('Name the skater who serves this penalty.')
    expect(rejected(recordHockeyPenalties(state, { penalties: [{ ...TRIP, side: 'tracked', infraction: 'too_many_men', offenderKind: 'bench' }] }, ctx(5))))
      .toBe('Name the skater who serves this penalty.')
    expect(rejected(recordHockeyPenalties(state, { penalties: [{ side: 'tracked', class: 'match', infraction: 'fighting', offenderKind: 'player', offender: { participantId: 'p2' } }] }, ctx(5))))
      .toBe('Name the teammate who serves the match penalty.')
    expect(rejected(recordHockeyPenalties(state, { penalties: [{ ...trackedMinor('p2'), servedBy: { participantId: 'p2' } }] }, ctx(5))))
      .toMatch(/different player/)
    expect(rejected(recordHockeyPenalties(state, { penalties: [{ ...TRIP, side: 'tracked', offenderKind: 'player', offender: { participantId: 'p1' } }] }, ctx(5))))
      .toMatch(/Choose Goalie/)
    // The opponent's players are labels, so an opponent server stays optional.
    const bench = penalize(state, { ...TRIP, side: 'opponent', infraction: 'too_many_men', offenderKind: 'bench' }, 5)
    expect(projection(bench).penalties[0]).toMatchObject({ offenderKind: 'bench', offenderLabel: null })
    const goalie = penalize(state, { ...TRIP, side: 'tracked', offenderKind: 'goalie', offender: { participantId: 'p1' }, servedBy: { participantId: 'p4' } }, 5)
    expect(boxAt(goalie, 5).box.tracked[0]).toMatchObject({ participantId: 'p4' })
  })

  it('records penalties only during a period', () => {
    const between = expectOk(endHockeyPeriod(running(), { reason: 'Fixture' }, ctx(5)))
    expect(rejected(recordHockeyPenalties(between, { penalties: [trackedMinor()] }, ctx(6))))
      .toBe('Penalties are recorded during a period.')
  })
})

describe('hockey penalty box and strength', () => {
  it('runs a minor with the clock and expires it', () => {
    let state = penalize(running(), trackedMinor(), 61)
    expect(boxAt(state, 61).box.tracked).toEqual([expect.objectContaining({ status: 'running', remainingMs: 120_000, strength: true, participantId: 'p2' })])
    expect(strengthAt(state, 61)).toBe('4v5')
    expect(boxAt(state, 121).box.tracked[0].remainingMs).toBe(60_000)
    // Paused clock time does not count.
    state = expectOk(pauseHockeyClock(state, ctx(121)))
    expect(boxAt(state, 500).box.tracked[0].remainingMs).toBe(60_000)
    state = expectOk(startHockeyClock(state, ctx(600)))
    expect(boxAt(state, 659).box.tracked[0].remainingMs).toBe(1_000)
    expect(boxAt(state, 660).box.tracked).toEqual([])
    expect(strengthAt(state, 660)).toBe('5v5')
  })

  it('moves timers with a clock correction', () => {
    let state = penalize(running(), trackedMinor(), 61)
    state = expectOk(pauseHockeyClock(state, ctx(91)))
    expect(boxAt(state, 91).box.tracked[0].remainingMs).toBe(90_000)
    state = expectOk(setHockeyClock(state, { elapsedMs: 150_000, reason: 'Clock missed a whistle' }, ctx(92)))
    expect(boxAt(state, 92).box.tracked[0].remainingMs).toBe(30_000)
  })

  it('stacks a third penalty until a slot frees (5v3)', () => {
    let state = running()
    state = penalize(state, trackedMinor('p2'), 61)
    state = penalize(state, trackedMinor('p3'), 71)
    state = penalize(state, trackedMinor('p4'), 81)
    const box = boxAt(state, 81).box.tracked
    expect(box.map(entry => [entry.participantId, entry.status])).toEqual([['p2', 'running'], ['p3', 'running'], ['p4', 'waiting']])
    expect(strengthAt(state, 81)).toBe('3v5')
    // p2 ends at 181; p4 starts then with its full two minutes.
    const after = boxAt(state, 185).box.tracked
    expect(after.map(entry => [entry.participantId, entry.remainingMs])).toEqual([['p3', 6_000], ['p4', 116_000]])
    expect(strengthAt(state, 185)).toBe('3v5')
    expect(boxAt(state, 191).box.tracked.map(entry => [entry.participantId, entry.remainingMs])).toEqual([['p4', 110_000]])
    expect(strengthAt(state, 191)).toBe('4v5')
  })

  it('never takes a side below the minimum skaters', () => {
    let state = running()
    for (const [index, id] of ['p2', 'p3', 'p4', 'p5'].entries()) state = penalize(state, trackedMinor(id), 11 + index)
    expect(boxAt(state, 20).strength!.tracked.baseSkaters).toBe(3)
  })

  it('serves a double minor as two consecutive segments', () => {
    let state = penalize(running(), { ...trackedMinor(), class: 'double_minor', infraction: 'high_sticking' }, 1)
    expect(boxAt(state, 1).box.tracked.map(entry => [entry.segment, entry.status, entry.remainingMs]))
      .toEqual([[1, 'running', 120_000], [2, 'waiting', 120_000]])
    expect(boxAt(state, 181).box.tracked.map(entry => [entry.segment, entry.status, entry.remainingMs]))
      .toEqual([[2, 'running', 60_000]])
    expect(strengthAt(state, 181)).toBe('4v5')
    state = expectOk(pauseHockeyClock(state, ctx(300)))
    expect(boxAt(state, 300).box.tracked).toEqual([])
  })

  it('keeps misconduct time off the strength and runs a major for its full length', () => {
    let state = running()
    state = penalize(state, { side: 'tracked', class: 'misconduct', infraction: 'unsportsmanlike', offenderKind: 'player', offender: { participantId: 'p2' } }, 1)
    state = penalize(state, { side: 'opponent', class: 'major', infraction: 'boarding', offenderKind: 'player', offender: { label: '#4' } }, 1)
    expect(boxAt(state, 1).box.tracked[0]).toMatchObject({ strength: false, remainingMs: 600_000 })
    expect(strengthAt(state, 1)).toBe('5v4')
    expect(strengthAt(state, 300)).toBe('5v4')
    expect(strengthAt(state, 301)).toBe('5v5')
  })

  it('adds the extra attacker to the side whose net is empty', () => {
    let state = penalize(running(), opponentMinor(), 1)
    state = expectOk(pullHockeyGoalie(state, { side: 'tracked' }, ctx(2)))
    const strength = boxAt(state, 2).strength!
    expect(strength.tracked).toEqual({ baseSkaters: 5, skatersOnIce: 6 })
    expect(strength.opponent).toEqual({ baseSkaters: 4, skatersOnIce: 4 })
    expect(formatHockeyStrength(strength)).toBe('6v4')
  })

  it('carries remaining time across a period end', () => {
    let state = penalize(running(), trackedMinor(), 841)
    state = expectOk(pauseHockeyClock(state, ctx(901)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(902)))
    expect(boxAt(state, 950).box.tracked[0].remainingMs).toBe(60_000)
    state = expectOk(startNextHockeyPeriod(state, ctx(960)))
    state = expectOk(startHockeyClock(state, ctx(961)))
    expect(boxAt(state, 991).box.tracked[0].remainingMs).toBe(30_000)
    expect(boxAt(state, 1021).box.tracked).toEqual([])
  })

  it('records clockless penalties without timers or strength', () => {
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
    state = penalize(state, trackedMinor(), 10)
    expect(projection(state).penalties[0]).toMatchObject({ elapsedMs: null, gameTimeMs: null })
    expect(projection(state).penaltyTotals.tracked.pimMs).toBe(120_000)
    const reading = boxAt(state, 10)
    expect(reading.box.tracked).toEqual([])
    expect(reading.strength).toBeNull()
    expect(rejected(releaseHockeyPenalty(state, { penaltyEventId: penaltyIds(state)[0], reason: 'Early' }, ctx(11))))
      .toMatch(/games with a clock/)
  })
})

describe('coincidental penalties', () => {
  const pair = (coincidental: boolean): RecordHockeyPenaltiesInput => ({
    penalties: [trackedMinor(), opponentMinor()],
    coincidental,
    captureCommandId: 'unit-1',
  })

  it('cancels a grouped minor pair under substitute, keeping the box timers and PIM', () => {
    const state = penalize(running(), pair(true), 61)
    expect(projection(state).penalties.map(record => record.coincidenceGroupId)).toEqual(['unit-1', 'unit-1'])
    const reading = boxAt(state, 61)
    expect(reading.box.tracked[0]).toMatchObject({ strength: false, cancelled: true, status: 'running' })
    expect(reading.box.cancelledPenaltyIds).toHaveLength(2)
    expect(formatHockeyStrength(reading.strength!)).toBe('5v5')
    expect(projection(state).penaltyTotals.tracked.pimMs).toBe(120_000)
    expect(boxAt(state, 181).box.tracked).toEqual([])
  })

  it('plays four on four under play_short at full strength', () => {
    const state = penalize(running('nhl_regular'), pair(true), 61)
    expect(strengthAt(state, 61)).toBe('4v4')
    expect(boxAt(state, 61).box.strengthPenaltyIds).toHaveLength(2)
  })

  it('substitutes under play_short when a side is already short', () => {
    let state = penalize(running('nhl_regular'), trackedMinor('p5'), 31)
    state = penalize(state, pair(true), 61)
    expect(strengthAt(state, 61)).toBe('4v5')
  })

  it('treats the same equal minors saved separately as unrelated', () => {
    let state = penalize(running(), trackedMinor(), 61)
    expect(strengthAt(state, 61)).toBe('4v5')
    state = penalize(state, opponentMinor(), 61)
    expect(projection(state).penalties.map(record => record.coincidenceGroupId)).toEqual([null, null])
    expect(strengthAt(state, 61)).toBe('4v4')
    expect(boxAt(state, 61).box.strengthPenaltyIds).toHaveLength(2)
  })

  it('leaves the unmatched minor of a two-for-one group counting', () => {
    const state = penalize(running(), {
      penalties: [trackedMinor('p2'), trackedMinor('p3'), opponentMinor()],
      coincidental: true,
    }, 61)
    const reading = boxAt(state, 61)
    expect(reading.box.tracked.map(entry => [entry.participantId, entry.cancelled])).toEqual([['p2', true], ['p3', false]])
    expect(formatHockeyStrength(reading.strength!)).toBe('4v5')
  })

  it('does not save a group without both sides', () => {
    expect(rejected(recordHockeyPenalties(running(), { penalties: [trackedMinor('p2'), trackedMinor('p3')], coincidental: true }, ctx(5))))
      .toBe('Coincidental penalties need a penalty on each side.')
  })

  it('rejects a one-sided group and a group id other than its capture id on replay', () => {
    const state = running()
    const setup = hockeySportState(state)!.setup
    const penalty = (id: string | undefined, sequence: number, groupId: string | null, commandId: string | null) => createHockeyEvent({
      id,
      eventType: 'hockey.penalty',
      teamSide: 'tracked',
      actors: [{ role: 'offender', kind: 'player', playerId: `player-${sequence}`, participantId: `p${sequence}` }],
      payload: {
        captureCommandId: commandId,
        class: 'minor',
        infraction: 'tripping',
        infractionLabel: null,
        durationMs: 120_000,
        offenderKind: 'player',
        delayed: false,
        coincidenceGroupId: groupId,
      },
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 9_000,
      recorderUserId: null,
      sequence: 100 + sequence,
      occurredAt: at(10),
    }) as unknown as GameEvent
    const oneSided = replayHockeyEvents(setup, [...events(state), penalty('a', 2, 'g', 'g'), penalty('b', 3, 'g', 'g')])
    expect(oneSided.diagnostics).toEqual([expect.objectContaining({ message: 'Coincidental penalties need a penalty on each side.', eventId: 'a' })])

    const mismatch = gameEventRegistry.inspect(penalty(undefined, 2, 'other', 'g'))
    expect(mismatch.ok ? null : mismatch.diagnostic.message).toBe('A coincidence group is the penalties saved together.')
  })

  it('undoes and restores the whole unit together', () => {
    const state = penalize(running(), pair(true), 61)
    expect(hockeyRecentEvents(state)[0]).toMatchObject({ undoable: true, eventIds: penaltyIds(state) })
    const undone = expectOk(undoHockeyCapture(state, at(62)))
    expect(projection(undone).penalties).toEqual([])
    const restored = expectOk(restoreHockeyCapture(undone, at(63)))
    expect(projection(restored).penalties.map(record => record.coincidenceGroupId)).toEqual(['unit-1', 'unit-1'])
  })

  it('round-trips a group through hydration', () => {
    const state = penalize(running(), pair(true), 61)
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
    expect(buildGameSyncFingerprint(hydrated)).toBe(buildGameSyncFingerprint(state))
    expect(projection(hydrated)).toEqual(projection(state))
    expect(formatHockeyStrength(boxAt(hydrated, 61).strength!)).toBe('5v5')
  })
})

describe('misconducts and removal', () => {
  const minorAndMisconduct = (servedBy: string | null): RecordHockeyPenaltiesInput => ({
    penalties: [
      { ...trackedMinor('p2'), infraction: 'roughing', servedBy: servedBy ? { participantId: servedBy } : null },
      { side: 'tracked', class: 'misconduct', infraction: 'roughing', offenderKind: 'player', offender: { participantId: 'p2' } },
    ],
  })

  it('serves a minor by a teammate and starts the misconduct when the minor ends', () => {
    expect(rejected(recordHockeyPenalties(running(), minorAndMisconduct(null), ctx(61))))
      .toMatch(/teammate who serves the minor/)
    const state = penalize(running(), minorAndMisconduct('p4'), 61)
    expect(boxAt(state, 61).box.tracked.map(entry => [entry.class, entry.status, entry.participantId]))
      .toEqual([['minor', 'running', 'p4'], ['misconduct', 'waiting', 'p2']])
    expect(boxAt(state, 181).box.tracked.map(entry => [entry.class, entry.status, entry.remainingMs]))
      .toEqual([['misconduct', 'running', 600_000]])
    expect(strengthAt(state, 181)).toBe('5v5')
    expect(playerStat(state, 'player-2', 'hky_pim')).toBe(12)
  })

  it('removes a player with a game misconduct from every later capture', () => {
    let state = penalize(running(), { side: 'tracked', class: 'game_misconduct', infraction: 'abuse_of_officials', offenderKind: 'player', offender: { participantId: 'p2' } }, 11)
    expect(projection(state).removedParticipantIds).toEqual(['p2'])
    expect(boxAt(state, 11).box.tracked).toEqual([])
    expect(strengthAt(state, 11)).toBe('5v5')
    const setup = hockeySportState(state)!.setup
    expect(hockeyAvailableParticipants(hockeySkaterChoices(setup), projection(state)).map(entry => entry.id)).not.toContain('p2')
    expect(rejected(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p2' } }, ctx(12))))
      .toBe('Player 2 has left the game.')
    expect(rejected(recordHockeyShot(state, {
      side: 'tracked',
      outcome: 'goal',
      onIce: { status: 'complete', skaterParticipantIds: ['p2', 'p3', 'p4', 'p5', 'p6'], goalie: 'p1' },
    }, ctx(12)))).toBe('Player 2 has left the game.')
    expect(rejected(recordHockeyPenalties(state, { penalties: [trackedMinor('p2')] }, ctx(12))))
      .toBe('Player 2 has left the game.')
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p3' } }, ctx(13)))
  })

  it('runs a match penalty for five minutes served by a teammate and removes the offender', () => {
    const state = penalize(running(), {
      side: 'tracked',
      class: 'match',
      infraction: 'fighting',
      offenderKind: 'player',
      offender: { participantId: 'p2' },
      servedBy: { participantId: 'p3' },
    }, 1)
    expect(projection(state).removedParticipantIds).toEqual(['p2'])
    expect(boxAt(state, 1).box.tracked).toEqual([expect.objectContaining({ strength: true, remainingMs: 300_000, participantId: 'p3' })])
    expect(strengthAt(state, 1)).toBe('4v5')
  })

  it('asks for a goalie change before removing the goalie in net', () => {
    let state = running()
    const penalty: HockeyPenaltyInput = {
      side: 'tracked',
      class: 'game_misconduct',
      infraction: 'abuse_of_officials',
      offenderKind: 'goalie',
      offender: { participantId: 'p1' },
    }
    expect(rejected(recordHockeyPenalties(state, { penalties: [penalty] }, ctx(5)))).toBe('Put another goalie in net before removing this one.')
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(6)))
    state = penalize(state, penalty, 7)
    expect(rejected(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p1' }, ctx(8)))).toBe('Player 1 has left the game.')
  })
})

describe('early penalty release', () => {
  it('ends a minor early without changing PIM, and Undo lets it run again', () => {
    let state = penalize(running(), trackedMinor(), 61)
    const [penaltyEventId] = penaltyIds(state)
    expect(rejected(releaseHockeyPenalty(state, { penaltyEventId, reason: ' ' }, ctx(90)))).toBe('Say why the penalty is ending early.')
    state = expectOk(releaseHockeyPenalty(state, { penaltyEventId, reason: 'Referee waved it off' }, ctx(91)))
    expect(projection(state).penaltyReleases).toEqual([expect.objectContaining({ penaltyEventId, segment: 1, gameTimeMs: 90_000 })])
    expect(boxAt(state, 91).box.tracked).toEqual([])
    expect(strengthAt(state, 91)).toBe('5v5')
    expect(projection(state).penaltyTotals.tracked.pimMs).toBe(120_000)
    expect(playerStat(state, 'player-2', 'hky_pim')).toBe(2)
    expect(hockeyRecentEvents(state)[0].label).toBe('Tracked penalty released early (Referee waved it off)')
    expect(rejected(releaseHockeyPenalty(state, { penaltyEventId, reason: 'Again' }, ctx(92)))).toBe('That penalty has already ended.')

    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
    expect(boxAt(hydrated, 95).box.tracked).toEqual([])

    const undone = expectOk(undoHockeyCapture(state, at(100)))
    expect(boxAt(undone, 100).box.tracked[0].remainingMs).toBe(81_000)
  })

  it('releases the second half of a double minor', () => {
    let state = penalize(running(), { ...trackedMinor(), class: 'double_minor' }, 1)
    const [penaltyEventId] = penaltyIds(state)
    state = expectOk(releaseHockeyPenalty(state, { penaltyEventId, segment: 2, reason: 'Assessed in error' }, ctx(31)))
    expect(boxAt(state, 31).box.tracked.map(entry => entry.segment)).toEqual([1])
    expect(boxAt(state, 121).box.tracked).toEqual([])
    expect(projection(state).penaltyTotals.tracked.pimMs).toBe(240_000)
  })

  it('refuses to release a penalty that already ended', () => {
    const state = penalize(running(), trackedMinor(), 1)
    expect(rejected(releaseHockeyPenalty(state, { penaltyEventId: penaltyIds(state)[0], reason: 'Late' }, ctx(200))))
      .toBe('That penalty has already ended.')
  })

  it('keeps a release inert, with a note, when the clock had already run out the penalty', () => {
    let state = penalize(running(), trackedMinor(), 61)
    state = expectOk(pauseHockeyClock(state, ctx(100)))
    const setup = hockeySportState(state)!.setup
    const [penaltyEventId] = penaltyIds(state)
    // A correction that ran the clock past the penalty's end, then a release at that time.
    const correction = createHockeyEvent({
      eventType: 'hockey.clock_set',
      payload: { captureCommandId: null, fromElapsedMs: 99_000, toElapsedMs: 200_000, reason: 'Correction' },
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 200_000,
      recorderUserId: null,
      sequence: 200,
      occurredAt: at(101),
    }) as unknown as GameEvent
    const release = createHockeyEvent({
      id: 'release',
      eventType: 'hockey.penalty_release',
      teamSide: 'tracked',
      payload: { captureCommandId: null, penaltyEventId, segment: 1, reason: 'Waved off' },
      period: { id: 'regulation-1', order: 1 },
      elapsedMs: 200_000,
      recorderUserId: null,
      sequence: 201,
      occurredAt: at(102),
    }) as unknown as GameEvent
    const replay = replayHockeyEvents(setup, [...events(state), correction, release])
    expect(replay.diagnostics).toEqual([])
    const box = hockeyPenaltyBoxAt(setup, replay.projection, 200_000)
    expect(box.tracked).toEqual([])
    expect(box.notes).toEqual([{ eventId: 'release', message: expect.stringMatching(/no effect/) }])
  })
})
