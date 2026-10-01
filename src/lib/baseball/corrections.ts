import type { GameState } from '../../types'
import { applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import type { GameEvent, GameEventMutation } from '../gameEvents/types'
import { baseballSportState, type BaseballCommandResult } from './commands'
import { createBaseballUuid } from './id'
import { formatBaseballHalf } from './periods'
import { baseballFieldingPositionCode } from './positions'
import { replayBaseballCreditByEvent, replayBaseballEvents, type BaseballEventCredit } from './projector'
import { baseballEventLabel, type BaseballSideNames } from './recentPlays'
import { baseballPersonLabel } from './trackerView'
import {
  BASEBALL_MAX_CORRECTION_RECEIPTS,
  type BaseballCorrectionReceipt,
  type BaseballMatchProjection,
  type BaseballSportGameState,
} from './types'
import {
  baseballActiveEvents,
  baseballRemovedEvents,
  findBaseballStoredEvent,
  formatBaseballEventHalf,
  groupBaseballUnits,
  isBaseballCaptureEvent,
} from './units'

/**
 * Timeline Remove and Restore (BSB-4C), under the BSB-4 section 4.1 contract: every correction
 * replays the full candidate history first, later rows the engine rejects are listed as
 * dependents (plays and game flow separately), and credit is compared before and after so a
 * moved batter or pitcher credit is shown even when no warning changes. Nothing is retagged or
 * rewritten; the recorder confirms what the preview lists, and the save re-checks it.
 */

export interface BaseballCorrectionRow {
  /** The unit's first event id. */
  id: string
  eventIds: string[]
  label: string
  halfLabel: string
}

export interface BaseballDependentRow extends BaseballCorrectionRow {
  /** Why the engine rejects the row once the correction is made, word for word. */
  reason: string
}

export interface BaseballCorrectionPreview {
  action: 'remove' | 'restore'
  /** What the recorder chose: the removed unit, the removed row restored, or a receipt's group. */
  target: BaseballCorrectionTarget
  /** The rows removed or restored by choice. */
  rows: BaseballCorrectionRow[]
  dependents: { plays: BaseballDependentRow[]; lifecycle: BaseballDependentRow[] }
  /** Score, half-inning, outs, count and runner differences. */
  changes: string[]
  /** Batting or pitching credit (or fielding credit) that moves to someone else. */
  creditMoves: string[]
  /** New or changed fielder mismatches: the lineup differs, credit stays as stamped. */
  fieldingKept: string[]
  /** Mismatches the correction clears without moving credit. Needs no confirmation. */
  information: string[]
  /** True when dependents, credit moves or kept fielding credit need "Save with these changes". */
  needsConfirmation: boolean
  /** Compared on save, so a preview made against an older history is rejected. */
  key: string
}

export type BaseballCorrectionTarget =
  | { kind: 'remove'; unitId: string }
  | { kind: 'restore_unit'; unitId: string }
  | { kind: 'restore_group'; receiptId: string }

export type BaseballCorrectionPreviewResult =
  | { ok: true; preview: BaseballCorrectionPreview }
  | { ok: false; message: string }

export interface BaseballCorrectionOptions {
  now: string
  /** The recorder pressed "Save with these changes" on this preview. */
  confirmed: boolean
  /** Fixed in tests; a new id otherwise. */
  receiptId?: string
}

/** Previews removing one play (a capture unit) from anywhere in the game. */
export function previewBaseballRemoval(state: GameState, unitId: string, names: BaseballSideNames): BaseballCorrectionPreviewResult {
  const sport = baseballSportState(state)
  if (!sport || !state.eventStream) return refuse('This is not a Baseball event game.')
  const unit = groupBaseballUnits(baseballActiveEvents(state)).find(candidate => candidate[0].id === unitId)
  if (!unit) return refuse('That play is no longer in the game.')
  if (!isBaseballCaptureEvent(unit[0])) {
    return refuse('Game-flow rows are not removed on their own. Reopen a finished game, or remove the play they depend on.')
  }
  return buildPreview(state, sport, names, { kind: 'remove', unitId }, unit, [])
}

/**
 * Previews restoring removed rows: one removed unit on its own, or a saved removal as a group.
 * A group is offered only while every entry is still removed at the revision its removal gave it.
 */
export function previewBaseballRestore(
  state: GameState,
  target: Extract<BaseballCorrectionTarget, { kind: 'restore_unit' | 'restore_group' }>,
  names: BaseballSideNames
): BaseballCorrectionPreviewResult {
  const sport = baseballSportState(state)
  if (!sport || !state.eventStream) return refuse('This is not a Baseball event game.')
  const removed = baseballRemovedEvents(state)
  if (target.kind === 'restore_unit') {
    const unit = groupBaseballUnits(removed).find(candidate => candidate[0].id === target.unitId)
    if (!unit) return refuse('That row is not removed.')
    return buildPreview(state, sport, names, target, [], unit)
  }
  const receipt = sport.capturePreferences.corrections.find(entry => entry.id === target.receiptId)
  if (!receipt || receipt.kind !== 'remove') return refuse('That removal can no longer be restored together.')
  const status = baseballCorrectionGroupStatus(state, receipt)
  if (!status.restorable) {
    return refuse('Some of these rows changed since they were removed. Restore them one at a time.')
  }
  const ids = new Set(receipt.entries.map(entry => entry.eventId))
  return buildPreview(state, sport, names, target, [], removed.filter(event => ids.has(event.id)))
}

/** Whether a saved removal can still be restored together, and which of its rows changed. */
export function baseballCorrectionGroupStatus(
  state: GameState,
  receipt: BaseballCorrectionReceipt
): { restorable: boolean; changedEventIds: string[] } {
  const changed = receipt.entries
    .filter(entry => {
      const event = findBaseballStoredEvent(state, entry.eventId)
      return !event || !event.deletedAt || event.revision !== entry.expectedRevision
    })
    .map(entry => entry.eventId)
  return { restorable: receipt.kind === 'remove' && changed.length === 0, changedEventIds: changed }
}

/** Removes the previewed play and its confirmed dependents as one atomic batch, with a receipt. */
export function removeBaseballPlay(
  state: GameState,
  preview: BaseballCorrectionPreview,
  names: BaseballSideNames,
  options: BaseballCorrectionOptions
): BaseballCommandResult {
  if (preview.target.kind !== 'remove') return failure(state, 'That preview is not a removal.')
  return saveCorrection(state, previewBaseballRemoval(state, preview.target.unitId, names), preview, options)
}

/** Restores the previewed rows (and removes any confirmed dependents) as one atomic batch. */
export function restoreBaseballCorrection(
  state: GameState,
  preview: BaseballCorrectionPreview,
  names: BaseballSideNames,
  options: BaseballCorrectionOptions
): BaseballCommandResult {
  if (preview.target.kind === 'remove') return failure(state, 'That preview is not a restore.')
  return saveCorrection(state, previewBaseballRestore(state, preview.target, names), preview, options)
}

// ---------------------------------------------------------------------------
// Preview

function buildPreview(
  state: GameState,
  sport: BaseballSportGameState,
  names: BaseballSideNames,
  target: BaseballCorrectionTarget,
  removing: GameEvent[],
  restoring: GameEvent[]
): BaseballCorrectionPreviewResult {
  const before = baseballActiveEvents(state)
  const removingIds = new Set(removing.map(event => event.id))
  const restoringIds = new Set(restoring.map(event => event.id))
  let candidate = [
    ...before.filter(event => !removingIds.has(event.id)),
    ...restoring.map(event => ({ ...event, deletedAt: null })),
  ].sort(compareGameEventCaptureOrder)

  // The engine stops at the first rejected row, so remove it and replay again until the rest
  // replays; every row removed this way is a dependent the recorder must see.
  const dependents: Array<{ unit: GameEvent[]; reason: string }> = []
  let after = replayBaseballEvents(sport.setup, candidate)
  while (after.diagnostics.length > 0) {
    const diagnostic = after.diagnostics[0]
    const failing = candidate.find(event => event.id === diagnostic.eventId)
    if (!failing) return refuse(diagnostic.message)
    if (restoringIds.has(failing.id)) return refuse(`This row cannot come back here: ${diagnostic.message}`)
    if (failing.eventType === 'baseball.game_started') return refuse(diagnostic.message)
    const unit = groupBaseballUnits(candidate).find(entry => entry.some(event => event.id === failing.id))!
    if (unit.some(event => restoringIds.has(event.id))) return refuse(`This row cannot come back here: ${diagnostic.message}`)
    dependents.push({ unit, reason: diagnostic.message })
    const dropped = new Set(unit.map(event => event.id))
    candidate = candidate.filter(event => !dropped.has(event.id))
    after = replayBaseballEvents(sport.setup, candidate)
  }

  const row = (unit: readonly GameEvent[]): BaseballCorrectionRow => ({
    id: unit[0].id,
    eventIds: unit.map(event => event.id),
    label: unit.map(event => baseballEventLabel(sport, event, names, [])).join(' + '),
    halfLabel: formatBaseballEventHalf(unit[0]),
  })
  const chosen = groupBaseballUnits(removing.length ? removing : restoring).map(row)
  dependents.sort((a, b) => compareGameEventCaptureOrder(a.unit[0], b.unit[0]))
  const plays: BaseballDependentRow[] = []
  const lifecycle: BaseballDependentRow[] = []
  for (const dependent of dependents) {
    const entry = { ...row(dependent.unit), reason: dependent.reason }
    if (isBaseballCaptureEvent(dependent.unit[0])) plays.push(entry)
    else lifecycle.push(entry)
  }

  const beforeProjection = replayBaseballEvents(sport.setup, before).projection
  const changes = describeChanges(sport, names, beforeProjection, after.projection)
  const credit = compareCredit(
    sport,
    candidate,
    replayBaseballCreditByEvent(sport.setup, before),
    replayBaseballCreditByEvent(sport.setup, candidate),
    beforeProjection,
    after.projection
  )
  const needsConfirmation =
    dependents.length > 0 || credit.creditMoves.length > 0 || credit.fieldingKept.length > 0
  const preview: BaseballCorrectionPreview = {
    action: target.kind === 'remove' ? 'remove' : 'restore',
    target,
    rows: chosen,
    dependents: { plays, lifecycle },
    changes,
    ...credit,
    needsConfirmation,
    key: '',
  }
  preview.key = JSON.stringify([
    target,
    chosen.map(entry => entry.eventIds),
    dependents.map(entry => entry.unit.map(event => [event.id, event.revision])),
    changes,
    credit.creditMoves,
    credit.fieldingKept,
  ])
  return { ok: true, preview }
}

const STATUS_LABELS: Record<BaseballMatchProjection['status'], string> = {
  pregame: 'not started',
  in_progress: 'in progress',
  final: 'final',
  suspended: 'suspended',
  abandoned: 'abandoned',
}

function describeChanges(
  sport: BaseballSportGameState,
  names: BaseballSideNames,
  before: BaseballMatchProjection,
  after: BaseballMatchProjection
): string[] {
  const lines: string[] = []
  if (before.score.tracked !== after.score.tracked || before.score.opponent !== after.score.opponent) {
    lines.push(
      `Score: ${names.tracked} ${before.score.tracked}–${before.score.opponent} ${names.opponent} becomes ${after.score.tracked}–${after.score.opponent}`
    )
  }
  if (before.status !== after.status) {
    lines.push(`The game goes from ${STATUS_LABELS[before.status]} to ${STATUS_LABELS[after.status]}`)
  }
  const sameHalf = before.inning === after.inning && before.half === after.half
  if (!sameHalf) {
    lines.push(
      `Play resumes in ${formatBaseballHalf(after.inning, after.half)} instead of ${formatBaseballHalf(before.inning, before.half)}`
    )
  }
  if (before.outs !== after.outs) lines.push(`Outs: ${before.outs} becomes ${after.outs}`)
  if (sameHalf && (before.balls !== after.balls || before.strikes !== after.strikes)) {
    lines.push(`Count: ${before.balls}-${before.strikes} becomes ${after.balls}-${after.strikes}`)
  }
  const bases = (projection: BaseballMatchProjection) => {
    const entries = (['first', 'second', 'third'] as const)
      .filter(base => projection.bases[base])
      .map(base => `${baseballPersonLabel(sport, projection.bases[base]!.runnerId).name} on ${base}`)
    return entries.length ? entries.join(', ') : 'bases empty'
  }
  const beforeBases = bases(before)
  const afterBases = bases(after)
  if (beforeBases !== afterBases) lines.push(`Runners: ${beforeBases} becomes ${afterBases}`)
  return lines
}

/**
 * Compares, for every event in both histories, who the replay credits, and the fielder
 * mismatches it reports. Moves in the same half and role are grouped into one line.
 */
function compareCredit(
  sport: BaseballSportGameState,
  candidate: readonly GameEvent[],
  before: Map<string, BaseballEventCredit>,
  after: Map<string, BaseballEventCredit>,
  beforeProjection: BaseballMatchProjection,
  afterProjection: BaseballMatchProjection
): Pick<BaseballCorrectionPreview, 'creditMoves' | 'fieldingKept' | 'information'> {
  const person = (id: string | null) => (id ? baseballPersonLabel(sport, id).name : 'nobody')
  const moves = new Map<string, { half: string; role: string; from: string; to: string; plays: number }>()
  const moved = new Set<string>()
  const addMove = (event: GameEvent, role: string, key: string, from: string | null, to: string | null) => {
    moved.add(`${event.id}:${key}`)
    const half = formatBaseballEventHalf(event)
    const groupKey = JSON.stringify([half, role, from, to])
    const existing = moves.get(groupKey)
    if (existing) existing.plays += 1
    else moves.set(groupKey, { half, role, from: person(from), to: person(to), plays: 1 })
  }
  for (const event of candidate) {
    const previous = before.get(event.id)
    const next = after.get(event.id)
    if (!previous || !next) continue
    if (previous.batterId !== next.batterId) addMove(event, 'batting', 'batter', previous.batterId, next.batterId)
    if (previous.pitcherId !== next.pitcherId) addMove(event, 'pitching', 'pitcher', previous.pitcherId, next.pitcherId)
    const positions = new Set([...Object.keys(previous.fielders), ...Object.keys(next.fielders)])
    for (const position of [...positions].sort((a, b) => Number(a) - Number(b))) {
      const from = previous.fielders[position] ?? null
      const to = next.fielders[position] ?? null
      if (from !== to) {
        addMove(event, `fielding at ${baseballFieldingPositionCode(Number(position)) ?? position}`, `fielder_${position}`, from, to)
      }
    }
  }
  const creditMoves = [...moves.values()].map(move =>
    `${move.half} ${move.role}: moves from ${move.from} to ${move.to}${move.plays > 1 ? ` (${move.plays} plays)` : ''}`
  )

  const surviving = new Set(candidate.map(event => event.id))
  const warningKey = (warning: BaseballMatchProjection['warnings'][number]) =>
    JSON.stringify([warning.eventId, warning.role, warning.recordedParticipantId, warning.resolvedParticipantId])
  const beforeWarnings = new Map(beforeProjection.warnings.map(warning => [warningKey(warning), warning]))
  const afterWarnings = new Map(afterProjection.warnings.map(warning => [warningKey(warning), warning]))

  const fieldingKept = new Set<string>()
  for (const [key, warning] of afterWarnings) {
    if (beforeWarnings.has(key) || !warning.role.startsWith('fielder_')) continue
    // Restored rows are new to the history; only rows that were already there can change.
    if (!before.has(warning.eventId)) continue
    const position = Number(warning.role.slice('fielder_'.length))
    const event = candidate.find(entry => entry.id === warning.eventId)
    fieldingKept.add(
      `${event ? `${formatBaseballEventHalf(event)}: ` : ''}lineup now shows ${person(warning.resolvedParticipantId)} at ${baseballFieldingPositionCode(position) ?? position}; credit stays with ${person(warning.recordedParticipantId)}`
    )
  }

  const information = new Set<string>()
  for (const [key, warning] of beforeWarnings) {
    if (afterWarnings.has(key) || !surviving.has(warning.eventId)) continue
    if (afterProjection.warnings.some(entry => entry.eventId === warning.eventId && entry.role === warning.role)) continue
    if (moved.has(`${warning.eventId}:${warning.role}`)) continue
    const event = candidate.find(entry => entry.id === warning.eventId)
    information.add(`${event ? `${formatBaseballEventHalf(event)}: ` : ''}${person(warning.recordedParticipantId)} now matches the lineup`)
  }

  return { creditMoves, fieldingKept: [...fieldingKept], information: [...information] }
}

// ---------------------------------------------------------------------------
// Save

function saveCorrection(
  state: GameState,
  fresh: BaseballCorrectionPreviewResult,
  preview: BaseballCorrectionPreview,
  options: BaseballCorrectionOptions
): BaseballCommandResult {
  if (!fresh.ok) return failure(state, fresh.message)
  if (fresh.preview.key !== preview.key) {
    return failure(state, 'The game changed since this preview. Review the changes again.')
  }
  if (fresh.preview.needsConfirmation && !options.confirmed) {
    return failure(state, 'Review the listed changes and choose Save with these changes.')
  }
  const sport = baseballSportState(state)!
  const chosenIds = fresh.preview.rows.flatMap(row => row.eventIds)
  const dependentIds = [...fresh.preview.dependents.plays, ...fresh.preview.dependents.lifecycle].flatMap(row => row.eventIds)
  const restoring = fresh.preview.action === 'restore'
  const mutations: GameEventMutation[] = [
    ...chosenIds.map(eventId => ({ type: restoring ? 'restore' as const : 'delete' as const, eventId })),
    ...dependentIds.map(eventId => ({ type: 'delete' as const, eventId })),
  ]
  const result = applyGameEventMutations(state, mutations, options.now, gameEventRegistry, gameEventProjectors)
  if (!result.ok) return failure(state, result.error.message)
  if (!result.inspection.complete) return failure(state, 'The change would leave an incomplete Baseball history.')

  const revisionOf = (eventId: string) => findBaseballStoredEvent(result.state, eventId)!.revision
  const removedIds = restoring ? dependentIds : [...chosenIds, ...dependentIds]
  const restoredIds = new Set(restoring ? chosenIds : [])
  let receipts = sport.capturePreferences.corrections
  if (fresh.preview.target.kind === 'restore_group') {
    const receiptId = fresh.preview.target.receiptId
    receipts = receipts.filter(entry => entry.id !== receiptId)
  }
  // A row restored on its own drops out of its group; the rest of the group stays together.
  receipts = receipts
    .map(entry => ({
      ...entry,
      primaryEventIds: entry.primaryEventIds.filter(id => !restoredIds.has(id)),
      entries: entry.entries.filter(item => !restoredIds.has(item.eventId)),
    }))
    .filter(entry => entry.entries.length > 0)
  if (removedIds.length > 0) {
    const receipt: BaseballCorrectionReceipt = {
      id: options.receiptId ?? createBaseballUuid(),
      createdAt: options.now,
      kind: 'remove',
      primaryEventIds: restoring ? [] : chosenIds,
      entries: removedIds.map(eventId => ({ eventId, expectedRevision: revisionOf(eventId) })),
    }
    receipts = [receipt, ...receipts]
  }
  const nextSport = baseballSportState(result.state)!
  const next: GameState = {
    ...result.state,
    sportGameState: {
      ...nextSport,
      capturePreferences: {
        ...nextSport.capturePreferences,
        // Any Timeline correction ends quick Restore, as in Basketball.
        lastUndo: null,
        corrections: receipts.slice(0, BASEBALL_MAX_CORRECTION_RECEIPTS),
      },
    },
  }
  const touched = new Set([...chosenIds, ...dependentIds])
  const events = (result.inspection.activeEvents as GameEvent[])
    .concat(result.inspection.deletedEvents as GameEvent[])
    .filter(event => touched.has(event.id))
  return { ok: true, state: next, events }
}

function refuse(message: string): BaseballCorrectionPreviewResult {
  return { ok: false, message }
}

function failure(state: GameState, message: string): BaseballCommandResult {
  return { ok: false, state, code: 'rejected', message }
}
