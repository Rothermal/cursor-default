import { supabase } from '../supabase'
import { isPlainObject } from './envelope'
import type { EventCloudParticipantRow } from './cloudTransport'

/** The `games` columns an event-sport cloud shell reads. */
export interface EventCloudGameRow {
  id: string
  team_id: string | null
  season_id: string | null
  created_by: string
  tracked_team_name: string
  tracked_team_nickname?: string | null
  opponent_name: string
  opponent_nickname?: string | null
  tournament_name: string | null
  game_date: string
  status: string
}

export interface EventCloudShellRows {
  game: EventCloudGameRow
  setupSnapshot: unknown
  participants: EventCloudParticipantRow[]
}

/**
 * Loads and structurally checks one event game's metadata, immutable setup snapshot and
 * participant rows (the Basketball BKE-4B3 shell checks, sport neutral since HKY-5B).
 * The sport module normalizes the setup and checks participant identity against it.
 */
export async function loadEventCloudShellRows(
  gameId: string,
  sportId: string,
  sportLabel: string
): Promise<EventCloudShellRows> {
  if (!supabase) throw new Error('Supabase client not configured')
  const [
    { data: gameData, error: gameError },
    { data: setupData, error: setupError },
    { data: participantData, error: participantError },
  ] = await Promise.all([
    supabase
      .from('games')
      .select(
        'id,team_id,season_id,created_by,tracked_team_name,tracked_team_nickname,opponent_name,opponent_nickname,tournament_name,game_date,status'
      )
      .eq('id', gameId)
      .eq('sport_id', sportId)
      .maybeSingle(),
    supabase
      .from('game_event_setup_snapshots')
      .select('sport_id,setup_snapshot')
      .eq('game_id', gameId)
      .maybeSingle(),
    supabase
      .from('game_participants')
      .select('id,client_participant_id,client_player_id,display_name,jersey_number')
      .eq('game_id', gameId),
  ])
  if (gameError) throw new Error(`${sportLabel} game load failed: ${gameError.message}`)
  if (setupError) throw new Error(`${sportLabel} setup load failed: ${setupError.message}`)
  if (participantError) {
    throw new Error(`${sportLabel} participants could not load: ${participantError.message}`)
  }
  if (!gameData) throw new Error(`Cloud ${sportLabel} game is unavailable.`)
  if (!setupData) throw new Error(`Cloud ${sportLabel} setup is unavailable.`)
  if (setupData.sport_id !== sportId) {
    throw new Error(`${sportLabel} game has an incompatible event setup snapshot.`)
  }
  if (!isEventCloudGameRow(gameData)) throw new Error(`Cloud ${sportLabel} game metadata is invalid.`)
  if (!Array.isArray(participantData) || !participantData.every(isEventCloudParticipantRow)) {
    throw new Error(`Cloud ${sportLabel} participants are invalid.`)
  }
  if (
    new Set(participantData.map(row => row.id)).size !== participantData.length ||
    new Set(participantData.map(row => row.client_participant_id)).size !== participantData.length
  ) {
    throw new Error(`Cloud ${sportLabel} participants contain duplicate identities.`)
  }
  const resolved = participantData.filter(row => row.client_player_id)
  if (new Set(resolved.map(row => row.client_player_id)).size !== resolved.length) {
    throw new Error(`Cloud ${sportLabel} participants contain duplicate player identities.`)
  }
  return { game: gameData, setupSnapshot: setupData.setup_snapshot, participants: participantData }
}

/** Whether a cloud game has an event setup snapshot (`sport_events`) or is a legacy row. */
export async function loadEventCloudDataAuthority(
  gameId: string,
  sportId: string,
  sportLabel: string
): Promise<'sport_events' | 'legacy'> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase
    .from('game_event_setup_snapshots')
    .select('sport_id')
    .eq('game_id', gameId)
    .maybeSingle()
  if (error) throw new Error(`${sportLabel} data authority could not load: ${error.message}`)
  if (!data) return 'legacy'
  if (data.sport_id !== sportId) {
    throw new Error(`${sportLabel} game has an incompatible event setup snapshot.`)
  }
  return 'sport_events'
}

function isEventCloudGameRow(value: unknown): value is EventCloudGameRow {
  return Boolean(
    isPlainObject(value) &&
      typeof value.id === 'string' && value.id.length > 0 &&
      (value.team_id === null || typeof value.team_id === 'string') &&
      (value.season_id === null || typeof value.season_id === 'string') &&
      typeof value.created_by === 'string' && value.created_by.length > 0 &&
      typeof value.tracked_team_name === 'string' && value.tracked_team_name.length > 0 &&
      (value.tracked_team_nickname == null || typeof value.tracked_team_nickname === 'string') &&
      typeof value.opponent_name === 'string' && value.opponent_name.length > 0 &&
      (value.opponent_nickname == null || typeof value.opponent_nickname === 'string') &&
      (value.tournament_name === null || typeof value.tournament_name === 'string') &&
      typeof value.game_date === 'string' && Number.isFinite(Date.parse(value.game_date)) &&
      typeof value.status === 'string' && value.status.length > 0
  )
}

function isEventCloudParticipantRow(value: unknown): value is EventCloudParticipantRow {
  return Boolean(
    isPlainObject(value) &&
      typeof value.id === 'string' && value.id.length > 0 &&
      typeof value.client_participant_id === 'string' && value.client_participant_id.length > 0 &&
      (value.client_player_id === null || typeof value.client_player_id === 'string') &&
      typeof value.display_name === 'string' && value.display_name.length > 0 &&
      (value.jersey_number === null || typeof value.jersey_number === 'string')
  )
}
