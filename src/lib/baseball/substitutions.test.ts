import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { stableJson } from '../gameEvents/stream'
import { baseballSportState, substituteBaseball } from './commands'
import {
  baseballBatterHand,
  baseballCanEnter,
  baseballOpponentLineupView,
  baseballPlayerGameDetail,
  baseballTrackedLineupView,
} from './lineupView'
import { baseballPitchingChangeOptions } from './pitchingChange'
import { normalizeBaseballSportGameState } from './state'
import {
  baseballAvailableSubstitutionKinds,
  baseballSubstitutionChoices,
  type BaseballSubstitutionChoices,
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

const sportOf = (state: GameState) => baseballSportState(state)!
const choices = (state: GameState) => baseballSubstitutionChoices(sportOf(state))
const sub = (state: GameState, substitution: BaseballSubstitution) =>
  expectOk(substituteBaseball(state, 'tracked', substitution, ctx()))

function listed(all: BaseballSubstitutionChoices): Set<string> {
  return new Set(
    Object.values(all).flatMap(groups => groups.flatMap(group => group.options.map(option => stableJson(option.substitution))))
  )
}

function option(state: GameState, kind: keyof BaseballSubstitutionChoices, match: (summary: string[]) => boolean) {
  const found = choices(state)[kind].flatMap(group => group.options).find(entry => match(entry.summary))
  if (!found) throw new Error(`No ${kind} option matched`)
  return found
}

/** Every single change the projector could be asked for in this state. */
function candidates(state: GameState): BaseballSubstitution[] {
  const sport = sportOf(state)
  const ids = sport.setup.participants.map(participant => participant.id)
  const positions = Array.from({ length: sport.setup.rulesSnapshot.defensivePlayers }, (_, index) => index + 1)
  const list: BaseballSubstitution[] = []
  for (const incomingId of ids) {
    for (const outgoingId of ids) {
      if (incomingId === outgoingId) continue
      list.push({ kind: 'pinch_hitter', incomingId, outgoingId })
      list.push({ kind: 'pinch_runner', incomingId, outgoingId })
      list.push({ kind: 'courtesy_runner', incomingId, outgoingId })
    }
    for (const position of positions) {
      list.push({ kind: 'defensive', position, incomingId, outgoingId: null })
      for (const outgoingId of ids) {
        if (outgoingId !== incomingId) list.push({ kind: 'defensive', position, incomingId, outgoingId })
      }
      // Moving a fielder to the position they already play changes nothing.
      if (sport.projection.lineups.tracked.defense[String(position)] !== incomingId) {
        list.push({ kind: 'position_change', assignments: [{ participantId: incomingId, position }] })
      }
    }
  }
  const defense = sport.projection.lineups.tracked.defense
  for (const [from, moverId] of Object.entries(defense)) {
    for (const [to, otherId] of Object.entries(defense)) {
      if (from === to) continue
      list.push({
        kind: 'position_change',
        assignments: [{ participantId: moverId, position: Number(to) }, { participantId: otherId, position: Number(from) }],
      })
    }
  }
  return list
}

/** Choices the engine accepts that BSB-4A leaves out on purpose (see substitutionOptions). */
function deliberatelyOmitted(state: GameState, substitution: BaseballSubstitution): boolean {
  const sport = sportOf(state)
  const lineup = sport.projection.lineups.tracked
  switch (substitution.kind) {
    case 'courtesy_runner':
      // Only players who have not appeared are offered.
      return lineup.appearedIds.includes(substitution.incomingId)
    case 'defensive': {
      // Changes that move a second player (a DH or EH taking a filled position, or a
      // fielder leaving from another position, which opens a second hole) wait for BSB-4B.
      const occupant = lineup.defense[String(substitution.position)] ?? null
      if (occupant !== null) return substitution.outgoingId !== occupant
      return substitution.outgoingId !== null && Object.values(lineup.defense).includes(substitution.outgoingId)
    }
    case 'position_change':
      // A batter without a position joining the field through a position change is the
      // defensive "stays in the game" choice instead.
      return substitution.assignments.some(entry => !Object.values(lineup.defense).includes(entry.participantId))
    default:
      return false
  }
}

function expectMatchesEngine(state: GameState) {
  const offered = listed(choices(state))
  for (const key of offered) {
    const result = substituteBaseball(state, 'tracked', JSON.parse(key) as BaseballSubstitution, ctx())
    expect(result.ok ? 'ok' : `${key}: ${result.message}`).toBe('ok')
  }
  for (const substitution of candidates(state)) {
    const accepted = substituteBaseball(state, 'tracked', substitution, ctx()).ok
    if (!accepted || deliberatelyOmitted(state, substitution)) continue
    expect(offered.has(stableJson(substitution)) ? 'listed' : stableJson(substitution)).toBe('listed')
  }
}

function dhSetup(): BaseballMatchSetup {
  const setup = baseballSetup({ rules: { battingOrderFormat: 'designated_hitter' } })
  setup.trackedLineup.battingOrder[0] = TRACKED[9]
  return setup
}

/** Bottom 1, t1 on first by a walk and t2 at bat. */
function runnerOnFirst(setup?: BaseballMatchSetup): GameState {
  return walk(threeUpThreeDown(startedGame(setup)))
}

/** Bottom 1: t10 pinch-hits for t2 (the catcher), then the half ends; t2's spot at C is open. */
function openCatcher(): GameState {
  let state = runnerOnFirst()
  state = sub(state, { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't2' })
  return strikeout(strikeout(strikeout(state)))
}

// Each case replays the game once per candidate change, so these run longer than most.
describe('Baseball substitution options match the engine', { timeout: 30_000 }, () => {
  it('in the field at the start of the game', () => {
    expectMatchesEngine(startedGame())
  })

  it('at bat with a runner on first', () => {
    expectMatchesEngine(runnerOnFirst())
  })

  it('with an open position after a pinch hitter', () => {
    expectMatchesEngine(openCatcher())
  })

  it('with a designated hitter', () => {
    expectMatchesEngine(startedGame(dhSetup()))
    expectMatchesEngine(runnerOnFirst(dhSetup()))
  })

  it('with no re-entry and with unlimited re-entry', () => {
    for (const reentry of ['none', 'unlimited'] as const) {
      let state = runnerOnFirst(baseballSetup({ rules: { reentry } }))
      state = sub(state, { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't2' })
      state = strikeout(strikeout(strikeout(state)))
      expectMatchesEngine(state)
    }
  })

  it('with the catcher on base and courtesy runners allowed', () => {
    let state = runnerOnFirst()
    state = strikeout(state)
    state = walk(state)
    // t1 (the pitcher) is on second and t3 on first after two walks; t2 struck out.
    expect(projection(state).bases.second?.runnerId).toBe('t1')
    expectMatchesEngine(state)
  })
})

describe('Baseball substitutions', () => {
  it('offers only the kinds that are legal now', () => {
    expect(baseballAvailableSubstitutionKinds(choices(startedGame()))).toEqual(['defensive', 'position_change'])
    expect(baseballAvailableSubstitutionKinds(choices(runnerOnFirst()))).toEqual([
      'pinch_hitter',
      'pinch_runner',
      'courtesy_runner',
      'defensive',
      'position_change',
    ])
    const noCourtesy = runnerOnFirst(baseballSetup({ rules: { courtesyRunners: false } }))
    expect(baseballAvailableSubstitutionKinds(choices(noCourtesy))).not.toContain('courtesy_runner')
  })

  it('pinch hitter writes one event and the summary names the slot and re-entry', () => {
    let state = runnerOnFirst()
    const choice = option(state, 'pinch_hitter', summary => summary[0].startsWith('#10 Player 10'))
    expect(choice.summary).toEqual([
      '#10 Player 10 pinch-hits for #2 Player 2, batting 2nd.',
      '#2 Player 2 leaves the game and may re-enter once, in the 2nd slot.',
    ])
    const before = state.eventStream!.events.length
    state = sub(state, choice.substitution)
    expect(state.eventStream!.events.length).toBe(before + 1)
    const lineup = projection(state).lineups.tracked
    expect(lineup.battingOrder[1]).toBe('t10')
    expect(lineup.removedIds).toEqual(['t2'])
    expect(projection(state).currentBatterId).toBe('t10')
  })

  it('pinch runner takes the base and the batting slot', () => {
    let state = runnerOnFirst()
    state = sub(state, option(state, 'pinch_runner', summary => summary[0].startsWith('#11 Player 11')).substitution)
    expect(projection(state).bases.first?.runnerId).toBe('t11')
    expect(projection(state).lineups.tracked.battingOrder[0]).toBe('t11')
  })

  it('courtesy runner is offered only for the pitcher or catcher, from players who have not appeared', () => {
    let state = runnerOnFirst()
    const groups = choices(state).courtesy_runner
    expect(groups.map(group => group.title)).toEqual(['For #1 Player 1 (pitcher) on first'])
    expect(groups[0].options.map(entry => entry.label)).toEqual(['#10 Player 10', '#11 Player 11', '#12 Player 12'])
    state = sub(state, groups[0].options[0].substitution)
    expect(projection(state).bases.first?.runnerId).toBe('t10')
    expect(projection(state).lineups.tracked.battingOrder).toContain('t1')
    expect(baseballTrackedLineupView(sportOf(state)).bench.find(entry => entry.id === 't10')).toMatchObject({
      status: 'courtesy_runner',
    })
  })

  it('an open position after a pinch hitter can be filled by the pinch hitter, a sub, or the returning starter', () => {
    const state = openCatcher()
    const view = baseballTrackedLineupView(sportOf(state))
    expect(view.openPositions).toEqual(['C'])
    const catcher = choices(state).defensive.find(group => group.title === 'C (open)')!
    expect(catcher.options.map(entry => entry.label)).toEqual([
      '#10 Player 10 (already batting)',
      '#2 Player 2 (re-entry) for #10 Player 10',
      '#11 Player 11 for #10 Player 10',
      '#12 Player 12 for #10 Player 10',
    ])
    const returned = sub(state, catcher.options[1].substitution)
    const lineup = projection(returned).lineups.tracked
    expect(lineup.defense['2']).toBe('t2')
    expect(lineup.reenteredIds).toEqual(['t2'])
    // The starter may not come back a second time.
    expect(baseballCanEnter(sportOf(returned), 't2', 1)).toBe(false)
  })

  it('never offers a returning starter for another batting slot', () => {
    const state = openCatcher()
    const sport = sportOf(state)
    // t2 started 2nd; the pitcher bats 1st, so t2 cannot replace the pitcher.
    expect(baseballPitchingChangeOptions(sport).bench.map(entry => entry.incomingId)).toEqual(['t11', 't12'])
    const firstBase = choices(state).defensive.find(group => group.key === 'def:3')!
    expect(firstBase.options.map(entry => entry.substitution)).not.toContainEqual(
      expect.objectContaining({ incomingId: 't2' })
    )
  })

  it('position switch swaps two fielders or moves one to an open spot', () => {
    let state = startedGame()
    const swap = option(state, 'position_change', summary => summary[0] === '#6 Player 6 moves from SS to 2B.')
    expect(swap.summary).toEqual([
      '#6 Player 6 moves from SS to 2B.',
      '#4 Player 4 moves from 2B to SS.',
      'Batting slots do not change.',
    ])
    state = sub(state, swap.substitution)
    expect(projection(state).lineups.tracked.defense).toMatchObject({ '4': 't6', '6': 't4' })
  })

  it('survives reload', () => {
    let state = openCatcher()
    state = sub(state, choices(state).defensive.find(group => group.title === 'C (open)')!.options[0].substitution)
    const reloaded = normalizeBaseballSportGameState(JSON.parse(JSON.stringify(state.sportGameState)))
    expect(reloaded?.projection.lineups.tracked).toEqual(projection(state).lineups.tracked)
  })

  it('offers nothing while a game ending is pending or before the start', () => {
    const pregame = { ...startedGame() }
    const sport = sportOf(pregame)
    const notStarted = { ...sport, projection: { ...sport.projection, status: 'pregame' as const } }
    expect(baseballAvailableSubstitutionKinds(baseballSubstitutionChoices(notStarted))).toEqual([])
    const pending = { ...sport, projection: { ...sport.projection, pendingEnd: 'walk_off' as const } }
    expect(baseballAvailableSubstitutionKinds(baseballSubstitutionChoices(pending))).toEqual([])
  })
})

describe('Baseball lineup view', () => {
  it('shows the order, positions, the batter, hands and the bench', () => {
    const state = runnerOnFirst(dhSetup())
    const view = baseballTrackedLineupView(sportOf(state))
    expect(view.cards[0]).toMatchObject({ slot: 1, id: 't10', position: 'DH', bats: 'R', status: null })
    expect(view.cards[1]).toMatchObject({ slot: 2, id: 't2', position: 'C', status: 'batting' })
    expect(view.cards[2]).toMatchObject({ status: 'up_next' })
    expect(view.defense[0]).toMatchObject({ code: 'P', id: 't1', doesNotBat: true })
    expect(view.bench.map(entry => [entry.id, entry.status])).toEqual([['t11', 'available'], ['t12', 'available']])
    expect(baseballBatterHand(sportOf(state))).toBe('R')
    // A pinch hitter in a DH game has no position until taking the field; only the DH slot reads DH.
    const pinched = sub(state, { kind: 'pinch_hitter', incomingId: 't11', outgoingId: 't2' })
    expect(baseballTrackedLineupView(sportOf(pinched)).cards[1]).toMatchObject({ id: 't11', position: 'No position' })
  })

  it('notes who left, who may return and who replaced a starter', () => {
    let state = runnerOnFirst(baseballSetup({ rules: { reentry: 'none' } }))
    state = sub(state, { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't2' })
    const view = baseballTrackedLineupView(sportOf(state))
    expect(view.cards[1]).toMatchObject({ id: 't10', position: 'No position', replaced: '#2 Player 2' })
    expect(view.bench.find(entry => entry.id === 't2')).toEqual({
      id: 't2',
      name: '#2 Player 2',
      status: 'out',
      note: 'Out of the game; cannot re-enter.',
    })

    let reentry = openCatcher()
    expect(baseballTrackedLineupView(sportOf(reentry)).bench.find(entry => entry.id === 't2')?.note).toBe(
      'Left the game; may re-enter once, in the 2nd slot.'
    )
    reentry = sub(reentry, { kind: 'defensive', position: 2, incomingId: 't2', outgoingId: 't10' })
    expect(baseballTrackedLineupView(sportOf(reentry)).bench.find(entry => entry.id === 't10')?.status).toBe('out')
  })

  it('shows the opponent slots, the batter now and the pitcher', () => {
    const state = startedGame()
    const view = baseballOpponentLineupView(sportOf(state))
    expect(view.slots[0]).toMatchObject({ slot: 1, name: 'Batter 1', status: 'batting', bats: null })
    expect(view.pitcher).toEqual({ id: 'opp-p1', name: '#21 Starter', throws: 'R' })
  })
})

describe('Baseball Lineup tab components', () => {
  it('renders the lineup with open positions, the bench and the opponent pitcher', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { default: BaseballLineupPanel } = await import('../../components/baseball/BaseballLineupPanel')
    const sport = sportOf(openCatcher())
    const html = renderToStaticMarkup(createElement(BaseballLineupPanel, {
      tracked: baseballTrackedLineupView(sport),
      opponent: baseballOpponentLineupView(sport),
      names: { tracked: 'Aces', opponent: 'Visitors' },
      canChange: true,
      substituteHint: null,
      onSubstitute: () => {},
      onOpponentPitchingChange: () => {},
      onSelectPlayer: () => {},
      onEditOpponentSlot: () => {},
    }))
    expect(html).toContain('Open: C.')
    expect(html).toContain('Left the game; may re-enter once, in the 2nd slot.')
    expect(html).toContain('Pitching: #21 Starter')
    expect(html).toContain('throws R')
  })

  it('renders the substitution summary once a choice is made', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { default: BaseballSubstitutionSheet } = await import('../../components/baseball/BaseballSubstitutionSheet')
    const state = runnerOnFirst()
    const all = choices(state)
    const target = all.pinch_hitter[0].options[0]
    const html = renderToStaticMarkup(createElement(BaseballSubstitutionSheet, {
      teamName: 'Aces',
      choices: all,
      draft: { kind: 'pinch_hitter', groupKey: null, optionKey: target.key },
      onChange: () => {},
      onPitchingChange: null,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
    }))
    expect(html).toContain('Pinch hitter')
    expect(html).toContain('#10 Player 10 pinch-hits for #2 Player 2, batting 2nd.')
    expect(html).not.toContain('Double switch</button>')
  })

  it('shows the starter a substitute replaced in the rendered player details', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { default: BaseballPlayerDetailSheet } = await import('../../components/baseball/BaseballPlayerDetailSheet')
    const state = sub(runnerOnFirst(), { kind: 'pinch_hitter', incomingId: 't10', outgoingId: 't2' })
    const detail = baseballPlayerGameDetail(sportOf(state), 't10')!
    expect(detail.replaced).toBe('Replaced #2 Player 2 in the 2nd slot.')
    const html = renderToStaticMarkup(createElement(BaseballPlayerDetailSheet, { detail, onClose: () => {} }))
    expect(html).toContain('Replaced #2 Player 2 in the 2nd slot.')
    expect(baseballPlayerGameDetail(sportOf(state), 't1')!.replaced).toBeNull()
  })

  it('describes a player game and the batter hand', () => {
    let state = runnerOnFirst()
    const detail = baseballPlayerGameDetail(sportOf(state), 't1')!
    expect(detail.role).toBe('Batting 1st · P · Bats R, throws R')
    expect(detail.lines).toEqual(['Batting: 0 for 0, 1 BB (1 PA)', 'Pitching: 1.0 IP, 9 pitches, 0 H, 0 R, 0 ER, 0 BB, 3 K'])
    state = expectOk(substituteBaseball(state, 'opponent', {
      kind: 'opponent_slot', slotId: 'o1', label: 'Lefty', number: '7', position: null, bats: 'L',
    }, ctx()))
    expect(baseballOpponentLineupView(sportOf(state)).slots[0]).toMatchObject({ name: '#7 Lefty', bats: 'L' })
  })
})
