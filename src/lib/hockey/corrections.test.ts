import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { createInitialState, gameReducer } from '../gameReducer'
import {
  changeHockeyGoalie,
  recordHockeyFaceoff,
  recordHockeyPenalties,
  recordHockeyPlay,
  recordHockeyShootoutAttempt,
  recordHockeyShot,
  recordHockeyTeamEvent,
  recordHockeyTimeout,
  releaseHockeyPenalty,
  adjustHockeyScore,
  startHockeyShootout,
} from './captureCommands'
import {
  correctHockeyEvents,
  hasHockeyCorrectionConsequences,
  hockeyCorrectionConsequences,
  hockeyCorrectionInput,
  hockeyGoalieChangeCorrection,
  hockeyRemovalDependents,
  hockeyRestoreDependents,
  removeHockeyEvents,
  restoreHockeyEvents,
  updateHockeyGoalieStamps,
  type HockeyCorrectionInput,
} from './corrections'
import {
  endHockeyMatch,
  endHockeyPeriod,
  hockeySportState,
  interruptHockeyMatch,
  startHockeyClock,
  startHockeyGame,
  startNextHockeyPeriod,
  type HockeyCommandResult,
} from './live'
import { canRestoreHockeyCapture, undoHockeyCapture } from './recentEvents'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import { hockeyTimeline, type HockeyTimelineRow } from './timeline'
import type { HockeyProfileId } from './types'

const LABELS = { tracked: 'Blades', opponent: 'Rivals' }
const OPTIONS = { recorderUserId: null, now: at(500) }

function rows(state: GameState): HockeyTimelineRow[] {
  return hockeyTimeline(state, LABELS).rows
}

function row(state: GameState, label: string | RegExp): HockeyTimelineRow {
  const found = rows(state).find(entry => (typeof label === 'string' ? entry.label === label : label.test(entry.label)))
  if (!found) throw new Error(`No row ${label}: ${rows(state).map(entry => entry.label).join(' | ')}`)
  return found
}

function ids(entry: HockeyTimelineRow): string[] {
  return entry.events.map(event => event.id)
}

function correct(state: GameState, label: string | RegExp, change: (input: HockeyCorrectionInput) => HockeyCorrectionInput): HockeyCommandResult {
  const target = row(state, label)
  const input = hockeyCorrectionInput(target.events)
  if (!input) throw new Error('Row is read-only')
  return correctHockeyEvents(state, ids(target), change(structuredClone(input)), OPTIONS)
}

function rejected(result: HockeyCommandResult): string {
  if (result.ok) throw new Error('Expected a rejection')
  return result.message
}

function hydrate(state: GameState): GameState {
  return gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
}

function clockless(profile: HockeyProfileId = 'usa_hockey_youth'): GameState {
  return expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile, rules: CLOCKLESS })), ctx(0)))
}

function running(): GameState {
  return expectOk(startHockeyClock(expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0))), ctx(1)))
}

describe('Hockey Timeline corrections', () => {
  it('prefills every editable family so saving unchanged values changes nothing', () => {
    let state = running()
    state = expectOk(recordHockeyShot(state, {
      side: 'tracked',
      outcome: 'goal',
      shooter: { participantId: 'p2' },
      assists: [{ participantId: 'p3' }, { participantId: 'p4' }],
      location: { x: 0.8, y: 0.4 },
      onIce: { status: 'partial', skaterParticipantIds: ['p2', 'p3'], goalie: 'p1' },
    }, ctx(10)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'blocked', shooter: { label: '#9' }, blocker: { participantId: 'p5' } }, ctx(11)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'missed', missType: 'wide', penaltyShot: true }, ctx(12)))
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked', takerParticipantId: 'p2', opponentTakerLabel: '#19' }, ctx(13)))
    state = expectOk(recordHockeyPlay(state, { kind: 'hit', side: 'tracked', player: { participantId: 'p5' }, hitPlayer: { label: '#4' }, location: { x: 0.3, y: 0.2 } }, ctx(14)))
    state = expectOk(recordHockeyPlay(state, { kind: 'giveaway', side: 'opponent', player: { label: '#8' } }, ctx(15)))
    state = expectOk(recordHockeyPenalties(state, {
      penalties: [
        { side: 'tracked', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { participantId: 'p4' }, drawnBy: { label: '#7' } },
        { side: 'opponent', class: 'minor', infraction: 'other', infractionLabel: 'Spearing', offenderKind: 'player', offender: { label: '#12' }, delayed: true },
      ],
      coincidental: true,
    }, ctx(16)))
    state = expectOk(changeHockeyGoalie(state, {
      side: 'opponent',
      inParticipantId: 'opp-2',
      newOpponentGoalie: { id: 'opp-2', label: 'Backup', number: '1' },
    }, ctx(17)))
    state = expectOk(recordHockeyTeamEvent(state, { kind: 'icing', side: 'opponent', location: { x: 0.1, y: 0.9 } }, ctx(18)))
    state = expectOk(adjustHockeyScore(state, { side: 'opponent', delta: 1, reason: 'Scorer missed a goal' }, ctx(19)))
    state = expectOk(recordHockeyTimeout(state, { side: 'tracked' }, ctx(20)))

    const editable = rows(state).filter(entry => hockeyCorrectionInput(entry.events))
    expect(editable.map(entry => entry.events[0].eventType)).toEqual([
      'hockey.shot', 'hockey.shot', 'hockey.shot', 'hockey.faceoff', 'hockey.hit', 'hockey.giveaway',
      'hockey.penalty', 'hockey.goalie_change', 'hockey.team_event', 'hockey.score_adjustment', 'hockey.timeout',
    ])
    for (const entry of editable) {
      const input = hockeyCorrectionInput(entry.events)!
      expect(rejected(correctHockeyEvents(state, ids(entry), input, OPTIONS)), entry.label).toBe('Nothing changed.')
    }
    // Lifecycle and clock rows stay read-only.
    expect(hockeyCorrectionInput(row(state, 'clock started').events)).toBeNull()
  })

  it('edits a shot into a goal in place, keeping its id, time and stamped goalie', () => {
    let state = running()
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p2' } }, ctx(61)))
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(70)))
    state = expectOk(startNextHockeyPeriod(state, ctx(80)))
    const before = row(state, 'Blades saved by Player 2')

    const result = correct(state, 'Blades saved by Player 2', change => ({
      kind: 'shot',
      input: { ...(change.input as Extract<HockeyCorrectionInput, { kind: 'shot' }>['input']), outcome: 'goal', shooter: { participantId: 'p3' }, assists: [{ participantId: 'p2' }] },
    }))
    const after = expectOk(result)
    const edited = row(after, 'Blades goal by Player 3')
    expect(edited.id).toBe(before.id)
    expect(edited.events[0]).toMatchObject({
      period: before.events[0].period,
      elapsedMs: 60_000,
      occurredAt: before.events[0].occurredAt,
      sequence: before.events[0].sequence,
      revision: 2,
      updatedAt: at(500),
    })
    expect(edited.events[0].actors.find(actor => actor.role === 'goalie')?.participantId).toBe('opp-goalie')
    expect(edited).toMatchObject({ revised: true, strength: 'ev' })
    expect(projection(after).score).toEqual({ tracked: 1, opponent: 0 })
    expect(hockeyCorrectionConsequences(state, after).score).toEqual({ before: { tracked: 0, opponent: 0 }, after: { tracked: 1, opponent: 0 } })
    expect(rows(hydrate(after))).toEqual(rows(after))
  })

  it('refuses a correction the replay rejects and saves nothing', () => {
    let state = running()
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal' }, ctx(10)))
    const tooMany = correct(state, 'Blades goal', change => ({
      kind: 'shot',
      input: {
        ...(change.input as Extract<HockeyCorrectionInput, { kind: 'shot' }>['input']),
        onIce: { status: 'complete', skaterParticipantIds: ['p2', 'p3', 'p4', 'p5', 'p6', 'p30'], goalie: 'p1' },
      },
    }))
    expect(rejected(tooMany)).toMatch(/skaters|on the ice/i)
    expect(tooMany.state).toBe(state)
  })

  it('clears the quick-Undo Restore receipt and keeps Undo working on the newest capture', () => {
    let state = clockless()
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved' }, ctx(1)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(2)))
    const undone = undoHockeyCapture(state, at(3))
    if (!undone.ok) throw new Error(undone.message)
    expect(canRestoreHockeyCapture(undone.state)).toBe(true)
    const edited = expectOk(correct(undone.state, 'Blades saved', change => ({
      kind: 'shot',
      input: { ...(change.input as Extract<HockeyCorrectionInput, { kind: 'shot' }>['input']), outcome: 'missed' },
    })))
    expect(canRestoreHockeyCapture(edited)).toBe(false)
  })

  it('swaps a play to the other side, clearing actors the dialog must pick again', () => {
    let state = clockless()
    state = expectOk(recordHockeyPlay(state, { kind: 'takeaway', side: 'tracked', player: { participantId: 'p5' } }, ctx(1)))
    const swapped = expectOk(correct(state, 'Blades takeaway by Player 5', () => ({
      kind: 'play',
      input: { kind: 'takeaway', side: 'opponent', player: { label: '#22' } },
    })))
    expect(row(swapped, 'Rivals takeaway by #22').events[0].teamSide).toBe('opponent')
    expect(projection(swapped).takeaways).toEqual({ tracked: 0, opponent: 1 })
  })

  it('removes and restores a penalty with its early release', () => {
    let state = running()
    state = expectOk(recordHockeyPenalties(state, {
      penalties: [{ side: 'tracked', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { participantId: 'p2' } }],
    }, ctx(11)))
    const penaltyId = projection(state).penalties[0].eventId
    state = expectOk(releaseHockeyPenalty(state, { penaltyEventId: penaltyId, reason: 'Assessed in error' }, ctx(21)))
    expect(hockeyRemovalDependents(state, [penaltyId]).map(event => event.eventType)).toEqual(['hockey.penalty_release'])

    const removed = expectOk(removeHockeyEvents(state, [penaltyId], at(30)))
    expect(projection(removed).penalties).toEqual([])
    expect(rows(removed).filter(entry => entry.removed).map(entry => entry.events[0].eventType))
      .toEqual(['hockey.penalty', 'hockey.penalty_release'])
    expect(hockeyRestoreDependents(removed, [penaltyId]).releases).toHaveLength(1)

    const penaltyOnly = expectOk(restoreHockeyEvents(removed, [penaltyId], { withReleases: false }, at(31)))
    expect(projection(penaltyOnly).penalties).toHaveLength(1)
    expect(rows(penaltyOnly).find(entry => entry.events[0].eventType === 'hockey.penalty_release')?.removed).toBe(true)
    const both = expectOk(restoreHockeyEvents(removed, [penaltyId], { withReleases: true }, at(31)))
    expect(rows(both).some(entry => entry.removed)).toBe(false)
    expect(rows(hydrate(both))).toEqual(rows(both))
  })

  it('removes a coincidence group as one unit, and never lifecycle rows', () => {
    let state = clockless()
    state = expectOk(recordHockeyPenalties(state, {
      penalties: [
        { side: 'tracked', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { participantId: 'p2' } },
        { side: 'opponent', class: 'minor', infraction: 'roughing', offenderKind: 'player', offender: { label: '#4' } },
      ],
      coincidental: true,
    }, ctx(1)))
    const pair = row(state, /tripping/)
    const removed = expectOk(removeHockeyEvents(state, ids(pair), at(2)))
    expect(projection(removed).penalties).toEqual([])
    expect(rejected(removeHockeyEvents(state, ids(row(state, 'period started')), at(2))))
      .toBe('Game flow and clock rows cannot be removed.')
  })

  it('edits a coincidence group together', () => {
    let state = clockless()
    state = expectOk(recordHockeyPenalties(state, {
      penalties: [
        { side: 'tracked', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { participantId: 'p2' } },
        { side: 'opponent', class: 'minor', infraction: 'roughing', offenderKind: 'player', offender: { label: '#4' } },
      ],
      coincidental: true,
    }, ctx(1)))
    const edited = expectOk(correct(state, /tripping/, change => {
      const input = change.input as Extract<HockeyCorrectionInput, { kind: 'penalties' }>['input']
      return { kind: 'penalties', input: { ...input, penalties: [input.penalties[0], { ...input.penalties[1], infraction: 'slashing' }] } }
    }))
    const group = row(edited, /slashing/)
    expect(group.events).toHaveLength(2)
    expect(group.events.map(event => (event.payload as { coincidenceGroupId: string }).coincidenceGroupId))
      .toEqual([(row(state, /tripping/).events[0].payload as { captureCommandId: string }).captureCommandId, expect.any(String)])
    const added = correct(state, /tripping/, change => {
      const input = change.input as Extract<HockeyCorrectionInput, { kind: 'penalties' }>['input']
      return { kind: 'penalties', input: { ...input, penalties: [...input.penalties, input.penalties[0]] } }
    })
    expect(rejected(added)).toBe('This change adds or removes events. Remove the row and record it again instead.')
  })

  it('removes the shootout start with its attempts and restores them together', () => {
    let state = clockless('nhl_regular')
    let second = 1
    for (let period = 1; period <= 4; period++) {
      if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(second++)))
      state = expectOk(endHockeyPeriod(state, {}, ctx(second++)))
    }
    state = expectOk(startHockeyShootout(state, { firstSide: 'tracked' }, ctx(20)))
    state = expectOk(recordHockeyShootoutAttempt(state, { outcome: 'goal', shooter: { participantId: 'p2' } }, ctx(21)))
    state = expectOk(recordHockeyShootoutAttempt(state, { outcome: 'saved' }, ctx(22)))
    const start = row(state, /Shootout started/)
    const removed = expectOk(removeHockeyEvents(state, ids(start), at(30)))
    expect(projection(removed).shootout).toBeNull()
    expect(rows(removed).filter(entry => entry.removed)).toHaveLength(3)
    const restored = expectOk(restoreHockeyEvents(removed, ids(start), { withReleases: false }, at(31)))
    expect(projection(restored).shootout?.attempts).toHaveLength(2)

    const edited = expectOk(correct(state, /shootout Player 2/, () => ({
      kind: 'shootout_attempt',
      input: { outcome: 'missed', shooter: { participantId: 'p3' } },
    })))
    expect(projection(edited).shootout?.goals).toEqual({ tracked: 0, opponent: 0 })
  })

  it('previews goalie stamps a goalie correction leaves behind and updates them on request', () => {
    let state = clockless()
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(1)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(2)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'goal' }, ctx(3)))
    const shotIds = rows(state).filter(entry => entry.events[0].eventType === 'hockey.shot').map(entry => entry.id)

    // The change was wrong: the starter stayed in net. Removing it leaves both shots on p30.
    const removed = expectOk(removeHockeyEvents(state, ids(row(state, 'Blades goalie change')), at(10)))
    const consequences = hockeyCorrectionConsequences(state, removed)
    expect(consequences.goalies.map(entry => [entry.eventId, entry.recordedParticipantId, entry.resolvedParticipantId]))
      .toEqual([[shotIds[0], 'p30', 'p1'], [shotIds[1], 'p30', 'p1']])
    expect(hasHockeyCorrectionConsequences(consequences)).toBe(true)

    const restamped = expectOk(updateHockeyGoalieStamps(removed, shotIds, at(11)))
    expect(projection(restamped).warnings).toEqual([])
    const goal = row(restamped, 'Rivals goal').events[0]
    expect(goal.actors.find(actor => actor.role === 'goalie')?.participantId).toBe('p1')
    expect(rows(hydrate(restamped))).toEqual(rows(restamped))
  })

  it('restamps in the same batch when a goalie change shots depend on is removed', () => {
    let state = clockless()
    state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(1)))
    state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(2)))
    const shotId = row(state, 'Rivals saved').id

    const result = removeHockeyEvents(state, ids(row(state, 'Blades goalie change')), at(10), { updateGoalies: true })
    expect(result.goalieRepairs).toEqual([{ eventId: shotId, recordedParticipantId: 'p30', resolvedParticipantId: 'p1' }])
    const removed = expectOk(result)
    expect(projection(removed).warnings).toEqual([])
    expect(row(removed, 'Rivals saved').events[0].revision).toBe(2)
    expect(hockeyCorrectionConsequences(state, removed).goalies).toEqual([])
  })

  it('removes an opponent goalie introduction with its later shots restamped, never saving a broken history', () => {
    let state = clockless()
    state = expectOk(changeHockeyGoalie(state, {
      side: 'opponent',
      inParticipantId: 'opp-2',
      newOpponentGoalie: { id: 'opp-2', label: 'Backup', number: '1' },
    }, ctx(1)))
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p2' } }, ctx(2)))
    // A shot the recorder deliberately stamped against the starter keeps that choice.
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'missed', goalieId: 'opp-goalie' }, ctx(3)))
    const saved = row(state, 'Blades saved by Player 2')
    const unit = ids(row(state, 'Rivals goalie change'))

    // Without the restamp the saved shot names a goalie the game no longer knows.
    const plain = removeHockeyEvents(state, unit, at(10))
    expect(rejected(plain)).toBe('The opponent goalie is not known to this game.')
    expect(plain.state).toBe(state)

    const result = removeHockeyEvents(state, unit, at(10), { updateGoalies: true })
    expect(result.goalieRepairs).toEqual([{ eventId: saved.id, recordedParticipantId: 'opp-2', resolvedParticipantId: 'opp-goalie' }])
    const removed = expectOk(result)
    expect(row(removed, 'Blades saved by Player 2').events[0].actors.find(actor => actor.role === 'goalie')?.participantId).toBe('opp-goalie')
    expect(projection(removed).opponentGoalies.map(goalie => goalie.id)).toEqual(['opp-goalie'])
    expect(rows(hydrate(removed))).toEqual(rows(removed))

    // Restoring the introduction offers to move both shots back; the plain restore keeps them.
    const missed = row(state, 'Blades missed').id
    const restored = restoreHockeyEvents(removed, unit, { withReleases: false, updateGoalies: true }, at(20))
    expect(restored.goalieRepairs.map(entry => [entry.eventId, entry.resolvedParticipantId])).toEqual([[saved.id, 'opp-2'], [missed, 'opp-2']])
    const plainRestore = expectOk(restoreHockeyEvents(removed, unit, { withReleases: false }, at(20)))
    expect(projection(plainRestore).warnings.map(warning => warning.eventId)).toEqual([saved.id, missed])
  })

  it('edits an introduced opponent goalie to an empty net, dropping the introduction and restamping later shots', () => {
    let state = clockless()
    state = expectOk(changeHockeyGoalie(state, {
      side: 'opponent',
      inParticipantId: 'opp-2',
      newOpponentGoalie: { id: 'opp-2', label: 'Backup', number: '1' },
    }, ctx(1)))
    const target = row(state, 'Rivals goalie change')
    const initial = hockeyCorrectionInput(target.events)
    if (initial?.kind !== 'goalie_change') throw new Error('Expected a goalie change')

    // The editor's choices: Empty net, with the introduced goalie's fields still filled in.
    const pulled = hockeyGoalieChangeCorrection(initial.input, { inParticipantId: null, reason: 'tactical', label: 'Backup', number: '1' })
    expect(pulled).toEqual({ kind: 'goalie_change', input: { side: 'opponent', inParticipantId: null, reason: 'pulled', newOpponentGoalie: null } })
    // Keeping the introduction is what the validator refuses.
    expect(rejected(correctHockeyEvents(state, ids(target), {
      kind: 'goalie_change',
      input: { ...initial.input, inParticipantId: null, reason: 'pulled' },
    }, OPTIONS))).toBe('A new opponent goalie must be the goalie going in.')
    const edited = expectOk(correctHockeyEvents(state, ids(target), pulled, OPTIONS))
    expect(projection(edited).goalieInNet.opponent).toBeNull()

    // Still the introduced goalie: edited label and number are kept.
    const renamed = hockeyGoalieChangeCorrection(initial.input, { inParticipantId: 'opp-2', reason: 'tactical', label: ' Reserve ', number: '30' })
    expect(renamed.kind === 'goalie_change' && renamed.input.newOpponentGoalie).toEqual({ id: 'opp-2', label: 'Reserve', number: '30' })
    expect(projection(expectOk(correctHockeyEvents(state, ids(target), renamed, OPTIONS))).opponentGoalies[1]).toMatchObject({ number: '30' })

    // With a later shot on the introduced goalie, the edit saves only with the restamp.
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved' }, ctx(2)))
    const shot = row(state, 'Blades saved')
    expect(rejected(correctHockeyEvents(state, ids(target), pulled, OPTIONS))).toBe('The opponent goalie is not known to this game.')
    const result = correctHockeyEvents(state, ids(target), pulled, { ...OPTIONS, updateGoalies: true })
    expect(result.goalieRepairs).toEqual([{ eventId: shot.id, recordedParticipantId: 'opp-2', resolvedParticipantId: null }])
    const repaired = expectOk(result)
    const restamped = row(repaired, /Blades saved/).events[0]
    expect(restamped.actors.some(actor => actor.role === 'goalie')).toBe(false)
    expect(restamped.payload.emptyNet).toBe(true)
    expect(row(repaired, 'Rivals goalie pulled').events[0].revision).toBe(2)
    expect(rows(hydrate(repaired))).toEqual(rows(repaired))
  })

  it('previews a stored goal strength the box no longer supports, and removed players', () => {
    let state = running()
    state = expectOk(recordHockeyPenalties(state, {
      penalties: [{ side: 'opponent', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { label: '#4' } }],
    }, ctx(11)))
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' } }, ctx(41)))
    expect(row(state, /Blades goal \(PP\) by Player 2/).strength).toBe('pp')

    const removed = expectOk(removeHockeyEvents(state, ids(row(state, /tripping/)), at(50)))
    const consequences = hockeyCorrectionConsequences(state, removed)
    expect(consequences.strength).toEqual([{ eventId: row(state, /Blades goal \(PP\) by Player 2/).id, stored: 'pp', derived: 'ev' }])
    // Stored strength still wins.
    expect(row(removed, /Blades goal \(PP\) by Player 2/).strength).toBe('pp')

    let misconduct = running()
    misconduct = expectOk(recordHockeyPenalties(misconduct, {
      penalties: [{ side: 'tracked', class: 'minor', infraction: 'roughing', offenderKind: 'player', offender: { participantId: 'p3' } }],
    }, ctx(11)))
    const ejected = expectOk(correct(misconduct, /roughing/, change => {
      const input = change.input as Extract<HockeyCorrectionInput, { kind: 'penalties' }>['input']
      return { kind: 'penalties', input: { penalties: [{ ...input.penalties[0], class: 'game_misconduct', durationMs: undefined }] } }
    }))
    expect(hockeyCorrectionConsequences(misconduct, ejected).removedPlayers).toEqual({ added: ['p3'], cleared: [] })
  })

  it('corrects an ended game directly and re-settles the result', () => {
    let state = clockless()
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal' }, ctx(1)))
    let second = 2
    for (let period = 1; period <= 3; period++) {
      if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(second++)))
      state = expectOk(endHockeyPeriod(state, {}, ctx(second++)))
    }
    state = expectOk(endHockeyMatch(state, {}, ctx(second++)))
    expect(projection(state).result?.outcome).toBe('win')
    const tied = correct(state, 'Blades goal', change => ({
      kind: 'shot',
      // A side swap clears the goalie, as the dialog does: the goalie in net is stamped again.
      input: { ...(change.input as Extract<HockeyCorrectionInput, { kind: 'shot' }>['input']), side: 'opponent', goalieId: undefined },
    }))
    const after = expectOk(tied)
    expect(projection(after).result).toMatchObject({ outcome: 'loss', finalScore: { tracked: 0, opponent: 1 } })
    expect(hockeyCorrectionConsequences(state, after).result?.after?.outcome).toBe('loss')
  })

  it('previews a sudden-death lead and refuses one that would come before later events', () => {
    let state = clockless('nhl_regular')
    let second = 1
    for (let period = 1; period <= 3; period++) {
      if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(second++)))
      state = expectOk(endHockeyPeriod(state, {}, ctx(second++)))
    }
    state = expectOk(startNextHockeyPeriod(state, ctx(second++)))
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p2' } }, ctx(20)))
    const toGoal = (change: HockeyCorrectionInput): HockeyCorrectionInput => ({
      kind: 'shot',
      input: { ...(change.input as Extract<HockeyCorrectionInput, { kind: 'shot' }>['input']), outcome: 'goal' },
    })
    const decided = expectOk(correct(state, 'Blades saved by Player 2', toGoal))
    expect(hockeyCorrectionConsequences(state, decided).suddenDeath).toBe('decided')
    expect(hockeyCorrectionConsequences(decided, state).suddenDeath).toBe('undecided')

    const later = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(21)))
    const refused = correct(later, 'Blades saved by Player 2', toGoal)
    expect(rejected(refused)).toMatch(/decided|sudden/i)
    expect(refused.state).toBe(later)
  })

  it('asks for Reopen before correcting a suspended game', () => {
    let state = clockless()
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved' }, ctx(1)))
    state = expectOk(interruptHockeyMatch(state, { kind: 'suspended', reason: 'Lights out' }, ctx(2)))
    const shot = row(state, 'Blades saved')
    expect(rejected(removeHockeyEvents(state, ids(shot), at(3)))).toBe('Reopen the game to correct it.')
    expect(rejected(correctHockeyEvents(state, ids(shot), { kind: 'shot', input: { side: 'tracked', outcome: 'missed' } }, OPTIONS)))
      .toBe('Reopen the game to correct it.')
    expect(hockeySportState(state)).not.toBeNull()
  })
})
