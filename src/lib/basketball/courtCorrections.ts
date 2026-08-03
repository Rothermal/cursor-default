import type { GameState, Player } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { compareGameEventCaptureOrder, inspectGameEventStream } from '../gameEvents/stream'
import type { GameEventMutation } from '../gameEvents/types'
import { isTeamPseudoPlayer } from '../teamPlayers'
import type {
  BasketballCourtUndoReceipt,
  BasketballCourtUndoReceiptEntry,
  BasketballMatchEvent,
} from './types'
import type {
  BasketballCommandErrorCode,
  BasketballStateCommandResult,
} from './commands'

const COURT_EVENT_TYPES = new Set([
  'basketball.shot',
  'basketball.assist',
  'basketball.rebound',
  'basketball.steal',
  'basketball.block',
])

const LIFECYCLE_BOUNDARY_TYPES = new Set([
  'basketball.period_started',
  'basketball.period_ended',
  'basketball.match_ended',
  'basketball.match_reopened',
  'basketball.participant_resolved',
])

export interface BasketballCourtCaptureUnit {
  id: string
  captureCommandId: string | null
  eventIds: string[]
  events: BasketballMatchEvent[]
  who: string
  what: string
  containsLocatedFieldGoal: boolean
  kind: 'capture' | 'boundary'
  undoable: boolean
}

export interface BasketballClearChartPreview {
  shotCount: number
  linkedAssistCount: number
  linkedReboundCount: number
  unlinkedBlockCount: number
}

export function basketballCourtCaptureUnits(state: GameState): BasketballCourtCaptureUnit[] {
  const events = activeBasketballEvents(state)
    .filter(event => COURT_EVENT_TYPES.has(event.eventType))
    .sort(compareGameEventCaptureOrder)
  return captureUnitsForEvents(state, events)
}

export function basketballLiveCaptureUnits(state: GameState): BasketballCourtCaptureUnit[] {
  return captureUnitsForEvents(
    state,
    activeBasketballEvents(state).sort(compareGameEventCaptureOrder)
  )
}

function captureUnitsForEvents(
  state: GameState,
  events: BasketballMatchEvent[]
): BasketballCourtCaptureUnit[] {
  const grouped = new Map<string, BasketballMatchEvent[]>()

  for (const event of events) {
    const commandId = captureCommandIdForEvent(event)
    const key = commandId ? `command:${commandId}` : `event:${event.id}`
    const group = grouped.get(key) ?? []
    group.push(event)
    grouped.set(key, group)
  }

  return [...grouped.entries()]
    .map(([key, unitEvents]) => buildCaptureUnit(state, key, unitEvents))
    .sort((left, right) => {
      const leftLast = left.events[left.events.length - 1]
      const rightLast = right.events[right.events.length - 1]
      return compareGameEventCaptureOrder(rightLast, leftLast)
    })
}

export function previewBasketballClearShotChart(state: GameState): BasketballClearChartPreview {
  const plan = clearChartPlan(state)
  return {
    shotCount: plan.shots.length,
    linkedAssistCount: plan.assists.length,
    linkedReboundCount: plan.rebounds.length,
    unlinkedBlockCount: plan.blocks.length,
  }
}

export function canRestoreBasketballCourtUndo(state: GameState): boolean {
  return buildRestoreMutations(state) !== null
}

export function undoLatestBasketballCourtCapture(
  state: GameState,
  now = new Date().toISOString(),
  requireLocatedShot = false
): BasketballStateCommandResult {
  const timestamp = validTimestamp(now)
  if (!timestamp) return failure(state, 'invalid_timestamp', 'Basketball undo timestamp is invalid.')
  const unit = basketballLiveCaptureUnits(state)[0]
  if (!unit) return failure(state, 'nothing_to_undo', 'There is no Basketball event to undo.')
  if (!unit.undoable) {
    return failure(
      state,
      'nothing_to_undo',
      'The newest Basketball event is a lifecycle boundary and cannot be undone here.'
    )
  }
  if (requireLocatedShot && !unit.containsLocatedFieldGoal) {
    return failure(state, 'nothing_to_undo', 'The newest Basketball capture is not a court shot.')
  }

  const mutations: GameEventMutation[] = unit.events.map(event => ({
    type: 'delete',
    eventId: event.id,
  }))
  const receipt: BasketballCourtUndoReceipt = {
    kind: 'capture_undo',
    createdAt: timestamp,
    entries: unit.events.map(event => receiptEntry(event, 'restore', null)),
  }
  return applyCorrectionsWithReceipt(state, mutations, receipt, timestamp)
}

export function clearBasketballShotChart(
  state: GameState,
  now = new Date().toISOString()
): BasketballStateCommandResult {
  const timestamp = validTimestamp(now)
  if (!timestamp) return failure(state, 'invalid_timestamp', 'Basketball clear timestamp is invalid.')
  const plan = clearChartPlan(state)
  if (plan.shots.length === 0) {
    return failure(state, 'nothing_to_clear', 'There are no located Basketball shots to clear.')
  }

  const deleted = [...plan.shots, ...plan.assists, ...plan.rebounds]
  const mutations: GameEventMutation[] = [
    ...deleted.map(event => ({ type: 'delete' as const, eventId: event.id })),
    ...plan.blocks.map(event => ({
      type: 'update' as const,
      eventId: event.id,
      changes: {
        payload: { ...event.payload, relatedEventId: null },
      },
    })),
  ]
  const receipt: BasketballCourtUndoReceipt = {
    kind: 'clear_chart',
    createdAt: timestamp,
    entries: [
      ...deleted.map(event => receiptEntry(event, 'restore', null)),
      ...plan.blocks.map(event => receiptEntry(
        event,
        'relink_block',
        event.payload.relatedEventId
      )),
    ],
  }
  return applyCorrectionsWithReceipt(state, mutations, receipt, timestamp)
}

export function restoreLastBasketballCourtUndo(
  state: GameState,
  now = new Date().toISOString()
): BasketballStateCommandResult {
  const timestamp = validTimestamp(now)
  if (!timestamp) return failure(state, 'invalid_timestamp', 'Basketball restore timestamp is invalid.')
  const mutations = buildRestoreMutations(state)
  if (!mutations) {
    return failure(state, 'restore_unavailable', 'The last Basketball court correction can no longer be restored.')
  }
  const result = applyGameEventMutations(
    state,
    mutations,
    timestamp,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return failure(
      state,
      'command_failed',
      result.ok
        ? 'Basketball restore did not produce a complete event projection.'
        : result.error.message
    )
  }
  return { ok: true, state: reconcileBasketballPlayerRows(withUndoReceipt(result.state, null)) }
}

function activeBasketballEvents(state: GameState): BasketballMatchEvent[] {
  if (
    state.sport?.id !== 'basketball' ||
    state.sportGameState?.sportId !== 'basketball' ||
    !state.eventStream
  ) return []
  const inspection = inspectGameEventStream(state.eventStream, gameEventRegistry)
  if (!inspection.complete) return []
  return inspection.activeEvents.filter(isBasketballMatchEvent)
}

function isBasketballMatchEvent(event: { sportId: string }): event is BasketballMatchEvent {
  return event.sportId === 'basketball'
}

function captureCommandIdForEvent(event: BasketballMatchEvent): string | null {
  return typeof event.payload.captureCommandId === 'string'
    ? event.payload.captureCommandId
    : null
}

function buildCaptureUnit(
  state: GameState,
  key: string,
  events: BasketballMatchEvent[]
): BasketballCourtCaptureUnit {
  const shot = events.find(
    event => event.eventType === 'basketball.shot' &&
      event.payload.attempt === 'field_goal' &&
      event.location !== null
  )
  const primary = shot ?? events[0]
  const captureCommandId = captureCommandIdForEvent(primary)
  const boundary = events.some(event => LIFECYCLE_BOUNDARY_TYPES.has(event.eventType))
  return {
    id: captureCommandId ?? key,
    captureCommandId,
    eventIds: events.map(event => event.id),
    events,
    who: captureUnitActorLabel(state.players, primary),
    what: captureUnitLabel(state, events, shot),
    containsLocatedFieldGoal: Boolean(shot),
    kind: boundary ? 'boundary' : 'capture',
    undoable: !boundary,
  }
}

function captureUnitActorLabel(players: Player[], event: BasketballMatchEvent): string {
  if (event.eventType === 'basketball.match_roster_added') {
    return event.payload.participant.displayName
  }
  if (
    event.eventType === 'basketball.period_started' ||
    event.eventType === 'basketball.period_ended' ||
    event.eventType === 'basketball.match_ended' ||
    event.eventType === 'basketball.match_reopened'
  ) return 'Game'
  return actorLabel(players, event)
}

function actorLabel(players: Player[], event: BasketballMatchEvent): string {
  const actor = event.actors[0]
  if (!actor) return event.teamSide === 'tracked' ? 'Tracked team' : 'Opponent'
  if (actor.kind === 'player') {
    const player = players.find(candidate => candidate.id === actor.playerId)
    if (player) {
      const number = player.number.trim()
      return number ? `#${number} ${player.name}` : player.name
    }
  }
  if (actor.label) return actor.label
  const team = players.find(
    player => isTeamPseudoPlayer(player) &&
      (event.teamSide === 'tracked' ? player.teamSide !== 'opponent' : player.teamSide === 'opponent')
  )
  return team?.name ?? (event.teamSide === 'tracked' ? 'Tracked team' : 'Opponent')
}

function captureUnitLabel(
  state: GameState,
  events: BasketballMatchEvent[],
  shot: BasketballMatchEvent | undefined
): string {
  if (shot?.eventType === 'basketball.shot') {
    let label = `${shot.payload.made ? 'Made' : 'Missed'} ${shot.payload.value}PT`
    const assist = events.some(event => event.eventType === 'basketball.assist')
    const rebound = events.find(event => event.eventType === 'basketball.rebound')
    if (assist) label += ' + Assist'
    if (rebound?.eventType === 'basketball.rebound') {
      label += rebound.payload.kind === 'offensive' ? ' + Off Reb' : ' + Def Reb'
    }
    return label
  }
  switch (events[0]?.eventType) {
    case 'basketball.period_started':
      return `${periodLabel(state, events[0].payload.periodId)} started`
    case 'basketball.period_ended':
      return `${periodLabel(state, events[0].payload.periodId)} ended`
    case 'basketball.match_roster_added':
      return `Added to ${events[0].payload.participant.teamSide === 'tracked'
        ? state.gameInfo?.teamName || 'tracked team'
        : state.gameInfo?.opponentName || 'opponent'} roster`
    case 'basketball.participant_resolved': return 'Participant identity updated'
    case 'basketball.match_ended':
      return events[0].payload.reason === 'completed' ? 'Game completed' : 'Game ended'
    case 'basketball.match_reopened': return 'Game reopened'
    case 'basketball.assist': return 'Assist'
    case 'basketball.rebound':
      return events[0].payload.kind === 'offensive' ? 'Offensive rebound' : 'Defensive rebound'
    case 'basketball.steal': return 'Steal'
    case 'basketball.block': return 'Block'
    case 'basketball.shot': return `${events[0].payload.made ? 'Made' : 'Missed'} ${events[0].payload.value}PT`
    case 'basketball.turnover': return 'Turnover'
    case 'basketball.foul': return 'Foul'
    case 'basketball.ejection': return 'Ejection'
    case 'basketball.timeout': return 'Timeout'
    case 'basketball.minutes_adjustment': return 'Minutes adjustment'
    case 'basketball.score_adjustment': return 'Score adjustment'
    case 'basketball.free_throw_trip': return 'Free throw trip'
    default: return 'Basketball event'
  }
}

function periodLabel(state: GameState, periodId: string): string {
  if (state.sportGameState?.sportId !== 'basketball') return periodId
  return state.sportGameState.projection.periods.find(period => period.id === periodId)?.label ?? periodId
}

function clearChartPlan(state: GameState) {
  const events = activeBasketballEvents(state)
  const shots = events.filter((event): event is Extract<BasketballMatchEvent, { eventType: 'basketball.shot' }> =>
    event.eventType === 'basketball.shot' &&
    event.payload.attempt === 'field_goal' &&
    event.location !== null
  )
  const shotIds = new Set(shots.map(event => event.id))
  const assists = events.filter((event): event is Extract<BasketballMatchEvent, { eventType: 'basketball.assist' }> =>
    event.eventType === 'basketball.assist' &&
    event.payload.relatedEventId !== null &&
    shotIds.has(event.payload.relatedEventId)
  )
  const rebounds = events.filter((event): event is Extract<BasketballMatchEvent, { eventType: 'basketball.rebound' }> =>
    event.eventType === 'basketball.rebound' &&
    event.payload.relatedEventId !== null &&
    shotIds.has(event.payload.relatedEventId)
  )
  const blocks = events.filter((event): event is Extract<BasketballMatchEvent, { eventType: 'basketball.block' }> =>
    event.eventType === 'basketball.block' &&
    event.payload.relatedEventId !== null &&
    shotIds.has(event.payload.relatedEventId)
  )
  return { shots, assists, rebounds, blocks }
}

function receiptEntry(
  event: BasketballMatchEvent,
  action: BasketballCourtUndoReceiptEntry['action'],
  previousRelatedEventId: string | null
): BasketballCourtUndoReceiptEntry {
  return {
    eventId: event.id,
    expectedRevision: event.revision + 1,
    action,
    previousRelatedEventId,
  }
}

function applyCorrectionsWithReceipt(
  state: GameState,
  mutations: GameEventMutation[],
  receipt: BasketballCourtUndoReceipt,
  now: string
): BasketballStateCommandResult {
  const result = applyGameEventMutations(
    state,
    mutations,
    now,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!result.ok || !result.inspection.complete) {
    return failure(
      state,
      'command_failed',
      result.ok
        ? 'Basketball correction did not produce a complete event projection.'
        : result.error.message
    )
  }
  return {
    ok: true,
    state: reconcileBasketballPlayerRows(withUndoReceipt(result.state, receipt)),
  }
}

function buildRestoreMutations(state: GameState): GameEventMutation[] | null {
  const receipt = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.capturePreferences.lastCourtUndo
    : null
  if (!receipt || !state.eventStream) return null
  const mutations: GameEventMutation[] = []

  for (const entry of receipt.entries) {
    const raw = state.eventStream.events.find(
      candidate => isGameEventEnvelope(candidate) && candidate.id === entry.eventId
    )
    if (!raw) return null
    const inspected = gameEventRegistry.inspect(raw)
    if (!inspected.ok || !isBasketballMatchEvent(inspected.event)) return null
    const event = inspected.event
    if (event.revision !== entry.expectedRevision) return null

    if (entry.action === 'restore') {
      if (!event.deletedAt) return null
      mutations.push({ type: 'restore', eventId: event.id })
      continue
    }
    if (
      event.deletedAt ||
      event.eventType !== 'basketball.block' ||
      event.payload.relatedEventId !== null ||
      !entry.previousRelatedEventId
    ) return null
    mutations.push({
      type: 'update',
      eventId: event.id,
      changes: {
        payload: { ...event.payload, relatedEventId: entry.previousRelatedEventId },
      },
    })
  }
  return mutations
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

function reconcileBasketballPlayerRows(state: GameState): GameState {
  if (state.sportGameState?.sportId !== 'basketball') return state
  const sportState = state.sportGameState
  const projected = Object.values(sportState.projection.participants)
  const playerIds = new Set(
    projected.map(participant => participant.playerId).filter((id): id is string => Boolean(id))
  )
  const players = state.players
    .filter(player => isTeamPseudoPlayer(player) || playerIds.has(player.id))
    .map(player => {
      if (isTeamPseudoPlayer(player)) return player
      const participant = projected.find(value => value.playerId === player.id)
      return participant
        ? {
            ...player,
            name: participant.displayName,
            number: participant.number ?? '',
            stats: structuredClone(participant.stats),
          }
        : player
    })
  const existingIds = new Set(players.map(player => player.id))
  for (const participant of projected) {
    if (!participant.playerId || existingIds.has(participant.playerId)) continue
    players.push({
      id: participant.playerId,
      name: participant.displayName,
      number: participant.number ?? '',
      stats: structuredClone(participant.stats),
    })
    existingIds.add(participant.playerId)
  }

  let capturePreferences = sportState.capturePreferences
  const selected = capturePreferences.selectedParticipantId
  if (selected && !sportState.projection.participants[selected]) {
    capturePreferences = {
      ...capturePreferences,
      selectedParticipantId: null,
      selectionInitialized: true,
    }
  }
  const preferredPlayerId = capturePreferences.selectedParticipantId
    ? sportState.projection.participants[capturePreferences.selectedParticipantId]?.playerId ?? null
    : capturePreferences.teamSide === 'tracked'
      ? players.find(player => isTeamPseudoPlayer(player) && player.teamSide !== 'opponent')?.id ?? null
      : players.find(player => isTeamPseudoPlayer(player) && player.teamSide === 'opponent')?.id ?? null
  const activePlayerId = state.activePlayerId && existingIds.has(state.activePlayerId)
    ? state.activePlayerId
    : preferredPlayerId ?? players[0]?.id ?? null

  return {
    ...state,
    players,
    activePlayerId,
    sportGameState: {
      ...sportState,
      capturePreferences,
    },
  }
}

function validTimestamp(value: string): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null
}

function failure(
  state: GameState,
  code: BasketballCommandErrorCode,
  message: string
): BasketballStateCommandResult & { ok: false } {
  return { ok: false, state, code, message }
}
