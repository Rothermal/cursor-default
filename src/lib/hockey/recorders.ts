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
import { loadHockeyCloudShell } from './cloudSync'

export type HockeyRecorderSummary = EventRecorderSummary
export type HockeyPrimaryRecorderHistoryEntry = EventPrimaryRecorderHistoryEntry

/** The fixed Hockey wrappers from migration 073 over the shared recorder cores. */
export const HOCKEY_RECORDER_RPCS: EventRecorderRpcs = {
  label: 'Hockey',
  recorders: 'get_hockey_game_recorders',
  primaryHistory: 'get_hockey_primary_recorder_history',
  setPrimary: 'set_hockey_primary_recorder',
}

export interface HockeyRecorderProjection {
  recorder: HockeyRecorderSummary
  state: GameState
  eventStream: GameEventStream
  inspection: GameEventInspection<GameEvent>
}

export function loadHockeyGameRecorders(gameId: string): Promise<HockeyRecorderSummary[]> {
  return loadEventGameRecorders(HOCKEY_RECORDER_RPCS, gameId)
}

export function loadHockeyPrimaryRecorderHistory(gameId: string): Promise<HockeyPrimaryRecorderHistoryEntry[]> {
  return loadEventPrimaryRecorderHistory(HOCKEY_RECORDER_RPCS, gameId)
}

export function selectHockeyPrimaryRecorder(gameId: string, recorderId: string): Promise<void> {
  return selectEventPrimaryRecorder(HOCKEY_RECORDER_RPCS, gameId, recorderId)
}

export function hockeyRecorderNeedsAttention(recorder: HockeyRecorderSummary): boolean {
  return eventRecorderNeedsAttention(recorder)
}

/** One recorder's cloud stream replayed on its own; another recorder's events never blend in. */
export async function loadHockeyRecorderProjection(
  gameId: string,
  recorder: HockeyRecorderSummary
): Promise<HockeyRecorderProjection> {
  const shell = await loadHockeyCloudShell(gameId)
  const loaded = await loadGameEventStreamForRecorder(
    gameId,
    recorder.recorderId,
    shell.cloudToLocalPlayerId,
    gameEventRegistry
  )
  if (!loaded.ok) throw new Error(loaded.error ?? 'Hockey recorder stream could not load.')

  const rebuilt = rebuildGameEventProjection(
    { ...shell.state, eventStream: loaded.eventStream },
    gameEventRegistry,
    gameEventProjectors
  )
  const allEvents = [...rebuilt.inspection.activeEvents, ...rebuilt.inspection.deletedEvents]
  if (allEvents.some(event => event.sportId !== 'hockey' || event.recorderUserId !== recorder.recorderId)) {
    throw new Error('Hockey recorder stream contains mixed ownership.')
  }
  return { recorder, state: rebuilt.state, eventStream: loaded.eventStream, inspection: rebuilt.inspection }
}
