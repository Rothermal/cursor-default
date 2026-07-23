import type { GameState } from '../../types'
import { canonicalGameEventStreamForFingerprint } from '../gameEvents/stream'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { upsertGameEventForRecorder } from '../gameEvents/cloud'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { supabase } from '../supabase'
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
        currentStatus: participant.status,
        currentRole: structuredClone(participant.role),
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
  const participants = soccerCloudParticipants(sportState)

  const { data: bindingData, error: bindingError } = await supabase.rpc(
    'bind_soccer_event_game',
    {
      p_client_local_game_id: localGameId,
      p_source_team_id: sportState.setup.sourceTeamId,
      p_source_season_id: sportState.setup.sourceSeasonId,
      p_team_name: state.gameInfo!.teamName,
      p_opponent_name: state.gameInfo!.opponentName,
      p_competition_name: state.gameInfo!.tournamentName || null,
      p_game_date: state.gameInfo!.date,
      p_participants: participants,
    }
  )
  if (bindingError) throw new Error(`Soccer game binding failed: ${bindingError.message}`)

  const binding = bindingData as SoccerGameBindingRow | null
  if (!binding?.game_id || !binding.participant_id_map) {
    throw new Error('Soccer game binding returned an invalid response')
  }

  for (const rawEvent of state.eventStream!.events) {
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

  const revisions = soccerEventRevisionCheckpoint(state)
  const maxSequence = state.eventStream!.events.reduce<number>((max, rawEvent) =>
    isGameEventEnvelope(rawEvent) ? Math.max(max, rawEvent.sequence) : max, -1)
  const { data: checkpointData, error: checkpointError } = await supabase.rpc(
    'confirm_game_event_stream_checkpoint',
    {
      p_game_id: binding.game_id,
      p_stream_version: state.eventStream!.version,
      p_event_revisions: revisions,
      p_event_count: revisions.length,
      p_max_sequence: maxSequence,
      p_stream_fingerprint: soccerEventStreamFingerprint(state),
    }
  )
  if (checkpointError) {
    throw new Error(`Soccer event checkpoint failed: ${checkpointError.message}`)
  }
  if (typeof checkpointData !== 'string') {
    throw new Error('Soccer event checkpoint returned an invalid response')
  }

  return {
    seasonId: sportState.setup.sourceSeasonId,
    teamId: sportState.setup.sourceTeamId,
    gameId: binding.game_id,
    playerIdMap: binding.participant_id_map,
    syncedAt: checkpointData,
  }
}
