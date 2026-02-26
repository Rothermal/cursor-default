import type { GameState, Player } from '../types'
import { supabase } from './supabase'

interface SyncGameSnapshotInput {
  state: GameState
  userId: string
}

export interface SyncGameSnapshotResult {
  teamId: string
  gameId: string
  playerIdMap: Record<string, string>
  syncedAt: string
}

function parsePlayerName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return { firstName: 'Player', lastName: '' }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

function getSeasonFromDate(dateIso: string): string {
  const date = new Date(dateIso)
  if (Number.isNaN(date.getTime())) {
    return new Date().getFullYear().toString()
  }

  return date.getFullYear().toString()
}

async function ensureTeam(state: GameState, userId: string): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  if (state.cloudSync.teamId) {
    return state.cloudSync.teamId
  }

  const { data: existingTeams, error: lookupError } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', userId)
    .eq('name', state.gameInfo!.teamName)
    .eq('sport', state.sport!.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (lookupError) {
    throw new Error(`Team lookup failed: ${lookupError.message}`)
  }

  if (existingTeams && existingTeams.length > 0) {
    return existingTeams[0].id as string
  }

  const { data: createdTeam, error: createError } = await supabase
    .from('teams')
    .insert({
      owner_id: userId,
      name: state.gameInfo!.teamName,
      sport: state.sport!.id,
      season: getSeasonFromDate(state.gameInfo!.date),
    })
    .select('id')
    .single()

  if (createError || !createdTeam) {
    throw new Error(`Team creation failed: ${createError?.message ?? 'unknown error'}`)
  }

  return createdTeam.id as string
}

async function ensureGame(state: GameState, userId: string, teamId: string): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const gamePayload = {
    team_id: teamId,
    opponent_name: state.gameInfo!.opponentName,
    opponent_score: state.opponentScore,
    tournament_name: state.gameInfo!.tournamentName || null,
    game_date: state.gameInfo!.date,
    status: 'in_progress',
    created_by: userId,
  }

  if (state.cloudSync.gameId) {
    const { error: updateError } = await supabase
      .from('games')
      .update(gamePayload)
      .eq('id', state.cloudSync.gameId)

    if (updateError) {
      throw new Error(`Game update failed: ${updateError.message}`)
    }

    return state.cloudSync.gameId
  }

  const { data: createdGame, error: createError } = await supabase
    .from('games')
    .insert(gamePayload)
    .select('id')
    .single()

  if (createError || !createdGame) {
    throw new Error(`Game creation failed: ${createError?.message ?? 'unknown error'}`)
  }

  return createdGame.id as string
}

async function ensurePlayerId(
  player: Player,
  teamId: string,
  existingRemoteId: string | undefined
): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { firstName, lastName } = parsePlayerName(player.name)
  const jerseyNumber = player.number.trim()

  const playerPayload = {
    team_id: teamId,
    first_name: firstName,
    last_name: lastName,
    jersey_number: jerseyNumber,
    is_active: true,
  }

  if (existingRemoteId) {
    const { error: updateError } = await supabase
      .from('players')
      .update(playerPayload)
      .eq('id', existingRemoteId)

    if (updateError) {
      throw new Error(`Player update failed: ${updateError.message}`)
    }

    return existingRemoteId
  }

  const { data: existingPlayers, error: lookupError } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', teamId)
    .eq('first_name', firstName)
    .eq('last_name', lastName)
    .eq('jersey_number', jerseyNumber)
    .limit(1)

  if (lookupError) {
    throw new Error(`Player lookup failed: ${lookupError.message}`)
  }

  if (existingPlayers && existingPlayers.length > 0) {
    return existingPlayers[0].id as string
  }

  const { data: createdPlayer, error: createError } = await supabase
    .from('players')
    .insert(playerPayload)
    .select('id')
    .single()

  if (createError || !createdPlayer) {
    throw new Error(`Player creation failed: ${createError?.message ?? 'unknown error'}`)
  }

  return createdPlayer.id as string
}

async function upsertGameStats(
  state: GameState,
  userId: string,
  gameId: string,
  playerIdMap: Record<string, string>
): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const statRows: Array<{
    game_id: string
    player_id: string
    recorded_by: string
    stat_id: string
    value: number
  }> = []

  for (const player of state.players) {
    const remotePlayerId = playerIdMap[player.id]
    if (!remotePlayerId) continue

    for (const [statId, value] of Object.entries(player.stats)) {
      statRows.push({
        game_id: gameId,
        player_id: remotePlayerId,
        recorded_by: userId,
        stat_id: statId,
        value,
      })
    }
  }

  if (statRows.length === 0) {
    return
  }

  const { error: upsertError } = await supabase
    .from('game_stats')
    .upsert(statRows, { onConflict: 'game_id,player_id,recorded_by,stat_id' })

  if (upsertError) {
    throw new Error(`Stats sync failed: ${upsertError.message}`)
  }
}

export async function syncGameSnapshotToCloud({
  state,
  userId,
}: SyncGameSnapshotInput): Promise<SyncGameSnapshotResult> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  if (!state.sport || !state.gameInfo) {
    throw new Error('Game is not initialized')
  }

  const teamId = await ensureTeam(state, userId)
  const gameId = await ensureGame(state, userId, teamId)

  const nextPlayerIdMap: Record<string, string> = {}
  for (const player of state.players) {
    const remotePlayerId = await ensurePlayerId(player, teamId, state.cloudSync.playerIdMap[player.id])
    nextPlayerIdMap[player.id] = remotePlayerId
  }

  await upsertGameStats(state, userId, gameId, nextPlayerIdMap)

  return {
    teamId,
    gameId,
    playerIdMap: nextPlayerIdMap,
    syncedAt: new Date().toISOString(),
  }
}
