import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEvent, GameEventMutation } from '../gameEvents/types'
import {
  BASEBALL_BASERUNNING_PLAY_OPTIONS,
  BASEBALL_BATTED_BALL_OPTIONS,
  BASEBALL_QUICK_RESULT_OPTIONS,
  BASEBALL_REASON_LABELS,
} from './capture'
import { baseballSportState, withBaseballUndoReceipt, type BaseballCommandResult } from './commands'
import { formatBaseballHalf, parseBaseballPeriod } from './periods'
import { baseballFieldingPositionCode } from './positions'
import { replayBaseballEvents, replayBaseballRunsByEvent } from './projector'
import { baseballPersonLabel, BASEBALL_PRIMARY_PITCH_RESULTS, BASEBALL_MORE_PITCH_RESULTS } from './trackerView'
import type {
  BaseballEventType,
  BaseballGameEndOutcome,
  BaseballHalfInningEndReason,
  BaseballInPlayResult,
  BaseballRunnerMovement,
  BaseballSportGameState,
  BaseballSubstitution,
  BaseballUndoReceipt,
} from './types'

/**
 * Recent plays (BSB-3D): capture units newest first, with the game flow shown for context
 * and a divider where a half-inning closed.
 */
export type BaseballRecentRow =
  | {
      kind: 'play'
      /** The first event's id; stable for React keys. */
      id: string
      eventIds: string[]
      label: string
      halfLabel: string
      /** True only for the newest active unit. */
      undoable: boolean
    }
  | { kind: 'flow'; id: string; label: string; halfLabel: string }
  | { kind: 'divider'; id: string; label: string }

export interface BaseballSideNames {
  tracked: string
  opponent: string
}

/** Plays a recorder captures; everything else is game flow, shown but never undone. */
const CAPTURE_TYPES = new Set<BaseballEventType>([
  'baseball.pitch',
  'baseball.plate_appearance',
  'baseball.baserunning',
  'baseball.substitution',
  'baseball.score_adjustment',
])

export function baseballRecentPlays(
  state: GameState,
  names: BaseballSideNames,
  limit = 12
): BaseballRecentRow[] {
  const sport = baseballSportState(state)
  if (!sport || !state.eventStream) return []
  const events = activeEvents(state)
  const units = groupUnits(events)
  const scored = replayBaseballRunsByEvent(sport.setup, events)
  const rows: BaseballRecentRow[] = []
  for (let index = units.length - 1; index >= 0 && rows.length < limit; index--) {
    const unit = units[index]
    const first = unit[0]
    const newer = units[index + 1]?.[0]
    const divider = newer ? halfDivider(first, newer) : null
    if (divider) rows.push({ kind: 'divider', id: `divider-${first.id}`, label: divider })
    const halfLabel = formatPeriod(first)
    const label = unit.map(event => baseballEventLabel(sport, event, names, scored.get(event.id) ?? [])).join(' + ')
    if (CAPTURE_TYPES.has(first.eventType as BaseballEventType)) {
      rows.push({
        kind: 'play',
        id: first.id,
        eventIds: unit.map(event => event.id),
        label,
        halfLabel,
        undoable: index === units.length - 1,
      })
    } else {
      rows.push({ kind: 'flow', id: first.id, label, halfLabel })
    }
  }
  return rows
}

/** True when the newest active unit is a play Undo may remove. */
export function canUndoBaseballPlay(state: GameState): boolean {
  if (!baseballSportState(state) || !state.eventStream) return false
  const units = groupUnits(activeEvents(state))
  const newest = units[units.length - 1]
  return Boolean(newest && CAPTURE_TYPES.has(newest[0].eventType as BaseballEventType))
}

/** Removes the newest play, keeping a receipt so Restore can bring it back. */
export function undoBaseballPlay(state: GameState, now: string): BaseballCommandResult {
  const sport = baseballSportState(state)
  if (!sport || !state.eventStream) return failure(state, 'This is not a Baseball event game.')
  const units = groupUnits(activeEvents(state))
  const newest = units[units.length - 1]
  if (!newest || !CAPTURE_TYPES.has(newest[0].eventType as BaseballEventType)) {
    return failure(state, 'Nothing to undo: the latest entry is part of the game flow.')
  }
  const mutations: GameEventMutation[] = newest.map(event => ({ type: 'delete', eventId: event.id }))
  const receipt: BaseballUndoReceipt = {
    createdAt: now,
    entries: newest.map(event => ({ eventId: event.id, expectedRevision: event.revision + 1 })),
  }
  return applyChecked(state, sport, mutations, receipt, now, newest)
}

/** True when the receipt still matches the stream, so Restore would succeed structurally. */
export function canRestoreBaseballPlay(state: GameState): boolean {
  return restoreMutations(state) !== null
}

/** Restores the play Undo just removed, if nothing has been recorded since. */
export function restoreBaseballPlay(state: GameState, now: string): BaseballCommandResult {
  const sport = baseballSportState(state)
  if (!sport || !state.eventStream) return failure(state, 'This is not a Baseball event game.')
  const mutations = restoreMutations(state)
  if (!mutations) return failure(state, 'There is nothing to restore.')
  const restored = mutations.map(mutation => findEvent(state, mutation.eventId)!)
  return applyChecked(state, sport, mutations, null, now, restored)
}

// ---------------------------------------------------------------------------
// Labels

const PITCH_LABELS = Object.fromEntries(
  [...BASEBALL_PRIMARY_PITCH_RESULTS, ...BASEBALL_MORE_PITCH_RESULTS].map(option => [option.result, option.label])
) as Record<string, string>

const IN_PLAY_LABELS: Record<BaseballInPlayResult, string> = {
  single: 'single',
  double: 'double',
  triple: 'triple',
  home_run: 'home run',
  ground_rule_double: 'ground-rule double',
  out: 'out',
  error: 'reached on error',
  fielders_choice: "fielder's choice",
  sacrifice_bunt: 'sacrifice bunt',
  sacrifice_fly: 'sacrifice fly',
  double_play: 'double play',
  triple_play: 'triple play',
}

const QUICK_LABELS = Object.fromEntries(BASEBALL_QUICK_RESULT_OPTIONS.map(option => [option.result, option.label])) as Record<string, string>
const RUNNER_PLAY_LABELS = Object.fromEntries(BASEBALL_BASERUNNING_PLAY_OPTIONS.map(option => [option.play, option.label])) as Record<string, string>

const HALF_END_LABELS: Record<BaseballHalfInningEndReason, string> = {
  time_limit: 'time limit',
  mercy: 'mercy rule',
  other: 'ended early',
}

export const BASEBALL_GAME_END_LABELS: Record<BaseballGameEndOutcome, string> = {
  completed: 'Final',
  run_rule: 'Final (run rule)',
  time_limit: 'Final (time limit)',
  forfeit: 'Forfeit',
  suspended: 'Suspended',
  abandoned: 'Abandoned',
}

/**
 * One line for an event. `scoredRunnerIds` are the runs the replay actually credited, so a run
 * cancelled by a force or batter third out is never announced.
 */
export function baseballEventLabel(
  sport: BaseballSportGameState,
  event: GameEvent,
  names: BaseballSideNames,
  scoredRunnerIds: readonly string[]
): string {
  const person = (id: string) => baseballPersonLabel(sport, id).name
  const actor = (role: string) => {
    const id = event.actors.find(entry => entry.role === role)?.participantId
    return id ? person(id) : null
  }
  const payload = event.payload as Record<string, unknown>
  const batter = actor('batter')
  const withBatter = (text: string) => (batter ? `${batter}: ${text}` : text)
  switch (event.eventType as BaseballEventType) {
    case 'baseball.game_started':
      return 'Game started'
    case 'baseball.pitch': {
      const inPlay = payload.inPlay as { result: BaseballInPlayResult } | null
      const text = inPlay ? IN_PLAY_LABELS[inPlay.result] : PITCH_LABELS[payload.result as string] ?? 'Pitch'
      return withBatter(capitalize(text) + runs(scoredRunnerIds))
    }
    case 'baseball.plate_appearance': {
      const inPlay = payload.inPlay as { result: BaseballInPlayResult } | null
      const text = inPlay ? IN_PLAY_LABELS[inPlay.result] : (QUICK_LABELS[payload.result as string] ?? 'Plate appearance').toLowerCase()
      return withBatter(`${capitalize(text)} (quick)${runs(scoredRunnerIds)}`)
    }
    case 'baseball.baserunning': {
      const movements = payload.movements as BaseballRunnerMovement[]
      const who = movements.map(movement => person(movement.runnerId)).join(', ')
      return `${RUNNER_PLAY_LABELS[payload.play as string] ?? 'Runner play'}${who ? `: ${who}` : ''}${runs(scoredRunnerIds)}`
    }
    case 'baseball.substitution':
      return substitutionLabel(sport, payload.substitution as BaseballSubstitution, names, person)
    case 'baseball.score_adjustment': {
      const side = event.teamSide === 'tracked' ? names.tracked : names.opponent
      const delta = payload.delta as number
      return `${side} score ${delta > 0 ? `+${delta}` : delta} (${payload.reason as string})`
    }
    case 'baseball.half_inning_ended':
      return `Half-inning ended: ${HALF_END_LABELS[payload.reason as BaseballHalfInningEndReason]}`
    case 'baseball.game_ended':
      return BASEBALL_GAME_END_LABELS[payload.outcome as BaseballGameEndOutcome]
    case 'baseball.game_reopened':
      return `Game reopened (${payload.reason as string})`
    default:
      return 'Event'
  }
}

function substitutionLabel(
  sport: BaseballSportGameState,
  substitution: BaseballSubstitution,
  names: BaseballSideNames,
  person: (id: string) => string
): string {
  switch (substitution.kind) {
    case 'defensive': {
      const position = baseballFieldingPositionCode(substitution.position) ?? `Fielder ${substitution.position}`
      const leaving = substitution.outgoingId ? ` for ${person(substitution.outgoingId)}` : ''
      return substitution.position === 1
        ? `Pitching change: ${person(substitution.incomingId)}${leaving}`
        : `${person(substitution.incomingId)} to ${position}${leaving}`
    }
    case 'position_change': {
      const pitcher = substitution.assignments.find(entry => entry.position === 1)
      const moves = substitution.assignments
        .filter(entry => entry.position !== 1)
        .map(entry => `${person(entry.participantId)} to ${baseballFieldingPositionCode(entry.position) ?? entry.position}`)
      return pitcher
        ? `Pitching change: ${person(pitcher.participantId)} pitches${moves.length ? `, ${moves.join(', ')}` : ''}`
        : `Position change: ${moves.join(', ')}`
    }
    case 'opponent_pitcher':
      return `${names.opponent} pitching change: ${baseballPersonLabel(sport, substitution.pitcher.id).name}`
    case 'opponent_slot':
      return `${names.opponent} batter labelled ${[substitution.number ? `#${substitution.number}` : null, substitution.label].filter(Boolean).join(' ') || 'blank'}`
    case 'pinch_hitter':
      return `Pinch hitter: ${person(substitution.incomingId)} for ${person(substitution.outgoingId)}`
    case 'pinch_runner':
      return `Pinch runner: ${person(substitution.incomingId)} for ${person(substitution.outgoingId)}`
    case 'courtesy_runner':
      return `Courtesy runner: ${person(substitution.incomingId)} for ${person(substitution.outgoingId)}`
  }
}

function runs(scoredRunnerIds: readonly string[]): string {
  const count = scoredRunnerIds.length
  return count === 0 ? '' : count === 1 ? ', 1 run scores' : `, ${count} runs score`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Middle 3" after a top half, "End 3" after a bottom half, when the next unit opens a later half. */
function halfDivider(older: GameEvent, newer: GameEvent): string | null {
  const from = parseBaseballPeriod(older.period)
  const to = parseBaseballPeriod(newer.period)
  if (!from || !to || older.period.order >= newer.period.order) return null
  return `${from.half === 'top' ? 'Middle' : 'End'} ${from.inning}`
}

function formatPeriod(event: GameEvent): string {
  const period = parseBaseballPeriod(event.period)
  return period ? formatBaseballHalf(period.inning, period.half) : ''
}

// ---------------------------------------------------------------------------
// Read-only play details

export interface BaseballPlayDetail {
  id: string
  label: string
  halfLabel: string
  sections: Array<{ heading: string; lines: string[] }>
}

const FROM_LABELS: Record<string, string> = { batter: 'home', first: 'first', second: 'second', third: 'third' }
const BATTED_BALL_LABELS = Object.fromEntries(BASEBALL_BATTED_BALL_OPTIONS.map(option => [option.type, option.label])) as Record<string, string>

/**
 * What a capture unit recorded, for the read-only details sheet (BSB-3D): the result, the
 * batted ball, every runner's movement with fielders, errors and recorder overrides, and
 * whether each run counted. Editing older plays is the BSB-4 Timeline.
 */
export function baseballPlayDetail(state: GameState, playId: string, names: BaseballSideNames): BaseballPlayDetail | null {
  const sport = baseballSportState(state)
  if (!sport || !state.eventStream) return null
  const events = activeEvents(state)
  const unit = groupUnits(events).find(candidate => candidate[0].id === playId)
  if (!unit || !CAPTURE_TYPES.has(unit[0].eventType as BaseballEventType)) return null
  const scored = replayBaseballRunsByEvent(sport.setup, events)
  const person = (id: string) => baseballPersonLabel(sport, id).name
  const fielder = (position: number) => `${baseballFieldingPositionCode(position) ?? 'Fielder'} (${position})`
  const sections: BaseballPlayDetail['sections'] = []

  for (const event of unit) {
    const payload = event.payload as Record<string, unknown>
    const play: string[] = []
    const actor = (role: string) => event.actors.find(entry => entry.role === role)?.participantId ?? null
    const batter = actor('batter')
    const pitcher = actor('pitcher')
    if (batter) play.push(`Batter: ${person(batter)}`)
    if (pitcher) play.push(`Pitcher: ${person(pitcher)}`)
    if (event.eventType === 'baseball.pitch') {
      play.push(`Pitch: ${PITCH_LABELS[payload.result as string] ?? 'Pitch'}`)
      const location = payload.pitchLocation as { x: number; y: number } | null
      if (location) {
        const inZone = location.x >= 0 && location.x <= 1 && location.y >= 0 && location.y <= 1
        play.push(`Pitch location: ${inZone ? 'in the zone' : 'outside the zone'}`)
      }
    }
    if (event.eventType === 'baseball.plate_appearance') {
      play.push(`Quick result: ${QUICK_LABELS[payload.result as string] ?? 'Plate appearance'}`)
      if (payload.finalBalls !== null || payload.finalStrikes !== null) {
        play.push(`Final count: ${payload.finalBalls ?? '?'}-${payload.finalStrikes ?? '?'}`)
      }
    }
    if (event.eventType === 'baseball.baserunning') {
      play.push(`Runner play: ${RUNNER_PLAY_LABELS[payload.play as string] ?? 'Runner play'}`)
    }
    const inPlay = payload.inPlay as { result: BaseballInPlayResult; battedBallType: string; fielders: number[]; errorBy: number | null; insideThePark: boolean } | null | undefined
    if (inPlay) {
      play.push(`Result: ${capitalize(IN_PLAY_LABELS[inPlay.result])}${inPlay.insideThePark ? ' (inside the park)' : ''}`)
      play.push(`Batted ball: ${BATTED_BALL_LABELS[inPlay.battedBallType] ?? 'Unknown'}${event.location ? ', location marked' : ''}`)
      if (inPlay.fielders.length) play.push(`Fielded by: ${inPlay.fielders.map(fielder).join(', ')}`)
      if (inPlay.errorBy !== null) play.push(`Error: ${fielder(inPlay.errorBy)}`)
    }
    if (event.eventType === 'baseball.substitution' || event.eventType === 'baseball.score_adjustment') {
      play.push(baseballEventLabel(sport, event, names, []))
    }
    if (play.length) sections.push({ heading: unit.length > 1 ? baseballEventLabel(sport, event, names, scored.get(event.id) ?? []) : 'Play', lines: play })

    const movements = (payload.movements as BaseballRunnerMovement[] | undefined) ?? []
    if (movements.length) {
      const counted = new Set(scored.get(event.id) ?? [])
      sections.push({
        heading: 'Runners',
        lines: movements.map(movement => {
          const where = movement.to === 'out'
            ? `out${movement.fielders.length ? ` (${movement.fielders.join('-')})` : ''}`
            : `${FROM_LABELS[movement.from]} to ${movement.to}`
          const extras = [BASEBALL_REASON_LABELS[movement.reason]]
          if (movement.errorBy !== null) extras.push(`error on ${fielder(movement.errorBy)}`)
          if (movement.to === 'home') extras.push(counted.has(movement.runnerId) ? 'run counts' : 'run does not count')
          if (movement.earned !== null) extras.push(`earned set to ${movement.earned ? 'yes' : 'no'}`)
          if (movement.runCounts !== null) extras.push(`run counts set to ${movement.runCounts ? 'yes' : 'no'}`)
          if (movement.rbi !== null) extras.push(`RBI set to ${movement.rbi ? 'yes' : 'no'}`)
          return `${person(movement.runnerId)}: ${where} · ${extras.join(', ')}`
        }),
      })
    }
  }

  return {
    id: playId,
    label: unit.map(event => baseballEventLabel(sport, event, names, scored.get(event.id) ?? [])).join(' + '),
    halfLabel: formatPeriod(unit[0]),
    sections,
  }
}

// ---------------------------------------------------------------------------
// Internals

function activeEvents(state: GameState): GameEvent[] {
  const inspection = inspectGameEventStream(state.eventStream!, gameEventRegistry)
  return [...inspection.activeEvents].sort(compareGameEventCaptureOrder)
}

/** Consecutive events sharing a non-null `captureCommandId` form one unit. */
function groupUnits(events: readonly GameEvent[]): GameEvent[][] {
  const units: GameEvent[][] = []
  for (const event of events) {
    const commandId = captureCommandId(event)
    const last = units[units.length - 1]
    if (commandId && last && captureCommandId(last[0]) === commandId) last.push(event)
    else units.push([event])
  }
  return units
}

function captureCommandId(event: GameEvent): string | null {
  const value = (event.payload as { captureCommandId?: unknown }).captureCommandId
  return typeof value === 'string' ? value : null
}

function restoreMutations(state: GameState): GameEventMutation[] | null {
  const sport = baseballSportState(state)
  const receipt = sport?.capturePreferences.lastUndo
  if (!receipt || !state.eventStream) return null
  const mutations: GameEventMutation[] = []
  for (const entry of receipt.entries) {
    const event = findEvent(state, entry.eventId)
    if (!event || !event.deletedAt || event.revision !== entry.expectedRevision) return null
    mutations.push({ type: 'restore', eventId: event.id })
  }
  // Every new event clears the receipt, so a surviving receipt means nothing was recorded since.
  return mutations
}

function findEvent(state: GameState, eventId: string): GameEvent | null {
  const raw = state.eventStream?.events.find(candidate => isGameEventEnvelope(candidate) && candidate.id === eventId)
  return raw && isGameEventEnvelope(raw) ? (raw as GameEvent) : null
}

function applyChecked(
  state: GameState,
  sport: BaseballSportGameState,
  mutations: GameEventMutation[],
  receipt: BaseballUndoReceipt | null,
  now: string,
  events: GameEvent[]
): BaseballCommandResult {
  const removing = new Set(mutations.filter(mutation => mutation.type === 'delete').map(mutation => mutation.eventId))
  const restoring = mutations.filter(mutation => mutation.type === 'restore').map(mutation => findEvent(state, mutation.eventId)!)
  const candidate = [
    ...activeEvents(state).filter(event => !removing.has(event.id)),
    ...restoring.map(event => ({ ...event, deletedAt: null })),
  ].sort(compareGameEventCaptureOrder)
  const replay = replayBaseballEvents(sport.setup, candidate)
  if (replay.diagnostics.length > 0) return failure(state, replay.diagnostics[0].message)
  const result = applyGameEventMutations(state, mutations, now, gameEventRegistry, gameEventProjectors)
  if (!result.ok) return failure(state, result.error.message)
  if (!result.inspection.complete) return failure(state, 'The change would leave an incomplete Baseball history.')
  return { ok: true, state: withBaseballUndoReceipt(result.state, receipt), events }
}

function failure(state: GameState, message: string): BaseballCommandResult {
  return { ok: false, state, code: 'rejected', message }
}
