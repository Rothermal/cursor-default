import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { applyGameEventAppendsAndMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import type { GameEvent } from '../gameEvents/types'
import { baseballSportState, nextBaseballEventSequence, recordBaseballPitch, substituteBaseball } from './commands'
import { baseballDesignatedHitterId, baseballTrackedLineupView } from './lineupView'
import { normalizeBaseballSportGameState } from './state'
import { replayBaseballEvents } from './projector'
import { baseballRecentPlays, restoreBaseballPlay, undoBaseballPlay } from './recentPlays'
import {
  baseballDoubleSwitchPicker,
  baseballSubstitutionChoices,
  emptyBaseballSubstitutionDraft,
  pickBaseballDoubleSwitch,
  selectedBaseballSubstitution,
} from './substitutionOptions'
import {
  baseballSetup,
  ctx,
  expectOk,
  projection,
  startedGame,
  strikeout,
  threeUpThreeDown,
  TRACKED,
  walk,
} from './testFixtures'
import type { BaseballMatchSetup, BaseballSubstitution } from './types'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const sportOf = (state: GameState) => baseballSportState(state)!
const choices = (state: GameState) => baseballSubstitutionChoices(sportOf(state))
const tracked = (state: GameState) => projection(state).lineups.tracked
const attempt = (state: GameState, changes: BaseballSubstitution | BaseballSubstitution[]) =>
  substituteBaseball(state, 'tracked', changes, ctx())
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 13, 0, seconds)).toISOString()

/** DH format: t10 bats 1st as the DH and the pitcher t1 does not bat. */
function dhSetup(): BaseballMatchSetup {
  const setup = baseballSetup({ rules: { battingOrderFormat: 'designated_hitter' } })
  setup.trackedLineup.battingOrder[0] = TRACKED[9]
  return setup
}

function dhOption(state: GameState, key: string) {
  const found = choices(state).designated_hitter.flatMap(group => group.options).find(entry => entry.key === key)
  if (!found) throw new Error(`No ${key} option`)
  return found
}

describe('Baseball substitution payload schema 2', () => {
  it('writes the changes as one event and still reads schema 1 events', () => {
    let state = startedGame()
    state = expectOk(attempt(state, { kind: 'defensive', position: 7, incomingId: 't10', outgoingId: 't7' }))
    const stored = state.eventStream!.events[state.eventStream!.events.length - 1] as GameEvent
    expect(stored.schemaVersion).toBe(2)
    expect(stored.payload).toEqual({
      captureCommandId: null,
      changes: [{ kind: 'defensive', position: 7, incomingId: 't10', outgoingId: 't7' }],
    })

    // An event saved before BSB-4B, exactly as BSB-4A wrote it.
    const legacy = {
      ...stored,
      schemaVersion: 1,
      payload: { captureCommandId: stored.payload.captureCommandId, substitution: { kind: 'defensive', position: 7, incomingId: 't10', outgoingId: 't7' } },
    } as unknown as GameEvent
    const old: GameState = { ...state, eventStream: { ...state.eventStream!, events: [...state.eventStream!.events.slice(0, -1), legacy] } }
    const inspection = inspectGameEventStream(old.eventStream!, gameEventRegistry)
    expect(inspection.complete).toBe(true)
    expect(inspection.activeEvents[inspection.activeEvents.length - 1]!.payload).toEqual({ ...stored.payload, legacyLineupRules: true })
    expect(replayBaseballEvents(sportOf(old).setup, inspection.activeEvents).projection.lineups.tracked)
      .toEqual(tracked(state))
    // Raw schema 1 payloads replay too (Restore reads stored events directly).
    expect(replayBaseballEvents(sportOf(old).setup, old.eventStream!.events as GameEvent[]).diagnostics).toEqual([])
    expect(baseballRecentPlays(old, names)[0]).toMatchObject({ label: '#10 Player 10 to LF for #7 Player 7' })

    const undone = expectOk(undoBaseballPlay(old, at(1)))
    expect(tracked(undone).defense['7']).toBe('t7')
    const restored = expectOk(restoreBaseballPlay(undone, at(2)))
    expect(tracked(restored).defense['7']).toBe('t10')
  })

  it('rejects malformed change lists and mixed sides', () => {
    const state = startedGame()
    expect(attempt(state, []).ok).toBe(false)
    const mixed = attempt(state, [
      { kind: 'defensive', position: 7, incomingId: 't10', outgoingId: 't7' },
      { kind: 'opponent_slot', slotId: 'o1', label: 'A', number: null, position: null, bats: null },
    ])
    expect(mixed).toMatchObject({ ok: false, message: 'That change belongs to the opponent.' })
    const twoOpponent = substituteBaseball(state, 'opponent', [
      { kind: 'opponent_slot', slotId: 'o1', label: 'A', number: null, position: null, bats: null },
      { kind: 'opponent_slot', slotId: 'o2', label: 'B', number: null, position: null, bats: null },
    ], ctx())
    expect(twoOpponent).toMatchObject({ ok: false, message: 'Opponent changes are recorded one at a time.' })
  })

  it('checks the result as a whole, so a failed later change writes nothing', () => {
    const state = startedGame()
    const result = attempt(state, [
      { kind: 'defensive', position: 7, incomingId: 't10', outgoingId: 't7' },
      { kind: 'defensive', position: 8, incomingId: 't10', outgoingId: 't8' },
    ])
    expect(result.ok).toBe(false)
    expect(result.state).toBe(state)
  })
})

describe('Baseball double switch', () => {
  it('swaps the batting slots of a new pitcher and a new fielder in one event', () => {
    let state = startedGame()
    const group = choices(state).double_switch.find(entry => entry.key === 'ds:7')!
    expect(group.title).toBe('LF (#7 Player 7) with #1 Player 1')

    let draft = emptyBaseballSubstitutionDraft('double_switch', 'ds:7')
    const picker = baseballDoubleSwitchPicker(group)
    expect(picker.pitchers.map(entry => entry.label)).toEqual(['#10 Player 10', '#11 Player 11', '#12 Player 12'])
    expect(picker.fielders).toEqual([])
    draft = pickBaseballDoubleSwitch(group, draft, { pitcherId: 't10' })
    expect(baseballDoubleSwitchPicker(group, draft.parts).fielders.map(entry => entry.id)).toEqual(['t11', 't12'])
    draft = pickBaseballDoubleSwitch(group, draft, { fielderId: 't11' })
    // Both players picked: the switched slots are chosen by default.
    expect(draft.parts?.pitcherBats).toBe('fielder_slot')
    expect(baseballDoubleSwitchPicker(group, draft.parts).slots.map(entry => entry.label)).toEqual([
      'Pitcher bats 7th, LF bats 1st (switched)',
      'Pitcher bats 1st, LF bats 7th (unchanged)',
    ])
    const option = selectedBaseballSubstitution(choices(state), draft)!
    expect(option.summary).toEqual([
      '#10 Player 10 replaces #1 Player 1 as pitcher, batting 7th.',
      '#11 Player 11 replaces #7 Player 7 at LF, batting 1st.',
      '#1 Player 1 leaves the game and may re-enter once, in the 1st slot.',
      '#7 Player 7 leaves the game and may re-enter once, in the 7th slot.',
    ])

    const before = state.eventStream!.events.length
    state = expectOk(attempt(state, option.changes))
    expect(state.eventStream!.events.length).toBe(before + 1)
    const lineup = tracked(state)
    expect(lineup.battingOrder[0]).toBe('t11')
    expect(lineup.battingOrder[6]).toBe('t10')
    expect(lineup.defense).toMatchObject({ '1': 't10', '7': 't11' })
    expect(lineup.pitcherId).toBe('t10')
    expect(lineup.removedIds).toEqual(['t7', 't1'])
    expect(baseballTrackedLineupView(sportOf(state)).openPositions).toEqual([])
    expect(baseballRecentPlays(state, names)[0]).toMatchObject({
      label: 'Double switch: #10 Player 10 pitches, #11 Player 11 to LF; #1 Player 1 and #7 Player 7 leave',
    })
    // One capture unit, so Undo takes the whole switch back.
    const undone = expectOk(undoBaseballPlay(state, at(3)))
    expect(tracked(undone).defense).toMatchObject({ '1': 't1', '7': 't7' })
  })

  it('clears a fielder pick that no longer fits a new pitcher pick', () => {
    const state = startedGame()
    const group = choices(state).double_switch.find(entry => entry.key === 'ds:7')!
    let draft = pickBaseballDoubleSwitch(group, emptyBaseballSubstitutionDraft('double_switch', 'ds:7'), { pitcherId: 't10', fielderId: 't11' })
    expect(draft.optionKey).toBe('ds:7:t10:t11:fielder_slot')
    draft = pickBaseballDoubleSwitch(group, draft, { pitcherId: 't11' })
    expect(draft.parts).toEqual({ pitcherId: 't11', pitcherBats: undefined })
    expect(draft.optionKey).toBeNull()
  })

  it('is not offered while the pitcher does not bat or is on base', () => {
    expect(choices(startedGame(dhSetup())).double_switch).toEqual([])
    // Bottom 1: the pitcher t1 walked and is on first.
    expect(choices(walk(threeUpThreeDown(startedGame()))).double_switch).toEqual([])
  })

  it('needs every displaced fielder placed by the end of the event', () => {
    const state = startedGame()
    expect(attempt(state, { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't7' })).toMatchObject({
      ok: false,
      message: 'Every fielder moved off a position needs a new position or must leave the game.',
    })
  })
})

describe('Baseball DH forfeiture', () => {
  it('the DH takes the field and the pitcher bats in place of the fielder who leaves', () => {
    let state = startedGame(dhSetup())
    expect(baseballDesignatedHitterId(sportOf(state))).toBe('t10')
    const option = dhOption(state, 'dh:field:7')
    expect(option.summary).toEqual([
      '#10 Player 10 moves from DH to LF and keeps batting 1st.',
      '#7 Player 7 leaves the game; #1 Player 1 (P) bats 7th in that place.',
      '#7 Player 7 leaves the game and may re-enter once, in the 7th slot.',
      'The DH role ends for the rest of the game.',
    ])
    state = expectOk(attempt(state, option.changes))
    const lineup = tracked(state)
    expect(lineup.battingOrder[0]).toBe('t10')
    expect(lineup.battingOrder[6]).toBe('t1')
    expect(lineup.defense).toMatchObject({ '1': 't1', '7': 't10' })
    expect(lineup.removedIds).toEqual(['t7'])
    expect(baseballDesignatedHitterId(sportOf(state))).toBeNull()
    expect(choices(state).designated_hitter).toEqual([])
    const view = baseballTrackedLineupView(sportOf(state))
    expect(view.cards[0]).toMatchObject({ id: 't10', position: 'LF' })
    expect(view.cards[6]).toMatchObject({ id: 't1', position: 'P' })
    expect(view.defense.every(row => !row.doesNotBat)).toBe(true)
    expect(baseballRecentPlays(state, names)[0]).toMatchObject({
      label: '#10 Player 10 to LF; #1 Player 1 bats in place of #7 Player 7; the DH role ends',
    })
  })

  it('the pitcher bats for the DH, who leaves', () => {
    let state = startedGame(dhSetup())
    state = expectOk(attempt(state, dhOption(state, 'dh:bats').changes))
    expect(tracked(state).battingOrder[0]).toBe('t1')
    expect(tracked(state).removedIds).toEqual(['t10'])
    expect(baseballDesignatedHitterId(sportOf(state))).toBeNull()
  })

  it('the DH pitches and the old pitcher leaves the game', () => {
    let state = startedGame(dhSetup())
    const option = dhOption(state, 'dh:field:1')
    expect(option.summary[0]).toBe('#10 Player 10 moves from DH to P and keeps batting 1st.')
    state = expectOk(attempt(state, option.changes))
    expect(tracked(state).pitcherId).toBe('t10')
    expect(tracked(state).removedIds).toEqual(['t1'])
  })

  it('rejects the DH taking the field while the pitcher still does not bat', () => {
    const state = startedGame(dhSetup())
    expect(attempt(state, { kind: 'defensive', position: 7, incomingId: 't10', outgoingId: null })).toMatchObject({
      ok: false,
      message: 'Every fielder moved off a position needs a new position or must leave the game.',
    })
    // An open catcher: the DH filling it still leaves the pitcher out of the order.
    let open = walk(threeUpThreeDown(startedGame(dhSetup())))
    open = expectOk(attempt(open, { kind: 'pinch_hitter', incomingId: 't11', outgoingId: 't2' }))
    open = strikeout(strikeout(strikeout(open)))
    expect(attempt(open, { kind: 'defensive', position: 2, incomingId: 't10', outgoingId: null })).toMatchObject({
      ok: false,
      message: 'When the DH takes the field, the pitcher bats; the DH role ends.',
    })
    // The pinch hitter is offered for the open spot; the DH is not.
    const catcher = choices(open).defensive.find(group => group.key === 'def:2')!
    expect(catcher.options.map(entry => entry.label)).toContain('#11 Player 11 (already batting)')
    expect(catcher.options.some(entry => entry.label.startsWith('#10 Player 10'))).toBe(false)
  })

  it('a pitching change keeps the DH', () => {
    let state = startedGame(dhSetup())
    state = expectOk(attempt(state, { kind: 'defensive', position: 1, incomingId: 't11', outgoingId: 't1' }))
    expect(baseballDesignatedHitterId(sportOf(state))).toBe('t10')
    expect(tracked(state).battingOrder).not.toContain('t11')
  })
})

describe('Baseball multi-change sheet', () => {
  it('renders the double switch pickers and the summary', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { default: BaseballSubstitutionSheet } = await import('../../components/baseball/BaseballSubstitutionSheet')
    const state = startedGame()
    const all = choices(state)
    const group = all.double_switch.find(entry => entry.key === 'ds:7')!
    const draft = pickBaseballDoubleSwitch(group, emptyBaseballSubstitutionDraft('double_switch', 'ds:7'), { pitcherId: 't10', fielderId: 't11' })
    const html = renderToStaticMarkup(createElement(BaseballSubstitutionSheet, {
      teamName: 'Aces',
      choices: all,
      draft,
      onChange: () => {},
      onPitchingChange: null,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
    }))
    expect(html).toContain('New pitcher')
    expect(html).toContain('New fielder (LF)')
    expect(html).toContain('Pitcher bats 7th, LF bats 1st (switched)')
    expect(html).toContain('#11 Player 11 replaces #7 Player 7 at LF, batting 1st.')
  })
})

/**
 * A substitution exactly as BSB-4A saved it (schema 1). BSB-4A's picker offered the DH for
 * an open position after a pinch hitter, and its projector accepted the move; BSB-4B would
 * reject the same change as a new write, so saved games must keep replaying it.
 */
const PRE_BSB4B_DH_TO_CATCHER = {
  id: '6f3c1a52-0b4e-4c55-9a51-1d8a8e3a4b01',
  sportId: 'baseball',
  eventType: 'baseball.substitution',
  schemaVersion: 1,
  recorderUserId: null,
  period: { id: 'inning-2-top', order: 3 },
  elapsedMs: null,
  occurredAt: '2026-09-30T18:00:00.000Z',
  teamSide: 'tracked',
  location: null,
  actors: [],
  payload: {
    captureCommandId: 'c0a8e7f4-5d1b-4a8e-9b0c-3e2f1a6d7c88',
    substitution: { kind: 'defensive', position: 2, incomingId: 't10', outgoingId: null },
  },
  revision: 1,
  createdAt: '2026-09-30T18:00:00.000Z',
  updatedAt: '2026-09-30T18:00:00.000Z',
  deletedAt: null,
} as const

/** Top 2 of a DH game: t11 pinch-hit for the catcher t2 in the bottom 1, so C is open. */
function dhOpenCatcher(): GameState {
  let state = walk(threeUpThreeDown(startedGame(dhSetup())))
  state = expectOk(attempt(state, { kind: 'pinch_hitter', incomingId: 't11', outgoingId: 't2' }))
  return strikeout(strikeout(strikeout(state)))
}

function withLegacyEvent(state: GameState): GameState {
  const event = { ...PRE_BSB4B_DH_TO_CATCHER, sequence: nextBaseballEventSequence(state.eventStream!.events, null) } as unknown as GameEvent
  const result = applyGameEventAppendsAndMutations(state, [event], [], at(10), gameEventRegistry, gameEventProjectors)
  if (!result.ok) throw new Error(result.error.message)
  return result.state
}

describe('Baseball substitutions saved before BSB-4B', () => {
  it('replays the DH into an open catcher spot that BSB-4A accepted, while new writes stay strict', () => {
    const before = dhOpenCatcher()
    expect(attempt(before, { kind: 'defensive', position: 2, incomingId: 't10', outgoingId: null })).toMatchObject({
      ok: false,
      message: 'When the DH takes the field, the pitcher bats; the DH role ends.',
    })

    const state = withLegacyEvent(before)
    const stored = state.eventStream!.events[state.eventStream!.events.length - 1] as GameEvent
    const inspection = inspectGameEventStream(state.eventStream!, gameEventRegistry)
    expect(inspection.complete).toBe(true)
    expect(inspection.activeEvents.find(event => event.id === stored.id)!.payload).toEqual({
      captureCommandId: PRE_BSB4B_DH_TO_CATCHER.payload.captureCommandId,
      changes: [{ kind: 'defensive', position: 2, incomingId: 't10', outgoingId: null }],
      legacyLineupRules: true,
    })
    // Hydrated projection: the DH catches, the pitcher still does not bat, nobody left.
    const lineup = tracked(state)
    expect(lineup.defense['2']).toBe('t10')
    expect(lineup.battingOrder).not.toContain('t1')
    expect(lineup.removedIds).toEqual(['t2'])
    expect(replayBaseballEvents(sportOf(state).setup, state.eventStream!.events as GameEvent[]).diagnostics).toEqual([])
    const normalized = normalizeBaseballSportGameState(JSON.parse(JSON.stringify(state.sportGameState)))
    expect(normalized?.projection.lineups.tracked).toEqual(lineup)

    // Review.
    expect(baseballRecentPlays(state, names)[0]).toMatchObject({ label: '#10 Player 10 to C' })
    expect(baseballTrackedLineupView(sportOf(state)).cards[0]).toMatchObject({ id: 't10', position: 'C' })
    expect(baseballDesignatedHitterId(sportOf(state))).toBeNull()

    // Every option offered on top of the saved history is one the engine accepts.
    for (const option of Object.values(choices(state)).flatMap(groups => groups.flatMap(group => group.options))) {
      const result = attempt(state, option.changes)
      expect(result.ok ? 'ok' : `${option.key}: ${result.message}`).toBe('ok')
    }

    // Undo and Restore of the saved event.
    const undone = expectOk(undoBaseballPlay(state, at(11)))
    expect(tracked(undone).defense['2']).toBeUndefined()
    const restored = expectOk(restoreBaseballPlay(undone, at(12)))
    expect(tracked(restored).defense['2']).toBe('t10')

    // Play continues: a pitch, a pitching change and the remaining open spot all work.
    let next = expectOk(recordBaseballPitch(restored, { result: 'ball' }, ctx()))
    next = expectOk(attempt(next, { kind: 'defensive', position: 1, incomingId: 't12', outgoingId: 't1' }))
    expect(tracked(next).pitcherId).toBe('t12')
    expect(projection(next).balls).toBe(1)
    expect(choices(next).position_change.length).toBeGreaterThan(0)
  })

  it('still applies the BSB-4A checks to saved events', () => {
    const state = startedGame()
    const legacy = {
      ...PRE_BSB4B_DH_TO_CATCHER,
      period: { id: 'inning-1-top', order: 1 },
      sequence: nextBaseballEventSequence(state.eventStream!.events, null),
      // Displaces the LF without a new position, which BSB-4A refused in a standard order.
      payload: { captureCommandId: 'legacy-2', substitution: { kind: 'position_change', assignments: [{ participantId: 't8', position: 7 }] } },
    } as unknown as GameEvent
    const result = applyGameEventAppendsAndMutations(state, [legacy], [], at(20), gameEventRegistry, gameEventProjectors)
    expect(result.ok).toBe(false)
    const replay = replayBaseballEvents(sportOf(state).setup, [...(state.eventStream!.events as GameEvent[]), legacy])
    expect(replay.diagnostics[0]?.message).toBe('Every displaced fielder needs a new position.')
  })

  it('rejects the legacy marker on anything but one BSB-4A change', () => {
    const state = startedGame()
    const forged = {
      ...PRE_BSB4B_DH_TO_CATCHER,
      schemaVersion: 2,
      period: { id: 'inning-1-top', order: 1 },
      sequence: nextBaseballEventSequence(state.eventStream!.events, null),
      payload: {
        captureCommandId: 'forged',
        changes: [
          { kind: 'defensive', position: 7, incomingId: 't10', outgoingId: 't7' },
          { kind: 'defensive', position: 8, incomingId: 't11', outgoingId: 't8' },
        ],
        legacyLineupRules: true,
      },
    } as unknown as GameEvent
    expect(gameEventRegistry.inspect(forged).ok).toBe(false)
  })
})
