import { sports } from '../../config/sports'
import type { GameEventSyncConflict, GameState, Player } from '../../types'
import { loadGameEventStreamForRecorder } from '../gameEvents/cloud'
import { gameEventSyncBase, gameEventSyncConflictFromRow } from '../gameEvents/cloudConflicts'
import { loadEventCloudDataAuthority, loadEventCloudShellRows, type EventCloudGameRow } from '../gameEvents/cloudShell'
import {
  assertHealthyEventGame,
  syncEventGameToCloud,
  type EventCloudParticipant,
  type EventCloudTransportAdapter,
  type SyncEventGameResult,
} from '../gameEvents/cloudTransport'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { initializeGameEventStream } from '../gameEvents/mutations'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { isEventGameLocalOnly } from '../eventCloudPolicy'
import { createInitialCloudSyncState } from '../gameReducer'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { supabase } from '../supabase'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../authIdentity'
import { createBaseballSportGameState, normalizeBaseballMatchSetup } from './state'
import { baseballLocalPlayerKey } from './stats'
import { ensureBaseballReleaseCapabilities } from './releaseCapabilities'
import type { BaseballMatchSetup, BaseballSportGameState } from './types'
import { syncBaseballTournamentAssociation } from './tournament'

export interface BaseballCloudShell {
  game: EventCloudGameRow
  state: GameState
  cloudToLocalPlayerId: Record<string, string>
}

export interface SyncBaseballEventGameInput {
  state: GameState
  userId: string
  localGameId: string
  validateBinding?: (gameId: string) => void | Promise<void>
  assertCurrent?: () => void
}

export type SyncBaseballEventGameResult = SyncEventGameResult

export class BaseballCloudRecoveryError extends Error {
  recoveredState: GameState

  constructor(message: string, recoveredState: GameState) {
    super(message)
    this.name = 'BaseballCloudRecoveryError'
    this.recoveredState = recoveredState
  }
}

/**
 * Every Baseball participant is a tracked setup participant; opponent slots and pitchers are
 * labels and stay in the setup snapshot. A team game links roster players to the source team
 * (the Hockey rule, BSB-6 plan §2).
 */
export function baseballCloudParticipants(setup: BaseballMatchSetup): EventCloudParticipant[] {
  return setup.participants.map(participant => ({
    client_participant_id: participant.id,
    client_player_id: participant.playerId,
    source_player_id: setup.sourceTeamId && participant.playerId ? participant.playerId : null,
    kind: participant.playerId ? 'player' : 'anonymous',
    display_name: participant.displayName,
    jersey_number: participant.number,
    snapshot: {
      teamSide: 'tracked',
      position: participant.position,
      bats: participant.bats,
      throws: participant.throws,
    },
  }))
}

function rebuildBaseballEventGame(state: GameState) {
  return rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
}

export function assertHealthyBaseballEventGame(state: GameState): BaseballSportGameState {
  const sportState = state.sportGameState
  if (state.gameDataAuthority !== 'sport_events' || sportState?.sportId !== 'baseball') {
    throw new Error('Baseball event game is not initialized')
  }
  assertHealthyEventGame(state, 'baseball', rebuildBaseballEventGame)
  return sportState as BaseballSportGameState
}

export const baseballEventCloudTransportAdapter: EventCloudTransportAdapter = {
  sportId: 'baseball',
  sportLabel: 'Baseball',
  bindingRpc: 'bind_baseball_event_game_v5',
  registry: gameEventRegistry,
  remoteConflictRevisionPolicy: 'advance',
  prepare(state) {
    const sportState = assertHealthyBaseballEventGame(state)
    return {
      sourceTeamId: sportState.setup.sourceTeamId,
      sourceSeasonId: sportState.setup.sourceSeasonId,
      setupSnapshot: sportState.setup,
      participants: baseballCloudParticipants(sportState.setup),
    }
  },
  createRecoveryError(message, recoveredState) {
    return new BaseballCloudRecoveryError(message, recoveredState)
  },
  rebuild: rebuildBaseballEventGame,
}

/** One recorder's stream per local game; another recorder's events are never blended in. */
export async function syncBaseballEventGameToCloud(
  input: SyncBaseballEventGameInput
): Promise<SyncBaseballEventGameResult> {
  if (isEventGameLocalOnly(input.state)) {
    throw new Error('This Baseball game is saved on this device only.')
  }
  assertHealthyBaseballEventGame(input.state)
  if (input.state.eventStream?.events.some(event => (
    !isGameEventEnvelope(event) || event.recorderUserId !== input.userId
  ))) {
    throw new Error('Baseball cloud sync cannot blend another recorder stream.')
  }
  const hasTournament = Boolean(input.state.gameInfo?.tournamentId)
  const identity = captureAuthIdentity(input.userId)
  const assertCurrent = () => {
    input.assertCurrent?.()
    if (hasTournament && (!identity || !isCurrentAuthIdentity(identity))) throw Error('The Baseball sync account changed.')
  }
  assertCurrent()
  const capability = await ensureBaseballReleaseCapabilities(input.userId, { force: true })
  assertCurrent()
  if (capability.status !== 'ready') throw new Error(capability.error)
  const synced = await syncEventGameToCloud({ ...input, adapter: baseballEventCloudTransportAdapter, assertCurrent })
  assertCurrent()
  // Tournament metadata is recoverable independently of the recorded event checkpoint.
  let tournamentSyncWarning: string | null = null
  try {
    await syncBaseballTournamentAssociation(input.state, synced.gameId, input.userId, assertCurrent)
  } catch (error) {
    assertCurrent()
    tournamentSyncWarning = error instanceof Error ? error.message : 'The Baseball tournament attachment could not be saved.'
  }
  assertCurrent()
  return { ...synced, syncedState: { ...synced.syncedState, cloudSync: { ...synced.syncedState.cloudSync, tournamentSyncWarning } } }
}

export function loadBaseballCloudDataAuthority(gameId: string): Promise<'sport_events' | 'legacy'> {
  return loadEventCloudDataAuthority(gameId, 'baseball', 'Baseball')
}

export async function loadBaseballCloudShell(gameId: string): Promise<BaseballCloudShell> {
  const rows = await loadEventCloudShellRows(gameId, 'baseball', 'Baseball')
  const { game } = rows
  const setup = normalizeBaseballMatchSetup(rows.setupSnapshot)
  if (!setup) throw new Error('Cloud Baseball setup is invalid.')
  if (
    setup.sourceTeamId !== game.team_id ||
    setup.sourceSeasonId !== (game.team_id ? game.season_id : null)
  ) {
    throw new Error('Cloud Baseball setup source does not match its game binding.')
  }

  const rowByParticipantId = new Map(rows.participants.map(row => [row.client_participant_id, row]))
  for (const participant of setup.participants) {
    const row = rowByParticipantId.get(participant.id)
    if (
      !row ||
      row.client_player_id !== participant.playerId ||
      row.display_name !== participant.displayName ||
      row.jersey_number !== participant.number
    ) {
      throw new Error('Cloud Baseball participant identity does not match the immutable setup.')
    }
  }
  const resolvedRows = rows.participants.filter(
    (row): row is typeof row & { client_player_id: string } => Boolean(row.client_player_id)
  )
  const players: Player[] = setup.participants.map(participant => ({
    id: baseballLocalPlayerKey(participant),
    name: participant.displayName,
    number: participant.number ?? '',
    stats: {},
  }))
  const baseball = sports.find(sport => sport.id === 'baseball')
  if (!baseball) throw new Error('Baseball configuration is unavailable.')
  return {
    game,
    cloudToLocalPlayerId: Object.fromEntries(resolvedRows.map(row => [row.id, row.client_player_id])),
    state: {
      gameDataAuthority: 'sport_events',
      sport: baseball,
      gameInfo: {
        teamName: game.tracked_team_name,
        teamNickname: game.tracked_team_nickname,
        opponentName: game.opponent_name,
        opponentNickname: game.opponent_nickname,
        tournamentName: game.tournament_name ?? '',
        tournamentId: game.tournament_id ?? null,
        date: game.game_date,
      },
      players,
      activePlayerId: null,
      opponentScore: 0,
      homeTeamScore: 0,
      homeScoreAdjustment: 0,
      notes: '',
      actionLog: [],
      currentPeriod: 1,
      teamStatsConfig: null,
      shotChart: [],
      eventStream: null,
      sportGameState: createBaseballSportGameState(setup),
      cloudSync: {
        ...createInitialCloudSyncState('idle'),
        // A game opened from the cloud is a cloud game; a missing policy would keep it local.
        eventCloudPolicy: 'automatic',
        seasonId: game.season_id,
        teamId: game.team_id,
        gameId,
        gameStatus: game.status,
        playerIdMap: Object.fromEntries(resolvedRows.map(row => [row.client_player_id, row.id])),
      },
    },
  }
}

/** The signed-in recorder's own cloud stream for this game, or null when they have none. */
export async function loadBaseballCloudGameById(userId: string, gameId: string): Promise<GameState | null> {
  if (!supabase) throw new Error('Supabase client not configured')
  const shell = await loadBaseballCloudShell(gameId)
  const [{ data: conflictData, error: conflictError }, remote] = await Promise.all([
    supabase
      .from('game_event_conflicts')
      .select('id,event_id,local_event,remote_event,detected_at')
      .eq('game_id', gameId)
      .eq('recorded_by', userId)
      .eq('status', 'open'),
    loadGameEventStreamForRecorder(gameId, userId, shell.cloudToLocalPlayerId, gameEventRegistry),
  ])
  if (conflictError) throw new Error(`Baseball conflicts could not load: ${conflictError.message}`)
  if (!remote.ok || !remote.inspection.complete) {
    throw new Error(
      remote.error ?? remote.inspection.diagnostics[0]?.message ?? 'Cloud Baseball events are invalid.'
    )
  }
  if (remote.eventStream.events.length === 0) return null

  const conflicts = (conflictData ?? []).map(row => gameEventSyncConflictFromRow(row, 'baseball'))
  if (conflicts.some(conflict => conflict === null)) {
    throw new Error('Cloud Baseball conflict history is invalid.')
  }
  const validConflicts = conflicts as GameEventSyncConflict[]
  if (new Set(validConflicts.map(conflict => conflict.eventId)).size !== validConflicts.length) {
    throw new Error('Cloud Baseball conflict history contains duplicate event ids.')
  }

  const rebuilt = rebuildBaseballEventGame({
    ...shell.state,
    eventStream: remote.eventStream,
    cloudSync: {
      ...shell.state.cloudSync,
      status: validConflicts.length > 0 ? 'error' : 'synced',
      lastSyncedAt: new Date().toISOString(),
      lastError: validConflicts.length > 0 ? 'Review competing event revisions before syncing.' : null,
      eventSyncBase: gameEventSyncBase(remote.eventStream),
      eventConflicts: validConflicts,
      pendingEventConflictResolutions: [],
    },
  })
  if (!rebuilt.inspection.complete) {
    throw new Error(rebuilt.inspection.diagnostics[0]?.message ?? 'Cloud Baseball projection is invalid.')
  }
  return {
    ...rebuilt.state,
    cloudSync: {
      ...rebuilt.state.cloudSync,
      lastSyncedGameFingerprint: buildGameSyncFingerprint(rebuilt.state),
    },
  }
}

/**
 * A second recorder on a team game starts their own stream from the same immutable setup.
 * As at setup, the game is not started: the recorder taps Start game in the tracker. Final
 * games cannot add a recorder.
 */
export async function createBaseballIndependentRecorderState(gameId: string): Promise<GameState> {
  const shell = await loadBaseballCloudShell(gameId)
  if (shell.game.status === 'final') throw new Error('Finalized games cannot add a recorder.')
  const initialized = initializeGameEventStream(shell.state, gameEventRegistry, gameEventProjectors)
  if (!initialized.ok || !initialized.inspection.complete) {
    throw new Error(
      initialized.ok
        ? initialized.inspection.diagnostics[0]?.message ?? 'Baseball recorder could not start.'
        : initialized.error.message
    )
  }
  return initialized.state
}
