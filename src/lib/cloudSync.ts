import type { GameInfo, GameState, Player } from '../types'
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

export interface HydratedCloudGame {
  sportId: string
  status: string
  gameInfo: GameInfo
  players: Player[]
  activePlayerId: string | null
  opponentScore: number
  teamId: string
  gameId: string
  playerIdMap: Record<string, string>
  hydratedAt: string
}

type CloudGameRow = {
  id: string
  team_id: string
  opponent_name: string
  tournament_name: string | null
  game_date: string
  opponent_score: number | null
  status: string
  created_at: string
}

function isMissingLastOpenedColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('last_opened_at') && error.message.includes('column')
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

  // Best-effort metadata touch for deterministic resume selection across devices.
  // If the optional migration adding games.last_opened_at is not applied yet,
  // this call safely no-ops.
  await touchCloudGameLastOpened(gameId).catch(() => {})

  return {
    teamId,
    gameId,
    playerIdMap: nextPlayerIdMap,
    syncedAt: new Date().toISOString(),
  }
}

async function hydrateCloudGameFromRow(userId: string, gameRow: CloudGameRow): Promise<HydratedCloudGame> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { data: teamRow, error: teamError } = await supabase
    .from('teams')
    .select('id,name,sport')
    .eq('id', gameRow.team_id)
    .maybeSingle()

  if (teamError) {
    throw new Error(`Team load failed: ${teamError.message}`)
  }

  if (!teamRow) {
    throw new Error('Team missing for requested game')
  }

  const { data: statRows, error: statsError } = await supabase
    .from('game_stats')
    .select('player_id,stat_id,value')
    .eq('game_id', gameRow.id)
    .eq('recorded_by', userId)

  if (statsError) {
    throw new Error(`Stats load failed: ${statsError.message}`)
  }

  const statsByPlayer = new Map<string, Record<string, number>>()
  for (const row of statRows ?? []) {
    const playerId = row.player_id as string
    const statMap = statsByPlayer.get(playerId) ?? {}
    statMap[row.stat_id as string] = row.value as number
    statsByPlayer.set(playerId, statMap)
  }

  const { data: playerRows, error: playersError } = await supabase
    .from('players')
    .select('id,first_name,last_name,jersey_number,is_active,created_at')
    .eq('team_id', gameRow.team_id)
    .order('created_at', { ascending: true })

  if (playersError) {
    throw new Error(`Players load failed: ${playersError.message}`)
  }

  const players: Player[] = (playerRows ?? [])
    .filter(row => (row.is_active as boolean) || statsByPlayer.has(row.id as string))
    .map(row => {
      const playerId = row.id as string
      const fullName = `${(row.first_name as string | null) ?? ''} ${(row.last_name as string | null) ?? ''}`.trim()
      return {
        id: playerId,
        name: fullName || 'Player',
        number: (row.jersey_number as string | null) ?? '',
        stats: statsByPlayer.get(playerId) ?? {},
      }
    })

  const playerIdMap = players.reduce<Record<string, string>>((map, player) => {
    map[player.id] = player.id
    return map
  }, {})

  return {
    sportId: teamRow.sport as string,
    status: gameRow.status,
    gameInfo: {
      teamName: teamRow.name as string,
      opponentName: gameRow.opponent_name,
      tournamentName: gameRow.tournament_name ?? '',
      date: gameRow.game_date,
    },
    players,
    activePlayerId: players[0]?.id ?? null,
    opponentScore: gameRow.opponent_score ?? 0,
    teamId: teamRow.id as string,
    gameId: gameRow.id,
    playerIdMap,
    hydratedAt: new Date().toISOString(),
  }
}

async function loadLatestGameRow(userId: string): Promise<CloudGameRow | null> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const advanced = await supabase
    .from('games')
    .select('id,team_id,opponent_name,tournament_name,game_date,opponent_score,status,created_at,last_opened_at')
    .eq('created_by', userId)
    .in('status', ['in_progress', 'scheduled'])
    .order('last_opened_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!advanced.error) {
    return (advanced.data as CloudGameRow | null) ?? null
  }

  if (!isMissingLastOpenedColumnError(advanced.error)) {
    throw new Error(`Game load failed: ${advanced.error.message}`)
  }

  const fallback = await supabase
    .from('games')
    .select('id,team_id,opponent_name,tournament_name,game_date,opponent_score,status,created_at')
    .eq('created_by', userId)
    .in('status', ['in_progress', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fallback.error) {
    throw new Error(`Game load failed: ${fallback.error.message}`)
  }

  return (fallback.data as CloudGameRow | null) ?? null
}

export async function loadLatestCloudGame(userId: string): Promise<HydratedCloudGame | null> {
  const latestGame = await loadLatestGameRow(userId)
  if (!latestGame) {
    return null
  }

  return hydrateCloudGameFromRow(userId, latestGame)
}

export async function loadCloudGameById(userId: string, gameId: string): Promise<HydratedCloudGame | null> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { data: gameRow, error: gameError } = await supabase
    .from('games')
    .select('id,team_id,opponent_name,tournament_name,game_date,opponent_score,status,created_at')
    .eq('created_by', userId)
    .eq('id', gameId)
    .maybeSingle()

  if (gameError) {
    throw new Error(`Game load failed: ${gameError.message}`)
  }

  if (!gameRow) {
    return null
  }

  return hydrateCloudGameFromRow(userId, gameRow as CloudGameRow)
}

export async function touchCloudGameLastOpened(gameId: string): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { error } = await supabase
    .from('games')
    .update({ last_opened_at: new Date().toISOString() })
    .eq('id', gameId)

  if (!error) return
  if (isMissingLastOpenedColumnError(error)) return

  throw new Error(`Game touch failed: ${error.message}`)
}
