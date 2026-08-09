import type { GameState } from '../../types'
import { addGameEvent, addGameEvents } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type { GameEventActor } from '../gameEvents/types'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import {
  basketballActorForSelection,
  basketballCaptureTargetForPlayerId,
  createBasketballCaptureCommandId,
  getBasketballCommandContext,
  type BasketballCaptureActorSelection,
  type BasketballCommandErrorCode,
} from './commands'
import { createBasketballUuid } from './id'
import { createBasketballStatEvent } from './statEvents'
import type {
  BasketballMatchEvent,
  BasketballScoreAdjustmentPayload,
  BasketballTeamSide,
} from './types'

export type BasketballDirectStatId =
  | 'ft'
  | 'ft_miss'
  | '2pt'
  | '2pt_miss'
  | '3pt'
  | '3pt_miss'
  | 'oreb'
  | 'dreb'
  | 'ast'
  | 'stl'
  | 'blk'
  | 'to'
  | 'min'
  | 'team_turnover'

export interface BasketballDirectStatOptions {
  recorderUserId: string | null
  playerId: string
  statId: BasketballDirectStatId
  occurredAt?: string
  eventId?: string
}

export interface BasketballScoreAdjustmentOptions {
  recorderUserId: string | null
  teamSide: BasketballTeamSide
  delta: number
  reason: BasketballScoreAdjustmentPayload['reason']
  note?: string | null
  occurredAt?: string
  eventId?: string
}

export type BasketballTurnoverTarget =
  | { kind: 'player'; playerId: string }
  | { kind: 'team' }
  | { kind: 'unknown'; label: string }

export interface BasketballStealTurnoverOptions {
  recorderUserId: string | null
  stealerPlayerId: string
  turnoverTarget: BasketballTurnoverTarget
  occurredAt?: string
  eventIds?: string[]
  captureCommandId?: string
}

export interface BasketballMinutesDecrementOptions {
  recorderUserId: string | null
  playerId: string
  occurredAt?: string
  eventId?: string
}

export type BasketballDirectCommandResult =
  | { ok: true; state: GameState; eventIds: string[] }
  | {
      ok: false
      state: GameState
      code: BasketballCommandErrorCode
      message: string
    }

export function captureBasketballDirectStat(
  state: GameState,
  options: BasketballDirectStatOptions
): BasketballDirectCommandResult {
  const guarded = directCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!guarded.ok) return guarded
  const target = basketballCaptureTargetForPlayerId(state, options.playerId)
  if (!target.ok) return failure(state, target.code, target.message)

  const { nextSequence, occurredAt, period } = guarded.context
  const id = options.eventId ?? createBasketballUuid()
  const common = {
    id,
    recorderUserId: options.recorderUserId,
    sequence: nextSequence,
    period,
    occurredAt,
    teamSide: target.value.teamSide,
  }
  let event: BasketballMatchEvent

  if (options.statId === 'min') {
    if (guarded.context.sportState.setup.rulesSnapshot.clockModel !== 'none') {
      return failure(state, 'command_failed', 'Manual Basketball minutes are unavailable when the game clock is authoritative.')
    }
    if (target.value.selection.kind !== 'participant') {
      return failure(state, 'invalid_actor', 'Minutes require an individual Basketball participant.')
    }
    const actor = basketballActorForSelection(
      state,
      'player',
      target.value.teamSide,
      target.value.selection
    )
    if (!actor.ok || actor.value.kind !== 'player') {
      return failure(
        state,
        actor.ok ? 'invalid_actor' : actor.code,
        actor.ok ? 'Minutes require a resolved Basketball player.' : actor.message
      )
    }
    event = createBasketballAdministrativeEvent({
      ...common,
      eventType: 'basketball.minutes_adjustment',
      payload: { deltaMinutes: 1, captureCommandId: null },
      actors: [actor.value],
    })
  } else if (isShotStat(options.statId)) {
    if (target.value.selection.kind === 'team') {
      return failure(state, 'invalid_actor', 'Direct Basketball shots require an individual player.')
    }
    const actor = basketballActorForSelection(
      state,
      'shooter',
      target.value.teamSide,
      target.value.selection
    )
    if (!actor.ok) return failure(state, actor.code, actor.message)
    const shot = shotDescriptor(options.statId)
    event = createBasketballStatEvent({
      ...common,
      eventType: 'basketball.shot',
      payload: {
        ...shot,
        freeThrowTripId: null,
        tripAttemptNumber: null,
        captureCommandId: null,
      },
      actors: [actor.value],
    })
  } else if (options.statId === 'team_turnover') {
    if (target.value.selection.kind !== 'team') {
      return failure(state, 'invalid_actor', 'A team turnover must target a Basketball team chip.')
    }
    const actor = basketballActorForSelection(
      state,
      'committed_by',
      target.value.teamSide,
      target.value.selection
    )
    if (!actor.ok) return failure(state, actor.code, actor.message)
    event = createBasketballStatEvent({
      ...common,
      eventType: 'basketball.turnover',
      payload: { kind: 'team', captureCommandId: null },
      actors: [actor.value],
    })
  } else if (options.statId === 'to') {
    if (target.value.selection.kind === 'team') {
      return failure(state, 'invalid_actor', 'A player turnover requires an individual Basketball actor.')
    }
    const actor = basketballActorForSelection(
      state,
      'committed_by',
      target.value.teamSide,
      target.value.selection
    )
    if (!actor.ok) return failure(state, actor.code, actor.message)
    event = createBasketballStatEvent({
      ...common,
      eventType: 'basketball.turnover',
      payload: { kind: 'player', captureCommandId: null },
      actors: [actor.value],
    })
  } else {
    const descriptor = relatedStatDescriptor(options.statId)
    const actor = basketballActorForSelection(
      state,
      descriptor.role,
      target.value.teamSide,
      target.value.selection
    )
    if (!actor.ok) return failure(state, actor.code, actor.message)
    event = createRelatedStatEvent(descriptor, common, actor.value)
  }

  return appendDirectEvents(
    state,
    withCaptureTarget(state, target.value.teamSide, target.value.selection),
    [event]
  )
}

export function decrementBasketballMinutes(
  state: GameState,
  options: BasketballMinutesDecrementOptions
): BasketballDirectCommandResult {
  const guarded = directCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!guarded.ok) return guarded
  if (guarded.context.sportState.setup.rulesSnapshot.clockModel !== 'none') {
    return failure(state, 'command_failed', 'Manual Basketball minutes are unavailable when the game clock is authoritative.')
  }
  const target = basketballCaptureTargetForPlayerId(state, options.playerId)
  if (!target.ok) return failure(state, target.code, target.message)
  if (target.value.selection.kind !== 'participant') {
    return failure(state, 'invalid_actor', 'Minutes require an individual Basketball participant.')
  }
  const participant = guarded.context.sportState.projection.participants[
    target.value.selection.participantId
  ]
  if (!participant || participant.stats.min < 1) {
    return failure(state, 'command_failed', 'Basketball minutes cannot be adjusted below zero.')
  }
  const actor = basketballActorForSelection(
    state,
    'player',
    target.value.teamSide,
    target.value.selection,
    { allowUnavailable: true }
  )
  if (!actor.ok || actor.value.kind !== 'player') {
    return failure(
      state,
      actor.ok ? 'invalid_actor' : actor.code,
      actor.ok ? 'Minutes require a resolved Basketball player.' : actor.message
    )
  }
  const event = createBasketballAdministrativeEvent({
    id: options.eventId,
    eventType: 'basketball.minutes_adjustment',
    payload: { deltaMinutes: -1, captureCommandId: null },
    recorderUserId: options.recorderUserId,
    sequence: guarded.context.nextSequence,
    period: guarded.context.period,
    occurredAt: guarded.context.occurredAt,
    teamSide: target.value.teamSide,
    actors: [actor.value],
  })
  return appendDirectEvents(
    state,
    withCaptureTarget(state, target.value.teamSide, target.value.selection),
    [event]
  )
}

export function adjustBasketballScore(
  state: GameState,
  options: BasketballScoreAdjustmentOptions
): BasketballDirectCommandResult {
  const guarded = directCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!guarded.ok) return guarded
  if (!Number.isInteger(options.delta) || options.delta === 0) {
    return failure(state, 'command_failed', 'Basketball score adjustment must be a non-zero whole number.')
  }
  const note = options.note?.trim() || null
  if (options.reason === 'official_correction' && !note) {
    return failure(state, 'command_failed', 'Official Basketball score corrections require a note.')
  }
  const score = guarded.context.sportState.projection.score[options.teamSide]
  if (score + options.delta < 0) {
    return failure(state, 'command_failed', 'Basketball score cannot be adjusted below zero.')
  }
  const actor = basketballActorForSelection(
    state,
    'team',
    options.teamSide,
    { kind: 'team' }
  )
  if (!actor.ok) return failure(state, actor.code, actor.message)
  const event = createBasketballStatEvent({
    id: options.eventId,
    eventType: 'basketball.score_adjustment',
    payload: {
      delta: options.delta,
      reason: options.reason,
      note,
      captureCommandId: null,
    },
    recorderUserId: options.recorderUserId,
    sequence: guarded.context.nextSequence,
    period: guarded.context.period,
    occurredAt: guarded.context.occurredAt,
    teamSide: options.teamSide,
    actors: [actor.value],
  })
  return appendDirectEvents(state, clearUndoReceipt(state), [event])
}

export function captureBasketballStealTurnover(
  state: GameState,
  options: BasketballStealTurnoverOptions
): BasketballDirectCommandResult {
  const guarded = directCommandContext(state, options.recorderUserId, options.occurredAt)
  if (!guarded.ok) return guarded
  const stealerTarget = basketballCaptureTargetForPlayerId(state, options.stealerPlayerId)
  if (!stealerTarget.ok) return failure(state, stealerTarget.code, stealerTarget.message)
  if (stealerTarget.value.selection.kind !== 'participant') {
    return failure(state, 'invalid_actor', 'Steal + Turnover requires an individual stealer.')
  }
  const turnoverSide = oppositeSide(stealerTarget.value.teamSide)
  const turnoverSelection = turnoverSelectionForOptions(state, turnoverSide, options.turnoverTarget)
  if (!turnoverSelection.ok) return turnoverSelection
  const turnoverActor = basketballActorForSelection(
    state,
    'committed_by',
    turnoverSide,
    turnoverSelection.selection
  )
  if (!turnoverActor.ok) return failure(state, turnoverActor.code, turnoverActor.message)
  const stealer = basketballActorForSelection(
    state,
    'stealer',
    stealerTarget.value.teamSide,
    stealerTarget.value.selection
  )
  if (!stealer.ok) return failure(state, stealer.code, stealer.message)

  const commandId = options.captureCommandId ?? createBasketballCaptureCommandId()
  const turnoverId = options.eventIds?.[0] ?? createBasketballUuid()
  const stealId = options.eventIds?.[1] ?? createBasketballUuid()
  const common = {
    recorderUserId: options.recorderUserId,
    period: guarded.context.period,
    occurredAt: guarded.context.occurredAt,
  }
  const turnover = createBasketballStatEvent({
    ...common,
    id: turnoverId,
    eventType: 'basketball.turnover',
    payload: {
      kind: options.turnoverTarget.kind === 'team' ? 'team' : 'player',
      captureCommandId: commandId,
    },
    sequence: guarded.context.nextSequence,
    teamSide: turnoverSide,
    actors: [turnoverActor.value],
  })
  const steal = createBasketballStatEvent({
    ...common,
    id: stealId,
    eventType: 'basketball.steal',
    payload: { relatedEventId: turnoverId, captureCommandId: commandId },
    sequence: guarded.context.nextSequence + 1,
    teamSide: stealerTarget.value.teamSide,
    actors: [stealer.value],
  })
  return appendDirectEvents(
    state,
    withCaptureTarget(state, stealerTarget.value.teamSide, stealerTarget.value.selection),
    [turnover, steal]
  )
}

function directCommandContext(
  state: GameState,
  recorderUserId: string | null,
  occurredAt?: string
): { ok: true; context: Exclude<ReturnType<typeof getBasketballCommandContext>, { ok: false }>['value'] } |
  { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string } {
  if (hasCloudBinding(state)) {
    return failure(state, 'cloud_flow_unsupported', 'Basketball event capture is local-only during development.')
  }
  const context = getBasketballCommandContext(state, recorderUserId, occurredAt)
  return context.ok ? { ok: true, context: context.value } : failure(state, context.code, context.message)
}

function appendDirectEvents(
  originalState: GameState,
  candidateState: GameState,
  events: BasketballMatchEvent[]
): BasketballDirectCommandResult {
  const appended = events.length === 1
    ? addGameEvent(candidateState, events[0], gameEventRegistry, gameEventProjectors)
    : addGameEvents(candidateState, events, gameEventRegistry, gameEventProjectors)
  if (!appended.ok || !appended.inspection.complete) {
    return failure(
      originalState,
      'command_failed',
      appended.ok
        ? 'Basketball direct capture did not produce a complete event projection.'
        : appended.error.message
    )
  }
  return { ok: true, state: appended.state, eventIds: events.map(event => event.id) }
}

function withCaptureTarget(
  state: GameState,
  teamSide: BasketballTeamSide,
  selection: BasketballCaptureActorSelection
): GameState {
  if (state.sportGameState?.sportId !== 'basketball') return state
  return {
    ...state,
    sportGameState: {
      ...state.sportGameState,
      capturePreferences: {
        ...state.sportGameState.capturePreferences,
        teamSide,
        selectedParticipantId: selection.kind === 'participant' ? selection.participantId : null,
        selectionInitialized: true,
        lastCourtUndo: null,
      },
    },
  }
}

function clearUndoReceipt(state: GameState): GameState {
  if (state.sportGameState?.sportId !== 'basketball') return state
  return {
    ...state,
    sportGameState: {
      ...state.sportGameState,
      capturePreferences: {
        ...state.sportGameState.capturePreferences,
        lastCourtUndo: null,
      },
    },
  }
}

function isShotStat(statId: BasketballDirectStatId): statId is
  'ft' | 'ft_miss' | '2pt' | '2pt_miss' | '3pt' | '3pt_miss' {
  return statId === 'ft' || statId === 'ft_miss' || statId === '2pt' ||
    statId === '2pt_miss' || statId === '3pt' || statId === '3pt_miss'
}

function shotDescriptor(statId: 'ft' | 'ft_miss' | '2pt' | '2pt_miss' | '3pt' | '3pt_miss') {
  if (statId === 'ft' || statId === 'ft_miss') {
    return {
      value: 1 as const,
      made: statId === 'ft',
      attempt: 'free_throw' as const,
      valueSource: 'free_throw' as const,
    }
  }
  const value = statId.startsWith('3') ? 3 as const : 2 as const
  return {
    value,
    made: !statId.endsWith('_miss'),
    attempt: 'field_goal' as const,
    valueSource: 'quick_entry' as const,
  }
}

function relatedStatDescriptor(statId: Exclude<
  BasketballDirectStatId,
  'ft' | 'ft_miss' | '2pt' | '2pt_miss' | '3pt' | '3pt_miss' | 'to' | 'min' | 'team_turnover'
>) {
  switch (statId) {
    case 'oreb': return { eventType: 'basketball.rebound' as const, role: 'rebounder', kind: 'offensive' as const }
    case 'dreb': return { eventType: 'basketball.rebound' as const, role: 'rebounder', kind: 'defensive' as const }
    case 'ast': return { eventType: 'basketball.assist' as const, role: 'assister' }
    case 'stl': return { eventType: 'basketball.steal' as const, role: 'stealer' }
    case 'blk': return { eventType: 'basketball.block' as const, role: 'blocker' }
  }
}

type RelatedStatDescriptor = ReturnType<typeof relatedStatDescriptor>

function createRelatedStatEvent(
  descriptor: RelatedStatDescriptor,
  common: {
    id: string
    recorderUserId: string | null
    sequence: number
    period: { id: string; order: number }
    occurredAt: string
    teamSide: BasketballTeamSide
  },
  actor: GameEventActor
): BasketballMatchEvent {
  const related = { relatedEventId: null, captureCommandId: null }
  if (descriptor.eventType === 'basketball.rebound') {
    return createBasketballStatEvent({
      ...common,
      eventType: descriptor.eventType,
      payload: { ...related, kind: descriptor.kind },
      actors: [actor],
    })
  }
  return createBasketballStatEvent({
    ...common,
    eventType: descriptor.eventType,
    payload: related,
    actors: [actor],
  })
}

function turnoverSelectionForOptions(
  state: GameState,
  turnoverSide: BasketballTeamSide,
  target: BasketballTurnoverTarget
):
  | { ok: true; selection: BasketballCaptureActorSelection }
  | { ok: false; state: GameState; code: BasketballCommandErrorCode; message: string } {
  if (target.kind === 'team') return { ok: true, selection: { kind: 'team' } }
  if (target.kind === 'unknown') {
    const label = target.label.trim()
    return label
      ? { ok: true, selection: { kind: 'unknown', label } }
      : failure(state, 'invalid_actor', 'Enter a label for the unknown Basketball turnover actor.')
  }
  const resolved = basketballCaptureTargetForPlayerId(state, target.playerId)
  if (!resolved.ok) return failure(state, resolved.code, resolved.message)
  if (resolved.value.teamSide !== turnoverSide || resolved.value.selection.kind !== 'participant') {
    return failure(state, 'invalid_actor', 'The turnover actor must belong to the opposite Basketball side.')
  }
  return { ok: true, selection: resolved.value.selection }
}

function oppositeSide(side: BasketballTeamSide): BasketballTeamSide {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

function hasCloudBinding(state: GameState): boolean {
  return Boolean(
    state.cloudSync.teamId ||
    state.cloudSync.gameId ||
    state.cloudSync.seasonId ||
    Object.keys(state.cloudSync.playerIdMap).length > 0 ||
    state.cloudSync.lastSyncedGameFingerprint
  )
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballDirectCommandResult & { ok: false } {
  return { ok: false, state, code, message }
}
