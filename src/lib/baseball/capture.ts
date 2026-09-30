import type { GameState } from '../../types'
import {
  baseballMovement,
  proposeBaseballMovements,
  recordBaseballPitch,
  recordBaseballPlateAppearance,
  type BaseballCommandContext,
  type BaseballCommandResult,
} from './commands'
import type {
  BaseballBase,
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
  return capture.source === 'pitch'
    ? baseballPitchTerminal(sport.projection, sport.setup.rulesSnapshot, capture.result)
    : baseballQuickTerminal(capture.result)
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
      ? { runnerId, from, to: movement.to, reason: movement.reason, fielders: [...movement.fielders], errorBy: movement.errorBy }
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

export function updateBaseballResolutionDraftRow(runnerId: string, patch: Partial<Pick<BaseballResolutionRow, 'reason' | 'fielders'>>): BaseballResolutionTransition {
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

export function baseballResolutionMovements(rows: readonly BaseballResolutionRow[]): BaseballRunnerMovement[] {
  return rows
    .filter(row => row.to !== 'stay')
    .map(row =>
      baseballMovement(row.runnerId, row.from, row.to as BaseballMovementTo, row.reason, {
        fielders: row.to === 'out' || row.errorBy !== null ? row.fielders : [],
        errorBy: row.errorBy,
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
