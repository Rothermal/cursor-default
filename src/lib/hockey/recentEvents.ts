import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEvent, GameEventMutation } from '../gameEvents/types'
import { HOCKEY_OUTCOME_LABELS } from './captureCommands'
import { hockeySportState, withHockeyUndoReceipt, type HockeyCommandResult } from './live'
import { hockeyPenaltyLabel } from './penalties'
import { formatHockeyPeriod, parseHockeyPeriod } from './periods'
import { replayHockeyEvents } from './projector'
import type {
  HockeyMatchSetup,
  HockeyPenaltyPayload,
  HockeyShotOutcome,
  HockeySportGameState,
  HockeyUndoReceipt,
} from './types'
import { HOCKEY_CAPTURE_EVENT_TYPES } from './types'

/** One row of Recent Events: a capture unit, or a lifecycle or clock event shown for context. */
export interface HockeyRecentEventRow {
  /** The first event's id; stable for React keys. */
  id: string
  eventIds: string[]
  label: string
  periodLabel: string
  elapsedMs: number | null
  capture: boolean
  /** True only for the newest active unit, when nothing later depends on it. */
  undoable: boolean
}

const CAPTURE_TYPES = new Set<string>(HOCKEY_CAPTURE_EVENT_TYPES)

/**
 * The newest active rows, newest first (HKY-2C). A capture unit is the events sharing a
 * `captureCommandId`, or a single event; lifecycle and clock rows are context only.
 */
export function hockeyRecentEvents(
  state: GameState,
  sideLabels: HockeySideLabels = DEFAULT_SIDE_LABELS,
  limit = 10
): HockeyRecentEventRow[] {
  const sport = hockeySportState(state)
  if (!sport || !state.eventStream) return []
  const active = activeEvents(state)
  const rows: HockeyRecentEventRow[] = []
  const units = groupUnits(active)
  for (let index = units.length - 1; index >= 0 && rows.length < limit; index--) {
    const unit = units[index]
    const first = unit[0]
    const capture = CAPTURE_TYPES.has(first.eventType)
    rows.push({
      id: first.id,
      eventIds: unit.map(event => event.id),
      label: unit.map(event => hockeyEventLabel(sport.setup, event, sideLabels)).join(' + '),
      periodLabel: periodLabel(first),
      elapsedMs: first.elapsedMs,
      capture,
      undoable: capture && index === units.length - 1,
    })
  }
  return rows
}

/** Removes the newest capture unit, keeping a receipt so Restore can bring it back. */
export function undoHockeyCapture(state: GameState, now: string): HockeyCommandResult {
  const sport = hockeySportState(state)
  if (!sport || !state.eventStream) return failure(state, 'This is not a Hockey event game.')
  const units = groupUnits(activeEvents(state))
  const newest = units[units.length - 1]
  if (!newest || !CAPTURE_TYPES.has(newest[0].eventType)) {
    return failure(state, 'Nothing to undo: the latest event is part of the game flow.')
  }
  const mutations: GameEventMutation[] = newest.map(event => ({ type: 'delete', eventId: event.id }))
  const receipt: HockeyUndoReceipt = {
    createdAt: now,
    entries: newest.map(event => ({ eventId: event.id, expectedRevision: event.revision + 1 })),
  }
  return applyChecked(state, sport, mutations, receipt, now, newest)
}

/** True when the receipt still matches the stream, so Restore would succeed structurally. */
export function canRestoreHockeyCapture(state: GameState): boolean {
  return restoreMutations(state) !== null
}

/** Restores the capture unit Undo just removed, if nothing has been recorded since. */
export function restoreHockeyCapture(state: GameState, now: string): HockeyCommandResult {
  const sport = hockeySportState(state)
  if (!sport || !state.eventStream) return failure(state, 'This is not a Hockey event game.')
  const mutations = restoreMutations(state)
  if (!mutations) return failure(state, 'There is nothing to restore.')
  const restored = mutations.map(mutation => findEvent(state, mutation.eventId)!)
  return applyChecked(state, sport, mutations, null, now, restored)
}

export interface HockeySideLabels {
  tracked: string
  opponent: string
}

const DEFAULT_SIDE_LABELS: HockeySideLabels = { tracked: 'Tracked', opponent: 'Opponent' }

export function hockeyEventLabel(
  setup: HockeyMatchSetup,
  event: GameEvent,
  sideLabels: HockeySideLabels = DEFAULT_SIDE_LABELS
): string {
  const side = event.teamSide === 'tracked' ? sideLabels.tracked : event.teamSide === 'opponent' ? sideLabels.opponent : null
  const who = (role: string) => {
    const actor = event.actors.find(entry => entry.role === role)
    if (!actor) return null
    return setup.participants.find(entry => entry.id === actor.participantId)?.displayName ?? actor.label ?? null
  }
  const by = (role: string) => {
    const name = who(role)
    return name ? ` by ${name}` : ''
  }
  const payload = event.payload as Record<string, unknown>
  switch (event.eventType) {
    case 'hockey.shot':
      return `${side} ${HOCKEY_OUTCOME_LABELS[payload.outcome as HockeyShotOutcome].toLowerCase()}${by('shooter')}`
    case 'hockey.goalie_change':
      return payload.inParticipantId === null ? `${side} goalie pulled` : `${side} goalie change`
    case 'hockey.score_adjustment':
      return `${side} score ${(payload.delta as number) > 0 ? '+1' : '-1'} (${payload.reason as string})`
    case 'hockey.faceoff':
      return `${sideLabels.tracked} faceoff ${payload.winner === 'tracked' ? 'win' : 'loss'}${by('taker')}`
    case 'hockey.hit':
      return `${side} hit${by('hitter')}`
    case 'hockey.takeaway':
      return `${side} takeaway${by('player')}`
    case 'hockey.giveaway':
      return `${side} giveaway${by('player')}`
    case 'hockey.penalty': {
      const penalty = payload as unknown as HockeyPenaltyPayload
      const offender = penalty.offenderKind === 'bench' || penalty.offenderKind === 'staff'
        ? ` (${penalty.offenderKind})`
        : who('offender') ? ` on ${who('offender')}` : ''
      return `${side} ${hockeyPenaltyLabel(penalty)}${offender}`
    }
    case 'hockey.penalty_release':
      return `${side} penalty released early (${payload.reason as string})`
    default:
      return event.eventType.replace('hockey.', '').replace(/_/g, ' ')
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
  const sport = hockeySportState(state)
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
  sport: HockeySportGameState,
  mutations: GameEventMutation[],
  receipt: HockeyUndoReceipt | null,
  now: string,
  events: GameEvent[]
): HockeyCommandResult {
  const removing = new Set(mutations.filter(mutation => mutation.type === 'delete').map(mutation => mutation.eventId))
  const restoring = mutations.filter(mutation => mutation.type === 'restore').map(mutation => findEvent(state, mutation.eventId)!)
  const candidate = [
    ...activeEvents(state).filter(event => !removing.has(event.id)),
    ...restoring.map(event => ({ ...event, deletedAt: null })),
  ]
  const replay = replayHockeyEvents(sport.setup, candidate)
  if (replay.diagnostics.length > 0) return failure(state, replay.diagnostics[0].message)
  const result = applyGameEventMutations(state, mutations, now, gameEventRegistry, gameEventProjectors)
  if (!result.ok) return failure(state, result.error.message)
  if (!result.inspection.complete) return failure(state, 'The change would leave an incomplete Hockey history.')
  return { ok: true, state: withHockeyUndoReceipt(result.state, receipt), events }
}

function periodLabel(event: GameEvent): string {
  const period = parseHockeyPeriod(event.period)
  return period ? formatHockeyPeriod(period) : ''
}

function failure(state: GameState, message: string): HockeyCommandResult {
  return { ok: false, state, code: 'rejected', message }
}
