/**
 * BSB-6A server parity cases. Builds games with the real Baseball commands and checks the
 * client's final score. With BSB6A_CASES_OUT set, also writes them as JSON for the PostgreSQL
 * harness in supabase/tests/bsb6a (see its README).
 */
import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { GameState } from '../../types'
import { proposeBaseballCaptureMovements } from './capture'
import {
  adjustBaseballScore,
  baseballMovement as mv,
  baseballSportState,
  endBaseballGame,
  endBaseballHalfInning,
  proposeBaseballMovements,
  recordBaseballBaserunning,
  recordBaseballPlateAppearance,
  reopenBaseballGame,
} from './commands'
import { editBaseballPlay, previewBaseballEdit } from './corrections'
import { baseballCaptureEdit, baseballEditTarget } from './edits'
import { undoBaseballPlay } from './recentPlays'
import { baseballSetup, ctx, expectOk, inPlay, pitch, projection, startedGame, strikeout, threeUpThreeDown, walk } from './testFixtures'
import type { BaseballBase, BaseballGameEndOutcome, BaseballInPlay, BaseballProfileId, BaseballRunnerMovement } from './types'
import { baseballActiveEvents } from './units'

const names = { tracked: 'Aces', opponent: 'Visitors' }
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 15, 12, 0, seconds)).toISOString()
const on = (s: GameState, base: BaseballBase) => projection(s).bases[base]!.runnerId
const batter = (s: GameState) => projection(s).currentBatterId!
const hit = (s: GameState, result: BaseballInPlay['result'], movements: BaseballRunnerMovement[]) =>
  pitch(s, { result: 'in_play', inPlay: inPlay(result), movements })
const halves = (s: GameState, count: number) => {
  for (let index = 0; index < count; index++) s = threeUpThreeDown(s)
  return s
}
const end = (s: GameState, outcome: BaseballGameEndOutcome, options: Parameters<typeof endBaseballGame>[3] = {}) =>
  expectOk(endBaseballGame(s, outcome, ctx(), options))
const quickHomer = (s: GameState) =>
  expectOk(recordBaseballPlateAppearance(s, {
    result: 'in_play',
    inPlay: inPlay('home_run', { battedBallType: 'fly' }),
    movements: proposeBaseballMovements(projection(s), 'home_run'),
  }, ctx()))
const game = (options: { profile?: BaseballProfileId; trackedSide?: 'home' | 'away' } = {}) =>
  startedGame(baseballSetup(options))
/** Opponent batting in the top of the first with the bases loaded and `outs` out. */
const basesLoaded = (outs: number) => {
  let s = game()
  for (let index = 0; index < outs; index++) s = strikeout(s)
  return walk(walk(walk(s)))
}
/** Opponent batting in the top of the first with a runner on third and two outs. */
const thirdTwoOut = () => {
  const s = strikeout(strikeout(game()))
  return hit(s, 'triple', [mv(batter(s), 'batter', 'third', 'on_play')])
}

interface Case { name: string; state: GameState; refuse?: boolean }
const cases: Case[] = []
function add(name: string, state: GameState, refuse = false) { cases.push({ name, state, refuse }) }

it('builds the server parity cases with the client scores the server must match', () => {
  add('walk-off double in the bottom of the seventh', (() => {
    let s = walk(halves(game(), 13))
    s = hit(s, 'double', [mv(on(s, 'first'), 'first', 'home', 'on_play'), mv(batter(s), 'batter', 'second', 'on_play')])
    return end(s, 'completed')
  })())
  add('tracked away team wins in regulation', (() => {
    const s = quickHomer(game({ trackedSide: 'away' }))
    return end(halves(s, 14), 'completed')
  })())
  add('third-out force with a runner crossing the plate', (() => {
    const s = basesLoaded(2)
    return end(hit(s, 'fielders_choice', [
      mv(on(s, 'third'), 'third', 'home', 'forced'),
      mv(on(s, 'second'), 'second', 'third', 'forced'),
      mv(on(s, 'first'), 'first', 'out', 'forced', { fielders: [6, 4] }),
      mv(batter(s), 'batter', 'first', 'on_play'),
    ]), 'time_limit')
  })())
  add('batter out before first on the third out', (() => {
    const s = thirdTwoOut()
    return end(hit(s, 'out', [mv(on(s, 'third'), 'third', 'home', 'on_play'), mv(batter(s), 'batter', 'out', 'on_play', { fielders: [6, 3] })]), 'time_limit')
  })())
  add('bases loaded one out: batter retired second, runner from first third', (() => {
    const s = basesLoaded(1)
    return end(hit(s, 'double_play', [
      mv(on(s, 'third'), 'third', 'home', 'on_play'),
      mv(batter(s), 'batter', 'out', 'on_play', { fielders: [3] }),
      mv(on(s, 'first'), 'first', 'out', 'on_play', { fielders: [3, 6] }),
      mv(on(s, 'second'), 'second', 'third', 'on_play'),
    ]), 'time_limit')
  })())
  add('bases loaded one out: runner from first retired second, batter third', (() => {
    const s = basesLoaded(1)
    return end(hit(s, 'double_play', [
      mv(on(s, 'third'), 'third', 'home', 'on_play'),
      mv(on(s, 'first'), 'first', 'out', 'forced', { fielders: [6, 4] }),
      mv(batter(s), 'batter', 'out', 'on_play', { fielders: [4, 3] }),
      mv(on(s, 'second'), 'second', 'third', 'on_play'),
    ]), 'time_limit')
  })())
  add('runner on third two outs: single, runner scores, batter put out', (() => {
    const s = thirdTwoOut()
    return end(hit(s, 'single', [mv(on(s, 'third'), 'third', 'home', 'on_play'), mv(batter(s), 'batter', 'out', 'on_play', { fielders: [8, 4] })]), 'time_limit')
  })())
  add('runner on third two outs: single, batter out listed first', (() => {
    const s = thirdTwoOut()
    return end(hit(s, 'single', [mv(batter(s), 'batter', 'out', 'on_play', { fielders: [8, 4] }), mv(on(s, 'third'), 'third', 'home', 'on_play')]), 'time_limit')
  })())
  add('recorder override counts a run on a force third out', (() => {
    const s = basesLoaded(2)
    return end(hit(s, 'fielders_choice', [
      mv(on(s, 'third'), 'third', 'home', 'forced', { runCounts: true }),
      mv(on(s, 'second'), 'second', 'third', 'forced'),
      mv(on(s, 'first'), 'first', 'out', 'forced', { fielders: [6, 4] }),
      mv(batter(s), 'batter', 'first', 'on_play'),
    ]), 'time_limit')
  })())
  add('recorder override takes away a run', (() => {
    const s = thirdTwoOut()
    return end(hit(s, 'single', [mv(on(s, 'third'), 'third', 'home', 'on_play', { runCounts: false }), mv(batter(s), 'batter', 'first', 'on_play')]), 'time_limit')
  })())
  add('double steal: runner steals home while the trailing runner is caught for the third out', (() => {
    let s = thirdTwoOut()
    s = walk(s)
    return end(expectOk(recordBaseballBaserunning(s, 'stolen_base', [
      mv(on(s, 'third'), 'third', 'home', 'stolen_base'),
      mv(on(s, 'first'), 'first', 'out', 'caught_stealing', { fielders: [2, 6] }),
    ], ctx())), 'time_limit')
  })())
  add('placed runner in extra innings, then a walk-off home run', (() => {
    let s = halves(game({ profile: 'nfhs_softball_fastpitch' }), 14)
    s = hit(s, 'single', [mv(on(s, 'second'), 'second', 'home', 'on_play'), mv(batter(s), 'batter', 'first', 'on_play')])
    s = threeUpThreeDown(s)
    return end(quickHomer(s), 'completed')
  })())
  add('half ended early with runners on, then runs in later halves', (() => {
    let s = walk(walk(game()))
    s = expectOk(endBaseballHalfInning(s, 'time_limit', null, ctx()))
    s = threeUpThreeDown(quickHomer(s))
    s = hit(s, 'single', [mv(batter(s), 'batter', 'first', 'on_play')])
    s = hit(s, 'double', [mv(on(s, 'first'), 'first', 'home', 'on_play'), mv(batter(s), 'batter', 'second', 'on_play')])
    return end(s, 'time_limit')
  })())
  add('slowpitch half closes at five runs', (() => {
    let s = game({ profile: 'softball_slowpitch' })
    for (let index = 0; index < 5; index++) s = quickHomer(s)
    s = quickHomer(quickHomer(s))
    return end(s, 'time_limit')
  })())
  add('run rule reached with grand slams', (() => {
    let s = halves(game(), 9)
    s = quickHomer(walk(walk(walk(s))))
    s = quickHomer(walk(walk(walk(s))))
    s = quickHomer(walk(s))
    return end(s, 'run_rule')
  })())
  add('score adjustments', (() => {
    let s = quickHomer(game())
    s = expectOk(adjustBaseballScore(s, 'tracked', 2, 'Missed runs', ctx()))
    s = expectOk(adjustBaseballScore(s, 'tracked', -1, 'Double count', ctx()))
    s = expectOk(adjustBaseballScore(s, 'opponent', 3, 'Book', ctx()))
    return end(s, 'time_limit')
  })())
  add('removed scoring play', (() => {
    let s = thirdTwoOut()
    s = hit(s, 'single', [mv(on(s, 'third'), 'third', 'home', 'on_play'), mv(batter(s), 'batter', 'first', 'on_play')])
    s = expectOk(undoBaseballPlay(s, at(1)))
    return end(s, 'time_limit')
  })())
  add('revised scoring play: the runner held at third', (() => {
    let s = thirdTwoOut()
    s = hit(s, 'single', [mv(on(s, 'third'), 'third', 'home', 'on_play'), mv(batter(s), 'batter', 'first', 'on_play')])
    const events = baseballActiveEvents(s)
    const target = baseballEditTarget(s, events[events.length - 1]!.id)
    if (!target.ok || target.target.seed.kind !== 'capture') throw new Error('not a capture')
    const proposed = proposeBaseballCaptureMovements(target.target.prefix, target.target.seed.capture)
    expect(proposed.length).toBeGreaterThan(0)
    const held = [mv(target.target.prefix.projection.currentBatterId!, 'batter', 'first', 'on_play')]
    const edit = baseballCaptureEdit(target.target, target.target.seed.capture, held)
    const preview = previewBaseballEdit(s, edit, names)
    if (!preview.ok) throw new Error(preview.message)
    s = expectOk(editBaseballPlay(s, preview.preview, edit, names, { now: at(2), confirmed: true, receiptId: 'r' }))
    expect(projection(s).bases.third).not.toBeNull()
    return end(s, 'time_limit')
  })())
  add('forfeit publishes the recorded runs', end(quickHomer(game()), 'forfeit', { forfeitWinner: 'tracked' }))
  add('abandoned with runners on', end(quickHomer(walk(walk(game()))), 'abandoned', { note: 'Lightning' }))
  add('reopened, corrected and ended again', (() => {
    let s = end(quickHomer(game()), 'time_limit')
    s = expectOk(reopenBaseballGame(s, 'Missed a run', ctx()))
    s = expectOk(adjustBaseballScore(s, 'tracked', 1, 'Missed run', ctx()))
    return end(s, 'time_limit')
  })())
  add('suspended is refused', end(quickHomer(game()), 'suspended'), true)
  add('reopened but not ended is refused', expectOk(reopenBaseballGame(end(game(), 'time_limit'), 'Check', ctx())), true)
  add('in progress is refused', quickHomer(game()), true)

  const out = cases.map(({ name, state, refuse }) => {
    const sport = baseballSportState(state)!
    return {
      name,
      refuse: !!refuse,
      status: sport.projection.status,
      expected: sport.projection.score,
      setup: sport.setup,
      events: state.eventStream!.events,
    }
  })
  expect(out.map(c => [c.name, c.refuse ? 'refused' : `${c.expected.tracked}-${c.expected.opponent}`])).toEqual([
    ['walk-off double in the bottom of the seventh', '1-0'],
    ['tracked away team wins in regulation', '1-0'],
    ['third-out force with a runner crossing the plate', '0-0'],
    ['batter out before first on the third out', '0-0'],
    ['bases loaded one out: batter retired second, runner from first third', '0-1'],
    ['bases loaded one out: runner from first retired second, batter third', '0-0'],
    ['runner on third two outs: single, runner scores, batter put out', '0-1'],
    ['runner on third two outs: single, batter out listed first', '0-1'],
    ['recorder override counts a run on a force third out', '0-1'],
    ['recorder override takes away a run', '0-0'],
    ['double steal: runner steals home while the trailing runner is caught for the third out', '0-1'],
    ['placed runner in extra innings, then a walk-off home run', '2-1'],
    ['half ended early with runners on, then runs in later halves', '1-1'],
    ['slowpitch half closes at five runs', '2-5'],
    ['run rule reached with grand slams', '10-0'],
    ['score adjustments', '1-4'],
    ['removed scoring play', '0-0'],
    ['revised scoring play: the runner held at third', '0-0'],
    ['forfeit publishes the recorded runs', '0-1'],
    ['abandoned with runners on', '0-3'],
    ['reopened, corrected and ended again', '1-1'],
    ['suspended is refused', 'refused'],
    ['reopened but not ended is refused', 'refused'],
    ['in progress is refused', 'refused'],
  ])
  const target = process.env.BSB6A_CASES_OUT
  if (target) writeFileSync(target, JSON.stringify(out, null, 1))
})
