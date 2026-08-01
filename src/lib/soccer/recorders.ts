import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { loadGameEventStreamForRecorder } from '../gameEvents/cloud'
import type { GameEvent, GameEventInspection, GameEventStream } from '../gameEvents/types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createInitialCloudSyncState } from '../gameReducer'
import { supabase } from '../supabase'
import { prepareSoccerKickoff } from './kickoff'
import { createSoccerSportGameState, normalizeSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'

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
  client_player_id: string | null
  display_name: string
  jersey_number: string | null
}

interface SoccerCloudShell {
  state: GameState
  setup: SoccerMatchSetup
  game: SoccerCloudGameRow
}

export interface SoccerRecorderSummary {
  recorderId: string
  displayName: string
  eventCount: number
  checkpointEventCount: number | null
  checkpointSyncedAt: string | null
  checkpointCurrent: boolean
  unresolvedConflictCount: number
  isPrimary: boolean
  primarySource: 'default' | 'selected' | null
  canSelectPrimary: boolean
}

export interface SoccerPrimaryRecorderHistoryEntry {
  id: string
  previousRecorderId: string | null
  previousDisplayName: string | null
  recorderId: string
  displayName: string
  changedBy: string
  changedByDisplayName: string
  changedAt: string
}

export interface SoccerRecorderProjection {
  recorder: SoccerRecorderSummary
  state: GameState
  eventStream: GameEventStream
  inspection: GameEventInspection<GameEvent>
}

export async function loadSoccerGameRecorders(
  gameId: string
): Promise<SoccerRecorderSummary[]> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('get_soccer_game_recorders', {
    p_game_id: gameId,
  })
  if (error) throw new Error(`Recorder streams could not load: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Recorder stream response is invalid.')
  return data.map(parseRecorderSummary)
}

export async function loadSoccerPrimaryRecorderHistory(
  gameId: string
): Promise<SoccerPrimaryRecorderHistoryEntry[]> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('get_soccer_primary_recorder_history', {
    p_game_id: gameId,
  })
  if (error) throw new Error(`Primary recorder history could not load: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Primary recorder history response is invalid.')
  return data.map(row => {
    const value = objectRow(row)
    return {
      id: requiredString(value.id, 'history id'),
      previousRecorderId: nullableString(value.previous_recorded_by),
      previousDisplayName: nullableString(value.previous_display_name),
      recorderId: requiredString(value.recorded_by, 'selected recorder'),
      displayName: requiredString(value.display_name, 'selected recorder name'),
      changedBy: requiredString(value.changed_by, 'selection actor'),
      changedByDisplayName: requiredString(
        value.changed_by_display_name,
        'selection actor name'
      ),
      changedAt: requiredString(value.changed_at, 'selection time'),
    }
  })
}

export async function selectSoccerPrimaryRecorder(
  gameId: string,
  recorderId: string
): Promise<void> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('set_soccer_primary_recorder', {
    p_game_id: gameId,
    p_recorded_by: recorderId,
  })
  if (error) throw new Error(`Primary recorder could not update: ${error.message}`)
  if (data !== recorderId) throw new Error('Primary recorder update returned an invalid response.')
}

export function primarySoccerRecorder(
  recorders: SoccerRecorderSummary[]
): SoccerRecorderSummary | null {
  return recorders.find(recorder => recorder.isPrimary) ?? null
}

export async function loadSoccerRecorderProjection(
  baseState: GameState,
  recorder: SoccerRecorderSummary
): Promise<SoccerRecorderProjection> {
  const gameId = baseState.cloudSync.gameId
  if (!gameId) throw new Error('Cloud game binding is unavailable.')
  const participantRows = await loadSoccerParticipantRows(gameId)
  const cloudToLocalPlayerId = Object.fromEntries(
    participantRows
      .filter(row => row.client_player_id)
      .map(row => [row.id, row.client_player_id!])
  )
  const loaded = await loadGameEventStreamForRecorder(
    gameId,
    recorder.recorderId,
    cloudToLocalPlayerId,
    gameEventRegistry
  )
  if (!loaded.ok) throw new Error(loaded.error ?? 'Recorder stream could not load.')
  const rebuilt = rebuildGameEventProjection(
    {
      ...baseState,
      players: mergeParticipantPlayers(baseState.players, participantRows),
      eventStream: loaded.eventStream,
      sportGameState:
        baseState.sportGameState?.sportId === 'soccer'
          ? createSoccerSportGameState(baseState.sportGameState.setup)
          : baseState.sportGameState,
    },
    gameEventRegistry,
    gameEventProjectors
  )
  return {
    recorder,
    state: rebuilt.state,
    eventStream: loaded.eventStream,
    inspection: rebuilt.inspection,
  }
}

async function loadSoccerParticipantRows(
  gameId: string
): Promise<SoccerCloudParticipantRow[]> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase
    .from('game_participants')
    .select('id,client_player_id,display_name,jersey_number')
    .eq('game_id', gameId)
  if (error) throw new Error(`Soccer participants could not load: ${error.message}`)
  return (data ?? []) as SoccerCloudParticipantRow[]
}

function mergeParticipantPlayers(
  players: Player[],
  participantRows: SoccerCloudParticipantRow[]
): Player[] {
  const merged = players.map(player => ({ ...player, stats: { ...player.stats } }))
  const ids = new Set(merged.map(player => player.id))
  for (const row of participantRows) {
    if (!row.client_player_id || ids.has(row.client_player_id)) continue
    merged.push({
      id: row.client_player_id,
      name: row.display_name,
      number: row.jersey_number ?? '',
      stats: {},
    })
    ids.add(row.client_player_id)
  }
  return merged
}

export async function loadSoccerPrimaryCloudReview(
  gameId: string
): Promise<{
  recorders: SoccerRecorderSummary[]
  primary: SoccerRecorderProjection
}> {
  const [shell, recorders] = await Promise.all([
    loadSoccerCloudShell(gameId),
    loadSoccerGameRecorders(gameId),
  ])
  const primary = primarySoccerRecorder(recorders)
  if (!primary) throw new Error('No healthy primary recorder is available yet.')
  return {
    recorders,
    primary: await loadSoccerRecorderProjection(shell.state, primary),
  }
}

export async function createSoccerIndependentRecorderState(
  userId: string,
  gameId: string
): Promise<GameState> {
  const shell = await loadSoccerCloudShell(gameId)
  if (shell.game.status === 'final') throw new Error('Finalized games cannot add a recorder.')
  const kickoff = prepareSoccerKickoff(shell.state, shell.setup, {
    recorderUserId: userId,
  })
  if (!kickoff.ok) throw new Error(kickoff.message)
  return kickoff.state
}

export async function loadSoccerCloudSummaryState(gameId: string): Promise<GameState> {
  return (await loadSoccerCloudShell(gameId)).state
}

async function loadSoccerCloudShell(gameId: string): Promise<SoccerCloudShell> {
  if (!supabase) throw new Error('Supabase client not configured')
  const [
    { data: gameData, error: gameError },
    { data: setupData, error: setupError },
    { data: participantData, error: participantError },
  ] = await Promise.all([
    supabase
      .from('games')
      .select(
        'id,team_id,season_id,created_by,tracked_team_name,opponent_name,tournament_name,game_date,status'
      )
      .eq('id', gameId)
      .eq('sport_id', 'soccer')
      .maybeSingle(),
    supabase
      .from('game_event_setup_snapshots')
      .select('setup_snapshot')
      .eq('game_id', gameId)
      .maybeSingle(),
    supabase
      .from('game_participants')
      .select('id,client_player_id,display_name,jersey_number')
      .eq('game_id', gameId),
  ])
  if (gameError) throw new Error(`Soccer game load failed: ${gameError.message}`)
  if (setupError) throw new Error(`Soccer setup load failed: ${setupError.message}`)
  if (participantError) {
    throw new Error(`Soccer participants could not load: ${participantError.message}`)
  }
  if (!gameData || !setupData) throw new Error('Soccer cloud game is unavailable.')

  const game = gameData as SoccerCloudGameRow
  const normalized = normalizeSoccerSportGameState({
    sportId: 'soccer',
    version: 2,
    setup: setupData.setup_snapshot,
  })
  if (!normalized || normalized.sportId !== 'soccer') {
    throw new Error('Cloud soccer setup is invalid.')
  }
  const participantRows = (participantData ?? []) as SoccerCloudParticipantRow[]
  const players: Player[] = participantRows
    .filter(
      (row): row is SoccerCloudParticipantRow & { client_player_id: string } =>
        Boolean(row.client_player_id)
    )
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
  const soccer = sports.find(sport => sport.id === 'soccer')
  if (!soccer) throw new Error('Soccer configuration is unavailable.')

  return {
    game,
    setup: normalized.setup,
    state: {
      sport: soccer,
      gameInfo: {
        teamName: game.tracked_team_name,
        opponentName: game.opponent_name,
        tournamentName: game.tournament_name ?? '',
        date: game.game_date,
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
      eventStream: null,
      sportGameState: createSoccerSportGameState(normalized.setup),
      cloudSync: {
        ...createInitialCloudSyncState('idle'),
        seasonId: game.season_id,
        teamId: game.team_id,
        gameId,
        gameStatus: game.status,
        playerIdMap,
      },
    },
  }
}

function parseRecorderSummary(row: unknown): SoccerRecorderSummary {
  const value = objectRow(row)
  const primarySource = nullableString(value.primary_source)
  if (primarySource !== null && primarySource !== 'default' && primarySource !== 'selected') {
    throw new Error('Recorder primary source is invalid.')
  }
  return {
    recorderId: requiredString(value.recorder_user_id, 'recorder id'),
    displayName: requiredString(value.display_name, 'recorder name'),
    eventCount: requiredInteger(value.event_count, 'event count'),
    checkpointEventCount:
      value.checkpoint_event_count === null
        ? null
        : requiredInteger(value.checkpoint_event_count, 'checkpoint event count'),
    checkpointSyncedAt: nullableString(value.checkpoint_synced_at),
    checkpointCurrent: value.checkpoint_current === true,
    unresolvedConflictCount: requiredInteger(
      value.unresolved_conflict_count,
      'conflict count'
    ),
    isPrimary: value.is_primary === true,
    primarySource,
    canSelectPrimary: value.can_select_primary === true,
  }
}

function objectRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cloud recorder response contains an invalid row.')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${label}.`)
  return value
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function requiredInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}.`)
  }
  return parsed
}
