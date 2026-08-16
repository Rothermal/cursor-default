import { sports } from '../../config/sports'
import type { GameState, GameEventSyncConflict, Player } from '../../types'
import { createInitialCloudSyncState } from '../gameReducer'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { loadGameEventStreamForRecorder } from '../gameEvents/cloud'
import {
  assertHealthyEventGame,
  eventRevisionCheckpoint,
  eventStreamFingerprint,
  syncEventGameToCloud,
  type EventCloudParticipant,
  type EventCloudTransportAdapter,
} from '../gameEvents/cloudTransport'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { supabase } from '../supabase'
import { gameEventSyncBase } from '../gameEvents/cloudConflicts'
import { createSoccerSportGameState, normalizeSoccerSportGameState } from './state'
import type { SoccerMatchParticipant, SoccerSportGameState } from './types'

interface SoccerCloudParticipant extends EventCloudParticipant {
  client_participant_id: string
  client_player_id: string | null
  source_player_id: string | null
  kind: SoccerMatchParticipant['kind']
  display_name: string
  jersey_number: string | null
  snapshot: Record<string, unknown>
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
  gameStatus: string
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
  return eventRevisionCheckpoint(state)
}

export function soccerEventStreamFingerprint(state: GameState): string {
  return eventStreamFingerprint(state)
}

export function assertHealthySoccerEventGame(state: GameState): SoccerSportGameState {
  const sportState = state.sportGameState
  if (sportState?.sportId !== 'soccer') {
    throw new Error('Soccer event game is not initialized')
  }
  assertHealthyEventGame(state, 'soccer', rebuildEventGameState)
  return sportState
}

function rebuildEventGameState(state: GameState) {
  return rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
}

const soccerEventCloudTransportAdapter: EventCloudTransportAdapter = {
  sportId: 'soccer',
  sportLabel: 'Soccer',
  bindingRpc: 'bind_soccer_event_game_v4',
  registry: gameEventRegistry,
  remoteConflictRevisionPolicy: 'preserve',
  prepare(state) {
    const sportState = assertHealthySoccerEventGame(state)
    return {
      sourceTeamId: sportState.setup.sourceTeamId,
      sourceSeasonId: sportState.setup.sourceSeasonId,
      setupSnapshot: sportState.setup,
      participants: soccerCloudParticipants(sportState),
    }
  },
  createRecoveryError(message, recoveredState) {
    return new SoccerCloudRecoveryError(message, recoveredState)
  },
  rebuild: rebuildEventGameState,
}

export async function syncSoccerEventGameToCloud({
  state,
  userId,
  localGameId,
}: SyncSoccerEventGameInput): Promise<SyncSoccerEventGameResult> {
  return syncEventGameToCloud({
    state,
    userId,
    localGameId,
    adapter: soccerEventCloudTransportAdapter,
  })
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
  const normalizedSportState = normalizeSoccerSportGameState({
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
