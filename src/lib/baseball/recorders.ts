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
import { loadBaseballCloudShell } from './cloudSync'
import { assertBaseballCloudAccount } from './cloudPolicy'

export type BaseballRecorderSummary = EventRecorderSummary
export type BaseballPrimaryRecorderHistoryEntry = EventPrimaryRecorderHistoryEntry

/** The fixed Baseball wrappers from migration 077 over the shared recorder cores. */
export const BASEBALL_RECORDER_RPCS: EventRecorderRpcs = {
  label: 'Baseball',
  recorders: 'get_baseball_game_recorders',
  primaryHistory: 'get_baseball_primary_recorder_history',
  setPrimary: 'set_baseball_primary_recorder',
}

export interface BaseballRecorderProjection {
  recorder: BaseballRecorderSummary
  state: GameState
  eventStream: GameEventStream
  inspection: GameEventInspection<GameEvent>
}

export function loadBaseballGameRecorders(gameId: string): Promise<BaseballRecorderSummary[]> {
  return loadEventGameRecorders(BASEBALL_RECORDER_RPCS, gameId)
}

export function loadBaseballPrimaryRecorderHistory(gameId: string): Promise<BaseballPrimaryRecorderHistoryEntry[]> {
  return loadEventPrimaryRecorderHistory(BASEBALL_RECORDER_RPCS, gameId)
}

export async function selectBaseballPrimaryRecorder(gameId: string, recorderId: string, userId?: string | null): Promise<void> {
  if (userId !== undefined) assertBaseballCloudAccount(userId)
  await selectEventPrimaryRecorder(BASEBALL_RECORDER_RPCS, gameId, recorderId)
  if (userId !== undefined) assertBaseballCloudAccount(userId)
}

export function baseballRecorderNeedsAttention(recorder: BaseballRecorderSummary): boolean {
  return eventRecorderNeedsAttention(recorder)
}

/** One recorder's cloud stream replayed on its own; another recorder's events never blend in. */
export async function loadBaseballRecorderProjection(
  gameId: string,
  recorder: BaseballRecorderSummary
): Promise<BaseballRecorderProjection> {
  const shell = await loadBaseballCloudShell(gameId)
  const loaded = await loadGameEventStreamForRecorder(
    gameId,
    recorder.recorderId,
    shell.cloudToLocalPlayerId,
    gameEventRegistry
  )
  if (!loaded.ok) throw new Error(loaded.error ?? 'Baseball recorder stream could not load.')

  const rebuilt = rebuildGameEventProjection(
    { ...shell.state, eventStream: loaded.eventStream },
    gameEventRegistry,
    gameEventProjectors
  )
  const allEvents = [...rebuilt.inspection.activeEvents, ...rebuilt.inspection.deletedEvents]
  if (allEvents.some(event => event.sportId !== 'baseball' || event.recorderUserId !== recorder.recorderId)) {
    throw new Error('Baseball recorder stream contains mixed ownership.')
  }
  return { recorder, state: rebuilt.state, eventStream: loaded.eventStream, inspection: rebuilt.inspection }
}
