import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import {
  baseballSportState,
  endBaseballGame,
  reopenBaseballGame,
  setBaseballPitcherDecisions,
  substituteBaseball,
} from './commands'
import { previewBaseballRemoval, removeBaseballPlay } from './corrections'
import {
  baseballDecisionsView,
  baseballEmptyDecisions,
  baseballPitcherDecisionMarks,
  saveBaseballPitcherDecisions,
} from './decisions'
import { undoBaseballPlay } from './recentPlays'
import { ballInPlay, baseballSetup, ctx, expectOk, OPPONENT_PITCHER, projection, startedGame, strikeout, walk } from './testFixtures'
import type { BaseballPitcherDecisions } from './types'
import { baseballActiveEvents } from './units'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const sportOf = (state: GameState) => baseballSportState(state)!
const viewOf = (state: GameState) => baseballDecisionsView(sportOf(state), baseballActiveEvents(state))
const setup = () => baseballSetup({ rules: { runRules: [] } })

const homeRun = (state: GameState) => ballInPlay(state, 'home_run', { battedBallType: 'fly' })
const relieve = (state: GameState, incomingId: string) =>
  expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId, outgoingId: null }, ctx()))
const finish = (state: GameState) => expectOk(endBaseballGame(state, 'completed', ctx()))

/** Plays a full half-inning of strikeouts, with `before` run first (home runs, changes). */
function half(state: GameState, ...before: Array<(state: GameState) => GameState>): GameState {
  const { inning, half: which } = projection(state)
  let next = before.reduce((current, step) => step(current), state)
  const same = () => projection(next).inning === inning && projection(next).half === which
  while (same() && projection(next).pendingEnd === null && projection(next).status === 'in_progress') next = strikeout(next)
  return next
}

type SidePick = { win?: string | null; loss?: string | null; save?: string | null; holds?: string[] }

function decisions(partial: { tracked?: SidePick; opponent?: SidePick }): BaseballPitcherDecisions {
  const empty = baseballEmptyDecisions()
  return { tracked: { ...empty.tracked, ...partial.tracked }, opponent: { ...empty.opponent, ...partial.opponent } }
}

/** Starter t1 throws a 1-0 shutout (we are home, so the bottom of the 7th is not played). */
function starterWin(): GameState {
  let state = startedGame(setup())
  state = half(state)
  state = half(state, homeRun)
  for (let inning = 2; inning <= 6; inning += 1) state = half(half(state))
  return finish(half(state))
}

/**
 * Relief win with a save: the opponent scores off t1 in the 1st, t10 takes over in the 4th and
 * is the pitcher of record when we go ahead 2-1 in the 5th, and t11 finishes the 6th and 7th.
 */
function reliefWinWithSave(): GameState {
  let state = startedGame(setup())
  state = half(state, homeRun)
  state = half(state)
  for (let inning = 2; inning <= 3; inning += 1) state = half(half(state))
  state = half(state, current => relieve(current, 't10'))
  state = half(state)
  state = half(state)
  state = half(state, homeRun, homeRun)
  state = half(state, current => relieve(current, 't11'))
  state = half(state)
  return finish(half(state))
}

describe('Baseball pitcher decision suggestion', () => {
  it('gives a complete-game starter the W and the opponent starter the L, with no SV', () => {
    const view = viewOf(starterWin())
    expect(view.canSet).toBe(true)
    expect(view.winner).toBe('tracked')
    expect(view.suggestion.decisions).toEqual(decisions({ tracked: { win: 't1' }, opponent: { loss: OPPONENT_PITCHER } }))
    expect(view.pitchers.tracked).toEqual(['t1'])
  })

  it('gives the W to the reliever of record when the lead is taken and the SV to the closer', () => {
    const view = viewOf(reliefWinWithSave())
    expect(view.suggestion.decisions).toEqual(decisions({
      tracked: { win: 't10', save: 't11' },
      opponent: { loss: OPPONENT_PITCHER },
    }))
    expect(view.pitchers.tracked).toEqual(['t1', 't10', 't11'])
  })

  it('leaves W (and so SV) blank for a starter short of the minimum innings', () => {
    // NFHS: seven scheduled innings scale five down to three, and t1 leaves after two.
    let state = startedGame(setup())
    state = half(state)
    state = half(state, homeRun)
    state = half(half(state))
    state = half(state, current => relieve(current, 't10'))
    state = half(state)
    for (let inning = 4; inning <= 6; inning += 1) state = half(half(state))
    const view = viewOf(finish(half(state)))
    expect(view.suggestion.decisions).toEqual(decisions({ opponent: { loss: OPPONENT_PITCHER } }))
    expect(view.suggestion.notes[0]).toMatch(/fewer than 3 innings/)
  })

  it('charges the L with the go-ahead run in extra innings', () => {
    let state = startedGame(setup())
    for (let inning = 1; inning <= 7; inning += 1) state = half(half(state))
    state = half(state)
    expect(projection(state)).toMatchObject({ inning: 8, half: 'bottom' })
    state = homeRun(state)
    expect(projection(state).pendingEnd).toBe('walk_off')
    const view = viewOf(finish(state))
    expect(view.suggestion.decisions).toEqual(decisions({ tracked: { win: 't1' }, opponent: { loss: OPPONENT_PITCHER } }))
  })

  it('suggests nothing for a tie', () => {
    let state = startedGame(setup())
    state = half(half(state))
    state = expectOk(endBaseballGame(state, 'time_limit', ctx()))
    const view = viewOf(state)
    expect(view.winner).toBeNull()
    expect(view.suggestion.decisions).toEqual(baseballEmptyDecisions())
    expect(view.suggestion.notes).toEqual(['Nothing is suggested for a tie or a forfeit.'])
    expect(saveBaseballPitcherDecisions(state, decisions({ tracked: { win: 't1' } }), ctx())).toMatchObject({ ok: false })
  })
})

describe('Baseball save eligibility (OBR 9.19)', () => {
  /** We lead after six; the top of the 7th is played by `seventh`. */
  function leadAfterSix(runs: number, seventh: (state: GameState) => GameState): GameState {
    let state = startedGame(setup())
    state = half(state)
    state = half(state, ...Array.from({ length: runs }, () => homeRun))
    for (let inning = 2; inning <= 6; inning += 1) state = half(half(state))
    return finish(seventh(state))
  }

  it('gives no SV to a reliever who enters with two out, bases empty and a three-run lead and gets one out', () => {
    const view = viewOf(leadAfterSix(3, state => strikeout(relieve(strikeout(strikeout(state)), 't10'))))
    expect(view.suggestion.decisions.tracked).toMatchObject({ win: 't1', save: null })
  })

  it('gives the SV to a reliever who enters with the tying run on deck and finishes', () => {
    const view = viewOf(leadAfterSix(2, state => strikeout(relieve(strikeout(strikeout(state)), 't10'))))
    expect(view.suggestion.decisions.tracked).toMatchObject({ win: 't1', save: 't10' })
  })

  it('gives the SV to a reliever who enters with the tying run on base', () => {
    const view = viewOf(leadAfterSix(3, state => strikeout(relieve(walk(strikeout(strikeout(state))), 't10'))))
    expect(view.suggestion.decisions.tracked).toMatchObject({ win: 't1', save: 't10' })
  })

  it('gives no SV to a reliever who lost the lead and finished after it was retaken; he gets the W', () => {
    let state = startedGame(setup())
    state = half(state)
    state = half(state, homeRun)
    for (let inning = 2; inning <= 4; inning += 1) state = half(half(state))
    state = half(state, current => relieve(current, 't10'), homeRun)
    expect(projection(state).score).toEqual({ tracked: 1, opponent: 1 })
    state = half(state, homeRun)
    state = half(half(state))
    const view = viewOf(finish(half(state)))
    expect(view.suggestion.decisions).toEqual(decisions({ tracked: { win: 't10' }, opponent: { loss: OPPONENT_PITCHER } }))
  })
})

describe('Baseball pitcher decision lifecycle', () => {
  it('validates choices and refuses impossible ones', () => {
    const state = reliefWinWithSave()
    const refuse = (chosen: BaseballPitcherDecisions) => {
      const result = saveBaseballPitcherDecisions(state, chosen, ctx())
      return result.ok ? null : result.message
    }
    expect(refuse(decisions({ tracked: { win: 't5' } }))).toMatch(/did not pitch/)
    expect(refuse(decisions({ opponent: { win: OPPONENT_PITCHER } }))).toMatch(/winning team/)
    expect(refuse(decisions({ tracked: { loss: 't1' } }))).toMatch(/losing team/)
    expect(refuse(decisions({ tracked: { win: 't10', save: 't10' } }))).toMatch(/both the W and the SV/)
    expect(refuse(decisions({ tracked: { win: 't10', holds: ['t10'] } }))).toMatch(/hold/)
    expect(refuse(decisions({ tracked: { win: 't10', save: 't11', holds: ['t1'] }, opponent: { loss: OPPONENT_PITCHER } }))).toBeNull()
  })

  it('refuses decisions before the game is final', () => {
    const state = half(startedGame(setup()))
    expect(setBaseballPitcherDecisions(state, baseballEmptyDecisions(), ctx())).toMatchObject({ ok: false })
  })

  it('keeps the newest decisions of the epoch, falls back when it is undone, and clears on Reopen', () => {
    let state = starterWin()
    const first = decisions({ tracked: { win: 't1' }, opponent: { loss: OPPONENT_PITCHER } })
    const second = decisions({ tracked: { win: 't1', holds: [] }, opponent: { loss: null } })
    state = expectOk(saveBaseballPitcherDecisions(state, first, { ...ctx(), captureCommandId: 'd1' }))
    state = expectOk(saveBaseballPitcherDecisions(state, second, { ...ctx(), captureCommandId: 'd2' }))
    expect(viewOf(state).current?.decisions).toEqual(second)
    // Saved games (reload, park, export) keep them: they are ordinary stream events.
    expect(viewOf(JSON.parse(JSON.stringify(state)) as GameState).current?.decisions).toEqual(second)
    expect(baseballPitcherDecisionMarks(viewOf(state).current!.decisions, 'tracked', 't1')).toEqual(['W'])

    // Undo takes the newest back; the earlier one counts again.
    state = expectOk(undoBaseballPlay(state, ctx().occurredAt))
    expect(viewOf(state).current?.decisions).toEqual(first)

    const epoch = viewOf(state).epochId
    state = expectOk(reopenBaseballGame(state, 'Scorebook check', ctx()))
    expect(viewOf(state)).toMatchObject({ canSet: false, current: null, epochId: null })
    expect(baseballActiveEvents(state).filter(event => event.eventType === 'baseball.pitcher_decisions')).toHaveLength(1)

    // A new end starts a new epoch with no decisions.
    state = finish(state)
    const view = viewOf(state)
    expect(view.epochId).not.toBe(epoch)
    expect(view.current).toBeNull()
    expect(view.suggestion.decisions.tracked.win).toBe('t1')
  })

  it('flags stored decisions an edit no longer fits without breaking the replay', () => {
    // The opponent brings in a reliever who gives up the go-ahead runs in the bottom of the 1st.
    let state = startedGame(setup())
    state = half(state)
    state = half(state, current => expectOk(substituteBaseball(current, 'opponent', {
      kind: 'opponent_pitcher',
      pitcher: { id: 'opp-p2', label: 'Reliever', number: '30', throws: 'R' },
    }, ctx())), homeRun)
    for (let inning = 2; inning <= 6; inning += 1) state = half(half(state))
    state = finish(half(state))
    expect(viewOf(state).suggestion.decisions.opponent.loss).toBe('opp-p2')
    state = expectOk(saveBaseballPitcherDecisions(state, decisions({ tracked: { win: 't1' }, opponent: { loss: 'opp-p2' } }), ctx()))

    // Remove the change: opp-p1 threw every pitch, so opp-p2 never pitched.
    const change = baseballActiveEvents(state).find(event => event.eventType === 'baseball.substitution')!
    const preview = previewBaseballRemoval(state, change.id, names)
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.preview.dependents).toEqual({ plays: [], lifecycle: [] })
    state = expectOk(removeBaseballPlay(state, preview.preview, names, { now: ctx().occurredAt, confirmed: true }))
    expect(projection(state).status).toBe('final')
    const view = viewOf(state)
    expect(view.current?.decisions.opponent.loss).toBe('opp-p2')
    expect(view.issues).toEqual(['A pitcher no longer in this game did not pitch for this team.'])
    expect(view.suggestion.decisions.opponent.loss).toBe(OPPONENT_PITCHER)
  })

})
