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
import { startHockeyGame } from './live'
import { createHockeySportGameState, normalizeHockeySportGameState } from './state'
import { hockeyLocalPlayerKey } from './stats'
import type { HockeyMatchSetup, HockeySportGameState } from './types'

export interface HockeyCloudShell {
  game: EventCloudGameRow
  state: GameState
  cloudToLocalPlayerId: Record<string, string>
}

export interface SyncHockeyEventGameInput {
  state: GameState
  userId: string
  localGameId: string
  validateBinding?: (gameId: string) => void | Promise<void>
  assertCurrent?: () => void
}

export type SyncHockeyEventGameResult = SyncEventGameResult

export class HockeyCloudRecoveryError extends Error {
  recoveredState: GameState

  constructor(message: string, recoveredState: GameState) {
    super(message)
    this.name = 'HockeyCloudRecoveryError'
    this.recoveredState = recoveredState
  }
}

/**
 * Every Hockey participant is a tracked setup participant (the opponent is entered by label).
 * A team game links roster players to the source team, as Basketball does (HKY-5 plan §5B).
 */
export function hockeyCloudParticipants(setup: HockeyMatchSetup): EventCloudParticipant[] {
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
      dressedAs: participant.dressedAs,
    },
  }))
}

function rebuildHockeyEventGame(state: GameState) {
  return rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
}

export function assertHealthyHockeyEventGame(state: GameState): HockeySportGameState {
  const sportState = state.sportGameState
  if (state.gameDataAuthority !== 'sport_events' || sportState?.sportId !== 'hockey') {
    throw new Error('Hockey event game is not initialized')
  }
  assertHealthyEventGame(state, 'hockey', rebuildHockeyEventGame)
  return sportState as HockeySportGameState
}

export const hockeyEventCloudTransportAdapter: EventCloudTransportAdapter = {
  sportId: 'hockey',
  sportLabel: 'Hockey',
  bindingRpc: 'bind_hockey_event_game_v5',
  registry: gameEventRegistry,
  remoteConflictRevisionPolicy: 'advance',
  prepare(state) {
    const sportState = assertHealthyHockeyEventGame(state)
    return {
      sourceTeamId: sportState.setup.sourceTeamId,
      sourceSeasonId: sportState.setup.sourceSeasonId,
      setupSnapshot: sportState.setup,
      participants: hockeyCloudParticipants(sportState.setup),
    }
  },
  createRecoveryError(message, recoveredState) {
    return new HockeyCloudRecoveryError(message, recoveredState)
  },
  rebuild: rebuildHockeyEventGame,
}

/** One recorder's stream per local game; another recorder's events are never blended in. */
export async function syncHockeyEventGameToCloud(
  input: SyncHockeyEventGameInput
): Promise<SyncHockeyEventGameResult> {
  if (isEventGameLocalOnly(input.state)) {
    throw new Error('This Hockey game is saved on this device only.')
  }
  assertHealthyHockeyEventGame(input.state)
  if (input.state.eventStream?.events.some(event => (
    !isGameEventEnvelope(event) || event.recorderUserId !== input.userId
  ))) {
    throw new Error('Hockey cloud sync cannot blend another recorder stream.')
  }
  input.assertCurrent?.()
  return syncEventGameToCloud({ ...input, adapter: hockeyEventCloudTransportAdapter })
}

export function loadHockeyCloudDataAuthority(gameId: string): Promise<'sport_events' | 'legacy'> {
  return loadEventCloudDataAuthority(gameId, 'hockey', 'Hockey')
}

export async function loadHockeyCloudShell(gameId: string): Promise<HockeyCloudShell> {
  const rows = await loadEventCloudShellRows(gameId, 'hockey', 'Hockey')
  const { game } = rows
  const normalized = normalizeHockeySportGameState({ sportId: 'hockey', version: 1, setup: rows.setupSnapshot })
  if (!normalized) throw new Error('Cloud Hockey setup is invalid.')
  const setup = normalized.setup
  if (
    setup.sourceTeamId !== game.team_id ||
    setup.sourceSeasonId !== (game.team_id ? game.season_id : null)
  ) {
    throw new Error('Cloud Hockey setup source does not match its game binding.')
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
      throw new Error('Cloud Hockey participant identity does not match the immutable setup.')
    }
  }
  const resolvedRows = rows.participants.filter(
    (row): row is typeof row & { client_player_id: string } => Boolean(row.client_player_id)
  )
  const players: Player[] = setup.participants.map(participant => ({
    id: hockeyLocalPlayerKey(participant),
    name: participant.displayName,
    number: participant.number ?? '',
    stats: {},
  }))
  const hockey = sports.find(sport => sport.id === 'hockey')
  if (!hockey) throw new Error('Hockey configuration is unavailable.')
  return {
    game,
    cloudToLocalPlayerId: Object.fromEntries(resolvedRows.map(row => [row.id, row.client_player_id])),
    state: {
      gameDataAuthority: 'sport_events',
      sport: hockey,
      gameInfo: {
        teamName: game.tracked_team_name,
        teamNickname: game.tracked_team_nickname,
        opponentName: game.opponent_name,
        opponentNickname: game.opponent_nickname,
        tournamentName: game.tournament_name ?? '',
        tournamentId: null,
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
      sportGameState: createHockeySportGameState(setup),
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
export async function loadHockeyCloudGameById(userId: string, gameId: string): Promise<GameState | null> {
  if (!supabase) throw new Error('Supabase client not configured')
  const shell = await loadHockeyCloudShell(gameId)
  const [{ data: conflictData, error: conflictError }, remote] = await Promise.all([
    supabase
      .from('game_event_conflicts')
      .select('id,event_id,local_event,remote_event,detected_at')
      .eq('game_id', gameId)
      .eq('recorded_by', userId)
      .eq('status', 'open'),
    loadGameEventStreamForRecorder(gameId, userId, shell.cloudToLocalPlayerId, gameEventRegistry),
  ])
  if (conflictError) throw new Error(`Hockey conflicts could not load: ${conflictError.message}`)
  if (!remote.ok || !remote.inspection.complete) {
    throw new Error(
      remote.error ?? remote.inspection.diagnostics[0]?.message ?? 'Cloud Hockey events are invalid.'
    )
  }
  if (remote.eventStream.events.length === 0) return null

  const conflicts = (conflictData ?? []).map(row => gameEventSyncConflictFromRow(row, 'hockey'))
  if (conflicts.some(conflict => conflict === null)) {
    throw new Error('Cloud Hockey conflict history is invalid.')
  }
  const validConflicts = conflicts as GameEventSyncConflict[]
  if (new Set(validConflicts.map(conflict => conflict.eventId)).size !== validConflicts.length) {
    throw new Error('Cloud Hockey conflict history contains duplicate event ids.')
  }

  const rebuilt = rebuildHockeyEventGame({
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
    throw new Error(rebuilt.inspection.diagnostics[0]?.message ?? 'Cloud Hockey projection is invalid.')
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
 * A second recorder on a team game starts their own stream from the same immutable setup:
 * the opening lineup and period 1, as at setup. Final games cannot add a recorder.
 */
export async function createHockeyIndependentRecorderState(userId: string, gameId: string): Promise<GameState> {
  const shell = await loadHockeyCloudShell(gameId)
  if (shell.game.status === 'final') throw new Error('Finalized games cannot add a recorder.')
  const initialized = initializeGameEventStream(shell.state, gameEventRegistry, gameEventProjectors)
  if (!initialized.ok || !initialized.inspection.complete) {
    throw new Error(
      initialized.ok
        ? initialized.inspection.diagnostics[0]?.message ?? 'Hockey recorder could not start.'
        : initialized.error.message
    )
  }
  const started = startHockeyGame(initialized.state, {
    recorderUserId: userId,
    occurredAt: new Date().toISOString(),
  })
  if (!started.ok) throw new Error(started.message)
  return started.state
}
