import type { GameState } from '../../types'
import { loadGameEventStreamForRecorder } from '../gameEvents/cloud'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import {
  eventRecorderNeedsAttention,
  loadEventGameRecorders,
  loadEventPrimaryRecorderHistory,
  selectEventPrimaryRecorder,
  type EventPrimaryRecorderHistoryEntry,
  type EventRecorderRpcs,
  type EventRecorderSummary,
} from '../gameEvents/recorders'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type { GameEvent, GameEventInspection, GameEventStream } from '../gameEvents/types'
import { loadBasketballCloudShell } from './cloudSync'
import { reconcileBasketballPlayerRows } from './courtCorrections'

export type BasketballRecorderSummary = EventRecorderSummary
export type BasketballPrimaryRecorderHistoryEntry = EventPrimaryRecorderHistoryEntry

const BASKETBALL_RECORDER_RPCS: EventRecorderRpcs = {
  label: 'Basketball',
  recorders: 'get_basketball_game_recorders',
  primaryHistory: 'get_basketball_primary_recorder_history',
  setPrimary: 'set_basketball_primary_recorder',
}

export interface BasketballRecorderProjection {
  recorder: BasketballRecorderSummary
  state: GameState
  eventStream: GameEventStream
  inspection: GameEventInspection<GameEvent>
}

export function loadBasketballGameRecorders(
  gameId: string
): Promise<BasketballRecorderSummary[]> {
  return loadEventGameRecorders(BASKETBALL_RECORDER_RPCS, gameId)
}

export function loadBasketballPrimaryRecorderHistory(
  gameId: string
): Promise<BasketballPrimaryRecorderHistoryEntry[]> {
  return loadEventPrimaryRecorderHistory(BASKETBALL_RECORDER_RPCS, gameId)
}

export function selectBasketballPrimaryRecorder(
  gameId: string,
  recorderId: string
): Promise<void> {
  return selectEventPrimaryRecorder(BASKETBALL_RECORDER_RPCS, gameId, recorderId)
}

export function primaryBasketballRecorder(
  recorders: BasketballRecorderSummary[]
): BasketballRecorderSummary | null {
  return recorders.find(recorder => recorder.isPrimary) ?? null
}

export function basketballRecorderNeedsAttention(
  recorder: BasketballRecorderSummary
): boolean {
  return eventRecorderNeedsAttention(recorder)
}

export async function loadBasketballRecorderProjection(
  gameId: string,
  recorder: BasketballRecorderSummary
): Promise<BasketballRecorderProjection> {
  const shell = await loadBasketballCloudShell(gameId)
  const loaded = await loadGameEventStreamForRecorder(
    gameId,
    recorder.recorderId,
    shell.cloudToLocalPlayerId,
    gameEventRegistry
  )
  if (!loaded.ok) {
    throw new Error(loaded.error ?? 'Basketball recorder stream could not load.')
  }

  const rebuilt = rebuildGameEventProjection(
    { ...shell.state, eventStream: loaded.eventStream },
    gameEventRegistry,
    gameEventProjectors
  )
  const allEvents = [
    ...rebuilt.inspection.activeEvents,
    ...rebuilt.inspection.deletedEvents,
  ]
  if (allEvents.some(event => (
    event.sportId !== 'basketball' || event.recorderUserId !== recorder.recorderId
  ))) {
    throw new Error('Basketball recorder stream contains mixed ownership.')
  }

  return {
    recorder,
    state: reconcileBasketballPlayerRows(rebuilt.state),
    eventStream: loaded.eventStream,
    inspection: rebuilt.inspection,
  }
}
