import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../types'
import {
  activateParkedGame,
  exportParkedGames,
  importParkedGames,
  listParkedGameRecords,
  parkActiveGame,
  saveActiveGameState,
} from '../gameParking'
import { createInitialState, gameReducer } from '../gameReducer'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { baseballMovement, baseballSportState, endBaseballGame, recordBaseballBaserunning, substituteBaseball } from './commands'
import {
  editBaseballPlay,
  previewBaseballEdit,
  previewBaseballRemoval,
  previewBaseballRestore,
  removeBaseballPlay,
  restoreBaseballCorrection,
} from './corrections'
import { baseballCaptureEdit, baseballEditResolutionRows, baseballEditTarget } from './edits'
import { baseballResolutionMovements } from './capture'
import { pickBaseballDoubleSwitch, emptyBaseballSubstitutionDraft, selectedBaseballSubstitution, baseballSubstitutionChoices } from './substitutionOptions'
import { ballInPlay, ctx, expectOk, projection, startedGame, threeUpThreeDown, walk } from './testFixtures'
import { baseballTimeline } from './timeline'
import { baseballActiveEvents } from './units'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

const names = { tracked: 'Aces', opponent: 'Visitors' }
const at = (minute: number) => new Date(Date.UTC(2026, 9, 2, 14, minute)).toISOString()
const newest = (state: GameState) => baseballActiveEvents(state).slice(-1)[0]!
const sportOf = (state: GameState) => baseballSportState(state)!

function reload(state: GameState): GameState {
  return gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
}

/** Seven innings: a pinch hitter, a double switch, a removed early play with its cascade and an edited hit. */
function scriptedGame() {
  let state = startedGame()
  // Top 1: a walk, a steal of second, a steal of third, three strikeouts.
  state = walk(state)
  state = expectOk(recordBaseballBaserunning(state, 'stolen_base', [baseballMovement('o1', 'first', 'second', 'stolen_base')], ctx()))
  const stealId = newest(state).id
  state = expectOk(recordBaseballBaserunning(state, 'stolen_base', [baseballMovement('o1', 'second', 'third', 'stolen_base')], ctx()))
  const secondStealId = newest(state).id
  state = threeUpThreeDown(state)

  // Bottom 1: #10 pinch-hits for the pitcher and singles; then three strikeouts.
  state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't1' }, ctx()))
  state = ballInPlay(state, 'single', { fielders: [7] })
  const hitId = newest(state).id
  state = threeUpThreeDown(state)

  // Top 2: the pinch hitter takes the mound.
  const choices = baseballSubstitutionChoices(sportOf(state))
  const toMound = [...choices.defensive, ...choices.position_change]
    .flatMap(group => group.options)
    .find(option => option.changes.some(change =>
      (change.kind === 'defensive' && change.position === 1 && change.incomingId === 't10') ||
      (change.kind === 'position_change' && change.assignments.some(entry => entry.participantId === 't10' && entry.position === 1))))
  if (!toMound) throw new Error('No option puts the pinch hitter on the mound')
  state = expectOk(substituteBaseball(state, 'tracked', toMound.changes, ctx()))
  state = threeUpThreeDown(state)

  // Bottom 2: a home run, then three strikeouts.
  state = ballInPlay(state, 'home_run', { battedBallType: 'fly' })
  state = threeUpThreeDown(state)

  // Top 3: a double switch (#11 pitches, #12 to left field), then the innings go quietly.
  const group = baseballSubstitutionChoices(sportOf(state)).double_switch.find(entry => entry.key === 'ds:7')
  if (!group) throw new Error('No double switch for LF')
  const draft = pickBaseballDoubleSwitch(group, emptyBaseballSubstitutionDraft('double_switch', 'ds:7'), { pitcherId: 't11', fielderId: 't12' })
  const doubleSwitch = selectedBaseballSubstitution(baseballSubstitutionChoices(sportOf(state)), draft)
  if (!doubleSwitch) throw new Error('Double switch not selectable')
  state = expectOk(substituteBaseball(state, 'tracked', doubleSwitch.changes, ctx()))
  for (let half = 0; half < 9; half += 1) state = threeUpThreeDown(state)
  // Top 7 done with the home team ahead: the game can end.
  expect(projection(state).pendingEnd).not.toBeNull()
  state = expectOk(endBaseballGame(state, 'completed', ctx()))
  return { state, stealId, secondStealId, hitId }
}

describe('Baseball corrections, seven-inning integration', () => {
  it('removes an early play with its cascade, edits a hit, and survives reload, park, export and import', () => {
    const script = scriptedGame()
    let state = script.state
    expect(projection(state)).toMatchObject({ status: 'final', score: { tracked: 1, opponent: 0 } })
    expect(projection(state).lineups.tracked.pitcherId).toBe('t11')

    // Remove the steal of second in the top of the 1st: the steal of third goes with it.
    const removal = previewBaseballRemoval(state, script.stealId, names)
    if (!removal.ok) throw new Error(removal.message)
    expect(removal.preview.dependents).toMatchObject({ plays: [{ id: script.secondStealId, reason: 'No such runner on second base.' }], lifecycle: [] })
    expect(removal.preview.needsConfirmation).toBe(true)
    state = expectOk(removeBaseballPlay(state, removal.preview, names, { now: at(1), confirmed: true }))
    expect(projection(state)).toMatchObject({ status: 'final', score: { tracked: 1, opponent: 0 } })

    // Edit the pinch hitter's single into a double, with rows read against the game before it.
    const target = baseballEditTarget(state, script.hitId)
    if (!target.ok) throw new Error(target.message)
    const { seed } = target.target
    if (seed.kind !== 'capture' || seed.capture.source !== 'pitch' || !seed.capture.battedBall) throw new Error('not a hit')
    const capture = { ...seed.capture, battedBall: { ...seed.capture.battedBall, inPlay: { ...seed.capture.battedBall.inPlay, result: 'double' as const } } }
    const rows = baseballEditResolutionRows(target.target, capture)
    const edit = baseballCaptureEdit(target.target, capture, baseballResolutionMovements(rows, { rbi: true }))
    expect(edit.actors).toEqual(baseballActiveEvents(state).find(event => event.id === script.hitId)!.actors)
    const preview = previewBaseballEdit(state, edit, names)
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.preview.dependents).toEqual({ plays: [], lifecycle: [] })
    state = expectOk(editBaseballPlay(state, preview.preview, edit, names, { now: at(2), confirmed: preview.preview.needsConfirmation }))
    expect(projection(state).battingLines.t10).toMatchObject({ h: 1, doubles: 1 })

    const timeline = baseballTimeline(state, names)
    const rowsById = new Map(timeline.halves.flatMap(half => half.rows).map(row => [row.id, row]))
    expect(rowsById.get(script.hitId)).toMatchObject({ revised: true })
    expect(timeline.halves.flatMap(half => half.removedRows).map(row => row.id)).toEqual(expect.arrayContaining([script.stealId, script.secondStealId]))
    const before = { projection: projection(state), fingerprint: buildGameSyncFingerprint(state), corrections: sportOf(state).capturePreferences.corrections }

    // Reload.
    const reloaded = reload(state)
    expect(projection(reloaded)).toEqual(before.projection)
    expect(buildGameSyncFingerprint(reloaded)).toBe(before.fingerprint)
    expect(sportOf(reloaded).capturePreferences.corrections).toEqual(before.corrections)

    // Park, resume, export and import.
    saveActiveGameState(state, 'user-1')
    parkActiveGame('user-1')
    const [record] = listParkedGameRecords('user-1')
    const resumed = reload(activateParkedGame(record!.localGameId, 'user-1')!)
    expect(projection(resumed)).toEqual(before.projection)
    parkActiveGame('user-1')
    const exported = exportParkedGames('user-1')
    localStorage.clear()
    expect(importParkedGames(exported, 'user-1').imported).toBe(1)
    const imported = reload(listParkedGameRecords('user-1')[0]!.gameState)
    expect(buildGameSyncFingerprint(imported)).toBe(before.fingerprint)
    expect(projection(imported)).toEqual(before.projection)

    // The removal's group still restores together after the round trip.
    const receipt = sportOf(imported).capturePreferences.corrections.find(entry => entry.kind === 'remove')!
    const restore = previewBaseballRestore(imported, { kind: 'restore_group', receiptId: receipt.id }, names)
    if (!restore.ok) throw new Error(restore.message)
    const restored = expectOk(restoreBaseballCorrection(imported, restore.preview, names, { now: at(3), confirmed: true }))
    expect(projection(restored).bases).toEqual(projection(script.state).bases)
    expect(projection(restored).pitchingLines).toEqual(projection(script.state).pitchingLines)
    expect(projection(restored).battingLines.t10).toMatchObject({ doubles: 1 })
  })
})
