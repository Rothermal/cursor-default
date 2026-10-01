import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BaseballEndGameSheet, BaseballReopenSheet } from '../../components/baseball/BaseballEndSheets'
import BaseballPitchingChangeSheet from '../../components/baseball/BaseballPitchingChangeSheet'
import BaseballRecentPlays from '../../components/baseball/BaseballRecentPlays'
import type { GameState } from '../../types'
import {
  baseballMovement,
  baseballSportState,
  endBaseballGame,
  endBaseballHalfInning,
  recordBaseballBaserunning,
  reopenBaseballGame,
  substituteBaseball,
} from './commands'
import {
  baseballCanEndHalf,
  baseballCanReopen,
  baseballEndGameOptions,
  baseballPendingEndOutcome,
} from './endings'
import { baseballOpponentPitcherChange, baseballPitchingChangeOptions } from './pitchingChange'
import {
  baseballRecentPlays,
  canRestoreBaseballPlay,
  canUndoBaseballPlay,
  restoreBaseballPlay,
  undoBaseballPlay,
} from './recentPlays'
import { normalizeBaseballSportGameState } from './state'
import { setBaseballCapturePreferences } from './trackerView'
import {
  baseballSetup,
  ctx,
  expectOk,
  pitch,
  projection,
  startedGame,
  strikeout,
  threeUpThreeDown,
  walk,
} from './testFixtures'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const sportOf = (state: GameState) => baseballSportState(state)!
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, seconds)).toISOString()
const plays = (state: GameState) => baseballRecentPlays(state, names)

describe('Baseball Recent plays', () => {
  it('lists plays newest first with the game flow and a divider where a half closed', () => {
    let state = threeUpThreeDown(startedGame())
    state = pitch(state, { result: 'ball' })
    const rows = plays(state)
    expect(rows[0]).toMatchObject({ kind: 'play', label: '#1 Player 1: Ball', halfLabel: 'Bottom 1', undoable: true })
    expect(rows[1]).toEqual({ kind: 'divider', id: expect.any(String), label: 'Middle 1' })
    expect(rows[2]).toMatchObject({ kind: 'play', halfLabel: 'Top 1', undoable: false })
    expect(rows[2]!.kind === 'play' && rows[2]!.label).toMatch(/^Batter 3: Swinging strike$/)
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'flow', label: 'Game started' })
  })

  it('labels runs scored, runner plays and substitutions', () => {
    let state = walk(walk(walk(walk(startedGame()))))
    expect(plays(state)[0]).toMatchObject({ label: 'Batter 4: Ball, 1 run scores' })
    const runner = projection(state).bases.second!.runnerId
    state = expectOk(recordBaseballBaserunning(state, 'stolen_base', [
      baseballMovement(projection(state).bases.third!.runnerId, 'third', 'home', 'stolen_base'),
    ], ctx()))
    expect(plays(state)[0]).toMatchObject({ label: 'Steal: Batter 2, 1 run scores' })
    expect(runner).toBe('o3')
    state = expectOk(substituteBaseball(state, 'opponent', baseballOpponentPitcherChange('opp-p2', 'Lefty', '33'), ctx()))
    expect(plays(state)[0]).toMatchObject({ label: 'Visitors pitching change: #33 Lefty' })
  })
})

describe('Baseball Undo and Restore', () => {
  it('removes only the newest play and brings it back with Restore', () => {
    let state = pitch(startedGame(), { result: 'ball' })
    state = pitch(state, { result: 'called_strike' })
    expect(canUndoBaseballPlay(state)).toBe(true)
    const undone = expectOk(undoBaseballPlay(state, at(1)))
    expect(projection(undone)).toMatchObject({ balls: 1, strikes: 0 })
    expect(canRestoreBaseballPlay(undone)).toBe(true)
    expect(sportOf(undone).capturePreferences.lastUndo?.entries).toHaveLength(1)
    const restored = expectOk(restoreBaseballPlay(undone, at(2)))
    expect(projection(restored)).toMatchObject({ balls: 1, strikes: 1 })
    expect(sportOf(restored).capturePreferences.lastUndo).toBeNull()
    expect(canRestoreBaseballPlay(restored)).toBe(false)
  })

  it('undoes the third out and reopens the half', () => {
    const state = threeUpThreeDown(startedGame())
    expect(projection(state).half).toBe('bottom')
    const undone = expectOk(undoBaseballPlay(state, at(1)))
    expect(projection(undone)).toMatchObject({ half: 'top', outs: 2 })
  })

  it('removes every event of a capture unit together', () => {
    let state = startedGame()
    const shared = { ...ctx(), captureCommandId: 'unit-1' }
    state = expectOk(substituteBaseball(state, 'opponent', baseballOpponentPitcherChange('opp-p2', 'A', '1'), shared))
    state = expectOk(substituteBaseball(state, 'opponent', baseballOpponentPitcherChange('opp-p3', 'B', '2'), { ...ctx(), captureCommandId: 'unit-1' }))
    const rows = plays(state)
    expect(rows[0]).toMatchObject({ kind: 'play', eventIds: [expect.any(String), expect.any(String)] })
    const undone = expectOk(undoBaseballPlay(state, at(1)))
    expect(projection(undone).lineups.opponent.pitcherId).toBe('opp-p1')
  })

  it('a new play clears the receipt so Restore is no longer offered', () => {
    let state = pitch(pitch(startedGame(), { result: 'ball' }), { result: 'ball' })
    state = expectOk(undoBaseballPlay(state, at(1)))
    state = pitch(state, { result: 'called_strike' })
    expect(sportOf(state).capturePreferences.lastUndo).toBeNull()
    expect(canRestoreBaseballPlay(state)).toBe(false)
    expect(restoreBaseballPlay(state, at(2)).ok).toBe(false)
  })

  it('never undoes game flow: the game start, a manual half end or a game end', () => {
    const fresh = startedGame()
    expect(canUndoBaseballPlay(fresh)).toBe(false)
    expect(undoBaseballPlay(fresh, at(1)).ok).toBe(false)
    const halfEnded = expectOk(endBaseballHalfInning(pitch(fresh, { result: 'ball' }), 'time_limit', null, ctx()))
    expect(canUndoBaseballPlay(halfEnded)).toBe(false)
    expect(plays(halfEnded)[0]).toMatchObject({ kind: 'flow', label: 'Half-inning ended: time limit' })
  })

  it('keeps the receipt across a preference change and a reload', () => {
    let state = pitch(startedGame(), { result: 'ball' })
    state = expectOk(undoBaseballPlay(state, at(1)))
    state = setBaseballCapturePreferences(state, { trackPitchLocation: false })
    expect(canRestoreBaseballPlay(state)).toBe(true)
    const reloaded = normalizeBaseballSportGameState(JSON.parse(JSON.stringify(state.sportGameState)))!
    expect(reloaded.capturePreferences.lastUndo).toEqual(sportOf(state).capturePreferences.lastUndo)
    const malformed = normalizeBaseballSportGameState({
      ...JSON.parse(JSON.stringify(state.sportGameState)),
      capturePreferences: { trackPitchLocation: true, trackBattedBallLocation: true, lastUndo: { createdAt: at(1), entries: [{ eventId: 7 }] } },
    })!
    expect(malformed.capturePreferences.lastUndo).toBeNull()
  })
})

describe('Baseball endings', () => {
  const oneInning = () => startedGame(baseballSetup({ rules: { scheduledInnings: 1 } }))

  it('blocks play at a pending end, offers Completed, and lets Undo take back the final play', () => {
    let walkOff = threeUpThreeDown(oneInning())
    walkOff = walk(walk(walk(walk(walkOff))))
    expect(projection(walkOff).pendingEnd).toBe('walk_off')
    expect(baseballEndGameOptions(projection(walkOff)).map(option => option.outcome)).toEqual([
      'completed', 'time_limit', 'forfeit', 'suspended', 'abandoned',
    ])
    expect(baseballCanEndHalf(projection(walkOff))).toBe(false)
    expect(baseballPendingEndOutcome('walk_off')).toBe('completed')
    const undone = expectOk(undoBaseballPlay(walkOff, at(1)))
    expect(projection(undone).pendingEnd).toBeNull()
    const ended = expectOk(endBaseballGame(walkOff, 'completed', ctx()))
    expect(projection(ended)).toMatchObject({ status: 'final', result: { outcome: 'completed', winner: 'tracked' } })
    expect(canUndoBaseballPlay(ended)).toBe(false)
    expect(baseballCanReopen(projection(ended))).toBe(true)
    expect(baseballEndGameOptions(projection(ended))).toEqual([])
    const reopened = expectOk(reopenBaseballGame(ended, 'Scored the wrong run', ctx()))
    expect(projection(reopened)).toMatchObject({ status: 'in_progress', pendingEnd: 'walk_off', result: null })
    expect(plays(reopened)[0]).toMatchObject({ kind: 'flow', label: 'Game reopened (Scored the wrong run)' })
  })

  it('offers only interruption endings mid-game and records suspend with its reason', () => {
    const state = pitch(startedGame(), { result: 'ball' })
    expect(baseballEndGameOptions(projection(state)).map(option => option.outcome)).toEqual([
      'time_limit', 'forfeit', 'suspended', 'abandoned',
    ])
    expect(baseballEndGameOptions(projection(state)).find(option => option.outcome === 'suspended')?.needsReason).toBe(true)
    const suspended = expectOk(endBaseballGame(state, 'suspended', ctx(), { note: 'Lightning' }))
    expect(projection(suspended)).toMatchObject({ status: 'suspended', result: { outcome: 'suspended', winner: null, note: 'Lightning' } })
    expect(baseballCanReopen(projection(suspended))).toBe(true)
  })

  it('ends a half early for a time limit', () => {
    const state = pitch(startedGame(), { result: 'ball' })
    expect(baseballCanEndHalf(projection(state))).toBe(true)
    const ended = expectOk(endBaseballHalfInning(state, 'time_limit', 'Two-hour limit', ctx()))
    expect(projection(ended)).toMatchObject({ half: 'bottom', outs: 0, balls: 0 })
  })

  it('records a forfeit with its winner', () => {
    const ended = expectOk(endBaseballGame(startedGame(), 'forfeit', ctx(), { forfeitWinner: 'opponent' }))
    expect(projection(ended).result).toMatchObject({ outcome: 'forfeit', winner: 'opponent' })
  })
})

describe('Baseball pitching changes', () => {
  const fielding = () => strikeout(startedGame())

  it('offers bench players and fielders, describing exactly what happens', () => {
    const options = baseballPitchingChangeOptions(sportOf(fielding()))
    expect(options.pitcherId).toBe('t1')
    expect(options.bench.map(option => option.incomingId)).toEqual(['t10', 't11', 't12'])
    expect(options.bench[0]!.summary).toEqual([
      '#10 Player 10 replaces #1 Player 1, batting 1st.',
      '#1 Player 1 leaves the game and may re-enter once, in the same batting slot.',
    ])
    expect(options.fielders.map(option => option.incomingId)).toEqual(['t2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'])
    expect(options.fielders[1]!.summary).toEqual([
      '#3 Player 3 moves from 1B to pitch.',
      '#1 Player 1 moves to 1B.',
      'Both keep their batting slots.',
    ])
  })

  it('brings a bench player in to pitch in the old pitcher\'s batting slot', () => {
    const state = fielding()
    const option = baseballPitchingChangeOptions(sportOf(state)).bench[0]!
    const changed = expectOk(substituteBaseball(state, 'tracked', option.substitution, ctx()))
    const lineup = projection(changed).lineups.tracked
    expect(lineup).toMatchObject({ pitcherId: 't10', removedIds: ['t1'] })
    expect(lineup.battingOrder[0]).toBe('t10')
    expect(plays(changed)[0]).toMatchObject({ label: 'Pitching change: #10 Player 10 for #1 Player 1' })
    // The count carries over and the next pitch is charged to the new pitcher.
    const pitched = pitch(changed, { result: 'ball' })
    expect(projection(pitched).pitchingLines.t10?.pitches).toBe(1)
  })

  it('swaps a fielder and the pitcher, keeping a complete defense', () => {
    const state = fielding()
    const option = baseballPitchingChangeOptions(sportOf(state)).fielders[1]!
    const changed = expectOk(substituteBaseball(state, 'tracked', option.substitution, ctx()))
    expect(projection(changed).lineups.tracked.defense).toMatchObject({ '1': 't3', '3': 't1' })
    expect(projection(changed).lineups.tracked.removedIds).toEqual([])
    expect(plays(changed)[0]).toMatchObject({ label: 'Pitching change: #3 Player 3 pitches, #1 Player 1 to 1B' })
  })

  it('hides re-entry for a player who has left when the rules forbid it', () => {
    const state = startedGame(baseballSetup({ rules: { reentry: 'none' } }))
    const first = baseballPitchingChangeOptions(sportOf(state)).bench[0]!
    const changed = expectOk(substituteBaseball(state, 'tracked', first.substitution, ctx()))
    const after = baseballPitchingChangeOptions(sportOf(changed))
    expect(after.bench.map(option => option.incomingId)).not.toContain('t1')
    expect(after.bench[0]!.summary[1]).toBe('#10 Player 10 leaves the game and cannot re-enter under these rules.')
  })

  it('records an opponent pitching change by label and number', () => {
    const changed = expectOk(substituteBaseball(fielding(), 'opponent', baseballOpponentPitcherChange('opp-p2', ' ', '44'), ctx()))
    expect(projection(changed).opponentPitchers['opp-p2']).toEqual({ id: 'opp-p2', label: null, number: '44', throws: null })
    expect(projection(changed).lineups.opponent.pitcherId).toBe('opp-p2')
  })
})

describe('Baseball game-flow components', () => {
  const noop = () => undefined

  it('shows Undo only on the newest play and Restore when a receipt exists', () => {
    const state = pitch(startedGame(), { result: 'ball' })
    const html = renderToStaticMarkup(createElement(BaseballRecentPlays, {
      rows: baseballRecentPlays(state, names),
      canRestore: true,
      onUndo: noop,
      onRestore: noop,
    }))
    expect(html.match(/aria-label="Undo /g)).toHaveLength(1)
    expect(html).toContain('Restore')
    expect(html).toContain('Ball')
  })

  it('summarises the selected pitching change before Confirm', () => {
    const sport = baseballSportState(startedGame())!
    const options = baseballPitchingChangeOptions(sport)
    const option = options.bench[0] ?? options.fielders[0]!
    const html = renderToStaticMarkup(createElement(BaseballPitchingChangeSheet, {
      draft: { side: 'tracked', selectedId: option.incomingId },
      onChange: noop,
      options,
      teamName: 'Aces',
      currentPitcher: 'Pitcher',
      error: null,
      onCancel: noop,
      onConfirm: noop,
    }))
    for (const line of option.summary) expect(html).toContain(line.replace(/'/g, '&#x27;'))
  })

  it('requires a reason before a suspend can be confirmed, and before a reopen', () => {
    const sport = baseballSportState(startedGame())!
    const suspend = renderToStaticMarkup(createElement(BaseballEndGameSheet, {
      draft: { outcome: 'suspended', note: '', winner: null },
      onChange: noop,
      options: baseballEndGameOptions(sport.projection),
      names: { tracked: 'Aces', opponent: 'Visitors' },
      error: null,
      onCancel: noop,
      onConfirm: noop,
    }))
    expect(suspend).toContain('disabled=""')
    const reopen = renderToStaticMarkup(createElement(BaseballReopenSheet, {
      reason: '',
      onChange: noop,
      error: null,
      onCancel: noop,
      onConfirm: noop,
    }))
    expect(reopen).toContain('disabled=""')
  })
})
