import { sports } from '../../config/sports'
import type { GameState, GameEventSyncConflict, Player } from '../../types'
import { createInitialCloudSyncState } from '../gameReducer'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { canonicalGameEventStreamForFingerprint } from '../gameEvents/stream'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import {
  loadGameEventStreamForRecorder,
  upsertGameEventForRecorder,
} from '../gameEvents/cloud'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { supabase } from '../supabase'
import {
  gameEventSyncBase,
  mergeSameRecorderEventStreams,
} from './cloudConflicts'
import { createSoccerSportGameState, normalizeSportGameState } from './state'
import type { SoccerMatchParticipant, SoccerSportGameState } from './types'

interface SoccerCloudParticipant {
  client_participant_id: string
  client_player_id: string | null
  source_player_id: string | null
  kind: SoccerMatchParticipant['kind']
  display_name: string
  jersey_number: string | null
  snapshot: Record<string, unknown>
}

interface SoccerGameBindingRow {
  game_id: string
  participant_id_map: Record<string, string>
  participants?: SoccerCloudParticipantRow[]
}

interface SoccerCloudGameRow {
  id: string
  team_id: string | null
  season_id: string | null
  created_by: string
  tracked_team_name: string
  opponent_name: string
  tournament_name: string | null
  game_date: string
  status: string
}

interface SoccerCloudParticipantRow {
  id: string
  client_participant_id: string
  client_player_id: string | null
  display_name: string
  jersey_number: string | null
}

interface SoccerCloudConflictRow {
  id: string
  event_id: string
  local_event: unknown
  remote_event: unknown
  detected_at: string
}

export interface SyncSoccerEventGameInput {
  state: GameState
  userId: string
  localGameId: string
}

export interface SyncSoccerEventGameResult {
  seasonId: string | null
  teamId: string | null
  gameId: string
  playerIdMap: Record<string, string>
  syncedAt: string
  syncedState: GameState
}

export class SoccerCloudRecoveryError extends Error {
  recoveredState: GameState

  constructor(message: string, recoveredState: GameState) {
    super(message)
    this.name = 'SoccerCloudRecoveryError'
    this.recoveredState = recoveredState
  }
}

export function soccerCloudParticipants(
  sportState: SoccerSportGameState
): SoccerCloudParticipant[] {
  const setupById = new Map(
    sportState.setup.participants.map(participant => [participant.id, participant])
  )
  return Object.values(sportState.projection.participants).map(participant => {
    const origin = setupById.get(participant.participantId)
    return {
      client_participant_id: participant.participantId,
      client_player_id: participant.playerId,
      source_player_id: sportState.setup.sourceTeamId ? participant.playerId : null,
      kind: participant.playerId ? 'player' : origin?.kind ?? 'anonymous',
      display_name: participant.displayName,
      jersey_number: participant.number,
      snapshot: {
        initialStatus: origin?.initialStatus ?? null,
        initialRole: origin ? structuredClone(origin.initialRole) : null,
        addedDuringMatch: origin === undefined,
      },
    }
  })
}

export function soccerEventRevisionCheckpoint(state: GameState): Array<{
  id: string
  revision: number
}> {
  if (!state.eventStream) return []
  return state.eventStream.events
    .filter(isGameEventEnvelope)
    .map(event => ({ id: event.id, revision: event.revision }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function soccerEventStreamFingerprint(state: GameState): string {
  return JSON.stringify(canonicalGameEventStreamForFingerprint(state.eventStream))
}

export function assertHealthySoccerEventGame(state: GameState): SoccerSportGameState {
  if (
    state.sport?.id !== 'soccer' ||
    !state.gameInfo ||
    !state.eventStream ||
    state.sportGameState?.sportId !== 'soccer'
  ) {
    throw new Error('Soccer event game is not initialized')
  }

  const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  if (!rebuilt.inspection.complete) {
    const first = rebuilt.inspection.diagnostics[0]
    throw new Error(first?.message ?? 'Soccer event history needs attention before cloud sync')
  }
  return state.sportGameState
}

export async function syncSoccerEventGameToCloud({
  state,
  userId,
  localGameId,
}: SyncSoccerEventGameInput): Promise<SyncSoccerEventGameResult> {
  if (!supabase) throw new Error('Supabase client not configured')
  const sportState = assertHealthySoccerEventGame(state)
  if ((state.cloudSync.eventConflicts?.length ?? 0) > 0) {
    throw new SoccerCloudRecoveryError(
      'Resolve the event sync conflicts before retrying cloud sync.',
      state
    )
  }
  const participants = soccerCloudParticipants(sportState)

  const { data: bindingData, error: bindingError } = await supabase.rpc(
    'bind_soccer_event_game_v3',
    {
      p_existing_game_id: state.cloudSync.gameId,
      p_client_local_game_id: localGameId,
      p_source_team_id: sportState.setup.sourceTeamId,
      p_source_season_id: sportState.setup.sourceSeasonId,
      p_team_name: state.gameInfo!.teamName,
      p_opponent_name: state.gameInfo!.opponentName,
      p_competition_name: state.gameInfo!.tournamentName || null,
      p_game_date: state.gameInfo!.date,
      p_participants: participants,
      p_setup_snapshot: sportState.setup,
    }
  )
  if (bindingError) throw new Error(`Soccer game binding failed: ${bindingError.message}`)

  const binding = bindingData as SoccerGameBindingRow | null
  if (!binding?.game_id || !binding.participant_id_map) {
    throw new Error('Soccer game binding returned an invalid response')
  }

  const cloudToLocalParticipantId = Object.fromEntries(
    Object.entries(binding.participant_id_map).map(([localId, cloudId]) => [cloudId, localId])
  )
  const remote = await loadGameEventStreamForRecorder(
    binding.game_id,
    userId,
    cloudToLocalParticipantId,
    gameEventRegistry
  )
  if (!remote.ok || !remote.inspection.complete) {
    throw new Error(remote.error ?? remote.inspection.diagnostics[0]?.message ?? 'Cloud event history could not be loaded')
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
  const mergedPlayers = mergeCloudParticipantPlayers(state.players, binding.participants ?? [])
  const mergedCandidate: GameState = {
    ...state,
    players: mergedPlayers,
    eventStream: merge.eventStream,
  }
  const rebuilt = rebuildGameEventProjection(
    mergedCandidate,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!rebuilt.inspection.complete && merge.conflicts.length === 0) {
    throw new SoccerCloudRecoveryError(
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
    throw new SoccerCloudRecoveryError(
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
    if (!isGameEventEnvelope(rawEvent)) {
      throw new Error('Soccer event history contains an invalid event')
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

  for (const pending of state.cloudSync.pendingEventConflictResolutions ?? []) {
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

  const revisions = soccerEventRevisionCheckpoint(mergedState)
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
      p_stream_fingerprint: soccerEventStreamFingerprint(mergedState),
    }
  )
  if (checkpointError) {
    throw new Error(`Soccer event checkpoint failed: ${checkpointError.message}`)
  }
  if (typeof checkpointData !== 'string') {
    throw new Error('Soccer event checkpoint returned an invalid response')
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
    seasonId: sportState.setup.sourceSeasonId,
    teamId: sportState.setup.sourceTeamId,
    gameId: binding.game_id,
    playerIdMap: binding.participant_id_map,
    syncedAt: checkpointData,
    syncedState,
  }
}

export async function loadSoccerCloudGameById(
  userId: string,
  gameId: string
): Promise<GameState | null> {
  if (!supabase) throw new Error('Supabase client not configured')
  const [{ data: gameData, error: gameError }, { data: setupData, error: setupError }] =
    await Promise.all([
      supabase
        .from('games')
        .select('id,team_id,season_id,created_by,tracked_team_name,opponent_name,tournament_name,game_date,status')
        .eq('id', gameId)
        .eq('sport_id', 'soccer')
        .maybeSingle(),
      supabase
        .from('game_event_setup_snapshots')
        .select('setup_snapshot')
        .eq('game_id', gameId)
        .maybeSingle(),
    ])
  if (gameError) throw new Error(`Soccer game load failed: ${gameError.message}`)
  if (setupError) throw new Error(`Soccer setup load failed: ${setupError.message}`)
  if (!gameData) throw new Error('Cloud soccer game is unavailable.')
  if (!setupData) throw new Error('Cloud soccer setup is unavailable.')

  const gameRow = gameData as SoccerCloudGameRow
  const normalizedSportState = normalizeSportGameState({
    sportId: 'soccer',
    version: 2,
    setup: setupData.setup_snapshot,
  })
  if (!normalizedSportState || normalizedSportState.sportId !== 'soccer') {
    throw new Error('Cloud soccer setup is invalid.')
  }

  const [{ data: participantData, error: participantError }, { data: conflictData, error: conflictError }] =
    await Promise.all([
      supabase
        .from('game_participants')
        .select('id,client_participant_id,client_player_id,display_name,jersey_number')
        .eq('game_id', gameId),
      supabase
        .from('game_event_conflicts')
        .select('id,event_id,local_event,remote_event,detected_at')
        .eq('game_id', gameId)
        .eq('recorded_by', userId)
        .eq('status', 'open'),
    ])
  if (participantError) throw new Error(`Soccer participants could not load: ${participantError.message}`)
  if (conflictError) throw new Error(`Soccer conflicts could not load: ${conflictError.message}`)
  const participantRows = (participantData ?? []) as SoccerCloudParticipantRow[]
  const cloudToLocalPlayerId = Object.fromEntries(
    participantRows
      .filter(row => row.client_player_id)
      .map(row => [row.id, row.client_player_id!])
  )
  const remote = await loadGameEventStreamForRecorder(
    gameId,
    userId,
    cloudToLocalPlayerId,
    gameEventRegistry
  )
  if (!remote.ok || !remote.inspection.complete) {
    throw new Error(remote.error ?? remote.inspection.diagnostics[0]?.message ?? 'Cloud soccer events are invalid.')
  }
  if (remote.eventStream.events.length === 0 && gameRow.created_by !== userId) {
    return null
  }

  const soccerSport = sports.find(sport => sport.id === 'soccer')
  if (!soccerSport) throw new Error('Soccer configuration is unavailable.')
  const players: Player[] = participantRows
    .filter((row): row is SoccerCloudParticipantRow & { client_player_id: string } => Boolean(row.client_player_id))
    .map(row => ({
      id: row.client_player_id,
      name: row.display_name,
      number: row.jersey_number ?? '',
      stats: {},
    }))
  const playerIdMap = Object.fromEntries(
    participantRows
      .filter(row => row.client_player_id)
      .map(row => [row.client_player_id!, row.id])
  )
  const conflicts = (conflictData ?? [])
    .map(row => cloudConflictFromRow(row as SoccerCloudConflictRow))
    .filter((conflict): conflict is GameEventSyncConflict => conflict !== null)
  const baseState: GameState = {
    sport: soccerSport,
    gameInfo: {
      teamName: gameRow.tracked_team_name,
      opponentName: gameRow.opponent_name,
      tournamentName: gameRow.tournament_name ?? '',
      date: gameRow.game_date,
    },
    players,
    activePlayerId: players[0]?.id ?? null,
    opponentScore: 0,
    homeTeamScore: 0,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    eventStream: remote.eventStream,
    sportGameState: createSoccerSportGameState(normalizedSportState.setup),
    cloudSync: {
      ...createInitialCloudSyncState(conflicts.length > 0 ? 'error' : 'synced'),
      seasonId: gameRow.season_id,
      teamId: gameRow.team_id,
      gameId,
      gameStatus: gameRow.status,
      playerIdMap,
      lastSyncedAt: new Date().toISOString(),
      lastError: conflicts.length > 0 ? 'Review competing event revisions before syncing.' : null,
      eventSyncBase: gameEventSyncBase(remote.eventStream),
      eventConflicts: conflicts,
    },
  }
  const rebuilt = rebuildGameEventProjection(baseState, gameEventRegistry, gameEventProjectors)
  if (!rebuilt.inspection.complete) {
    throw new Error(rebuilt.inspection.diagnostics[0]?.message ?? 'Cloud soccer projection is invalid.')
  }
  const fingerprint = buildGameSyncFingerprint(rebuilt.state)
  return {
    ...rebuilt.state,
    cloudSync: {
      ...rebuilt.state.cloudSync,
      lastSyncedGameFingerprint: fingerprint,
    },
  }
}

function cloudConflictFromRow(row: SoccerCloudConflictRow): GameEventSyncConflict | null {
  if (!isGameEventEnvelope(row.local_event) || !isGameEventEnvelope(row.remote_event)) return null
  if (row.local_event.id !== row.event_id || row.remote_event.id !== row.event_id) return null
  return {
    conflictId: row.id,
    eventId: row.event_id,
    localEvent: row.local_event,
    remoteEvent: row.remote_event,
    detectedAt: row.detected_at,
  }
}

function mergeCloudParticipantPlayers(
  players: Player[],
  participantRows: SoccerCloudParticipantRow[]
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
