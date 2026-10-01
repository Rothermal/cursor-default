import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BaseballDiamond from '../../components/baseball/BaseballDiamond'
import BaseballFielderPicker from '../../components/baseball/BaseballFielderPicker'
import BaseballInPlaySheet from '../../components/baseball/BaseballInPlaySheet'
import BaseballPitchPad from '../../components/baseball/BaseballPitchPad'
import BaseballQuickPlateAppearance from '../../components/baseball/BaseballQuickPlateAppearance'
import BaseballRunnerResolution from '../../components/baseball/BaseballRunnerResolution'
import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import {
  BASEBALL_IN_PLAY_RESULT_OPTIONS,
  BASEBALL_PITCH_RUNNING_REASONS,
  BASEBALL_PLAY_REASONS,
  BASEBALL_QUICK_RESULT_OPTIONS,
  BASEBALL_RUNNING_REASONS,
  baseballBaserunningPlayOptions,
  baseballCaptureAllowsRbi,
  baseballCaptureFallbackReason,
  baseballCaptureReasons,
  baseballCaptureTerminal,
  baseballDroppedThirdStrikeAvailable,
  baseballFallbackReason,
  baseballPitchTerminal,
  baseballResolutionDestinations,
  baseballResolutionIssues,
  baseballResolutionMovements,
  buildBaseballBattedBall,
  commitBaseballCapture,
  createBaseballResolutionRows,
  cycleBaseballResolutionRow,
  emptyBaseballInPlayDraft,
  proposeBaseballBaserunning,
  proposeBaseballCaptureMovements,
  setBaseballResolutionDestination,
  updateBaseballResolutionDraftRow,
  type BaseballPendingCapture,
  type BaseballResolutionDraft,
  type BaseballResolutionRow,
  type BaseballResolutionTransition,
} from './capture'
import { baseballMovement, baseballSportState } from './commands'
import { baseballDiamondView } from './trackerView'
import type { BaseballBaserunningPlay, BaseballInPlayResult, BaseballPitchResult } from './types'
import { baseballSetup, ctx, pitch, pitches, projection, startedGame, strikeout, walk } from './testFixtures'

const sportOf = (state: GameState) => baseballSportState(state)!
const events = (state: GameState) => (state.eventStream?.events ?? []) as GameEvent[]
const lastEvent = (state: GameState) => events(state)[events(state).length - 1]

function pitchCapture(result: BaseballPitchResult, extra: Partial<Extract<BaseballPendingCapture, { source: 'pitch' }>> = {}): BaseballPendingCapture {
  return { source: 'pitch', result, pitchLocation: null, battedBall: null, droppedThirdStrike: false, ...extra }
}

/** Mirrors the tracker: propose, optionally edit rows, then commit through the checked command. */
function capture(
  state: GameState,
  pending: BaseballPendingCapture,
  edit?: (rows: BaseballResolutionRow[]) => BaseballResolutionRow[]
): GameState {
  const sport = sportOf(state)
  const proposal = proposeBaseballCaptureMovements(sport, pending)
  const terminal = baseballCaptureTerminal(sport, pending)
  let rows = createBaseballResolutionRows(sport.projection, proposal, terminal !== null, baseballFallbackReason(terminal))
  if (edit) rows = edit(rows)
  expect({ rows, issues: baseballResolutionIssues(rows) }).toEqual({ rows, issues: {} })
  const result = commitBaseballCapture(state, pending, baseballResolutionMovements(rows), ctx())
  if (!result.ok) throw new Error(result.message)
  return result.state
}

const move = (rows: BaseballResolutionRow[], from: BaseballResolutionRow['from'], to: BaseballResolutionRow['to'], patch: Partial<BaseballResolutionRow> = {}) =>
  rows.map(row => (row.from === from ? { ...setBaseballResolutionDestination(row, to), ...patch } : row))

function toCount(state: GameState, balls: number, strikes: number): GameState {
  let next = state
  for (let index = 0; index < balls; index += 1) next = pitch(next, { result: 'ball' })
  for (let index = 0; index < strikes; index += 1) next = pitch(next, { result: 'called_strike' })
  return next
}

describe('Baseball pitch terminal detection', () => {
  it('matches the projector for every pitch result', () => {
    const results: BaseballPitchResult[] = [
      'ball', 'called_strike', 'swinging_strike', 'foul', 'foul_tip', 'foul_bunt',
      'missed_bunt', 'in_play', 'hit_by_pitch', 'intentional_ball', 'pitchout',
    ]
    for (const [balls, strikes] of [[0, 0], [3, 0], [0, 2], [3, 2]]) {
      const state = toCount(startedGame(), balls, strikes)
      const sport = sportOf(state)
      for (const result of results) {
        const terminal = baseballPitchTerminal(sport.projection, sport.setup.rulesSnapshot, result)
        const before = projection(state).plateAppearances.length
        const after = capture(state, pitchCapture(result, result === 'in_play'
          ? { battedBall: { inPlay: { battedBallType: 'ground', result: 'single', fielders: [], errorBy: null, insideThePark: false }, location: null } }
          : {}))
        expect(projection(after).plateAppearances.length - before, `${result} at ${balls}-${strikes}`).toBe(terminal ? 1 : 0)
      }
    }
  })

  it('treats a two-strike foul as a strikeout only when the rules say so', () => {
    const slowpitch = startedGame(baseballSetup({ profile: 'softball_slowpitch' }))
    const sport = sportOf(slowpitch)
    // Slowpitch starts at 1-1, so one more strike brings two.
    const twoStrikes = pitch(slowpitch, { result: 'called_strike' })
    expect(baseballPitchTerminal(projection(twoStrikes), sport.setup.rulesSnapshot, 'foul'))
      .toBe(sport.setup.rulesSnapshot.twoStrikeFoulIsOut ? 'strikeout' : null)
    const standard = toCount(startedGame(), 0, 2)
    expect(baseballPitchTerminal(projection(standard), sportOf(standard).setup.rulesSnapshot, 'foul')).toBeNull()
  })
})

describe('Baseball pitch capture', () => {
  it('writes a non-terminal pitch with its optional location and no movements', () => {
    const state = capture(startedGame(), pitchCapture('ball', { pitchLocation: { x: 1.2, y: 0.4 } }))
    expect(lastEvent(state).payload).toMatchObject({ result: 'ball', pitchLocation: { x: 1.2, y: 0.4 }, movements: [] })
    const noLocation = capture(startedGame(), pitchCapture('called_strike'))
    expect(lastEvent(noLocation).payload).toMatchObject({ pitchLocation: null })
  })

  it('completes ball four, HBP and strike three with the proposed movements', () => {
    let state = capture(toCount(walk(startedGame()), 3, 0), pitchCapture('ball'))
    expect(projection(state).bases.first).not.toBeNull()
    expect(projection(state).bases.second).not.toBeNull()
    state = capture(state, pitchCapture('hit_by_pitch'))
    expect(projection(state).bases.third).not.toBeNull()
    state = capture(toCount(state, 0, 2), pitchCapture('swinging_strike'))
    expect(projection(state).outs).toBe(1)
    expect(projection(state).fieldingLines).toBeDefined()
  })

  it('offers a dropped third strike only when the rules and bases allow it', () => {
    const open = toCount(startedGame(), 0, 2)
    expect(baseballDroppedThirdStrikeAvailable(sportOf(open))).toBe(true)
    const occupied = toCount(walk(startedGame()), 0, 2)
    expect(baseballDroppedThirdStrikeAvailable(sportOf(occupied))).toBe(false)
    const twoOuts = toCount(walk(strikeout(strikeout(startedGame()))), 0, 2)
    expect(baseballDroppedThirdStrikeAvailable(sportOf(twoOuts))).toBe(true)
    const youth = toCount(startedGame(baseballSetup({ rules: { droppedThirdStrike: false } })), 0, 2)
    expect(baseballDroppedThirdStrikeAvailable(sportOf(youth))).toBe(false)
  })

  it('records a dropped third strike with the batter reaching and forced runners with two outs', () => {
    let state = capture(toCount(startedGame(), 0, 2), pitchCapture('swinging_strike', { droppedThirdStrike: true }))
    expect(projection(state).bases.first).not.toBeNull()
    expect(projection(state).outs).toBe(0)
    state = strikeout(strikeout(state))
    const runner = projection(state).bases.first!.runnerId
    state = capture(toCount(state, 0, 2), pitchCapture('swinging_strike', { droppedThirdStrike: true }))
    expect(projection(state).bases.second?.runnerId).toBe(runner)
  })
})

describe('Baseball "Runners moved" captures are one event', () => {
  it('ball four plus a wild pitch moving another runner two bases', () => {
    let state = toCount(walk(startedGame()), 3, 0)
    const runner = projection(state).bases.first!.runnerId
    const count = events(state).length
    state = capture(state, pitchCapture('ball'), rows => move(rows, 'first', 'third', { reason: 'wild_pitch' }))
    expect(events(state).length).toBe(count + 1)
    expect(projection(state).bases.third?.runnerId).toBe(runner)
  })

  it('HBP plus a passed ball', () => {
    let state = walk(startedGame())
    state = pitch(state, { result: 'ball', movements: [baseballMovement(projection(state).bases.first!.runnerId, 'first', 'second', 'stolen_base')] })
    const runner = projection(state).bases.second!.runnerId
    state = capture(state, pitchCapture('hit_by_pitch'), rows => move(rows, 'second', 'third', { reason: 'passed_ball' }))
    expect(projection(state).bases.third?.runnerId).toBe(runner)
    expect(projection(state).bases.first).not.toBeNull()
  })

  it('a caught strikeout plus caught stealing for the third out moves to the next half', () => {
    let state = toCount(walk(strikeout(startedGame())), 0, 2)
    expect(projection(state).half).toBe('top')
    const count = events(state).length
    state = capture(state, pitchCapture('swinging_strike'), rows =>
      move(rows, 'first', 'out', { reason: 'caught_stealing', fielders: [2, 6] }))
    expect(events(state).length).toBe(count + 1)
    expect(projection(state).half).toBe('bottom')
    expect(projection(state).outs).toBe(0)
  })

  it('a dropped third strike plus a wild-pitch advance', () => {
    let state = walk(startedGame())
    state = pitch(state, { result: 'ball', movements: [baseballMovement(projection(state).bases.first!.runnerId, 'first', 'second', 'stolen_base')] })
    state = toCount(state, 0, 2)
    const runner = projection(state).bases.second!.runnerId
    state = capture(state, pitchCapture('swinging_strike', { droppedThirdStrike: true }), rows =>
      move(rows, 'second', 'third', { reason: 'wild_pitch' }))
    expect(projection(state).bases.third?.runnerId).toBe(runner)
    expect(projection(state).bases.first).not.toBeNull()
  })

  it('a forced winning run on ball four plus a wild pitch sets pendingEnd only after the whole pitch', () => {
    let state = startedGame(baseballSetup({ rules: { scheduledInnings: 1 } }))
    state = strikeout(strikeout(strikeout(state)))
    state = toCount(walk(walk(walk(state))), 3, 0)
    expect(projection(state).pendingEnd).toBeNull()
    state = capture(state, pitchCapture('ball'), rows => move(rows, 'second', 'home', { reason: 'wild_pitch' }))
    expect(projection(state).pendingEnd).toBe('walk_off')
    expect(projection(state).score.tracked).toBe(2)
  })

  it('a non-terminal pitch with a steal', () => {
    let state = walk(startedGame())
    const runner = projection(state).bases.first!.runnerId
    state = capture(state, pitchCapture('called_strike'), rows => move(rows, 'first', 'second', { reason: 'stolen_base' }))
    expect(projection(state).bases.second?.runnerId).toBe(runner)
    expect(projection(state).strikes).toBe(1)
  })

  it('keeps the draft when the engine rejects it', () => {
    const state = toCount(walk(startedGame()), 3, 0)
    const sport = sportOf(state)
    const pending = pitchCapture('ball')
    const rows = createBaseballResolutionRows(sport.projection, [], true, 'wild_pitch')
    // The forced runner was left in place, which the engine rejects.
    const batterOnly = rows.map(row => (row.from === 'batter' ? setBaseballResolutionDestination({ ...row, reason: 'awarded' }, 'first') : row))
    const result = commitBaseballCapture(state, pending, baseballResolutionMovements(batterOnly), ctx())
    expect(result.ok).toBe(false)
    expect(result.state).toBe(state)
  })
})

describe('Baseball in-play sheet', () => {
  const setups: Record<BaseballInPlayResult, (state: GameState) => GameState> = {
    single: state => state,
    double: state => state,
    triple: state => state,
    home_run: state => state,
    ground_rule_double: state => state,
    out: state => state,
    error: state => state,
    fielders_choice: state => walk(state),
    sacrifice_bunt: state => walk(state),
    sacrifice_fly: state => {
      let next = walk(state)
      next = pitch(next, { result: 'ball', movements: [baseballMovement(projection(next).bases.first!.runnerId, 'first', 'third', 'wild_pitch')] })
      return next
    },
    double_play: state => walk(state),
    triple_play: state => walk(walk(state)),
  }

  it('turns every result chip into a valid event from a fresh count', () => {
    for (const option of BASEBALL_IN_PLAY_RESULT_OPTIONS) {
      const state = setups[option.result](startedGame())
      const draft = {
        ...emptyBaseballInPlayDraft(),
        result: option.result,
        fielders: option.result === 'double_play' ? [6, 4, 3] : option.result === 'triple_play' ? [5, 4, 3] : [6],
        errorBy: option.result === 'error' ? 6 : null,
      }
      const built = buildBaseballBattedBall(draft)
      if (!built.ok) throw new Error(built.message)
      const before = projection(state).plateAppearances.length
      // Proposed runner outs on a double or triple play still need the recorder's fielders.
      const after = capture(state, pitchCapture('in_play', { battedBall: built.battedBall }), rows =>
        rows.map(row => (row.to === 'out' && row.fielders.length === 0 ? { ...row, fielders: [4] } : row))
      )
      expect(projection(after).plateAppearances.length, option.result).toBe(before + 1)
    }
  })

  it('blocks an out without fielders and an error without the erring fielder', () => {
    expect(buildBaseballBattedBall({ ...emptyBaseballInPlayDraft(), result: 'out' })).toMatchObject({ ok: false })
    expect(buildBaseballBattedBall({ ...emptyBaseballInPlayDraft(), result: 'error' })).toMatchObject({ ok: false })
    expect(buildBaseballBattedBall({ ...emptyBaseballInPlayDraft(), result: 'single' })).toMatchObject({ ok: true })
    expect(buildBaseballBattedBall(emptyBaseballInPlayDraft())).toMatchObject({ ok: false })
  })

  it('stores a skipped spray location as null and a placed one in the diamond frame', () => {
    const skipped = buildBaseballBattedBall({ ...emptyBaseballInPlayDraft(), result: 'single' })
    if (!skipped.ok) throw new Error(skipped.message)
    let state = capture(startedGame(), pitchCapture('in_play', { battedBall: skipped.battedBall }))
    expect(lastEvent(state).location).toBeNull()
    const placed = buildBaseballBattedBall({ ...emptyBaseballInPlayDraft(), result: 'single', location: { x: 0.3, y: 0.4 } })
    if (!placed.ok) throw new Error(placed.message)
    state = capture(state, pitchCapture('in_play', { battedBall: placed.battedBall }))
    expect(lastEvent(state).location).toEqual({ x: 0.3, y: 0.4, attackingDirection: 'unknown' })
  })

  it('only marks inside-the-park on a home run', () => {
    const built = buildBaseballBattedBall({ ...emptyBaseballInPlayDraft(), result: 'double', insideThePark: true })
    expect(built.ok && built.battedBall.inPlay.insideThePark).toBe(false)
  })
})

describe('Baseball runner resolution rows', () => {
  it('cycles destinations from stay through the bases, home and out', () => {
    expect(baseballResolutionDestinations('first')).toEqual(['stay', 'second', 'third', 'home', 'out'])
    expect(baseballResolutionDestinations('batter')).toEqual(['first', 'second', 'third', 'home', 'out'])
    let row: BaseballResolutionRow = { runnerId: 'r', from: 'third', to: 'stay', reason: 'wild_pitch', fielders: [], errorBy: null }
    row = cycleBaseballResolutionRow(row)
    expect(row.to).toBe('home')
    row = cycleBaseballResolutionRow(row)
    expect(row.to).toBe('out')
    row = cycleBaseballResolutionRow({ ...row, fielders: [2, 5] })
    expect(row).toMatchObject({ to: 'stay', fielders: [] })
  })

  it('flags passing runners, two runners on a base and outs without fielders', () => {
    const rows: BaseballResolutionRow[] = [
      { runnerId: 'lead', from: 'second', to: 'stay', reason: 'on_play', fielders: [], errorBy: null },
      { runnerId: 'trail', from: 'first', to: 'third', reason: 'on_play', fielders: [], errorBy: null },
      { runnerId: 'batter', from: 'batter', to: 'second', reason: 'on_play', fielders: [], errorBy: null },
    ]
    expect(baseballResolutionIssues(rows)).toEqual({ trail: 'Passes the runner ahead.', batter: 'Two runners on one base.' })
    const out = [{ ...rows[0], to: 'out' as const }]
    expect(baseballResolutionIssues(out)).toEqual({ lead: 'Tap the fielders for this out.' })
    const home = rows.map(row => ({ ...row, to: 'home' as const }))
    expect(baseballResolutionIssues(home)).toEqual({})
  })

  it('omits runners who stay and lists the lead runner first', () => {
    const state = walk(walk(startedGame()))
    const rows = createBaseballResolutionRows(projection(state), [], true, 'on_play')
    expect(rows.map(row => row.from)).toEqual(['second', 'first', 'batter'])
    expect(baseballResolutionMovements(rows)).toEqual([])
  })
})

describe('Baseball Quick PA', () => {
  it('records every result from a fresh plate appearance', () => {
    for (const option of BASEBALL_QUICK_RESULT_OPTIONS) {
      const single = { inPlay: { battedBallType: 'ground' as const, result: 'single' as const, fielders: [], errorBy: null, insideThePark: false }, location: null }
      const pending: BaseballPendingCapture = {
        source: 'quick',
        result: option.result,
        battedBall: option.result === 'in_play' ? single : null,
        finalBalls: option.result === 'walk' ? 4 : null,
        finalStrikes: option.result === 'walk' ? 2 : null,
      }
      const state = capture(startedGame(), pending)
      expect(lastEvent(state).eventType, option.result).toBe('baseball.plate_appearance')
      expect(projection(state).plateAppearances).toHaveLength(1)
    }
  })

  it('is refused after a pitch was tracked for this batter', () => {
    const state = pitches(startedGame(), 'ball')
    const pending: BaseballPendingCapture = { source: 'quick', result: 'walk', battedBall: null, finalBalls: null, finalStrikes: null }
    const result = commitBaseballCapture(state, pending, proposeBaseballCaptureMovements(sportOf(state), pending), ctx())
    expect(result.ok).toBe(false)
  })
})

describe('Baseball capture panels render', () => {
  const noop = () => {}

  it('enables pad results and shows the Runners moved chip as a toggle', () => {
    const markup = renderToStaticMarkup(createElement(BaseballPitchPad, {
      showZone: true,
      pendingLocation: null,
      onLocation: noop,
      onResult: noop,
      runnersMoved: { armed: true, onToggle: noop },
    }))
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('Runners moved: on')
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>Ball</)
  })

  it('keeps pad results disabled with the reason when play is blocked', () => {
    const markup = renderToStaticMarkup(createElement(BaseballPitchPad, {
      showZone: false,
      pendingLocation: null,
      onLocation: noop,
      disabledReason: 'The game can end on this play.',
      runnersMoved: { armed: false, onToggle: noop },
    }))
    expect(markup).toContain('The game can end on this play.')
    expect(markup).not.toContain('Runners moved')
  })

  it('shows every in-play result, the error picker and inside-the-park only when they apply', () => {
    const base = { onChange: noop, trackLocation: true, fielderCount: 9, onCancel: noop, onContinue: noop }
    const error = renderToStaticMarkup(createElement(BaseballInPlaySheet, {
      ...base,
      draft: { ...emptyBaseballInPlayDraft(), result: 'error' },
    }))
    for (const option of BASEBALL_IN_PLAY_RESULT_OPTIONS) expect(error).toContain(`>${option.label.replace("'", '&#x27;')}<`)
    expect(error).toContain('Error by')
    expect(error).toContain('Choose the fielder who made the error.')
    expect(error).not.toContain('Inside the park')
    const homer = renderToStaticMarkup(createElement(BaseballInPlaySheet, {
      ...base,
      trackLocation: false,
      draft: { ...emptyBaseballInPlayDraft(), result: 'home_run' },
    }))
    expect(homer).toContain('Inside the park')
    expect(homer).not.toContain('Tap the field where')
  })

  it('shows row issues, the engine error and the fielder picker for the active out', () => {
    const rows: BaseballResolutionRow[] = [
      { runnerId: 'lead', from: 'second', to: 'out', reason: 'caught_stealing', fielders: [], errorBy: null },
      { runnerId: 'batter', from: 'batter', to: 'out', reason: 'on_play', fielders: [2], errorBy: null },
    ]
    const markup = renderToStaticMarkup(createElement(BaseballRunnerResolution, {
      title: 'Runners on this pitch',
      draft: { rows, activeRunnerId: 'lead' },
      onChange: noop,
      names: { lead: '#4 Lee', batter: '#12 Garcia' },
      reasons: BASEBALL_PLAY_REASONS,
      allowRbi: true,
      fielderCount: 9,
      error: 'The engine said no.',
      onCancel: noop,
      onConfirm: noop,
    }))
    expect(markup).toContain('#4 Lee')
    expect(markup).toContain('Tap the fielders for this out.')
    expect(markup).toContain('Fielders on this out')
    expect(markup).toContain('The engine said no.')
    // The batter's out is not active, so it shows its sequence as a button.
    expect(markup).toContain('>2<')
  })

  it('lists every Quick PA result and bounds the final count by the rules', () => {
    const markup = renderToStaticMarkup(createElement(BaseballQuickPlateAppearance, {
      ballsForWalk: 4,
      strikesForStrikeout: 3,
      onCancel: noop,
      onContinue: noop,
    }))
    for (const option of BASEBALL_QUICK_RESULT_OPTIONS) expect(markup).toContain(`>${option.label.replace("'", '&#x27;')}<`)
    expect(markup.match(/aria-label="Final balls"[\s\S]*?<\/div><\/div>/)?.[0].match(/<button/g)).toHaveLength(5)
  })

  it('shows the batter pencil only when a label can be edited', () => {
    const sport = sportOf(startedGame())
    const props = { view: baseballDiamondView(sport), battingLabel: 'Away', fieldingLabel: 'Home' }
    expect(renderToStaticMarkup(createElement(BaseballDiamond, props))).not.toContain('Edit label for')
    expect(renderToStaticMarkup(createElement(BaseballDiamond, { ...props, onEditBatter: noop }))).toContain('Edit label for')
  })
})

/** Every element in a rendered tree, without expanding child components. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const props = node.props as { children?: ReactNode }
  return [node, ...elements(props.children)]
}

describe('Baseball runner resolution interactions', () => {
  /**
   * Drives the real component handlers the way the tracker does: every transition an
   * interaction emits is applied to the same previous draft in order, as batched React
   * functional updates would be.
   */
  function interact(sport: ReturnType<typeof sportOf>, draft: BaseballResolutionDraft, act: (tree: ReactElement[]) => void) {
    const emitted: BaseballResolutionTransition[] = []
    const tree = elements(BaseballRunnerResolution({
      title: 'Runners',
      draft,
      onChange: transition => emitted.push(transition),
      names: {},
      reasons: BASEBALL_PITCH_RUNNING_REASONS,
      allowRbi: false,
      fielderCount: sport.setup.rulesSnapshot.defensivePlayers,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
    }))
    act(tree)
    return emitted.reduce((current, transition) => transition(current), draft)
  }
  const chooseOut = (runnerId: string) => (tree: ReactElement[]) => {
    const select = tree.find(element => (element.props as { id?: string }).id === `destination-${runnerId}`)!
    ;(select.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: 'out' } })
  }
  const pickFielders = (fielders: number[]) => (tree: ReactElement[]) => {
    const picker = tree.find(element => element.type === BaseballFielderPicker)!
    ;(picker.props as { onChange: (sequence: number[]) => void }).onChange(fielders)
  }
  const openDraft = (state: GameState, pending: BaseballPendingCapture): BaseballResolutionDraft => {
    const sport = sportOf(state)
    const terminal = baseballCaptureTerminal(sport, pending)
    return {
      rows: createBaseballResolutionRows(sport.projection, proposeBaseballCaptureMovements(sport, pending), terminal !== null, baseballFallbackReason(terminal)),
      activeRunnerId: null,
    }
  }

  it('keeps Out on a base runner, takes its fielders and writes the caught stealing', () => {
    const state = walk(startedGame())
    const sport = sportOf(state)
    const runner = sport.projection.bases.first!.runnerId
    const pending = pitchCapture('ball')
    let draft = interact(sport, openDraft(state, pending), chooseOut(runner))
    expect(draft.rows.find(row => row.runnerId === runner)).toMatchObject({ to: 'out' })
    expect(draft.activeRunnerId).toBe(runner)
    draft = interact(sport, draft, pickFielders([2, 6]))
    draft = { ...draft, rows: draft.rows.map(row => ({ ...row, reason: 'caught_stealing' as const })) }
    expect(baseballResolutionIssues(draft.rows)).toEqual({})
    const result = commitBaseballCapture(state, pending, baseballResolutionMovements(draft.rows), ctx())
    if (!result.ok) throw new Error(result.message)
    expect(projection(result.state)).toMatchObject({ outs: 1, balls: 1, bases: { first: null } })
  })

  it('keeps Out on a dropped-third-strike batter thrown out at first', () => {
    const state = toCount(startedGame(), 0, 2)
    const sport = sportOf(state)
    const batter = sport.projection.currentBatterId!
    const pending = pitchCapture('swinging_strike', { droppedThirdStrike: true })
    let draft = interact(sport, openDraft(state, pending), chooseOut(batter))
    expect(draft.rows.find(row => row.runnerId === batter)).toMatchObject({ to: 'out' })
    draft = interact(sport, draft, pickFielders([2, 3]))
    const result = commitBaseballCapture(state, pending, baseballResolutionMovements(draft.rows), ctx())
    if (!result.ok) throw new Error(result.message)
    expect(projection(result.state)).toMatchObject({ outs: 1, bases: { first: null } })
  })
})

describe('Baseball runner plays between pitches', () => {
  const runnerCapture = (play: BaseballBaserunningPlay, runnerId: string): BaseballPendingCapture => ({ source: 'baserunning', play, runnerId })
  /** Mirrors the tracker's runner menu: preset rows, optional edits, one checked baserunning event. */
  function runnerPlay(
    state: GameState,
    play: BaseballBaserunningPlay,
    runnerId: string,
    edit?: (rows: BaseballResolutionRow[]) => BaseballResolutionRow[]
  ): GameState {
    const sport = sportOf(state)
    const pending = runnerCapture(play, runnerId)
    expect(baseballCaptureTerminal(sport, pending)).toBeNull()
    let rows = createBaseballResolutionRows(sport.projection, proposeBaseballCaptureMovements(sport, pending), false, baseballCaptureFallbackReason(sport, pending))
    if (edit) rows = edit(rows)
    expect(baseballResolutionIssues(rows)).toEqual({})
    const result = commitBaseballCapture(state, pending, baseballResolutionMovements(rows, { rbi: baseballCaptureAllowsRbi(sport, pending) }), ctx())
    if (!result.ok) throw new Error(result.message)
    return result.state
  }
  const firstAndThird = () => {
    let state = walk(startedGame())
    state = pitch(state, { result: 'ball', movements: [baseballMovement(projection(state).bases.first!.runnerId, 'first', 'third', 'wild_pitch')] })
    return walk(state)
  }

  it('offers steals only with stealing and a balk only when balks are called', () => {
    const plays = (rules: Partial<Parameters<typeof baseballSetup>[0] & object>['rules']) =>
      baseballBaserunningPlayOptions(baseballSetup({ rules }).rulesSnapshot).map(option => option.play)
    expect(plays({})).toContain('stolen_base')
    expect(plays({})).toContain('balk')
    const slowpitch = baseballBaserunningPlayOptions(baseballSetup({ profile: 'softball_slowpitch' }).rulesSnapshot).map(option => option.play)
    expect(slowpitch).not.toContain('stolen_base')
    expect(slowpitch).not.toContain('caught_stealing')
    expect(slowpitch).not.toContain('defensive_indifference')
    expect(slowpitch).not.toContain('balk')
    expect(slowpitch).toEqual(expect.arrayContaining(['pickoff', 'wild_pitch', 'passed_ball', 'error', 'appeal', 'other']))
  })

  it('offers the engine running reasons, without stolen base when stealing is off', () => {
    const state = walk(startedGame())
    const runner = projection(state).bases.first!.runnerId
    expect(baseballCaptureReasons(sportOf(state), runnerCapture('other', runner))).toEqual(BASEBALL_RUNNING_REASONS)
    const slow = walk(startedGame(baseballSetup({ profile: 'softball_slowpitch' })))
    const slowRunner = projection(slow).bases.first!.runnerId
    expect(baseballCaptureReasons(sportOf(slow), runnerCapture('other', slowRunner))).not.toContain('stolen_base')
  })

  it('presets the tapped runner for a steal or pickoff and every runner for a wild pitch or balk', () => {
    const state = firstAndThird()
    const bases = projection(state).bases
    const first = bases.first!.runnerId
    const third = bases.third!.runnerId
    expect(proposeBaseballBaserunning(projection(state), 'stolen_base', first)).toEqual([baseballMovement(first, 'first', 'second', 'stolen_base')])
    expect(proposeBaseballBaserunning(projection(state), 'pickoff', third)).toEqual([baseballMovement(third, 'third', 'out', 'pickoff')])
    expect(proposeBaseballBaserunning(projection(state), 'other', first)).toEqual([baseballMovement(first, 'first', 'second', 'awarded')])
    expect(proposeBaseballBaserunning(projection(state), 'balk', first)).toEqual([
      baseballMovement(first, 'first', 'second', 'balk'),
      baseballMovement(third, 'third', 'home', 'balk'),
    ])
  })

  it('records a steal without changing the count', () => {
    let state = pitch(walk(startedGame()), { result: 'ball' })
    const runner = projection(state).bases.first!.runnerId
    const count = events(state).length
    state = runnerPlay(state, 'stolen_base', runner)
    expect(events(state).length).toBe(count + 1)
    expect(lastEvent(state).eventType).toBe('baseball.baserunning')
    expect(projection(state)).toMatchObject({ balls: 1, strikes: 0, bases: { first: null, second: { runnerId: runner } } })
  })

  it('records a double steal as one play', () => {
    let state = firstAndThird()
    const { first, third } = projection(state).bases
    const count = events(state).length
    state = runnerPlay(state, 'stolen_base', first!.runnerId, rows => move(rows, 'third', 'home', { reason: 'stolen_base' }))
    expect(events(state).length).toBe(count + 1)
    expect(projection(state).bases.second?.runnerId).toBe(first!.runnerId)
    expect(projection(state).bases.third).toBeNull()
    expect(projection(state).score.opponent).toBe(1)
    expect(third).not.toBeNull()
  })

  it('records caught stealing and a pickoff with their fielders', () => {
    let state = walk(startedGame())
    state = runnerPlay(state, 'caught_stealing', projection(state).bases.first!.runnerId, rows =>
      rows.map(row => ({ ...row, fielders: [2, 6] })))
    expect(projection(state)).toMatchObject({ outs: 1, bases: { first: null } })
    state = walk(state)
    state = runnerPlay(state, 'pickoff', projection(state).bases.first!.runnerId, rows =>
      rows.map(row => ({ ...row, fielders: [1, 3] })))
    expect(projection(state)).toMatchObject({ outs: 2, bases: { first: null } })
  })

  it('moves every runner up on a wild pitch and scores the runner from third on a balk', () => {
    let state = firstAndThird()
    const { first, third } = projection(state).bases
    state = runnerPlay(state, 'wild_pitch', first!.runnerId)
    expect(projection(state).bases.second?.runnerId).toBe(first!.runnerId)
    expect(projection(state).score.opponent).toBe(1)
    expect(third).not.toBeNull()
    state = runnerPlay(state, 'balk', first!.runnerId)
    expect(projection(state).bases.third?.runnerId).toBe(first!.runnerId)
    expect(projection(state).score.opponent).toBe(1)
  })

  it('stores the erring fielder on an advance and earned/run-counts overrides only for a runner who scores', () => {
    let state = firstAndThird()
    const { first, third } = projection(state).bases
    state = runnerPlay(state, 'error', first!.runnerId, rows =>
      move(rows, 'third', 'home', { reason: 'error', errorBy: 2, earned: true, rbi: false, runCounts: true })
        .map(row => (row.runnerId === first!.runnerId ? { ...row, errorBy: 2 } : row)))
    const movements = (lastEvent(state).payload as { movements: Array<Record<string, unknown>> }).movements
    expect(movements.find(movement => movement.runnerId === third!.runnerId)).toMatchObject({ to: 'home', errorBy: 2, earned: true, rbi: null, runCounts: true })
    expect(movements.find(movement => movement.runnerId === first!.runnerId)).toMatchObject({ to: 'second', errorBy: 2, earned: null, rbi: null, runCounts: null })
  })

  it('clears run overrides when the destination leaves home', () => {
    const state = firstAndThird()
    const third = projection(state).bases.third!.runnerId
    let draft: BaseballResolutionDraft = {
      rows: createBaseballResolutionRows(projection(state), proposeBaseballBaserunning(projection(state), 'other', third), false, 'awarded'),
      activeRunnerId: null,
    }
    draft = updateBaseballResolutionDraftRow(third, { earned: false, rbi: true, runCounts: false })(draft)
    expect(draft.rows.find(row => row.runnerId === third)).toMatchObject({ to: 'home', earned: false, rbi: true, runCounts: false })
    const moved = draft.rows.map(row => (row.runnerId === third ? setBaseballResolutionDestination(row, 'stay') : row))
    expect(moved.find(row => row.runnerId === third)).toMatchObject({ earned: null, rbi: null, runCounts: null })
    expect(baseballResolutionMovements(moved)).toEqual([])
  })

  it('renders the Advanced overrides only for moving rows, with RBI only when it can take effect', () => {
    const state = firstAndThird()
    const { first, third } = projection(state).bases
    const render = (movement: ReturnType<typeof baseballMovement>, allowRbi: boolean) => renderToStaticMarkup(createElement(BaseballRunnerResolution, {
      title: 'Other advance',
      draft: { rows: createBaseballResolutionRows(projection(state), [movement], false, 'awarded'), activeRunnerId: null },
      onChange: () => {},
      names: { [first!.runnerId]: 'First runner', [third!.runnerId]: 'Third runner' },
      reasons: BASEBALL_RUNNING_REASONS,
      allowRbi,
      fielderCount: 9,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
    }))
    const earned = render(baseballMovement(third!.runnerId, 'third', 'home', 'awarded', { earned: false }), false)
    expect(earned.match(/Advanced/g)).toHaveLength(1)
    expect(earned).toContain('Advanced (changed)')
    expect(earned).toContain('<details class="rounded-md border border-line px-2 py-1 text-sm" open="">')
    expect(earned).toContain('Earned run')
    expect(earned).toContain('Run counts')
    expect(earned).toContain('Error by')
    expect(earned).not.toContain('RBI')
    // An RBI value the capture cannot apply is neither shown nor counted as a change.
    const ignored = render(baseballMovement(third!.runnerId, 'third', 'home', 'awarded', { rbi: true }), false)
    expect(ignored).not.toContain('RBI')
    expect(ignored).not.toContain('Advanced (changed)')
    const offered = render(baseballMovement(third!.runnerId, 'third', 'home', 'awarded', { rbi: false }), true)
    expect(offered).toContain('RBI')
    expect(offered).toContain('Advanced (changed)')
  })

  it('offers no RBI override on a runner play or a pitch that continues the plate appearance', () => {
    let state = firstAndThird()
    const third = projection(state).bases.third!.runnerId
    const batter = projection(state).currentBatterId!
    const sport = sportOf(state)
    const pending = runnerCapture('other', third)
    expect(baseballCaptureAllowsRbi(sport, pending)).toBe(false)
    expect(baseballCaptureAllowsRbi(sport, pitchCapture('ball'))).toBe(false)
    const rows = createBaseballResolutionRows(sport.projection, proposeBaseballCaptureMovements(sport, pending), false, 'awarded')
      .map(row => ({ ...row, rbi: true }))
    const movements = baseballResolutionMovements(rows, { rbi: baseballCaptureAllowsRbi(sport, pending) })
    expect(movements[0]).toMatchObject({ to: 'home', rbi: null })
    const result = commitBaseballCapture(state, pending, movements, ctx())
    if (!result.ok) throw new Error(result.message)
    state = result.state
    expect(projection(state).score.opponent).toBe(1)
    expect(projection(state).battingLines[batter]?.rbi ?? 0).toBe(0)
  })

  it('applies an RBI override on the pitch that completes the plate appearance', () => {
    const loaded = () => toCount(walk(walk(walk(startedGame()))), 3, 0)
    const batterOf = (state: GameState) => projection(state).currentBatterId!
    expect(baseballCaptureAllowsRbi(sportOf(loaded()), pitchCapture('ball'))).toBe(true)
    const byRule = loaded()
    const ruleBatter = batterOf(byRule)
    expect(projection(capture(byRule, pitchCapture('ball'))).battingLines[ruleBatter]).toMatchObject({ bb: 1, rbi: 1 })
    const overridden = loaded()
    const batter = batterOf(overridden)
    const after = capture(overridden, pitchCapture('ball'), rows =>
      rows.map(row => (row.to === 'home' ? { ...row, rbi: false } : row)))
    expect(projection(after).score.opponent).toBe(1)
    expect(projection(after).battingLines[batter]).toMatchObject({ bb: 1, rbi: 0 })
  })
})
