import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BaseballCorrectionPreviewSheet from '../../components/baseball/BaseballCorrectionPreviewSheet'
import BaseballTimeline from '../../components/baseball/BaseballTimeline'
import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import {
  baseballSportState,
  endBaseballGame,
  endBaseballHalfInning,
  reopenBaseballGame,
  substituteBaseball,
} from './commands'
import {
  baseballCorrectionGroupStatus,
  previewBaseballRemoval,
  previewBaseballRestore,
  removeBaseballPlay,
  restoreBaseballCorrection,
  type BaseballCorrectionPreview,
} from './corrections'
import { replayBaseballCreditByEvent } from './projector'
import { canRestoreBaseballPlay, undoBaseballPlay } from './recentPlays'
import { normalizeBaseballSportGameState } from './state'
import {
  ballInPlay,
  baseballSetup,
  ctx,
  expectOk,
  pitches,
  projection,
  startedGame,
  strikeout,
  threeUpThreeDown,
  walk,
} from './testFixtures'
import { BASEBALL_TIMELINE_DEFAULT_FILTER, baseballTimeline } from './timeline'
import { BASEBALL_MAX_CORRECTION_RECEIPTS } from './types'
import { baseballActiveEvents } from './units'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 13, 0, seconds)).toISOString()
const sportOf = (state: GameState) => baseballSportState(state)!
const active = (state: GameState) => baseballActiveEvents(state)
const newest = (state: GameState): GameEvent => active(state)[active(state).length - 1]

function previewRemove(state: GameState, eventId: string): BaseballCorrectionPreview {
  const result = previewBaseballRemoval(state, eventId, names)
  if (!result.ok) throw new Error(result.message)
  return result.preview
}

function remove(state: GameState, eventId: string, confirmed = true, receiptId?: string): GameState {
  return expectOk(removeBaseballPlay(state, previewRemove(state, eventId), names, { now: at(1), confirmed, receiptId }))
}

function restoreUnit(state: GameState, unitId: string, confirmed = true): GameState {
  const preview = previewBaseballRestore(state, { kind: 'restore_unit', unitId }, names)
  if (!preview.ok) throw new Error(preview.message)
  return expectOk(restoreBaseballCorrection(state, preview.preview, names, { now: at(2), confirmed }))
}

describe('Baseball correction preview and removal', () => {
  it('removes a play cleanly when nothing later depends on it', () => {
    let state = pitches(startedGame(), 'ball', 'called_strike')
    const ball = active(state)[1]!
    const preview = previewRemove(state, ball.id)
    expect(preview.dependents).toEqual({ plays: [], lifecycle: [] })
    expect(preview.changes).toEqual(['Count: 1-1 becomes 0-1'])
    expect(preview.needsConfirmation).toBe(false)
    state = expectOk(removeBaseballPlay(state, preview, names, { now: at(1), confirmed: false, receiptId: 'r1' }))
    expect(projection(state)).toMatchObject({ balls: 0, strikes: 1 })
    expect(sportOf(state).capturePreferences.corrections).toEqual([
      { id: 'r1', createdAt: at(1), kind: 'remove', primaryEventIds: [ball.id], entries: [{ eventId: ball.id, expectedRevision: 2 }] },
    ])
  })

  it('refuses game-flow rows on their own', () => {
    const state = pitches(startedGame(), 'ball')
    const result = previewBaseballRemoval(state, active(state)[0]!.id, names)
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Game-flow rows/) })
  })

  it('lists a later play the removal breaks and saves only after confirmation', () => {
    let state = walk(startedGame())
    const firstBall = active(state)[1]!
    const walkPitch = newest(state)
    const preview = previewRemove(state, firstBall.id)
    expect(preview.dependents.plays.map(row => row.id)).toEqual([walkPitch.id])
    expect(preview.dependents.plays[0]!.reason).toMatch(/.+/)
    expect(preview.needsConfirmation).toBe(true)
    expect(removeBaseballPlay(state, preview, names, { now: at(1), confirmed: false })).toMatchObject({
      ok: false,
      message: 'Review the listed changes and choose Save with these changes.',
    })
    state = expectOk(removeBaseballPlay(state, preview, names, { now: at(1), confirmed: true, receiptId: 'walk' }))
    expect(projection(state)).toMatchObject({ balls: 2, bases: { first: null } })
    const receipt = sportOf(state).capturePreferences.corrections[0]!
    expect(receipt.primaryEventIds).toEqual([firstBall.id])
    expect(receipt.entries.map(entry => entry.eventId)).toEqual([firstBall.id, walkPitch.id])
  })

  it('rejects a stale preview', () => {
    let state = pitches(startedGame(), 'ball')
    const preview = previewRemove(state, active(state)[1]!.id)
    state = pitches(state, 'ball', 'called_strike')
    expect(removeBaseballPlay(state, preview, names, { now: at(1), confirmed: true })).toMatchObject({
      ok: false,
      message: 'The game changed since this preview. Review the changes again.',
    })
  })

  it('removes the third out with every later play of the next half, without retagging, and restores them together', () => {
    let state = threeUpThreeDown(startedGame())
    const thirdOut = newest(state)
    state = pitches(state, 'ball', 'called_strike')
    const later = active(state).slice(-2).map(event => event.id)
    const preview = previewRemove(state, thirdOut.id)
    expect(preview.dependents.plays.map(row => row.id)).toEqual(later)
    expect(preview.dependents.plays[0]!.reason).toBe('Recorded in Bottom 1, but play is now in Top 1.')
    expect(preview.changes).toContain('Play resumes in Top 1 instead of Bottom 1')
    expect(preview.changes).toContain('Outs: 0 becomes 2')
    state = expectOk(removeBaseballPlay(state, preview, names, { now: at(1), confirmed: true, receiptId: 'g' }))
    expect(projection(state)).toMatchObject({ inning: 1, half: 'top', outs: 2, strikes: 2 })

    const group = previewBaseballRestore(state, { kind: 'restore_group', receiptId: 'g' }, names)
    if (!group.ok) throw new Error(group.message)
    expect(group.preview.rows.map(row => row.id)).toEqual([thirdOut.id, ...later])
    expect(group.preview.needsConfirmation).toBe(false)
    state = expectOk(restoreBaseballCorrection(state, group.preview, names, { now: at(2), confirmed: false }))
    expect(projection(state)).toMatchObject({ inning: 1, half: 'bottom', balls: 1, strikes: 1 })
    expect(sportOf(state).capturePreferences.corrections).toEqual([])
  })

  it('lists a manual half end, a game end and a reopen as lifecycle dependents, never the game start', () => {
    let state = strikeout(startedGame())
    const out = newest(state)
    state = expectOk(endBaseballHalfInning(state, 'time_limit', null, ctx()))
    state = pitches(state, 'ball')
    state = expectOk(endBaseballGame(state, 'suspended', ctx()))
    state = expectOk(reopenBaseballGame(state, 'rain stopped', ctx()))
    state = pitches(state, 'ball')
    // Removing the out leaves 0 outs; the half end still replays, so nothing depends on it.
    expect(previewRemove(state, out.id).dependents.lifecycle).toEqual([])

    let game = threeUpThreeDown(startedGame())
    const thirdOut = newest(game)
    game = pitches(game, 'ball')
    game = expectOk(endBaseballGame(game, 'suspended', ctx()))
    game = expectOk(reopenBaseballGame(game, 'rain stopped', ctx()))
    const preview = previewRemove(game, thirdOut.id)
    expect(preview.dependents.lifecycle.map(row => row.label)).toEqual(['Suspended', 'Game reopened (rain stopped)'])
    expect(preview.dependents.plays).toHaveLength(1)
    expect([...preview.dependents.plays, ...preview.dependents.lifecycle].every(row => row.label !== 'Game started')).toBe(true)
    game = expectOk(removeBaseballPlay(game, preview, names, { now: at(1), confirmed: true, receiptId: 'cascade' }))
    expect(projection(game)).toMatchObject({ status: 'in_progress', half: 'top', outs: 2 })
    const group = previewBaseballRestore(game, { kind: 'restore_group', receiptId: 'cascade' }, names)
    if (!group.ok) throw new Error(group.message)
    game = expectOk(restoreBaseballCorrection(game, group.preview, names, { now: at(2), confirmed: false }))
    expect(projection(game)).toMatchObject({ status: 'in_progress', half: 'bottom', balls: 1 })
  })

  it('clears quick Restore when a Timeline correction saves', () => {
    let state = pitches(startedGame(), 'ball', 'ball', 'called_strike')
    state = expectOk(undoBaseballPlay(state, at(0)))
    expect(canRestoreBaseballPlay(state)).toBe(true)
    state = remove(state, active(state)[1]!.id)
    expect(canRestoreBaseballPlay(state)).toBe(false)
  })
})

describe('Baseball correction attribution', () => {
  it('moves batting credit when a pinch hitter is removed, and back when restored', () => {
    let state = threeUpThreeDown(startedGame())
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't1' }, ctx()))
    const sub = newest(state)
    state = pitches(state, 'ball', 'called_strike')
    const credit = replayBaseballCreditByEvent(sportOf(state).setup, active(state))
    expect(credit.get(newest(state).id)).toMatchObject({ batterId: 't10', pitcherId: 'opp-p1' })

    const preview = previewRemove(state, sub.id)
    expect(preview.dependents).toEqual({ plays: [], lifecycle: [] })
    expect(preview.creditMoves).toEqual(['Bottom 1 batting: moves from #10 Player 10 to #1 Player 1 (2 plays)'])
    expect(preview.needsConfirmation).toBe(true)
    state = expectOk(removeBaseballPlay(state, preview, names, { now: at(1), confirmed: true }))
    expect(projection(state).warnings.filter(warning => warning.role === 'batter')).toHaveLength(2)

    const restore = previewBaseballRestore(state, { kind: 'restore_unit', unitId: sub.id }, names)
    if (!restore.ok) throw new Error(restore.message)
    expect(restore.preview.creditMoves).toEqual(['Bottom 1 batting: moves from #1 Player 1 to #10 Player 10 (2 plays)'])
    expect(restore.preview.information).toEqual([])
    expect(restore.preview.needsConfirmation).toBe(true)
    expect(restoreBaseballCorrection(state, restore.preview, names, { now: at(2), confirmed: false }).ok).toBe(false)
    state = expectOk(restoreBaseballCorrection(state, restore.preview, names, { now: at(2), confirmed: true }))
    expect(projection(state).warnings).toEqual([])
    expect(sportOf(state).capturePreferences.corrections).toEqual([])
  })

  it('moves pitching credit when a pitching change is removed', () => {
    let state = expectOk(substituteBaseball(startedGame(), 'tracked', { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't1' }, ctx()))
    const change = newest(state)
    state = pitches(state, 'ball')
    const preview = previewRemove(state, change.id)
    expect(preview.creditMoves).toEqual(['Top 1 pitching: moves from #10 Player 10 to #1 Player 1'])
    state = expectOk(removeBaseballPlay(state, preview, names, { now: at(1), confirmed: true }))
    expect(projection(state).lineups.tracked.pitcherId).toBe('t1')
  })

  it('keeps stamped fielding credit and lists the new mismatch; restoring only clears it', () => {
    let state = expectOk(substituteBaseball(startedGame(), 'tracked', { kind: 'defensive', position: 6, incomingId: 't10', outgoingId: 't6' }, ctx()))
    const sub = newest(state)
    state = ballInPlay(state, 'out', { fielders: [6, 3] })
    expect(projection(state).fieldingLines.t10).toMatchObject({ a: 1 })

    const preview = previewRemove(state, sub.id)
    expect(preview.creditMoves).toEqual([])
    expect(preview.fieldingKept).toEqual(['Top 1: lineup now shows #6 Player 6 at SS; credit stays with #10 Player 10'])
    expect(preview.needsConfirmation).toBe(true)
    state = expectOk(removeBaseballPlay(state, preview, names, { now: at(1), confirmed: true }))
    expect(projection(state).fieldingLines.t10).toMatchObject({ a: 1 })

    const restore = previewBaseballRestore(state, { kind: 'restore_unit', unitId: sub.id }, names)
    if (!restore.ok) throw new Error(restore.message)
    expect(restore.preview.fieldingKept).toEqual([])
    expect(restore.preview.information).toEqual(['Top 1: #10 Player 10 now matches the lineup'])
    expect(restore.preview.needsConfirmation).toBe(false)
    state = expectOk(restoreBaseballCorrection(state, restore.preview, names, { now: at(2), confirmed: false }))
    expect(projection(state).warnings).toEqual([])
  })
})

describe('Baseball correction receipts', () => {
  it('survive a JSON round trip and older games read with none', () => {
    const before = pitches(startedGame(), 'ball', 'ball')
    const state = remove(before, newest(before).id)
    const sport = sportOf(state)
    expect(normalizeBaseballSportGameState(JSON.parse(JSON.stringify(sport)))!.capturePreferences.corrections)
      .toEqual(sport.capturePreferences.corrections)
    const old = JSON.parse(JSON.stringify(sport))
    delete old.capturePreferences.corrections
    expect(normalizeBaseballSportGameState(old)!.capturePreferences.corrections).toEqual([])
  })

  it('keep the newest twenty', () => {
    let state = startedGame()
    for (let index = 0; index < BASEBALL_MAX_CORRECTION_RECEIPTS + 1; index += 1) {
      state = pitches(state, 'ball')
      state = remove(state, newest(state).id, true, `r${index}`)
    }
    const receipts = sportOf(state).capturePreferences.corrections
    expect(receipts).toHaveLength(BASEBALL_MAX_CORRECTION_RECEIPTS)
    expect(receipts[0]!.id).toBe(`r${BASEBALL_MAX_CORRECTION_RECEIPTS}`)
    expect(receipts.some(receipt => receipt.id === 'r0')).toBe(false)
  })

  it('drop a row restored on its own, and a changed group falls back to one-at-a-time restore', () => {
    let state = walk(startedGame())
    const firstBall = active(state)[1]!
    const walkPitch = newest(state)
    state = remove(state, firstBall.id, true, 'grp')
    state = restoreUnit(state, firstBall.id)
    expect(sportOf(state).capturePreferences.corrections[0]).toMatchObject({
      id: 'grp',
      primaryEventIds: [],
      entries: [{ eventId: walkPitch.id }],
    })

    const walked = walk(startedGame())
    let stale = remove(walked, active(walked)[1]!.id, true, 'stale')
    const sport = sportOf(stale)
    const receipt = { ...sport.capturePreferences.corrections[0]!, entries: sport.capturePreferences.corrections[0]!.entries.map(entry => ({ ...entry, expectedRevision: 9 })) }
    stale = { ...stale, sportGameState: { ...sport, capturePreferences: { ...sport.capturePreferences, corrections: [receipt] } } }
    expect(baseballCorrectionGroupStatus(stale, receipt).restorable).toBe(false)
    expect(previewBaseballRestore(stale, { kind: 'restore_group', receiptId: 'stale' }, names)).toMatchObject({
      ok: false,
      message: 'Some of these rows changed since they were removed. Restore them one at a time.',
    })
  })
})

describe('Baseball Timeline', () => {
  it('groups rows by half newest first with each half line, removed rows and filters', () => {
    let state = threeUpThreeDown(startedGame(baseballSetup()))
    state = pitches(state, 'ball', 'ball')
    state = remove(state, newest(state).id)
    const timeline = baseballTimeline(state, names)
    expect(timeline.halves.map(half => half.label)).toEqual(['Bottom 1', 'Top 1'])
    expect(timeline.halves[1]).toMatchObject({ battingSide: 'opponent', line: '0 R, 0 H, 0 E, 0 LOB' })
    expect(timeline.halves[0]!.rows).toHaveLength(1)
    expect(timeline.halves[0]!.removedRows).toMatchObject([{ removed: true, removedAt: at(1), kind: 'play', side: 'tracked' }])
    expect(timeline.halves[1]!.rows[timeline.halves[1]!.rows.length - 1]).toMatchObject({ kind: 'flow', label: 'Game started' })

    const ours = baseballTimeline(state, names, { half: 'all', side: 'tracked', correctedOnly: false })
    expect(ours.halves.map(half => half.label)).toEqual(['Bottom 1'])
    const corrected = baseballTimeline(state, names, { half: 'all', side: 'all', correctedOnly: true })
    expect(corrected.halves.flatMap(half => [...half.rows, ...half.removedRows])).toHaveLength(1)
    expect(corrected.hiddenCount).toBeGreaterThan(0)
    expect(baseballTimeline(state, names, { half: 'inning-1-top', side: 'all', correctedOnly: false }).halves.map(half => half.label)).toEqual(['Top 1'])
  })

  it('marks restored rows revised and shows the group a removal made', () => {
    let state = walk(startedGame())
    const firstBall = active(state)[1]!
    state = remove(state, firstBall.id, true, 'grp')
    const removedRows = baseballTimeline(state, names).halves[0]!.removedRows
    expect(removedRows).toHaveLength(2)
    expect(removedRows.every(row => row.group?.receiptId === 'grp' && row.group.restorable && row.group.size === 2)).toBe(true)
    state = restoreUnit(state, firstBall.id)
    const restored = baseballTimeline(state, names).halves[0]!.rows.find(row => row.id === firstBall.id)!
    expect(restored.revised).toBe(true)
  })
})

describe('Baseball Timeline rendering', () => {
  it('renders halves, removed rows with Restore together, and the preview with its confirmation', () => {
    let state = walk(startedGame())
    const firstBall = active(state)[1]!
    const preview = previewRemove(state, firstBall.id)
    const sheet = renderToStaticMarkup(createElement(BaseballCorrectionPreviewSheet, {
      preview,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
    }))
    expect(sheet).toContain('This later row no longer fits and is removed too:')
    expect(sheet).toContain('Save with these changes')

    state = remove(state, firstBall.id, true, 'grp')
    const html = renderToStaticMarkup(createElement(BaseballTimeline, {
      timeline: baseballTimeline(state, names),
      filter: BASEBALL_TIMELINE_DEFAULT_FILTER,
      names,
      onFilter: () => {},
      onSelect: () => {},
      onRestore: () => {},
      onRestoreGroup: () => {},
    }))
    expect(html).toContain('Top 1')
    expect(html).toContain('Visitors batting')
    expect(html).toContain('Removed (2)')
    expect(html).toContain('Restore together (2 rows removed in one correction)')
  })
})
