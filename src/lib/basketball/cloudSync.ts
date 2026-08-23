import { sports } from '../../config/sports'
import type { GameEventSyncConflict, GameState, Player } from '../../types'
import { loadGameEventStreamForRecorder } from '../gameEvents/cloud'
import { isPlainObject } from '../gameEvents/envelope'
import {
  gameEventSyncBase,
  gameEventSyncConflictFromRow,
} from '../gameEvents/cloudConflicts'
import {
  assertHealthyEventGame,
  syncEventGameToCloud,
  type EventCloudParticipant,
  type EventCloudTransportAdapter,
  type SyncEventGameResult,
} from '../gameEvents/cloudTransport'
import { addGameEvent, initializeGameEventStream } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createInitialCloudSyncState } from '../gameReducer'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { supabase } from '../supabase'
import { reconcileBasketballPlayerRows } from './courtCorrections'
import { createBasketballLifecycleEvent } from './events'
import { createBasketballUuid } from './id'
import { basketballRulesToTeamStatsConfig } from './rules'
import {
  createBasketballSportGameState,
  normalizeBasketballSportGameState,
} from './state'
import type { BasketballSportGameState } from './types'

export interface BasketballCloudGameRow {
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

interface BasketballCloudParticipantRow {
  id: string
  client_participant_id: string
  client_player_id: string | null
  display_name: string
  jersey_number: string | null
}

export interface BasketballCloudShell {
  game: BasketballCloudGameRow
  state: GameState
  cloudToLocalPlayerId: Record<string, string>
}

export interface SyncBasketballEventGameInput {
  state: GameState
  userId: string
  localGameId: string
}

export async function loadBasketballCloudDataAuthority(
  gameId: string
): Promise<'sport_events' | 'legacy'> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase
    .from('game_event_setup_snapshots')
    .select('sport_id')
    .eq('game_id', gameId)
    .maybeSingle()
  if (error) throw new Error(`Basketball data authority could not load: ${error.message}`)
  if (!data) return 'legacy'
  if (data.sport_id !== 'basketball') {
    throw new Error('Basketball game has an incompatible event setup snapshot.')
  }
  return 'sport_events'
}

export type SyncBasketballEventGameResult = SyncEventGameResult

export class BasketballCloudRecoveryError extends Error {
  recoveredState: GameState

  constructor(message: string, recoveredState: GameState) {
    super(message)
    this.name = 'BasketballCloudRecoveryError'
    this.recoveredState = recoveredState
  }
}

export function basketballCloudParticipants(
  sportState: BasketballSportGameState
): EventCloudParticipant[] {
  const setupById = new Map(
    sportState.setup.participants.map(participant => [participant.id, participant])
  )
  return Object.values(sportState.projection.participants).map(participant => {
    const origin = setupById.get(participant.participantId)
    return {
      client_participant_id: participant.participantId,
      client_player_id: participant.playerId,
      source_player_id:
        sportState.setup.sourceTeamId && participant.teamSide === 'tracked'
          ? participant.playerId
          : null,
      kind: participant.playerId ? 'player' : 'anonymous',
      display_name: participant.displayName,
      jersey_number: participant.number,
      snapshot: {
        teamSide: participant.teamSide,
        initialStatus: origin?.initialStatus ?? 'bench',
        position: origin?.position ?? participant.position,
        captain: origin?.captain ?? participant.captain,
        addedDuringMatch: origin === undefined,
      },
    }
  })
}

export function assertHealthyBasketballEventGame(
  state: GameState
): BasketballSportGameState {
  const sportState = state.sportGameState
  if (
    state.gameDataAuthority !== 'sport_events' ||
    sportState?.sportId !== 'basketball'
  ) {
    throw new Error('Basketball event game is not initialized')
  }
  assertHealthyEventGame(state, 'basketball', rebuildEventGameState)
  return sportState
}

function rebuildEventGameState(state: GameState) {
  const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  return rebuilt.inspection.complete
    ? { ...rebuilt, state: reconcileBasketballPlayerRows(rebuilt.state) }
    : rebuilt
}

export const basketballEventCloudTransportAdapter: EventCloudTransportAdapter = {
  sportId: 'basketball',
  sportLabel: 'Basketball',
  bindingRpc: 'bind_basketball_event_game_v4',
  registry: gameEventRegistry,
  remoteConflictRevisionPolicy: 'advance',
  prepare(state) {
    const sportState = assertHealthyBasketballEventGame(state)
    return {
      sourceTeamId: sportState.setup.sourceTeamId,
      sourceSeasonId: sportState.setup.sourceSeasonId,
      setupSnapshot: sportState.setup,
      participants: basketballCloudParticipants(sportState),
    }
  },
  createRecoveryError(message, recoveredState) {
    return new BasketballCloudRecoveryError(message, recoveredState)
  },
  rebuild: rebuildEventGameState,
}

// GameContext routes only structurally marked Basketball event games here. The adapter performs
// the full health check before binding or uploading, so malformed streams fail closed.
export function syncBasketballEventGameToCloud(
  input: SyncBasketballEventGameInput
): Promise<SyncBasketballEventGameResult> {
  return syncEventGameToCloud({ ...input, adapter: basketballEventCloudTransportAdapter })
}

export async function loadBasketballCloudGameById(
  userId: string,
  gameId: string
): Promise<GameState | null> {
  if (!supabase) throw new Error('Supabase client not configured')
  const shell = await loadBasketballCloudShell(gameId)
  const [{ data: conflictData, error: conflictError }, remote] = await Promise.all([
    supabase
      .from('game_event_conflicts')
      .select('id,event_id,local_event,remote_event,detected_at')
      .eq('game_id', gameId)
      .eq('recorded_by', userId)
      .eq('status', 'open'),
    loadGameEventStreamForRecorder(
      gameId,
      userId,
      shell.cloudToLocalPlayerId,
      gameEventRegistry
    ),
  ])
  if (conflictError) {
    throw new Error(`Basketball conflicts could not load: ${conflictError.message}`)
  }
  if (!remote.ok || !remote.inspection.complete) {
    throw new Error(
      remote.error ??
        remote.inspection.diagnostics[0]?.message ??
        'Cloud Basketball events are invalid.'
    )
  }
  if (remote.eventStream.events.length === 0) return null

  const rawConflicts = conflictData ?? []
  const conflicts = rawConflicts.map(row => gameEventSyncConflictFromRow(row, 'basketball'))
  if (conflicts.some(conflict => conflict === null)) {
    throw new Error('Cloud Basketball conflict history is invalid.')
  }
  const validConflicts = conflicts as GameEventSyncConflict[]
  if (new Set(validConflicts.map(conflict => conflict.eventId)).size !== validConflicts.length) {
    throw new Error('Cloud Basketball conflict history contains duplicate event ids.')
  }

  const candidate: GameState = {
    ...shell.state,
    eventStream: remote.eventStream,
    cloudSync: {
      ...shell.state.cloudSync,
      status: validConflicts.length > 0 ? 'error' : 'synced',
      lastSyncedAt: new Date().toISOString(),
      lastError:
        validConflicts.length > 0
          ? 'Review competing event revisions before syncing.'
          : null,
      eventSyncBase: gameEventSyncBase(remote.eventStream),
      eventConflicts: validConflicts,
      pendingEventConflictResolutions: [],
    },
  }
  const rebuilt = rebuildEventGameState(candidate)
  if (!rebuilt.inspection.complete) {
    throw new Error(
      rebuilt.inspection.diagnostics[0]?.message ?? 'Cloud Basketball projection is invalid.'
    )
  }
  const reconciled = reconcileBasketballPlayerRows(rebuilt.state)
  return {
    ...reconciled,
    cloudSync: {
      ...reconciled.cloudSync,
      lastSyncedGameFingerprint: buildGameSyncFingerprint(reconciled),
    },
  }
}

export async function createBasketballIndependentRecorderState(
  userId: string,
  gameId: string
): Promise<GameState> {
  const shell = await loadBasketballCloudShell(gameId)
  if (shell.game.status === 'final') {
    throw new Error('Finalized games cannot add a recorder.')
  }
  const initialized = initializeGameEventStream(
    shell.state,
    gameEventRegistry,
    gameEventProjectors
  )
  if (!initialized.ok || !initialized.inspection.complete) {
    throw new Error(
      initialized.ok
        ? initialized.inspection.diagnostics[0]?.message ?? 'Basketball recorder could not start.'
        : initialized.error.message
    )
  }
  if (initialized.state.sportGameState?.sportId !== 'basketball') {
    throw new Error('Basketball cloud setup is unavailable.')
  }
  const firstPeriod = initialized.state.sportGameState.setup.rulesSnapshot.regulationSegments[0]
  if (!firstPeriod || firstPeriod.order !== 1) {
    throw new Error('Basketball cloud setup has no first regulation period.')
  }
  const occurredAt = new Date().toISOString()
  const started = addGameEvent(
    initialized.state,
    createBasketballLifecycleEvent({
      id: createBasketballUuid(),
      eventType: 'basketball.period_started',
      payload: { periodId: firstPeriod.id, captureCommandId: null },
      recorderUserId: userId,
      sequence: 1,
      period: { id: firstPeriod.id, order: firstPeriod.order },
      occurredAt,
    }),
    gameEventRegistry,
    gameEventProjectors
  )
  if (!started.ok || !started.inspection.complete) {
    throw new Error(
      started.ok
        ? started.inspection.diagnostics[0]?.message ?? 'Basketball recorder could not start.'
        : started.error.message
    )
  }
  return reconcileBasketballPlayerRows(started.state)
}

export async function loadBasketballCloudShell(
  gameId: string
): Promise<BasketballCloudShell> {
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
      .eq('sport_id', 'basketball')
      .maybeSingle(),
    supabase
      .from('game_event_setup_snapshots')
      .select('setup_snapshot')
      .eq('game_id', gameId)
      .maybeSingle(),
    supabase
      .from('game_participants')
      .select('id,client_participant_id,client_player_id,display_name,jersey_number')
      .eq('game_id', gameId),
  ])
  if (gameError) throw new Error(`Basketball game load failed: ${gameError.message}`)
  if (setupError) throw new Error(`Basketball setup load failed: ${setupError.message}`)
  if (participantError) {
    throw new Error(`Basketball participants could not load: ${participantError.message}`)
  }
  if (!gameData) throw new Error('Cloud Basketball game is unavailable.')
  if (!setupData) throw new Error('Cloud Basketball setup is unavailable.')

  if (!isBasketballCloudGameRow(gameData)) {
    throw new Error('Cloud Basketball game metadata is invalid.')
  }
  const game = gameData
  const normalized = normalizeBasketballSportGameState({
    sportId: 'basketball',
    version: 1,
    setup: setupData.setup_snapshot,
  })
  if (!normalized || normalized.sportId !== 'basketball') {
    throw new Error('Cloud Basketball setup is invalid.')
  }
  if (
    normalized.setup.sourceTeamId !== game.team_id ||
    normalized.setup.sourceSeasonId !== (game.team_id ? game.season_id : null)
  ) {
    throw new Error('Cloud Basketball setup source does not match its game binding.')
  }

  if (
    !Array.isArray(participantData) ||
    !participantData.every(isBasketballCloudParticipantRow)
  ) {
    throw new Error('Cloud Basketball participants are invalid.')
  }
  const participantRows = participantData
  if (
    new Set(participantRows.map(row => row.id)).size !== participantRows.length ||
    new Set(participantRows.map(row => row.client_participant_id)).size !== participantRows.length
  ) {
    throw new Error('Cloud Basketball participants contain duplicate identities.')
  }
  const rowByParticipantId = new Map(
    participantRows.map(row => [row.client_participant_id, row])
  )
  for (const participant of normalized.setup.participants) {
    const row = rowByParticipantId.get(participant.id)
    if (
      !row ||
      row.client_player_id !== participant.playerId ||
      row.display_name !== participant.displayName ||
      row.jersey_number !== participant.number
    ) {
      throw new Error('Cloud Basketball participant identity does not match the immutable setup.')
    }
  }
  const resolvedRows = participantRows.filter(
    (row): row is BasketballCloudParticipantRow & { client_player_id: string } =>
      Boolean(row.client_player_id)
  )
  if (new Set(resolvedRows.map(row => row.client_player_id)).size !== resolvedRows.length) {
    throw new Error('Cloud Basketball participants contain duplicate player identities.')
  }
  const setupPlayerIds = new Set(
    normalized.setup.participants
      .map(participant => participant.playerId)
      .filter((playerId): playerId is string => Boolean(playerId))
  )
  const players: Player[] = resolvedRows
    .filter(row => setupPlayerIds.has(row.client_player_id))
    .map(row => ({
      id: row.client_player_id,
      name: row.display_name,
      number: row.jersey_number ?? '',
      stats: {},
    }))
  const playerIdMap = Object.fromEntries(
    resolvedRows.map(row => [row.client_player_id, row.id])
  )
  const cloudToLocalPlayerId = Object.fromEntries(
    resolvedRows.map(row => [row.id, row.client_player_id])
  )
  const basketball = sports.find(sport => sport.id === 'basketball')
  if (!basketball) throw new Error('Basketball configuration is unavailable.')
  const teamStatsConfig = basketballRulesToTeamStatsConfig(normalized.setup.rulesSnapshot)
  return {
    game,
    cloudToLocalPlayerId,
    state: {
      gameDataAuthority: 'sport_events',
      sport: basketball,
      gameInfo: {
        teamName: game.tracked_team_name,
        opponentName: game.opponent_name,
        tournamentName: game.tournament_name ?? '',
        tournamentId: null,
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
      teamStatsConfig: { ...teamStatsConfig },
      shotChart: [],
      eventStream: null,
      sportGameState: createBasketballSportGameState(normalized.setup),
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

function isBasketballCloudGameRow(value: unknown): value is BasketballCloudGameRow {
  return Boolean(
    isPlainObject(value) &&
      typeof value.id === 'string' && value.id.length > 0 &&
      (value.team_id === null || typeof value.team_id === 'string') &&
      (value.season_id === null || typeof value.season_id === 'string') &&
      typeof value.created_by === 'string' && value.created_by.length > 0 &&
      typeof value.tracked_team_name === 'string' && value.tracked_team_name.length > 0 &&
      typeof value.opponent_name === 'string' && value.opponent_name.length > 0 &&
      (value.tournament_name === null || typeof value.tournament_name === 'string') &&
      typeof value.game_date === 'string' && Number.isFinite(Date.parse(value.game_date)) &&
      typeof value.status === 'string' && value.status.length > 0
  )
}

function isBasketballCloudParticipantRow(
  value: unknown
): value is BasketballCloudParticipantRow {
  return Boolean(
    isPlainObject(value) &&
      typeof value.id === 'string' && value.id.length > 0 &&
      typeof value.client_participant_id === 'string' && value.client_participant_id.length > 0 &&
      (value.client_player_id === null || typeof value.client_player_id === 'string') &&
      typeof value.display_name === 'string' && value.display_name.length > 0 &&
      (value.jersey_number === null || typeof value.jersey_number === 'string')
  )
}
