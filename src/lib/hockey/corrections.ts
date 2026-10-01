import type { GameState } from '../../types'
import { applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEvent, GameEventActor, GameEventMutation } from '../gameEvents/types'
import {
  adjustHockeyScore,
  changeHockeyGoalie,
  hockeyDerivedGoalStrength,
  hockeyGoalieActor,
  recordHockeyFaceoff,
  recordHockeyPenalties,
  recordHockeyPlay,
  recordHockeyShootoutAttempt,
  recordHockeyShot,
  recordHockeyTeamEvent,
  recordHockeyTimeout,
  startHockeyShootout,
  type HockeyActorChoice,
  type HockeyPlayKind,
  type RecordHockeyFaceoffInput,
  type RecordHockeyPenaltiesInput,
  type RecordHockeyPlayInput,
  type RecordHockeyShootoutAttemptInput,
  type RecordHockeyShotInput,
} from './captureCommands'
import { hockeySportState, withHockeyUndoReceipt, type HockeyCommandResult } from './live'
import { hockeyOnIceLimits, type HockeyOnIceLimits } from './penalties'
import { hockeyActivePeriod, replayHockeyEvents } from './projector'
import type { HockeyFaceoffDotId } from './rinkGeometry'
import type {
  HockeyGoalieChangeReason,
  HockeyMatchProjection,
  HockeyMatchResult,
  HockeyOffenderKind,
  HockeyOnIce,
  HockeyOpponentGoalie,
  HockeyPenaltyClass,
  HockeyInfraction,
  HockeyShootoutOutcome,
  HockeyShotOutcome,
  HockeySide,
  HockeySportGameState,
  HockeyStrength,
  HockeyTeamEventKind,
  HockeyMissType,
} from './types'
import { HOCKEY_CAPTURE_EVENT_TYPES } from './types'

/**
 * Timeline corrections (HKY-4B): edit, remove and restore of capture units that are already
 * in the right period and time. Edits rerun the family's capture command against the game as
 * it stood just before the unit (`runHockeyCommand` correction mode), so they get exactly the
 * checks live capture gets. Every result is a candidate state: the caller previews it with
 * `hockeyCorrectionConsequences` and saves it, or drops it.
 */

export type HockeyCorrectionInput =
  | { kind: 'shot'; input: RecordHockeyShotInput }
  | { kind: 'faceoff'; input: RecordHockeyFaceoffInput }
  | { kind: 'play'; input: RecordHockeyPlayInput }
  | { kind: 'penalties'; input: RecordHockeyPenaltiesInput }
  | {
      kind: 'goalie_change'
      input: {
        side: HockeySide
        inParticipantId: string | null
        reason: HockeyGoalieChangeReason
        newOpponentGoalie: HockeyOpponentGoalie | null
      }
    }
  | { kind: 'timeout'; input: { side: HockeySide } }
  | { kind: 'team_event'; input: { kind: HockeyTeamEventKind; side: HockeySide; location: { x: number; y: number } | null } }
  | { kind: 'score_adjustment'; input: { side: HockeySide; delta: 1 | -1; reason: string } }
  | { kind: 'shootout_start'; input: { firstSide: HockeySide } }
  | { kind: 'shootout_attempt'; input: RecordHockeyShootoutAttemptInput }

export interface HockeyCorrectionOptions {
  recorderUserId: string | null
  /** When the correction is saved. */
  now: string
}

/**
 * The editable values of a Timeline row, in the input of the command that recorded it, or
 * null when the row is read-only (lifecycle, clock and penalty releases).
 */
export function hockeyCorrectionInput(events: readonly GameEvent[]): HockeyCorrectionInput | null {
  const first = events[0]
  if (!first || first.deletedAt !== null) return null
  const payload = first.payload as Record<string, unknown>
  const side = first.teamSide === 'tracked' || first.teamSide === 'opponent' ? first.teamSide : null
  switch (first.eventType) {
    case 'hockey.shot': {
      if (!side) return null
      const assists = [actorChoice(first, 'assist_primary'), actorChoice(first, 'assist_secondary')]
        .filter((choice): choice is HockeyActorChoice => choice !== null)
      const goal = payload.outcome === 'goal'
      return {
        kind: 'shot',
        input: {
          side,
          outcome: payload.outcome as HockeyShotOutcome,
          missType: (payload.missType as HockeyMissType | null) ?? null,
          penaltyShot: payload.penaltyShot === true,
          emptyNet: payload.emptyNet === true,
          shooter: actorChoice(first, 'shooter'),
          assists,
          blocker: actorChoice(first, 'blocker'),
          location: point(first),
          onIce: goal ? structuredClone((payload.onIce as HockeyOnIce | null) ?? null) : null,
          strength: goal ? (payload.strength as HockeyStrength | null) ?? null : null,
          goalieId: first.actors.find(actor => actor.role === 'goalie')?.participantId ?? null,
        },
      }
    }
    case 'hockey.faceoff':
      return {
        kind: 'faceoff',
        input: {
          dotId: payload.dotId as HockeyFaceoffDotId,
          winner: payload.winner as HockeySide,
          takerParticipantId: first.actors.find(actor => actor.role === 'taker')?.participantId ?? null,
          opponentTakerLabel: first.actors.find(actor => actor.role === 'opponent_taker')?.label ?? null,
        },
      }
    case 'hockey.hit':
    case 'hockey.takeaway':
    case 'hockey.giveaway': {
      if (!side) return null
      const kind = first.eventType.replace('hockey.', '') as HockeyPlayKind
      return {
        kind: 'play',
        input: {
          kind,
          side,
          player: actorChoice(first, kind === 'hit' ? 'hitter' : 'player'),
          hitPlayer: kind === 'hit' ? actorChoice(first, 'hit_player') : null,
          location: point(first),
        },
      }
    }
    case 'hockey.penalty': {
      if (events.some(event => event.eventType !== 'hockey.penalty')) return null
      return {
        kind: 'penalties',
        input: {
          penalties: events.map(event => {
            const penalty = event.payload as Record<string, unknown>
            return {
              side: event.teamSide as HockeySide,
              class: penalty.class as HockeyPenaltyClass,
              infraction: penalty.infraction as HockeyInfraction,
              infractionLabel: (penalty.infractionLabel as string | null) ?? null,
              durationMs: penalty.durationMs as number,
              offenderKind: penalty.offenderKind as HockeyOffenderKind,
              offender: actorChoice(event, 'offender'),
              servedBy: actorChoice(event, 'served_by'),
              drawnBy: actorChoice(event, 'drawn_by'),
              delayed: penalty.delayed === true,
            }
          }),
          coincidental: typeof payload.coincidenceGroupId === 'string',
          ...(typeof payload.captureCommandId === 'string' ? { captureCommandId: payload.captureCommandId } : {}),
        },
      }
    }
    case 'hockey.goalie_change':
      if (!side) return null
      return {
        kind: 'goalie_change',
        input: {
          side,
          inParticipantId: (payload.inParticipantId as string | null) ?? null,
          reason: payload.reason as HockeyGoalieChangeReason,
          newOpponentGoalie: structuredClone((payload.newOpponentGoalie as HockeyOpponentGoalie | null) ?? null),
        },
      }
    case 'hockey.timeout':
      return side ? { kind: 'timeout', input: { side } } : null
    case 'hockey.team_event':
      return side
        ? { kind: 'team_event', input: { kind: payload.kind as HockeyTeamEventKind, side, location: point(first) } }
        : null
    case 'hockey.score_adjustment':
      return side
        ? { kind: 'score_adjustment', input: { side, delta: payload.delta as 1 | -1, reason: payload.reason as string } }
        : null
    case 'hockey.shootout_started':
      return { kind: 'shootout_start', input: { firstSide: payload.firstSide as HockeySide } }
    case 'hockey.shootout_attempt':
      return {
        kind: 'shootout_attempt',
        input: { outcome: payload.outcome as HockeyShootoutOutcome, shooter: actorChoice(first, 'shooter') },
      }
    default:
      return null
  }
}

/** Rebuilds one capture unit with new values; the result is a candidate to preview and save. */
export function correctHockeyEvents(
  state: GameState,
  eventIds: readonly string[],
  correction: HockeyCorrectionInput,
  options: HockeyCorrectionOptions
): HockeyCommandResult {
  const first = activeEvent(state, eventIds[0])
  if (!first) return rejected(state, 'That event is no longer active.')
  const context = {
    recorderUserId: options.recorderUserId,
    occurredAt: first.occurredAt,
    replaceEventIds: eventIds,
    correctedAt: options.now,
  }
  switch (correction.kind) {
    case 'shot':
      return recordHockeyShot(state, correction.input, context)
    case 'faceoff':
      return recordHockeyFaceoff(state, correction.input, context)
    case 'play':
      return recordHockeyPlay(state, correction.input, context)
    case 'penalties':
      return recordHockeyPenalties(state, correction.input, context)
    case 'goalie_change':
      return changeHockeyGoalie(state, correction.input, context)
    case 'timeout':
      return recordHockeyTimeout(state, correction.input, context)
    case 'team_event':
      return recordHockeyTeamEvent(state, correction.input, context)
    case 'score_adjustment':
      return adjustHockeyScore(state, correction.input, context)
    case 'shootout_start':
      return startHockeyShootout(state, correction.input, context)
    case 'shootout_attempt':
      return recordHockeyShootoutAttempt(state, correction.input, context)
  }
}

/**
 * The game as it stood just before a unit, for prefilling an edit dialog: the goalie in net,
 * players still in the game, the box-derived strength and the on-ice limits at that moment.
 */
export interface HockeyCorrectionScene {
  sport: HockeySportGameState
  /** Active events before the unit, in capture order. */
  events: GameEvent[]
  derivedStrength: (side: HockeySide) => HockeyStrength | null
  onIceLimits: HockeyOnIceLimits | null
}

export function hockeyCorrectionScene(state: GameState, eventIds: readonly string[]): HockeyCorrectionScene | null {
  const sport = hockeySportState(state)
  if (!sport || !state.eventStream) return null
  const ordered = activeEvents(state)
  const index = ordered.findIndex(event => event.id === eventIds[0])
  if (index < 0) return null
  const target = ordered[index]
  const events = ordered.slice(0, index)
  const replay = replayHockeyEvents(sport.setup, events)
  if (replay.diagnostics.length > 0) return null
  const projection = replay.projection
  const active = hockeyActivePeriod(projection)
  return {
    sport: { ...sport, projection },
    events,
    derivedStrength: side => projection.clock
      ? hockeyDerivedGoalStrength(sport.setup, projection, target.period.id, target.elapsedMs, side)
      : null,
    onIceLimits: active ? hockeyOnIceLimits(sport.setup, projection, active, target.elapsedMs) : null,
  }
}

// ---------------------------------------------------------------------------
// Remove and restore

const CAPTURE_TYPES = new Set<string>(HOCKEY_CAPTURE_EVENT_TYPES)

/** Whether a Timeline row can be removed or restored (lifecycle and clock rows cannot). */
export function canRemoveHockeyEvents(events: readonly GameEvent[]): boolean {
  return events.length > 0 && events.every(event => CAPTURE_TYPES.has(event.eventType))
}

/**
 * Active events removed together with a unit: a penalty's early releases and the shootout
 * start's attempts. A coincidence group is already one unit.
 */
export function hockeyRemovalDependents(state: GameState, eventIds: readonly string[]): GameEvent[] {
  const ids = new Set(eventIds)
  const events = streamEvents(state)
  const unit = events.filter(event => ids.has(event.id))
  const penaltyIds = new Set(unit.filter(event => event.eventType === 'hockey.penalty').map(event => event.id))
  const shootout = unit.some(event => event.eventType === 'hockey.shootout_started')
  return events.filter(event =>
    event.deletedAt === null &&
    !ids.has(event.id) &&
    ((event.eventType === 'hockey.penalty_release' &&
      penaltyIds.has((event.payload as { penaltyEventId?: string }).penaltyEventId ?? '')) ||
      (shootout && event.eventType === 'hockey.shootout_attempt'))
  )
}

/**
 * Removed events that were removed together with a unit (same removal time) and come back
 * with it: early releases are offered, shootout attempts always return with their start.
 */
export function hockeyRestoreDependents(
  state: GameState,
  eventIds: readonly string[]
): { releases: GameEvent[]; attempts: GameEvent[] } {
  const ids = new Set(eventIds)
  const events = streamEvents(state)
  const unit = events.filter(event => ids.has(event.id))
  const removedAt = unit[0]?.deletedAt ?? null
  if (!removedAt) return { releases: [], attempts: [] }
  const penaltyIds = new Set(unit.filter(event => event.eventType === 'hockey.penalty').map(event => event.id))
  const shootout = unit.some(event => event.eventType === 'hockey.shootout_started')
  const removedWith = events.filter(event => event.deletedAt === removedAt && !ids.has(event.id))
  return {
    releases: removedWith.filter(event =>
      event.eventType === 'hockey.penalty_release' &&
      penaltyIds.has((event.payload as { penaltyEventId?: string }).penaltyEventId ?? '')
    ),
    attempts: shootout ? removedWith.filter(event => event.eventType === 'hockey.shootout_attempt') : [],
  }
}

/** Removes a whole capture unit and its dependents in one checked batch. */
export function removeHockeyEvents(state: GameState, eventIds: readonly string[], now: string): HockeyCommandResult {
  const sport = hockeySportState(state)
  if (!sport || !state.eventStream) return rejected(state, 'This is not a Hockey event game.')
  const unit = eventIds.map(id => activeEvent(state, id))
  if (unit.length === 0 || unit.some(event => !event)) return rejected(state, 'That event is no longer active.')
  if (!canRemoveHockeyEvents(unit as GameEvent[])) return rejected(state, 'Game flow and clock rows cannot be removed.')
  const statusMessage = correctableStatus(sport, state)
  if (statusMessage) return rejected(state, statusMessage)
  const targets = [...(unit as GameEvent[]), ...hockeyRemovalDependents(state, eventIds)]
  return applyChecked(state, sport, targets.map(event => ({ type: 'delete', eventId: event.id })), now)
}

/** Restores a removed unit, its shootout attempts, and its early releases when asked. */
export function restoreHockeyEvents(
  state: GameState,
  eventIds: readonly string[],
  options: { withReleases: boolean },
  now: string
): HockeyCommandResult {
  const sport = hockeySportState(state)
  if (!sport || !state.eventStream) return rejected(state, 'This is not a Hockey event game.')
  const events = streamEvents(state)
  const unit = eventIds.map(id => events.find(event => event.id === id))
  if (unit.length === 0 || unit.some(event => !event || event.deletedAt === null)) {
    return rejected(state, 'That event is not removed.')
  }
  if (!canRemoveHockeyEvents(unit as GameEvent[])) return rejected(state, 'Game flow and clock rows cannot be restored.')
  const statusMessage = correctableStatus(sport, state)
  if (statusMessage) return rejected(state, statusMessage)
  const dependents = hockeyRestoreDependents(state, eventIds)
  const targets = [...(unit as GameEvent[]), ...dependents.attempts, ...(options.withReleases ? dependents.releases : [])]
  return applyChecked(state, sport, targets.map(event => ({ type: 'restore', eventId: event.id })), now)
}

// ---------------------------------------------------------------------------
// Goalie stamps (§7 Q4)

/**
 * Restamps shots recorded against a goalie the goalie changes no longer put in net: the goalie
 * in net becomes the stamped goalie, or the shot becomes an empty-net shot.
 */
export function updateHockeyGoalieStamps(state: GameState, eventIds: readonly string[], now: string): HockeyCommandResult {
  const sport = hockeySportState(state)
  if (!sport || !state.eventStream) return rejected(state, 'This is not a Hockey event game.')
  const replay = replayHockeyEvents(sport.setup, activeEvents(state))
  const wanted = new Set(eventIds)
  const mutations: GameEventMutation[] = []
  for (const warning of replay.projection.warnings) {
    if (warning.role !== 'goalie' || !wanted.has(warning.eventId)) continue
    const shot = activeEvent(state, warning.eventId)
    if (!shot || shot.eventType !== 'hockey.shot') continue
    const defending: HockeySide = shot.teamSide === 'tracked' ? 'opponent' : 'tracked'
    const actors: GameEventActor[] = shot.actors.filter(actor => actor.role !== 'goalie')
    const resolved = warning.resolvedParticipantId
    if (resolved !== null) actors.push(hockeyGoalieActor(sport.setup, replay.projection, defending, resolved))
    mutations.push({
      type: 'update',
      eventId: shot.id,
      changes: { actors, payload: { ...shot.payload, emptyNet: resolved === null } },
    })
  }
  if (mutations.length === 0) return rejected(state, 'No shot needs a new goalie.')
  return applyChecked(state, sport, mutations, now)
}

// ---------------------------------------------------------------------------
// Consequence preview

export interface HockeyStrengthConsequence {
  eventId: string
  stored: HockeyStrength
  derived: HockeyStrength
}

export interface HockeyGoalieConsequence {
  eventId: string
  recordedParticipantId: string | null
  resolvedParticipantId: string | null
  message: string
}

export interface HockeyCorrectionConsequences {
  score: { before: { tracked: number; opponent: number }; after: { tracked: number; opponent: number } } | null
  /** Only when the game has ended before or after the correction. */
  result: { before: HockeyMatchResult | null; after: HockeyMatchResult | null } | null
  /** Goals whose stored strength now differs from the box. Stored strength still wins. */
  strength: HockeyStrengthConsequence[]
  /** Shots now recorded against a goalie who was not in net. */
  goalies: HockeyGoalieConsequence[]
  /** Participants removed from the game by a penalty, or no longer removed. */
  removedPlayers: { added: string[]; cleared: string[] }
  /** A sudden-death overtime lead appearing or disappearing. */
  suddenDeath: 'decided' | 'undecided' | null
}

/** What a candidate correction changes, compared with the current game. */
export function hockeyCorrectionConsequences(before: GameState, after: GameState): HockeyCorrectionConsequences {
  const sport = hockeySportState(after) ?? hockeySportState(before)
  const empty: HockeyCorrectionConsequences = {
    score: null,
    result: null,
    strength: [],
    goalies: [],
    removedPlayers: { added: [], cleared: [] },
    suddenDeath: null,
  }
  if (!sport) return empty
  const old = analyse(sport, before)
  const next = analyse(sport, after)
  const scoreChanged =
    old.projection.score.tracked !== next.projection.score.tracked ||
    old.projection.score.opponent !== next.projection.score.opponent
  const ended = old.projection.status === 'ended' || next.projection.status === 'ended'
  const resultChanged = JSON.stringify(old.projection.result) !== JSON.stringify(next.projection.result)

  const strength: HockeyStrengthConsequence[] = []
  for (const [eventId, entry] of next.strength) {
    if (entry.stored === entry.derived) continue
    const previous = old.strength.get(eventId)
    // Only a mismatch this correction creates; one the recorder chose before stays unlisted.
    if (previous && previous.derived === entry.derived && previous.stored === entry.stored) continue
    strength.push({ eventId, stored: entry.stored, derived: entry.derived })
  }
  const oldGoalies = new Set(old.projection.warnings.map(warning => `${warning.eventId}:${warning.resolvedParticipantId}`))
  const goalies = next.projection.warnings
    .filter(warning => warning.role === 'goalie' && !oldGoalies.has(`${warning.eventId}:${warning.resolvedParticipantId}`))
    .map(warning => ({
      eventId: warning.eventId,
      recordedParticipantId: warning.recordedParticipantId,
      resolvedParticipantId: warning.resolvedParticipantId,
      message: warning.message,
    }))
  const oldRemoved = new Set(old.projection.removedParticipantIds)
  const newRemoved = new Set(next.projection.removedParticipantIds)
  const oldDecided = old.projection.decidedInPeriodId
  const newDecided = next.projection.decidedInPeriodId
  return {
    score: scoreChanged ? { before: { ...old.projection.score }, after: { ...next.projection.score } } : null,
    result: ended && resultChanged ? { before: old.projection.result, after: next.projection.result } : null,
    strength,
    goalies,
    removedPlayers: {
      added: [...newRemoved].filter(id => !oldRemoved.has(id)),
      cleared: [...oldRemoved].filter(id => !newRemoved.has(id)),
    },
    suddenDeath: oldDecided === newDecided ? null : newDecided ? 'decided' : 'undecided',
  }
}

export function hasHockeyCorrectionConsequences(consequences: HockeyCorrectionConsequences): boolean {
  return Boolean(
    consequences.score ||
    consequences.result ||
    consequences.strength.length ||
    consequences.goalies.length ||
    consequences.removedPlayers.added.length ||
    consequences.removedPlayers.cleared.length ||
    consequences.suddenDeath
  )
}

// ---------------------------------------------------------------------------
// Internals

function analyse(sport: HockeySportGameState, state: GameState): {
  projection: HockeyMatchProjection
  strength: Map<string, { stored: HockeyStrength; derived: HockeyStrength }>
} {
  const strength = new Map<string, { stored: HockeyStrength; derived: HockeyStrength }>()
  const replay = replayHockeyEvents(sport.setup, state.eventStream ? activeEvents(state) : [], (event, projection) => {
    if (event.eventType !== 'hockey.shot') return
    const payload = event.payload as { outcome?: string; strength?: HockeyStrength | null }
    if (payload.outcome !== 'goal' || !payload.strength) return
    if (event.teamSide !== 'tracked' && event.teamSide !== 'opponent') return
    const derived = hockeyDerivedGoalStrength(sport.setup, projection, event.period.id, event.elapsedMs, event.teamSide)
    strength.set(event.id, { stored: payload.strength, derived })
  })
  return { projection: replay.projection, strength }
}

function correctableStatus(sport: HockeySportGameState, state: GameState): string | null {
  const replay = replayHockeyEvents(sport.setup, activeEvents(state))
  const status = replay.projection.status
  if (replay.diagnostics.length === 0 && (status === 'suspended' || status === 'abandoned')) {
    return 'Reopen the game to correct it.'
  }
  return null
}

function applyChecked(
  state: GameState,
  sport: HockeySportGameState,
  mutations: GameEventMutation[],
  now: string
): HockeyCommandResult {
  const byId = new Map(mutations.map(mutation => [mutation.eventId, mutation]))
  const candidate = streamEvents(state).flatMap(event => {
    const mutation = byId.get(event.id)
    if (!mutation) return event.deletedAt === null ? [event] : []
    if (mutation.type === 'delete') return []
    if (mutation.type === 'restore') return [{ ...event, deletedAt: null }]
    return [{ ...event, ...mutation.changes } as GameEvent]
  })
  const replay = replayHockeyEvents(sport.setup, candidate)
  if (replay.diagnostics.length > 0) return rejected(state, replay.diagnostics[0].message)
  const result = applyGameEventMutations(state, mutations, now, gameEventRegistry, gameEventProjectors)
  if (!result.ok) return rejected(state, result.error.message)
  if (!result.inspection.complete) return rejected(state, 'The change would leave an incomplete Hockey history.')
  // A correction ends the chance to restore the last undone capture (the Basketball rule).
  return { ok: true, state: withHockeyUndoReceipt(result.state, null), events: [] }
}

function streamEvents(state: GameState): GameEvent[] {
  if (!state.eventStream) return []
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  return [...inspection.activeEvents, ...inspection.deletedEvents].sort(compareGameEventCaptureOrder)
}

function activeEvents(state: GameState): GameEvent[] {
  return streamEvents(state).filter(event => event.deletedAt === null)
}

function activeEvent(state: GameState, eventId: string | undefined): GameEvent | null {
  return activeEvents(state).find(event => event.id === eventId) ?? null
}

function actorChoice(event: GameEvent, role: string): HockeyActorChoice | null {
  const actor = event.actors.find(entry => entry.role === role)
  if (!actor) return null
  if (actor.participantId) return { participantId: actor.participantId }
  return actor.label ? { label: actor.label } : null
}

function point(event: GameEvent): { x: number; y: number } | null {
  return event.location ? { x: event.location.x, y: event.location.y } : null
}

function rejected(state: GameState, message: string): HockeyCommandResult {
  return { ok: false, state, code: 'rejected', message }
}
