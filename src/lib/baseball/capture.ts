import type { GameState } from '../../types'
import {
  baseballMovement,
  proposeBaseballMovements,
  recordBaseballBaserunning,
  recordBaseballPitch,
  recordBaseballPlateAppearance,
  type BaseballCommandContext,
  type BaseballCommandResult,
} from './commands'
import type {
  BaseballBase,
  BaseballBaserunningPlay,
  BaseballInPlay,
  BaseballInPlayResult,
  BaseballMatchProjection,
  BaseballMatchRules,
  BaseballMovementFrom,
  BaseballMovementReason,
  BaseballMovementTo,
  BaseballPitchLocation,
  BaseballPitchResult,
  BaseballQuickPlateAppearanceResult,
  BaseballRunnerMovement,
  BaseballSportGameState,
} from './types'

/**
 * Pure capture helpers for the live tracker (BSB-3B). They turn a recorder's choices into
 * the inputs of the BSB-1 checked commands; the engine still validates every write.
 */

export type BaseballTerminalKind = 'walk' | 'hit_by_pitch' | 'strikeout' | 'catcher_interference' | 'in_play'

export interface BaseballBattedBall {
  inPlay: BaseballInPlay
  /** Spray location in the diamond frame, or null when unknown or not tracked. */
  location: { x: number; y: number } | null
}

/** A plate appearance or pitch waiting for its runner movements before it is written. */
export type BaseballPendingCapture =
  | {
      source: 'pitch'
      result: BaseballPitchResult
      pitchLocation: BaseballPitchLocation | null
      battedBall: BaseballBattedBall | null
      droppedThirdStrike: boolean
    }
  | {
      source: 'quick'
      result: BaseballQuickPlateAppearanceResult
      battedBall: BaseballBattedBall | null
      finalBalls: number | null
      finalStrikes: number | null
    }
  | {
      /** A running play between pitches (BSB-3C), started from the runner chip that was tapped. */
      source: 'baserunning'
      play: BaseballBaserunningPlay
      runnerId: string
    }

/**
 * What a pitch does to the plate appearance under these rules, mirroring the projector:
 * null when the plate appearance continues.
 */
export function baseballPitchTerminal(
  projection: BaseballMatchProjection,
  rules: BaseballMatchRules,
  result: BaseballPitchResult
): BaseballTerminalKind | null {
  const lastStrike = rules.strikesForStrikeout - 1
  switch (result) {
    case 'ball':
    case 'pitchout':
    case 'intentional_ball':
      return projection.balls + 1 >= rules.ballsForWalk ? 'walk' : null
    case 'called_strike':
    case 'swinging_strike':
    case 'missed_bunt':
    case 'foul_tip':
      return projection.strikes + 1 >= rules.strikesForStrikeout ? 'strikeout' : null
    case 'foul':
      return projection.strikes >= lastStrike && rules.twoStrikeFoulIsOut ? 'strikeout' : null
    case 'foul_bunt':
      return projection.strikes >= lastStrike && rules.twoStrikeFoulBuntIsStrikeout ? 'strikeout' : null
    case 'hit_by_pitch':
      return 'hit_by_pitch'
    case 'in_play':
      return 'in_play'
  }
}

export function baseballQuickTerminal(result: BaseballQuickPlateAppearanceResult): BaseballTerminalKind {
  switch (result) {
    case 'walk':
    case 'intentional_walk':
      return 'walk'
    case 'hit_by_pitch':
      return 'hit_by_pitch'
    case 'catcher_interference':
      return 'catcher_interference'
    case 'in_play':
      return 'in_play'
    case 'strikeout_swinging':
    case 'strikeout_looking':
      return 'strikeout'
  }
}

export function baseballCaptureTerminal(sport: BaseballSportGameState, capture: BaseballPendingCapture): BaseballTerminalKind | null {
  switch (capture.source) {
    case 'pitch':
      return baseballPitchTerminal(sport.projection, sport.setup.rulesSnapshot, capture.result)
    case 'quick':
      return baseballQuickTerminal(capture.result)
    case 'baserunning':
      return null
  }
}

/** The batter may run on a dropped third strike when the rules allow it and first is open or there are two outs. */
export function baseballDroppedThirdStrikeAvailable(sport: BaseballSportGameState): boolean {
  const { projection, setup } = sport
  return setup.rulesSnapshot.droppedThirdStrike && (!projection.bases.first || projection.outs >= 2)
}

/** The standard movements for a pending capture; an empty list for a pitch that does not end the plate appearance. */
export function proposeBaseballCaptureMovements(
  sport: BaseballSportGameState,
  capture: BaseballPendingCapture
): BaseballRunnerMovement[] {
  const { projection } = sport
  if (capture.source === 'baserunning') return proposeBaseballBaserunning(projection, capture.play, capture.runnerId)
  const terminal = baseballCaptureTerminal(sport, capture)
  switch (terminal) {
    case null:
      return []
    case 'in_play': {
      const inPlay = capture.battedBall?.inPlay
      if (!inPlay) return []
      return proposeBaseballMovements(projection, inPlay.result, inPlay.fielders)
    }
    case 'strikeout': {
      if (capture.source === 'pitch' && capture.droppedThirdStrike && projection.currentBatterId) {
        // The batter becomes a runner, so runners are forced only when first is occupied.
        const [batter, ...forced] = proposeBaseballMovements(projection, 'walk')
        return [{ ...batter, reason: 'dropped_third_strike' }, ...forced]
      }
      return proposeBaseballMovements(projection, 'strikeout')
    }
    default:
      return proposeBaseballMovements(projection, terminal)
  }
}

/** Writes a pending capture with its confirmed movements through the checked command. */
export function commitBaseballCapture(
  state: GameState,
  capture: BaseballPendingCapture,
  movements: BaseballRunnerMovement[],
  context: BaseballCommandContext
): BaseballCommandResult {
  if (capture.source === 'pitch') {
    return recordBaseballPitch(
      state,
      {
        result: capture.result,
        pitchLocation: capture.pitchLocation,
        inPlay: capture.battedBall?.inPlay ?? null,
        location: capture.battedBall?.location ?? null,
        movements,
      },
      context
    )
  }
  if (capture.source === 'baserunning') return recordBaseballBaserunning(state, capture.play, movements, context)
  return recordBaseballPlateAppearance(
    state,
    {
      result: capture.result,
      inPlay: capture.battedBall?.inPlay ?? null,
      location: capture.battedBall?.location ?? null,
      finalBalls: capture.finalBalls,
      finalStrikes: capture.finalStrikes,
      movements,
    },
    context
  )
}

// ---------------------------------------------------------------------------
// In-play sheet

export const BASEBALL_IN_PLAY_RESULT_OPTIONS: ReadonlyArray<{ result: BaseballInPlayResult; label: string }> = [
  { result: 'single', label: '1B' },
  { result: 'double', label: '2B' },
  { result: 'triple', label: '3B' },
  { result: 'home_run', label: 'HR' },
  { result: 'out', label: 'Out' },
  { result: 'error', label: 'Error' },
  { result: 'fielders_choice', label: "Fielder's choice" },
  { result: 'sacrifice_bunt', label: 'Sac bunt' },
  { result: 'sacrifice_fly', label: 'Sac fly' },
  { result: 'double_play', label: 'DP' },
  { result: 'triple_play', label: 'TP' },
  { result: 'ground_rule_double', label: 'Ground-rule 2B' },
]

export const BASEBALL_BATTED_BALL_OPTIONS: ReadonlyArray<{ type: BaseballInPlay['battedBallType']; label: string }> = [
  { type: 'ground', label: 'Ground' },
  { type: 'line', label: 'Line' },
  { type: 'fly', label: 'Fly' },
  { type: 'popup', label: 'Popup' },
  { type: 'bunt', label: 'Bunt' },
  { type: 'unknown', label: 'Unknown' },
]

const RESULTS_NEEDING_FIELDERS = new Set<BaseballInPlayResult>([
  'out',
  'fielders_choice',
  'sacrifice_bunt',
  'sacrifice_fly',
  'double_play',
  'triple_play',
])

export interface BaseballInPlayDraft {
  result: BaseballInPlayResult | null
  battedBallType: BaseballInPlay['battedBallType']
  insideThePark: boolean
  location: { x: number; y: number } | null
  fielders: number[]
  errorBy: number | null
  /** Advanced overrides (BSB-3C) for a runner who scores; absent or null means the engine's rules decide. */
  earned?: boolean | null
  rbi?: boolean | null
  runCounts?: boolean | null
}

export function emptyBaseballInPlayDraft(): BaseballInPlayDraft {
  return { result: null, battedBallType: 'unknown', insideThePark: false, location: null, fielders: [], errorBy: null }
}

/** Why the draft cannot continue yet, or the batted ball it describes. */
export function buildBaseballBattedBall(draft: BaseballInPlayDraft): { ok: true; battedBall: BaseballBattedBall } | { ok: false; message: string } {
  if (!draft.result) return { ok: false, message: 'Choose a result.' }
  if (RESULTS_NEEDING_FIELDERS.has(draft.result) && draft.fielders.length === 0) {
    return { ok: false, message: 'Tap the fielders who made the play, in order.' }
  }
  if (draft.result === 'error' && draft.errorBy === null) return { ok: false, message: 'Choose the fielder who made the error.' }
  return {
    ok: true,
    battedBall: {
      inPlay: {
        battedBallType: draft.battedBallType,
        result: draft.result,
        fielders: [...draft.fielders],
        errorBy: draft.result === 'error' ? draft.errorBy : null,
        insideThePark: draft.result === 'home_run' && draft.insideThePark,
      },
      location: draft.location,
    },
  }
}

// ---------------------------------------------------------------------------
// Runner resolution

export type BaseballResolutionDestination = BaseballMovementTo | 'stay'

export interface BaseballResolutionRow {
  runnerId: string
  from: BaseballMovementFrom
  to: BaseballResolutionDestination
  reason: BaseballMovementReason
  fielders: number[]
  errorBy: number | null
  /** Advanced overrides (BSB-3C) for a runner who scores; absent or null means the engine's rules decide. */
  earned?: boolean | null
  rbi?: boolean | null
  runCounts?: boolean | null
}

const ORDER: readonly BaseballMovementFrom[] = ['batter', 'first', 'second', 'third']
const BASES: readonly BaseballBase[] = ['first', 'second', 'third']

/** Reasons a runner can move for between plate appearances (the engine's running reasons). */
export const BASEBALL_RUNNING_REASONS: readonly BaseballMovementReason[] = [
  'wild_pitch',
  'passed_ball',
  'stolen_base',
  'caught_stealing',
  'pickoff',
  'balk',
  'error',
  'throw',
  'defensive_indifference',
  'appeal',
  'interference',
  'obstruction',
  'awarded',
]

/** Reasons offered for a runner on a play that ends the plate appearance. */
export const BASEBALL_PLAY_REASONS: readonly BaseballMovementReason[] = [
  'on_play',
  'forced',
  'awarded',
  'wild_pitch',
  'passed_ball',
  'stolen_base',
  'caught_stealing',
  'error',
  'throw',
]

/** Reasons a runner can move on a pitch that does not end the plate appearance. */
export const BASEBALL_PITCH_RUNNING_REASONS: readonly BaseballMovementReason[] = [
  'wild_pitch',
  'passed_ball',
  'stolen_base',
  'caught_stealing',
  'error',
  'throw',
]

/** The reason choices for a runner row: running reasons on a pitch that continues the plate appearance. */
export function baseballResolutionReasons(terminal: BaseballTerminalKind | null): readonly BaseballMovementReason[] {
  return terminal === null ? BASEBALL_PITCH_RUNNING_REASONS : BASEBALL_PLAY_REASONS
}

export const BASEBALL_REASON_LABELS: Record<BaseballMovementReason, string> = {
  on_play: 'On the play',
  forced: 'Forced',
  stolen_base: 'Steal',
  caught_stealing: 'Caught stealing',
  pickoff: 'Pickoff',
  wild_pitch: 'Wild pitch',
  passed_ball: 'Passed ball',
  balk: 'Balk',
  error: 'Error',
  throw: 'Throw',
  defensive_indifference: 'Indifference',
  appeal: 'Appeal',
  interference: 'Interference',
  obstruction: 'Obstruction',
  awarded: 'Awarded',
  dropped_third_strike: 'Dropped third strike',
}

/** The reason for runners the recorder moves beyond the proposal: on the play for a ball in play, else a wild pitch. */
export function baseballFallbackReason(terminal: BaseballTerminalKind | null): BaseballMovementReason {
  return terminal === 'in_play' ? 'on_play' : 'wild_pitch'
}

/**
 * One row for the batter (when the capture ends the plate appearance) and one per runner,
 * lead runner first, starting from the proposed movements.
 */
export function createBaseballResolutionRows(
  projection: BaseballMatchProjection,
  movements: readonly BaseballRunnerMovement[],
  includeBatter: boolean,
  /** Reason a runner gets when the recorder moves one the proposal left in place. */
  fallbackReason: BaseballMovementReason
): BaseballResolutionRow[] {
  const rows: BaseballResolutionRow[] = []
  const fromMovement = (runnerId: string, from: BaseballMovementFrom, fallbackReason: BaseballMovementReason) => {
    const movement = movements.find(entry => entry.runnerId === runnerId)
    return movement
      ? {
          runnerId,
          from,
          to: movement.to,
          reason: movement.reason,
          fielders: [...movement.fielders],
          errorBy: movement.errorBy,
          earned: movement.earned,
          rbi: movement.rbi,
          runCounts: movement.runCounts,
        }
      : { runnerId, from, to: 'stay' as const, reason: fallbackReason, fielders: [], errorBy: null }
  }
  for (const base of [...BASES].reverse()) {
    const runner = projection.bases[base]
    if (runner) rows.push(fromMovement(runner.runnerId, base, fallbackReason))
  }
  if (includeBatter && projection.currentBatterId) rows.push(fromMovement(projection.currentBatterId, 'batter', 'on_play'))
  return rows
}

/** Destinations in tap order: stay (runners only), each later base, home, then out. */
export function baseballResolutionDestinations(from: BaseballMovementFrom): BaseballResolutionDestination[] {
  const start = ORDER.indexOf(from)
  const later = BASES.filter((_, index) => index + 1 > start)
  return [...(from === 'batter' ? [] : ['stay' as const]), ...later, 'home', 'out']
}

export function cycleBaseballResolutionRow(row: BaseballResolutionRow): BaseballResolutionRow {
  const options = baseballResolutionDestinations(row.from)
  const next = options[(options.indexOf(row.to) + 1) % options.length]
  return setBaseballResolutionDestination(row, next)
}

export function setBaseballResolutionDestination(row: BaseballResolutionRow, to: BaseballResolutionDestination): BaseballResolutionRow {
  return {
    ...row,
    to,
    // Only an out keeps a putout sequence; an advance keeps fielders only with an error.
    fielders: to === 'out' || row.errorBy !== null ? row.fielders : [],
    // Scoring overrides only mean something for a runner who scores.
    ...(to === 'home' ? {} : { earned: null, rbi: null, runCounts: null }),
  }
}

/** The rows being edited plus the out row that fielder taps add to. */
export interface BaseballResolutionDraft {
  rows: BaseballResolutionRow[]
  activeRunnerId: string | null
}

/** One edit to the resolution draft. Each interaction is a single transition, so edits are never lost to a stale copy. */
export type BaseballResolutionTransition = (draft: BaseballResolutionDraft) => BaseballResolutionDraft

function editRow(draft: BaseballResolutionDraft, runnerId: string, edit: (row: BaseballResolutionRow) => BaseballResolutionRow) {
  return draft.rows.map(row => (row.runnerId === runnerId ? edit(row) : row))
}

/** Sets a row's destination; choosing Out also makes that row take the fielder taps. */
export function setBaseballResolutionDraftDestination(runnerId: string, to: BaseballResolutionDestination): BaseballResolutionTransition {
  return draft => ({
    rows: editRow(draft, runnerId, row => setBaseballResolutionDestination(row, to)),
    activeRunnerId: to === 'out' ? runnerId : draft.activeRunnerId,
  })
}

/** Cycles a row's destination (a tap on the runner chip); landing on Out activates it. */
export function cycleBaseballResolutionDraftRow(runnerId: string): BaseballResolutionTransition {
  return draft => {
    const rows = editRow(draft, runnerId, cycleBaseballResolutionRow)
    const cycled = rows.find(row => row.runnerId === runnerId)
    return { rows, activeRunnerId: cycled?.to === 'out' ? runnerId : draft.activeRunnerId }
  }
}

export function updateBaseballResolutionDraftRow(runnerId: string, patch: Partial<Pick<BaseballResolutionRow, 'reason' | 'fielders' | 'errorBy' | 'earned' | 'rbi' | 'runCounts'>>): BaseballResolutionTransition {
  return draft => ({ ...draft, rows: editRow(draft, runnerId, row => ({ ...row, ...patch })) })
}

export function activateBaseballResolutionRow(runnerId: string): BaseballResolutionTransition {
  return draft => ({ ...draft, activeRunnerId: runnerId })
}

/** Adds a fielder tap on the diamond to the active out row. */
export function addBaseballResolutionFielder(position: number): BaseballResolutionTransition {
  return draft => draft.activeRunnerId === null
    ? draft
    : {
        ...draft,
        rows: editRow(draft, draft.activeRunnerId, row => (row.to === 'out' ? { ...row, fielders: [...row.fielders, position] } : row)),
      }
}

function finalPosition(row: BaseballResolutionRow): number | null {
  if (row.to === 'out') return null
  if (row.to === 'stay') return ORDER.indexOf(row.from)
  if (row.to === 'home') return 4
  return BASES.indexOf(row.to) + 1
}

/** Problems the recorder should fix before confirming, keyed by runner id. The engine still decides. */
export function baseballResolutionIssues(rows: readonly BaseballResolutionRow[]): Record<string, string> {
  const issues: Record<string, string> = {}
  const onBase = rows
    .map(row => ({ row, start: ORDER.indexOf(row.from), end: finalPosition(row) }))
    .filter((entry): entry is { row: BaseballResolutionRow; start: number; end: number } => entry.end !== null)
  for (const entry of onBase) {
    if (entry.end === 4) continue
    // Flag the trailing runner: the one who moved onto a base someone ahead already holds.
    const shared = onBase.find(other => other !== entry && other.end === entry.end && other.start > entry.start)
    if (shared) issues[entry.row.runnerId] = 'Two runners on one base.'
  }
  for (const trailing of onBase) {
    for (const lead of onBase) {
      if (lead.start > trailing.start && trailing.end > lead.end) {
        issues[trailing.row.runnerId] = 'Passes the runner ahead.'
      }
    }
  }
  for (const row of rows) {
    if (row.to === 'out' && row.fielders.length === 0 && issues[row.runnerId] === undefined) {
      issues[row.runnerId] = 'Tap the fielders for this out.'
    }
  }
  return issues
}

/**
 * The movements for a resolution. `rbi: false` drops RBI overrides for a capture whose
 * projection cannot apply them (see `baseballCaptureAllowsRbi`).
 */
export function baseballResolutionMovements(
  rows: readonly BaseballResolutionRow[],
  options: { rbi?: boolean } = {}
): BaseballRunnerMovement[] {
  const allowRbi = options.rbi ?? true
  return rows
    .filter(row => row.to !== 'stay')
    .map(row =>
      baseballMovement(row.runnerId, row.from, row.to as BaseballMovementTo, row.reason, {
        fielders: row.to === 'out' || row.errorBy !== null ? row.fielders : [],
        errorBy: row.errorBy,
        ...(row.to === 'home' ? { earned: row.earned ?? null, rbi: allowRbi ? row.rbi ?? null : null, runCounts: row.runCounts ?? null } : {}),
      })
    )
}

// ---------------------------------------------------------------------------
// Quick PA

export const BASEBALL_QUICK_RESULT_OPTIONS: ReadonlyArray<{ result: BaseballQuickPlateAppearanceResult; label: string }> = [
  { result: 'walk', label: 'Walk' },
  { result: 'intentional_walk', label: 'Intentional walk' },
  { result: 'hit_by_pitch', label: 'HBP' },
  { result: 'strikeout_swinging', label: 'Strikeout swinging' },
  { result: 'strikeout_looking', label: 'Strikeout looking' },
  { result: 'catcher_interference', label: "Catcher's interference" },
  { result: 'in_play', label: 'In play' },
]

// ---------------------------------------------------------------------------
// Between-pitch running (BSB-3C)

export const BASEBALL_BASERUNNING_PLAY_OPTIONS: ReadonlyArray<{ play: BaseballBaserunningPlay; label: string }> = [
  { play: 'stolen_base', label: 'Steal' },
  { play: 'caught_stealing', label: 'Caught stealing' },
  { play: 'pickoff', label: 'Pickoff' },
  { play: 'wild_pitch', label: 'Wild pitch' },
  { play: 'passed_ball', label: 'Passed ball' },
  { play: 'balk', label: 'Balk' },
  { play: 'error', label: 'Error' },
  { play: 'defensive_indifference', label: 'Defensive indifference' },
  { play: 'appeal', label: 'Appeal out' },
  { play: 'other', label: 'Other advance' },
]

const BASERUNNING_REASON: Record<BaseballBaserunningPlay, BaseballMovementReason> = {
  stolen_base: 'stolen_base',
  caught_stealing: 'caught_stealing',
  pickoff: 'pickoff',
  wild_pitch: 'wild_pitch',
  passed_ball: 'passed_ball',
  balk: 'balk',
  error: 'error',
  defensive_indifference: 'defensive_indifference',
  appeal: 'appeal',
  other: 'awarded',
}

/** The runner menu's plays under these rules: no steals without stealing, no balk unless balks are called. */
export function baseballBaserunningPlayOptions(rules: BaseballMatchRules) {
  const stealing = new Set<BaseballBaserunningPlay>(['stolen_base', 'caught_stealing', 'defensive_indifference'])
  return BASEBALL_BASERUNNING_PLAY_OPTIONS.filter(option =>
    (rules.stealing || !stealing.has(option.play)) && (rules.balks || option.play !== 'balk'))
}

/** The reason a runner the recorder moves on this play starts with. */
export function baseballBaserunningReason(play: BaseballBaserunningPlay): BaseballMovementReason {
  return BASERUNNING_REASON[play]
}

/**
 * The preset for a runner play: the tapped runner moves up one base on a steal, error,
 * indifference or other advance, is out on caught stealing, a pickoff or an appeal, and
 * every runner moves up one base on a wild pitch, passed ball or balk.
 */
export function proposeBaseballBaserunning(
  projection: BaseballMatchProjection,
  play: BaseballBaserunningPlay,
  runnerId: string
): BaseballRunnerMovement[] {
  const reason = BASERUNNING_REASON[play]
  const runners = BASES.flatMap((base, index) => {
    const runner = projection.bases[base]
    return runner ? [{ base, next: index === 2 ? ('home' as const) : BASES[index + 1]!, id: runner.runnerId }] : []
  })
  switch (play) {
    case 'wild_pitch':
    case 'passed_ball':
    case 'balk':
      return runners.map(runner => baseballMovement(runner.id, runner.base, runner.next, reason))
    case 'caught_stealing':
    case 'pickoff':
    case 'appeal':
      return runners.filter(runner => runner.id === runnerId).map(runner => baseballMovement(runner.id, runner.base, 'out', reason))
    default:
      return runners.filter(runner => runner.id === runnerId).map(runner => baseballMovement(runner.id, runner.base, runner.next, reason))
  }
}

/** Reason choices for a capture: the engine's running reasons between pitches, else by what the pitch does. */
export function baseballCaptureReasons(sport: BaseballSportGameState, capture: BaseballPendingCapture): readonly BaseballMovementReason[] {
  if (capture.source === 'baserunning') {
    return BASEBALL_RUNNING_REASONS.filter(reason => sport.setup.rulesSnapshot.stealing || reason !== 'stolen_base')
  }
  return baseballResolutionReasons(baseballCaptureTerminal(sport, capture))
}

/**
 * Whether an RBI override can take effect: the projector credits RBIs only on the event
 * that completes a plate appearance, so runner plays and pitches that continue the plate
 * appearance never offer one.
 */
export function baseballCaptureAllowsRbi(sport: BaseballSportGameState, capture: BaseballPendingCapture): boolean {
  return baseballCaptureTerminal(sport, capture) !== null
}

/** The fallback reason for runners the recorder moves beyond a capture's proposal. */
export function baseballCaptureFallbackReason(sport: BaseballSportGameState, capture: BaseballPendingCapture): BaseballMovementReason {
  return capture.source === 'baserunning' ? BASERUNNING_REASON[capture.play] : baseballFallbackReason(baseballCaptureTerminal(sport, capture))
}

