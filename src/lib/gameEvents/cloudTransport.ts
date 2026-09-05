import type {
  GameEventSyncConflict,
  GameState,
  PendingGameEventConflictResolution,
  Player,
} from '../../types'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { supabase } from '../supabase'
import {
  loadGameEventStreamForRecorder,
  upsertGameEventForRecorder,
} from './cloud'
import {
  gameEventSyncBase,
  mergeSameRecorderEventStreams,
  type RemoteConflictRevisionPolicy,
} from './cloudConflicts'
import { isGameEventEnvelope } from './envelope'
import type { ProjectionRebuildResult } from './projection'
import type { GameEventRegistry } from './registry'
import { canonicalGameEventStreamForFingerprint } from './stream'
import type { GameEvent } from './types'

export interface EventCloudParticipant {
  client_participant_id: string
  client_player_id: string | null
  source_player_id: string | null
  kind: string
  display_name: string
  jersey_number: string | null
  snapshot: Record<string, unknown>
}

export interface EventCloudParticipantRow {
  id: string
  client_participant_id: string
  client_player_id: string | null
  display_name: string
  jersey_number: string | null
}

interface EventGameBindingRow {
  game_id: string
  game_status: string
  participant_id_map: Record<string, string>
  participants?: EventCloudParticipantRow[]
}

export interface PreparedEventCloudGame {
  sourceTeamId: string | null
  sourceSeasonId: string | null
  setupSnapshot: unknown
  participants: EventCloudParticipant[]
}

export interface EventCloudTransportAdapter {
  sportId: string
  sportLabel: string
  bindingRpc: string
  registry: GameEventRegistry<GameEvent>
  remoteConflictRevisionPolicy: RemoteConflictRevisionPolicy
  prepare(state: GameState): PreparedEventCloudGame
  rebuild(state: GameState): ProjectionRebuildResult<GameEvent>
  createRecoveryError(message: string, recoveredState: GameState): Error
}

export interface SyncEventGameInput {
  state: GameState
  userId: string
  localGameId: string
  adapter: EventCloudTransportAdapter
  validateBinding?: (gameId: string) => void | Promise<void>
}

export interface SyncEventGameResult {
  seasonId: string | null
  teamId: string | null
  gameId: string
  gameStatus: string
  playerIdMap: Record<string, string>
  syncedAt: string
  syncedState: GameState
}

export function eventRevisionCheckpoint(state: GameState): Array<{
  id: string
  revision: number
}> {
  if (!state.eventStream) return []
  return state.eventStream.events
    .filter(isGameEventEnvelope)
    .map(event => ({ id: event.id, revision: event.revision }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function eventStreamFingerprint(state: GameState): string {
  return JSON.stringify(canonicalGameEventStreamForFingerprint(state.eventStream))
}

export function latestPendingConflictResolutions(
  pending: PendingGameEventConflictResolution[]
): PendingGameEventConflictResolution[] {
  const latestByConflictId = new Map<string, PendingGameEventConflictResolution>()
  for (const item of pending) {
    latestByConflictId.set(item.conflictId, item)
  }
  return [...latestByConflictId.values()]
}

export function assertHealthyEventGame(
  state: GameState,
  sportId: string,
  rebuild: (state: GameState) => ProjectionRebuildResult<GameEvent>
): void {
  if (
    state.sport?.id !== sportId ||
    !state.gameInfo ||
    !state.eventStream ||
    state.sportGameState?.sportId !== sportId
  ) {
    throw new Error(`${sportName(sportId)} event game is not initialized`)
  }

  for (const rawEvent of state.eventStream.events) {
    if (!isGameEventEnvelope(rawEvent) || rawEvent.sportId !== sportId) {
      throw new Error(`${sportName(sportId)} event history contains an invalid event`)
    }
  }

  const rebuilt = rebuild(state)
  if (!rebuilt.inspection.complete) {
    const first = rebuilt.inspection.diagnostics[0]
    throw new Error(first?.message ?? `${sportName(sportId)} event history needs attention before cloud sync`)
  }
}

export async function syncEventGameToCloud({
  state,
  userId,
  localGameId,
  adapter,
  validateBinding,
}: SyncEventGameInput): Promise<SyncEventGameResult> {
  if (!supabase) throw new Error('Supabase client not configured')
  const prepared = adapter.prepare(state)
  if ((state.cloudSync.eventConflicts?.length ?? 0) > 0) {
    throw adapter.createRecoveryError(
      'Resolve the event sync conflicts before retrying cloud sync.',
      state
    )
  }

  const { data: bindingData, error: bindingError } = await supabase.rpc(
    adapter.bindingRpc,
    {
      p_existing_game_id: state.cloudSync.gameId,
      p_client_local_game_id: localGameId,
      p_source_team_id: prepared.sourceTeamId,
      p_source_season_id: prepared.sourceSeasonId,
      p_team_name: state.gameInfo!.teamName,
      p_opponent_name: state.gameInfo!.opponentName,
      p_competition_name: state.gameInfo!.tournamentName || null,
      p_game_date: state.gameInfo!.date,
      p_participants: prepared.participants,
      p_setup_snapshot: prepared.setupSnapshot,
    }
  )
  if (bindingError) {
    throw new Error(`${adapter.sportLabel} game binding failed: ${bindingError.message}`)
  }

  const binding = bindingData as EventGameBindingRow | null
  if (!binding?.game_id || !binding.game_status || !binding.participant_id_map) {
    throw new Error(`${adapter.sportLabel} game binding returned an invalid response`)
  }
  await validateBinding?.(binding.game_id)

  const cloudToLocalParticipantId = Object.fromEntries(
    Object.entries(binding.participant_id_map).map(([localId, cloudId]) => [cloudId, localId])
  )
  const remote = await loadGameEventStreamForRecorder(
    binding.game_id,
    userId,
    cloudToLocalParticipantId,
    adapter.registry
  )
  if (!remote.ok || !remote.inspection.complete) {
    throw new Error(
      remote.error ?? remote.inspection.diagnostics[0]?.message ?? 'Cloud event history could not be loaded'
    )
  }
  for (const rawEvent of remote.eventStream.events) {
    if (!isGameEventEnvelope(rawEvent) || rawEvent.sportId !== adapter.sportId) {
      throw adapter.createRecoveryError(
        `Cloud ${adapter.sportLabel.toLowerCase()} event history is invalid.`,
        state
      )
    }
  }

  const fallbackBase =
    state.cloudSync.lastSyncedGameFingerprint === buildGameSyncFingerprint(state)
      ? gameEventSyncBase(state.eventStream)
      : {}
  const storedBase = state.cloudSync.eventSyncBase ?? {}
  const merge = mergeSameRecorderEventStreams(
    state.eventStream!,
    remote.eventStream,
    Object.keys(storedBase).length > 0 ? storedBase : fallbackBase
  )
  const mergedCandidate: GameState = {
    ...state,
    players: mergeCloudParticipantPlayers(state.players, binding.participants ?? []),
    eventStream: merge.eventStream,
  }
  const rebuilt = adapter.rebuild(mergedCandidate)
  if (!rebuilt.inspection.complete && merge.conflicts.length === 0) {
    throw adapter.createRecoveryError(
      rebuilt.inspection.diagnostics[0]?.message ?? 'Merged cloud history needs attention.',
      rebuilt.state
    )
  }
  if (merge.conflicts.length > 0) {
    const conflicts: GameEventSyncConflict[] = []
    for (const conflict of merge.conflicts) {
      const { data: conflictId, error: conflictError } = await supabase.rpc(
        'record_game_event_conflict',
        {
          p_game_id: binding.game_id,
          p_event_id: conflict.eventId,
          p_local_event: conflict.localEvent,
          p_remote_event: conflict.remoteEvent,
        }
      )
      if (conflictError || typeof conflictId !== 'string') {
        throw new Error(`Event conflict could not be preserved: ${conflictError?.message ?? 'invalid response'}`)
      }
      conflicts.push({
        conflictId,
        eventId: conflict.eventId,
        localEvent: conflict.localEvent,
        remoteEvent: conflict.remoteEvent,
        detectedAt: new Date().toISOString(),
      })
    }
    throw adapter.createRecoveryError(
      `${conflicts.length} event ${conflicts.length === 1 ? 'conflict needs' : 'conflicts need'} review.`,
      {
        ...rebuilt.state,
        cloudSync: {
          ...rebuilt.state.cloudSync,
          gameId: binding.game_id,
          playerIdMap: binding.participant_id_map,
          eventConflicts: conflicts,
          status: 'error',
          lastError: 'Review competing event revisions before syncing.',
        },
      }
    )
  }

  const mergedState = rebuilt.state
  for (const rawEvent of mergedState.eventStream!.events) {
    if (!isGameEventEnvelope(rawEvent) || rawEvent.sportId !== adapter.sportId) {
      throw new Error(`${adapter.sportLabel} event history contains an invalid event`)
    }
    const result = await upsertGameEventForRecorder(
      binding.game_id,
      userId,
      rawEvent,
      binding.participant_id_map
    )
    if (!result.ok) {
      throw new Error(`Event ${rawEvent.id} could not sync: ${result.error}`)
    }
  }

  const pendingResolutions = latestPendingConflictResolutions(
    state.cloudSync.pendingEventConflictResolutions ?? []
  )
  let conflictStatusById = new Map<string, string>()
  if (pendingResolutions.length > 0) {
    const { data: conflictRows, error: conflictStatusError } = await supabase
      .from('game_event_conflicts')
      .select('id,status')
      .in('id', pendingResolutions.map(pending => pending.conflictId))
    if (conflictStatusError) {
      throw new Error(`Event conflict status could not load: ${conflictStatusError.message}`)
    }
    conflictStatusById = new Map(
      (conflictRows ?? []).map(row => [row.id, row.status])
    )
  }

  for (const pending of pendingResolutions) {
    const conflictStatus = conflictStatusById.get(pending.conflictId)
    if (conflictStatus === 'resolved') continue
    if (conflictStatus !== 'open') {
      throw new Error('Event conflict resolution could not sync: Conflict was not found')
    }
    const resolvedEvent = mergedState.eventStream!.events.find(
      rawEvent => isGameEventEnvelope(rawEvent) && rawEvent.id === pending.eventId
    )
    if (!resolvedEvent || !isGameEventEnvelope(resolvedEvent)) {
      throw new Error(`Resolved event ${pending.eventId} is missing.`)
    }
    const { error: resolutionError } = await supabase.rpc('resolve_game_event_conflict', {
      p_conflict_id: pending.conflictId,
      p_resolution: pending.resolution,
      p_resolved_event: resolvedEvent,
    })
    if (resolutionError) {
      throw new Error(`Event conflict resolution could not sync: ${resolutionError.message}`)
    }
  }

  const revisions = eventRevisionCheckpoint(mergedState)
  const maxSequence = mergedState.eventStream!.events.reduce<number>((max, rawEvent) =>
    isGameEventEnvelope(rawEvent) ? Math.max(max, rawEvent.sequence) : max, -1)
  const { data: checkpointData, error: checkpointError } = await supabase.rpc(
    'confirm_game_event_stream_checkpoint',
    {
      p_game_id: binding.game_id,
      p_stream_version: mergedState.eventStream!.version,
      p_event_revisions: revisions,
      p_event_count: revisions.length,
      p_max_sequence: maxSequence,
      p_stream_fingerprint: eventStreamFingerprint(mergedState),
    }
  )
  if (checkpointError) {
    throw new Error(`${adapter.sportLabel} event checkpoint failed: ${checkpointError.message}`)
  }
  if (typeof checkpointData !== 'string') {
    throw new Error(`${adapter.sportLabel} event checkpoint returned an invalid response`)
  }

  const syncedState: GameState = {
    ...mergedState,
    cloudSync: {
      ...mergedState.cloudSync,
      eventSyncBase: gameEventSyncBase(mergedState.eventStream),
      eventConflicts: [],
      pendingEventConflictResolutions: [],
    },
  }
  return {
    seasonId: prepared.sourceSeasonId,
    teamId: prepared.sourceTeamId,
    gameId: binding.game_id,
    gameStatus: binding.game_status,
    playerIdMap: binding.participant_id_map,
    syncedAt: checkpointData,
    syncedState,
  }
}

export function mergeCloudParticipantPlayers(
  players: Player[],
  participantRows: EventCloudParticipantRow[]
): Player[] {
  const next = players.map(player => ({ ...player, stats: { ...player.stats } }))
  const knownIds = new Set(next.map(player => player.id))
  for (const row of participantRows) {
    if (!row.client_player_id || knownIds.has(row.client_player_id)) continue
    next.push({
      id: row.client_player_id,
      name: row.display_name,
      number: row.jersey_number ?? '',
      stats: {},
    })
    knownIds.add(row.client_player_id)
  }
  return next
}

function sportName(sportId: string): string {
  return sportId.charAt(0).toUpperCase() + sportId.slice(1)
}
