import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { proposeBaseballCaptureMovements, type BaseballPendingCapture } from './capture'
import { adjustBaseballScore, baseballSportState, substituteBaseball } from './commands'
import {
  editBaseballPlay,
  previewBaseballEdit,
  previewBaseballRemoval,
  removeBaseballPlay,
  type BaseballCorrectionPreview,
  type BaseballEventEdit,
} from './corrections'
import {
  baseballCaptureEdit,
  baseballEditTarget,
  baseballMismatchedRoles,
  baseballRepairAttributionEdit,
  baseballScoreAdjustmentEdit,
  baseballSubstitutionEdit,
  type BaseballEditTarget,
} from './edits'
import {
  ballInPlay,
  ctx,
  expectOk,
  inPlay,
  pitch,
  pitches,
  projection,
  startedGame,
  threeUpThreeDown,
  walk,
} from './testFixtures'
import { baseballTimeline } from './timeline'
import { baseballActiveEvents } from './units'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 2, 13, 0, seconds)).toISOString()
const active = (state: GameState) => baseballActiveEvents(state)
const newest = (state: GameState): GameEvent => active(state)[active(state).length - 1]!
const sportOf = (state: GameState) => baseballSportState(state)!

function target(state: GameState, eventId: string): BaseballEditTarget {
  const result = baseballEditTarget(state, eventId)
  if (!result.ok) throw new Error(result.message)
  return result.target
}

function preview(state: GameState, edit: BaseballEventEdit): BaseballCorrectionPreview {
  const result = previewBaseballEdit(state, edit, names)
  if (!result.ok) throw new Error(result.message)
  return result.preview
}

function save(state: GameState, edit: BaseballEventEdit, confirmed = true): GameState {
  return expectOk(editBaseballPlay(state, preview(state, edit), edit, names, { now: at(1), confirmed, receiptId: 'e' }))
}

/** Re-records a capture as `next`, with the movements the engine proposes against the prefix. */
function recapture(state: GameState, eventId: string, next: (capture: BaseballPendingCapture) => BaseballPendingCapture): BaseballEventEdit {
  const t = target(state, eventId)
  if (t.seed.kind !== 'capture') throw new Error('not a capture')
  const capture = next(t.seed.capture)
  return baseballCaptureEdit(t, capture, proposeBaseballCaptureMovements(t.prefix, capture))
}

describe('Baseball edit seeding', () => {
  it('seeds from the stored play and the game just before it, matching capture-time proposals', () => {
    let state = walk(startedGame())
    state = ballInPlay(state, 'single', { fielders: [8] })
    const single = newest(state)
    const t = target(state, single.id)
    expect(t.prefix.projection.bases.first?.runnerId).toBe('o1')
    expect(t.prefix.projection.currentBatterId).toBe('o2')
    expect(t.seed.kind).toBe('capture')
    if (t.seed.kind !== 'capture') return
    expect(t.seed.capture).toMatchObject({ source: 'pitch', result: 'in_play', battedBall: { inPlay: { result: 'single', fielders: [8] } } })
    expect(proposeBaseballCaptureMovements(t.prefix, t.seed.capture)).toEqual(t.seed.movements)
  })

  it('refuses game-flow rows', () => {
    const state = pitches(startedGame(), 'ball')
    expect(baseballEditTarget(state, active(state)[0]!.id)).toMatchObject({ ok: false, message: 'This entry cannot be edited.' })
    expect(previewBaseballEdit(state, { eventId: active(state)[0]!.id, payload: {}, location: null, actors: [] }, names)).toMatchObject({
      ok: false,
      message: 'Game-flow rows cannot be edited.',
    })
  })
})

describe('Baseball edits', () => {
  it('a ball changed to a strike changes the count, and explains the walk it breaks', () => {
    let state = walk(startedGame())
    const firstBall = active(state)[1]!
    const edit = recapture(state, firstBall.id, capture => ({ ...capture, result: 'called_strike' }) as BaseballPendingCapture)
    const p = preview(state, edit)
    expect(p.action).toBe('edit')
    expect(p.dependents.plays).toHaveLength(1)
    expect(p.dependents.plays[0]!.id).toBe(newest(state).id)
    expect(p.needsConfirmation).toBe(true)
    expect(editBaseballPlay(state, p, edit, names, { now: at(1), confirmed: false }).ok).toBe(false)
    state = save(state, edit)
    expect(projection(state)).toMatchObject({ balls: 2, strikes: 1, bases: { first: null } })
    const receipts = sportOf(state).capturePreferences.corrections
    expect(receipts.map(receipt => receipt.kind)).toEqual(['edit', 'remove'])
    expect(receipts[0]).toMatchObject({ primaryEventIds: [firstBall.id], entries: [{ eventId: firstBall.id, expectedRevision: 2 }] })
  })

  it('a single changed to a double moves the runner', () => {
    let state = walk(startedGame())
    state = ballInPlay(state, 'single', { fielders: [8] })
    const hit = newest(state)
    const edit = recapture(state, hit.id, capture =>
      capture.source === 'pitch' && capture.battedBall
        ? { ...capture, battedBall: { ...capture.battedBall, inPlay: { ...capture.battedBall.inPlay, result: 'double' } } }
        : capture
    )
    const p = preview(state, edit)
    expect(p.dependents).toEqual({ plays: [], lifecycle: [] })
    expect(p.changes.some(line => line.startsWith('Runners:'))).toBe(true)
    state = save(state, edit, p.needsConfirmation)
    expect(projection(state).bases.second?.runnerId).toBe('o2')
    expect(projection(state).bases.third?.runnerId).toBe('o1')
  })

  it('an out changed to an error removes the out and keeps the batter on', () => {
    let state = ballInPlay(startedGame(), 'out', { fielders: [6, 3] })
    expect(projection(state).outs).toBe(1)
    const out = newest(state)
    const edit = recapture(state, out.id, capture =>
      capture.source === 'pitch' && capture.battedBall
        ? { ...capture, battedBall: { ...capture.battedBall, inPlay: inPlay('error', { fielders: [6], errorBy: 6 }) } }
        : capture
    )
    const p = preview(state, edit)
    expect(p.changes).toContain('Outs: 1 becomes 0')
    state = save(state, edit, p.needsConfirmation)
    expect(projection(state)).toMatchObject({ outs: 0, bases: { first: { runnerId: 'o1' } } })
  })

  it('a location-only edit after an earlier lineup correction keeps actors and fielding credit', () => {
    let state = expectOk(substituteBaseball(startedGame(), 'tracked', { kind: 'defensive', position: 6, incomingId: 't10', outgoingId: 't6' }, ctx()))
    const sub = newest(state)
    state = pitch(state, {
      result: 'in_play',
      inPlay: inPlay('out', { fielders: [6, 3] }),
      location: { x: 0.4, y: 0.5 },
      movements: proposeBaseballCaptureMovements(sportOf(state), {
        source: 'pitch', result: 'in_play', pitchLocation: null, droppedThirdStrike: false,
        battedBall: { inPlay: inPlay('out', { fielders: [6, 3] }), location: null },
      }),
    })
    const out = newest(state)
    // Remove the defensive change: the lineup now shows t6 at SS, the stamp stays with t10.
    const removal = previewBaseballRemoval(state, sub.id, names)
    if (!removal.ok) throw new Error(removal.message)
    state = expectOk(removeBaseballPlay(state, removal.preview, names, { now: at(0), confirmed: true }))
    const edit = recapture(state, out.id, capture =>
      capture.source === 'pitch' && capture.battedBall ? { ...capture, battedBall: { ...capture.battedBall, location: { x: 0.45, y: 0.5 } } } : capture
    )
    expect(edit.actors).toEqual(out.actors)
    const p = preview(state, edit)
    expect(p.stampChanges).toEqual([])
    expect(p.creditMoves).toEqual([])
    state = save(state, edit, p.needsConfirmation)
    expect(newest(state).location).toMatchObject({ x: 0.45 })
    expect(projection(state).fieldingLines.t10).toMatchObject({ a: 1 })
  })

  it('a fielder-list edit restamps only the changed roles and lists the credit move', () => {
    let state = ballInPlay(startedGame(), 'out', { fielders: [6, 3] })
    const out = newest(state)
    const edit = recapture(state, out.id, capture =>
      capture.source === 'pitch' && capture.battedBall
        ? { ...capture, battedBall: { ...capture.battedBall, inPlay: { ...capture.battedBall.inPlay, fielders: [4, 3] } } }
        : capture
    )
    const roles = (actors: GameEvent['actors']) => actors.map(actor => actor.role)
    expect(roles(out.actors)).toContain('fielder_6')
    expect(roles(edit.actors)).toContain('fielder_4')
    expect(roles(edit.actors)).not.toContain('fielder_6')
    expect(edit.actors.find(actor => actor.role === 'fielder_3')).toEqual(out.actors.find(actor => actor.role === 'fielder_3'))
    const p = preview(state, edit)
    expect(p.stampChanges).toEqual(['Fielder at 2B: now recorded as #4 Player 4', 'Fielder at SS: #6 Player 6 no longer recorded'])
    expect(p.creditMoves).toEqual(['Top 1 fielding at 2B: now credited to #4 Player 4', 'Top 1 fielding at SS: no longer credited to #6 Player 6'])
    expect(p.needsConfirmation).toBe(true)
    state = save(state, edit)
    expect(projection(state).fieldingLines.t4).toMatchObject({ a: 1 })
    expect(projection(state).fieldingLines.t6 ?? { a: 0 }).toMatchObject({ a: 0 })
  })

  it('edits a substitution and a score adjustment', () => {
    let state = threeUpThreeDown(startedGame())
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't1' }, ctx()))
    const sub = newest(state)
    state = save(state, baseballSubstitutionEdit(target(state, sub.id), [{ kind: 'pinch_hitter', incomingId: 't11', outgoingId: 't1' }]))
    expect(projection(state).lineups.tracked.battingOrder[0]).toBe('t11')

    state = expectOk(adjustBaseballScore(state, 'tracked', 2, 'scorer missed runs', ctx()))
    const adjustment = newest(state)
    state = save(state, baseballScoreAdjustmentEdit(target(state, adjustment.id), 1, 'scorer missed a run'))
    expect(projection(state).score.tracked).toBe(1)
  })

  it('refuses an edit that does not fit, and a draft with no change', () => {
    let state = pitches(startedGame(), 'ball', 'ball')
    const second = newest(state)
    const unchanged = recapture(state, second.id, capture => capture)
    expect(previewBaseballEdit(state, unchanged, names)).toMatchObject({ ok: false, message: 'Nothing changed.' })
    state = pitches(state, 'ball')
    // A walk on the second pitch has no batter-on-first movement once the count is 1-0.
    const bad = { ...recapture(state, second.id, capture => capture), payload: { ...(second.payload as object), result: 'hit_by_pitch', movements: [] } }
    expect(previewBaseballEdit(state, bad as BaseballEventEdit, names)).toMatchObject({ ok: false, message: expect.stringMatching(/^This change does not fit here: /) })
  })

  it('marks the edited row revised on the Timeline and rejects a stale edit preview', () => {
    let state = pitches(startedGame(), 'ball', 'ball')
    const first = active(state)[1]!
    const edit = recapture(state, first.id, capture => ({ ...capture, result: 'called_strike' }) as BaseballPendingCapture)
    const stale = preview(state, edit)
    state = pitches(state, 'ball')
    expect(editBaseballPlay(state, stale, edit, names, { now: at(1), confirmed: true })).toMatchObject({
      ok: false,
      message: 'The game changed since this preview. Review the changes again.',
    })
    state = save(state, edit)
    const row = baseballTimeline(state, names).halves[0]!.rows.find(entry => entry.id === first.id)!
    expect(row).toMatchObject({ revised: true, label: 'Batter 1: Called strike' })
  })
})

describe('Baseball Repair attribution', () => {
  it('restamps only the chosen roles and shows before and after', () => {
    let state = expectOk(substituteBaseball(startedGame(), 'tracked', { kind: 'defensive', position: 6, incomingId: 't10', outgoingId: 't6' }, ctx()))
    const sub = newest(state)
    state = ballInPlay(state, 'out', { fielders: [6, 3] })
    const out = newest(state)
    const removal = previewBaseballRemoval(state, sub.id, names)
    if (!removal.ok) throw new Error(removal.message)
    state = expectOk(removeBaseballPlay(state, removal.preview, names, { now: at(0), confirmed: true }))
    expect(baseballMismatchedRoles(state, out.id).map(entry => entry.role)).toEqual(['fielder_6'])

    const repair = baseballRepairAttributionEdit(state, out.id, ['fielder_6'])
    if (!repair.ok) throw new Error(repair.message)
    const p = preview(state, repair.edit)
    expect(p.stampChanges).toEqual(['Fielder at SS: #10 Player 10 becomes #6 Player 6'])
    expect(p.creditMoves).toEqual(['Top 1 fielding at SS: moves from #10 Player 10 to #6 Player 6'])
    state = save(state, repair.edit)
    expect(newest(state).actors.find(actor => actor.role === 'fielder_3')).toEqual(out.actors.find(actor => actor.role === 'fielder_3'))
    expect(projection(state).fieldingLines.t6).toMatchObject({ a: 1 })
    expect(projection(state).warnings).toEqual([])
    expect(baseballRepairAttributionEdit(state, out.id, ['fielder_6'])).toMatchObject({ ok: false })
  })
})
