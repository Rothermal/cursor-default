import type { GameState, Player } from '../../types'
import { addGameEvent, applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventActor } from '../gameEvents/types'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import {
  basketballActorForSelection,
  getBasketballCommandContext,
  type BasketballCommandErrorCode,
  type BasketballCommandResult,
  type BasketballStateCommandResult,
} from './commands'
import type {
  BasketballCourtUndoReceipt,
  BasketballEjectionEvent,
  BasketballFoulEvent,
  BasketballMatchEvent,
  BasketballTeamSide,
} from './types'

export type BasketballEjectionSubject =
  | { kind: 'player'; playerId: string }
  | { kind: 'staff'; label: string }

export interface BasketballOfficialEjectionOptions {
  recorderUserId: string | null
  teamSide: BasketballTeamSide
  subject: BasketballEjectionSubject
  reason: string
  relatedFoulEventId?: string | null
  occurredAt?: string
  eventId?: string
}

export interface BasketballEjectionFoulCandidate {
  eventId: string
  teamSide: BasketballTeamSide
  subject: BasketballEjectionSubject
  label: string
}

export interface BasketballOfficialEjectionStatus {
  eventId: string
  teamSide: BasketballTeamSide
  periodId: string
  subject: BasketballEjectionSubject
  subjectLabel: string
  reason: string
  relatedFoulEventId: string | null
  removable: boolean
}

export interface BasketballEjectionRemovalPreview {
  eventId: string
  subjectLabel: string
  subjectIsPlayer: boolean
  linkedFoulKept: boolean
  playerRemainsDisqualified: boolean
  requiresConfirmation: true
}

export type BasketballEjectionCommandResult =
  | { ok: true; state: GameState; eventId: string }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string }

export function captureBasketballOfficialEjection(
  state: GameState,
  options: BasketballOfficialEjectionOptions
): BasketballEjectionCommandResult {
  if (isFinalCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const context = getBasketballCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!context.ok) return failure(state, context.code, context.message)
  const reason = options.reason.trim()
  if (!reason) return failure(state, 'command_failed', 'Official Basketball ejections require a reason.')

  const subject = resolveSubjectActor(state, options.teamSide, options.subject)
  if (!subject.ok) return failure(state, subject.code, subject.message)
  if (alreadyOfficiallyEjected(state, options.teamSide, subject.value)) {
    return failure(state, 'invalid_actor', 'That Basketball player or staff member is already ejected.')
  }

  const relatedFoulEventId = options.relatedFoulEventId ?? null
  if (relatedFoulEventId) {
    const foul = activeBasketballEvents(state).find(
      (event): event is BasketballFoulEvent =>
        event.id === relatedFoulEventId && event.eventType === 'basketball.foul'
    )
    if (
      !foul ||
      foul.period.id !== context.value.period.id ||
      foul.teamSide !== options.teamSide ||
      !sameSubject(foul.actors.find(actor => actor.role === 'committed_by'), subject.value)
    ) {
      return failure(
        state,
        'command_failed',
        'The linked foul must be an active current-period foul for the ejected subject.'
      )
    }
  }

  const event = createBasketballAdministrativeEvent({
    id: options.eventId,
    eventType: 'basketball.ejection',
    payload: {
      reason,
      source: 'official_ruling',
      relatedFoulEventId,
      captureCommandId: null,
    },
    recorderUserId: options.recorderUserId,
    sequence: context.value.nextSequence,
    period: context.value.period,
    occurredAt: context.value.occurredAt,
    teamSide: options.teamSide,
    actors: [subject.value],
  })
  const candidate = clearUndoReceipt(state)
  const appended = addGameEvent(candidate, event, gameEventRegistry, gameEventProjectors)
  if (!appended.ok || !appended.inspection.complete) {
    return failure(
      state,
      'command_failed',
      appended.ok
        ? 'Basketball ejection capture did not produce a complete event projection.'
        : appended.error.message
    )
  }
  return { ok: true, state: appended.state, eventId: event.id }
}

export function basketballEjectionFoulCandidates(
  state: GameState
): BasketballEjectionFoulCandidate[] {
  const currentPeriodId = state.sportGameState?.sportId === 'basketball' &&
    state.sportGameState.projection.status === 'in_progress'
    ? state.sportGameState.projection.currentPeriodId
    : null
  if (!currentPeriodId) return []
  const fouls = activeBasketballEvents(state)
    .filter((event): event is BasketballFoulEvent =>
      event.eventType === 'basketball.foul' && event.period.id === currentPeriodId
    )
    .sort((left, right) => compareGameEventCaptureOrder(right, left))
  const subjectPositions = new Map<string, number>()
  const candidates: BasketballEjectionFoulCandidate[] = []
  for (const event of fouls) {
    const actor = event.actors.find(candidate => candidate.role === 'committed_by')
    const subject = actorToSubject(actor)
    if (!subject) continue
    const key = ejectionSubjectKey(event.teamSide, subject)
    const position = (subjectPositions.get(key) ?? 0) + 1
    subjectPositions.set(key, position)
    candidates.push({
      eventId: event.id,
      teamSide: event.teamSide,
      subject,
      label: `${foulClassLabel(event.payload.class)} foul - ${foulContextLabel(event.payload.context)} - ${recencyLabel(position)}`,
    })
  }
  return candidates
}

export function basketballOfficialEjectionStatuses(
  state: GameState
): BasketballOfficialEjectionStatus[] {
  const currentPeriodId = state.sportGameState?.sportId === 'basketball' &&
    state.sportGameState.projection.status === 'in_progress'
    ? state.sportGameState.projection.currentPeriodId
    : null
  const playerNames = new Map(state.players.map(player => [player.id, playerLabel(player)]))
  return activeBasketballEvents(state)
    .filter((event): event is BasketballEjectionEvent =>
      event.eventType === 'basketball.ejection' && event.payload.source === 'official_ruling'
    )
    .sort((left, right) => compareGameEventCaptureOrder(right, left))
    .flatMap(event => {
      const actor = event.actors.find(candidate => candidate.role === 'subject')
      const subject = actorToSubject(actor)
      if (!subject || !actor) return []
      return [{
        eventId: event.id,
        teamSide: event.teamSide,
        periodId: event.period.id,
        subject,
        subjectLabel: actor.kind === 'player'
          ? playerNames.get(actor.playerId) ?? actor.label ?? 'Player'
          : actor.label ?? 'Staff',
        reason: event.payload.reason,
        relatedFoulEventId: event.payload.relatedFoulEventId,
        removable: event.period.id === currentPeriodId,
      }]
    })
}

export function previewBasketballEjectionRemoval(
  state: GameState,
  eventId: string
): BasketballCommandResult<BasketballEjectionRemovalPreview> {
  if (isFinalCloudGame(state)) {
    return commandFailure('cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  const event = removableOfficialEjection(state, eventId)
  if (!event) {
    return commandFailure('nothing_to_undo', 'There is no matching current-period official ejection to remove.')
  }
  const subject = event.actors.find(actor => actor.role === 'subject')!
  const participant = subject.participantId && state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection.participants[subject.participantId]
    : null
  return {
    ok: true,
    value: {
      eventId,
      subjectLabel: actorDisplayLabel(state.players, subject),
      subjectIsPlayer: subject.kind === 'player',
      linkedFoulKept: Boolean(event.payload.relatedFoulEventId),
      playerRemainsDisqualified: Boolean(participant?.disqualified),
      requiresConfirmation: true,
    },
  }
}

export function removeBasketballOfficialEjection(
  state: GameState,
  eventId: string,
  now = new Date().toISOString()
): BasketballStateCommandResult {
  if (isFinalCloudGame(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Reopen the finalized game before editing it.')
  }
  if (!now || !Number.isFinite(Date.parse(now))) {
    return failure(state, 'invalid_timestamp', 'Basketball correction timestamp is invalid.')
  }
  const event = removableOfficialEjection(state, eventId)
  if (!event) {
    return failure(state, 'nothing_to_undo', 'There is no matching current-period official ejection to remove.')
  }
  const receipt: BasketballCourtUndoReceipt = {
    kind: 'administrative_decrement',
    createdAt: now,
    entries: [{
      eventId: event.id,
      expectedRevision: event.revision + 1,
      action: 'restore',
      previousRelatedEventId: null,
      previousAttemptNumber: null,
    }],
  }
  const result = applyGameEventMutations(
    state,
    [{ type: 'delete', eventId }],
    now,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return failure(
      state,
      'command_failed',
      result.ok
        ? 'Basketball ejection correction did not produce a complete event projection.'
        : result.error.message
    )
  }
  return { ok: true, state: withUndoReceipt(result.state, receipt) }
}

function resolveSubjectActor(
  state: GameState,
  teamSide: BasketballTeamSide,
  subject: BasketballEjectionSubject
): BasketballCommandResult<GameEventActor> {
  if (subject.kind === 'staff') {
    const label = subject.label.trim()
    return label
      ? { ok: true, value: { role: 'subject', kind: 'staff', label } }
      : commandFailure('invalid_actor', 'Enter a coach or staff label for the ejection.')
  }
  const participant = state.sportGameState?.sportId === 'basketball'
    ? Object.values(state.sportGameState.projection.participants)
        .find(candidate => candidate.playerId === subject.playerId)
    : null
  if (!participant || participant.teamSide !== teamSide) {
    return commandFailure('invalid_actor', 'The ejected player must belong to the selected Basketball side.')
  }
  return basketballActorForSelection(
    state,
    'subject',
    teamSide,
    { kind: 'participant', participantId: participant.participantId },
    { allowUnavailable: true }
  )
}

function removableOfficialEjection(
  state: GameState,
  eventId: string
): BasketballEjectionEvent | null {
  const currentPeriodId = state.sportGameState?.sportId === 'basketball' &&
    state.sportGameState.projection.status === 'in_progress'
    ? state.sportGameState.projection.currentPeriodId
    : null
  if (!currentPeriodId) return null
  return activeBasketballEvents(state).find(
    (event): event is BasketballEjectionEvent =>
      event.id === eventId &&
      event.eventType === 'basketball.ejection' &&
      event.payload.source === 'official_ruling' &&
      event.period.id === currentPeriodId
  ) ?? null
}

function alreadyOfficiallyEjected(
  state: GameState,
  teamSide: BasketballTeamSide,
  subject: GameEventActor
): boolean {
  return activeBasketballEvents(state).some(event =>
    event.eventType === 'basketball.ejection' &&
    event.payload.source === 'official_ruling' &&
    event.teamSide === teamSide &&
    sameSubject(event.actors.find(actor => actor.role === 'subject'), subject)
  )
}

function activeBasketballEvents(state: GameState): BasketballMatchEvent[] {
  if (!state.eventStream) return []
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) return []
  return inspection.activeEvents.filter(
    (event): event is BasketballMatchEvent => event.sportId === 'basketball'
  )
}

function actorToSubject(actor: GameEventActor | undefined): BasketballEjectionSubject | null {
  if (actor?.kind === 'player') return { kind: 'player', playerId: actor.playerId }
  if (actor?.kind === 'staff' && actor.label) return { kind: 'staff', label: actor.label }
  return null
}

function sameSubject(left: GameEventActor | undefined, right: GameEventActor): boolean {
  if (!left || left.kind !== right.kind) return false
  if (left.kind === 'player' && right.kind === 'player') return left.playerId === right.playerId
  if (left.kind === 'staff' && right.kind === 'staff') {
    return normalizeLabel(left.label) === normalizeLabel(right.label)
  }
  return false
}

function normalizeLabel(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? ''
}

function playerLabel(player: Player): string {
  const number = player.number.trim()
  return number ? `#${number} ${player.name}` : player.name
}

function actorDisplayLabel(players: Player[], actor: GameEventActor): string {
  if (actor.kind !== 'player') return actor.label ?? 'Staff'
  const player = players.find(candidate => candidate.id === actor.playerId)
  return player ? playerLabel(player) : actor.label ?? 'Player'
}

function foulClassLabel(value: BasketballFoulEvent['payload']['class']): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ')
}

function foulContextLabel(value: BasketballFoulEvent['payload']['context']): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ')
}

function ejectionSubjectKey(
  teamSide: BasketballTeamSide,
  subject: BasketballEjectionSubject
): string {
  return subject.kind === 'player'
    ? `${teamSide}:player:${subject.playerId}`
    : `${teamSide}:staff:${normalizeLabel(subject.label)}`
}

function recencyLabel(position: number): string {
  if (position === 1) return 'most recent'
  const remainder = position % 100
  const suffix = remainder >= 11 && remainder <= 13
    ? 'th'
    : position % 10 === 1
      ? 'st'
      : position % 10 === 2
        ? 'nd'
        : position % 10 === 3
          ? 'rd'
          : 'th'
  return `${position}${suffix} most recent`
}

function clearUndoReceipt(state: GameState): GameState {
  return withUndoReceipt(state, null)
}

function withUndoReceipt(
  state: GameState,
  receipt: BasketballCourtUndoReceipt | null
): GameState {
  if (state.sportGameState?.sportId !== 'basketball') return state
  return {
    ...state,
    sportGameState: {
      ...state.sportGameState,
      capturePreferences: {
        ...state.sportGameState.capturePreferences,
        lastCourtUndo: receipt,
      },
    },
  }
}

function isFinalCloudGame(state: GameState): boolean {
  return state.cloudSync.gameStatus === 'final'
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballStateCommandResult & { ok: false } {
  return { ok: false, state, code, message }
}

function commandFailure<T>(
  code: BasketballCommandErrorCode,
  message: string
): BasketballCommandResult<T> & { ok: false } {
  return { ok: false, code, message }
}
