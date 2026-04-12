import type { GameInfo, GameState, Player, ShotRecord } from '../types'
import { supabase } from './supabase'
import { isTeamPseudoPlayer, TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from './teamPlayers'

interface SyncGameSnapshotInput {
  state: GameState
  userId: string
}

export interface SyncGameSnapshotResult {
  seasonId: string
  teamId: string
  gameId: string
  playerIdMap: Record<string, string>
  syncedAt: string
  /** True when the cloud row is already final — no writes were performed (avoids clobbering scores). */
  skippedFinalGame?: boolean
}

export interface HydratedCloudGame {
  sportId: string
  status: string
  gameInfo: GameInfo
  players: Player[]
  activePlayerId: string | null
  opponentScore: number
  /** Null = legacy scoring from stats + home_score_adjustment. */
  homeTeamScore: number | null
  homeScoreAdjustment: number
  notes: string
  seasonId: string | null
  /** Raw `seasons.team_stats_config` when the column exists; null otherwise. */
  teamStatsConfig: Record<string, unknown> | null
  teamId: string
  gameId: string
  playerIdMap: Record<string, string>
  /** Chart shots for this game + recorder (basketball); empty if table missing or none. */
  shotChart: ShotRecord[]
  hydratedAt: string
}

type CloudGameRow = {
  id: string
  team_id: string
  opponent_name: string
  tournament_name: string | null
  tournament_id?: string | null
  season_id?: string | null
  game_date: string
  opponent_score: number | null
  home_team_score?: number | null
  home_score_adjustment?: number | null
  notes?: string | null
  status: string
  created_at: string
  home_team_player_id?: string | null
  opp_team_player_id?: string | null
}

function isMissingLastOpenedColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('last_opened_at') && error.message.includes('column')
}

function isMissingHomeScoreAdjustmentColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('home_score_adjustment') && error.message.includes('column')
}

function isMissingHomeTeamScoreColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('home_team_score') && error.message.includes('column')
}

function isMissingTournamentIdColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('tournament_id') && error.message.includes('column')
}

function isMissingNotesColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return (
    error.message.includes("'notes'") ||
    (error.message.includes('notes') && error.message.includes('column'))
  )
}

function isMissingSeasonIdColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('season_id') && error.message.includes('column')
}

function isMissingTeamStatsConfigColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('team_stats_config') && error.message.includes('column')
}

function isMissingGameTeamPlaceholderColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  const m = error.message
  if (!m.includes('column')) return false
  return (
    m.includes('home_team_player_id') ||
    m.includes('opp_team_player_id')
  )
}

function isMissingIsTeamPlaceholderColumnError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  return error.message.includes('is_team_placeholder') && error.message.includes('column')
}

function isMissingShotChartTableError(error: { message?: string } | null): boolean {
  if (!error?.message) return false
  const m = error.message.toLowerCase()
  return (
    (m.includes('shot_chart') && m.includes('relation') && m.includes('does not exist')) ||
    (m.includes('shot_chart') && m.includes('could not find the table'))
  )
}

function parseSeasonTeamStatsConfig(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  return Object.keys(rec).length > 0 ? rec : null
}

export type LastOpenedPreferenceSupport = 'unknown' | 'supported' | 'missing'
let lastOpenedPreferenceSupport: LastOpenedPreferenceSupport = 'unknown'

export function getLastOpenedPreferenceSupport(): LastOpenedPreferenceSupport {
  return lastOpenedPreferenceSupport
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

async function ensureSeason(state: GameState, userId: string): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  if (state.cloudSync.seasonId) {
    return state.cloudSync.seasonId
  }

  const sportId = state.sport!.id
  const teamName = state.gameInfo!.teamName.trim()

  // Prefer an existing cloud team with the same name and sport so we reuse the
  // season from Teams / Game Setup instead of creating a parallel year-based season.
  if (teamName) {
    const { data: teamRows, error: teamSeasonError } = await supabase
      .from('teams')
      .select('season_id, seasons!inner(sport)')
      .eq('owner_id', userId)
      .eq('name', teamName)
      .eq('seasons.sport', sportId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (teamSeasonError) {
      throw new Error(`Team season lookup failed: ${teamSeasonError.message}`)
    }

    const sid = teamRows?.[0]?.season_id as string | undefined
    if (sid) {
      return sid
    }
  }

  const seasonName = getSeasonFromDate(state.gameInfo!.date)

  const { data: existing, error: lookupError } = await supabase
    .from('seasons')
    .select('id')
    .eq('owner_id', userId)
    .eq('name', seasonName)
    .eq('sport', sportId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (lookupError) {
    throw new Error(`Season lookup failed: ${lookupError.message}`)
  }

  if (existing && existing.length > 0) {
    return existing[0].id as string
  }

  const { data: created, error: createError } = await supabase
    .from('seasons')
    .insert({
      owner_id: userId,
      name: seasonName,
      sport: sportId,
    })
    .select('id')
    .single()

  if (createError || !created) {
    throw new Error(`Season creation failed: ${createError?.message ?? 'unknown error'}`)
  }

  return created.id as string
}

async function ensureTeam(state: GameState, userId: string, seasonId: string): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  if (state.cloudSync.teamId) {
    return state.cloudSync.teamId
  }

  const teamName = state.gameInfo!.teamName.trim()

  const { data: existingTeams, error: lookupError } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', userId)
    .eq('name', teamName)
    .eq('season_id', seasonId)
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
      name: teamName,
      season_id: seasonId,
    })
    .select('id')
    .single()

  if (createError?.code === '23505') {
    const { data: again, error: againError } = await supabase
      .from('teams')
      .select('id')
      .eq('owner_id', userId)
      .eq('name', teamName)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (againError) {
      throw new Error(`Team lookup after conflict failed: ${againError.message}`)
    }
    if (again && again.length > 0) {
      return again[0].id as string
    }
  }

  if (createError || !createdTeam) {
    throw new Error(`Team creation failed: ${createError?.message ?? 'unknown error'}`)
  }

  return createdTeam.id as string
}

async function ensureGame(
  state: GameState,
  userId: string,
  teamId: string,
  seasonIdForGame: string | null
): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const gameInsertPayload = {
    team_id: teamId,
    ...(seasonIdForGame ? { season_id: seasonIdForGame } : {}),
    opponent_name: state.gameInfo!.opponentName,
    opponent_score: state.opponentScore,
    home_team_score: state.homeTeamScore,
    home_score_adjustment: state.homeScoreAdjustment,
    tournament_name: state.gameInfo!.tournamentName || null,
    tournament_id: state.gameInfo!.tournamentId || null,
    notes: state.notes || null,
    game_date: state.gameInfo!.date,
    status: 'in_progress',
    created_by: userId,
  }

  /** Updates must not set status — stale clients could reopen a final game id and revert it to in_progress. */
  const gameUpdatePayload = {
    team_id: teamId,
    ...(seasonIdForGame ? { season_id: seasonIdForGame } : {}),
    opponent_name: state.gameInfo!.opponentName,
    opponent_score: state.opponentScore,
    home_team_score: state.homeTeamScore,
    home_score_adjustment: state.homeScoreAdjustment,
    tournament_name: state.gameInfo!.tournamentName || null,
    tournament_id: state.gameInfo!.tournamentId || null,
    notes: state.notes || null,
    game_date: state.gameInfo!.date,
  }

  // Fallback payload without optional columns that may not exist yet (pre-migration)
  function buildInsertFallbackPayload(
    omitHomeTeamScore: boolean,
    omitHomeAdj: boolean,
    omitTournamentId: boolean,
    omitNotes: boolean,
    omitSeasonId: boolean
  ) {
    return {
      team_id: teamId,
      ...(omitSeasonId || !seasonIdForGame ? {} : { season_id: seasonIdForGame }),
      opponent_name: state.gameInfo!.opponentName,
      opponent_score: state.opponentScore,
      ...(omitHomeTeamScore ? {} : { home_team_score: state.homeTeamScore }),
      ...(omitHomeAdj ? {} : { home_score_adjustment: state.homeScoreAdjustment }),
      tournament_name: state.gameInfo!.tournamentName || null,
      ...(omitTournamentId ? {} : { tournament_id: state.gameInfo!.tournamentId || null }),
      ...(omitNotes ? {} : { notes: state.notes || null }),
      game_date: state.gameInfo!.date,
      status: 'in_progress',
      created_by: userId,
    }
  }

  function buildUpdateFallbackPayload(
    omitHomeTeamScore: boolean,
    omitHomeAdj: boolean,
    omitTournamentId: boolean,
    omitNotes: boolean,
    omitSeasonId: boolean
  ) {
    return {
      team_id: teamId,
      ...(omitSeasonId || !seasonIdForGame ? {} : { season_id: seasonIdForGame }),
      opponent_name: state.gameInfo!.opponentName,
      opponent_score: state.opponentScore,
      ...(omitHomeTeamScore ? {} : { home_team_score: state.homeTeamScore }),
      ...(omitHomeAdj ? {} : { home_score_adjustment: state.homeScoreAdjustment }),
      tournament_name: state.gameInfo!.tournamentName || null,
      ...(omitTournamentId ? {} : { tournament_id: state.gameInfo!.tournamentId || null }),
      ...(omitNotes ? {} : { notes: state.notes || null }),
      game_date: state.gameInfo!.date,
    }
  }

  async function upsertWithFallback(
    op: 'insert' | 'update',
    payload: object,
    gameId?: string
  ): Promise<string> {
    const run = async (p: object) => {
      if (op === 'update' && gameId) {
        const { error } = await supabase!.from('games').update(p).eq('id', gameId)
        return { error, data: null as null }
      }
      const { data, error } = await supabase!.from('games').insert(p).select('id').single()
      return { error, data }
    }

    let { error, data } = await run(payload)
    if (!error) return op === 'update' ? gameId! : (data!.id as string)

    const missingHomeTeamScore = isMissingHomeTeamScoreColumnError(error)
    const missingHomeAdj = isMissingHomeScoreAdjustmentColumnError(error)
    const missingTournamentId = isMissingTournamentIdColumnError(error)
    const missingNotes = isMissingNotesColumnError(error)
    const missingSeasonId = isMissingSeasonIdColumnError(error)
    if (
      !missingHomeTeamScore &&
      !missingHomeAdj &&
      !missingTournamentId &&
      !missingNotes &&
      !missingSeasonId
    ) {
      throw new Error(`Game ${op} failed: ${error.message}`)
    }

    const fb =
      op === 'update'
        ? buildUpdateFallbackPayload(
            missingHomeTeamScore,
            missingHomeAdj,
            missingTournamentId,
            missingNotes,
            missingSeasonId
          )
        : buildInsertFallbackPayload(
            missingHomeTeamScore,
            missingHomeAdj,
            missingTournamentId,
            missingNotes,
            missingSeasonId
          )
    ;({ error, data } = await run(fb))
    if (error) throw new Error(`Game ${op} failed: ${error.message}`)
    return op === 'update' ? gameId! : (data!.id as string)
  }

  if (state.cloudSync.gameId) {
    await upsertWithFallback('update', gameUpdatePayload, state.cloudSync.gameId)
    return state.cloudSync.gameId
  }

  return upsertWithFallback('insert', gameInsertPayload)
}

/**
 * Cloud `players` row for team stat tracking only (no `team_players` row).
 * Reuses existing id from `playerIdMap` or `games.*_team_player_id` when present.
 */
async function ensureTeamPlaceholderPlayer(
  player: Player,
  userId: string,
  existingRemoteId: string | undefined
): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { firstName, lastName } = parsePlayerName(player.name)

  if (existingRemoteId) {
    const { error: updateError } = await supabase
      .from('players')
      .update({ first_name: firstName, last_name: lastName || null, nickname: null })
      .eq('id', existingRemoteId)
    if (updateError) {
      throw new Error(`Team placeholder update failed: ${updateError.message}`)
    }
    return existingRemoteId
  }

  const fullInsert = {
    first_name: firstName,
    last_name: lastName || null,
    nickname: null as string | null,
    created_by: userId,
    is_team_placeholder: true,
  }
  const { data: created, error: createErr } = await supabase
    .from('players')
    .insert(fullInsert)
    .select('id')
    .single()

  if (!createErr && created) {
    return created.id as string
  }

  if (createErr && isMissingIsTeamPlaceholderColumnError(createErr)) {
    const { data: fb, error: fbErr } = await supabase
      .from('players')
      .insert({
        first_name: firstName,
        last_name: lastName || null,
        nickname: null,
        created_by: userId,
      })
      .select('id')
      .single()
    if (fbErr || !fb) {
      throw new Error(`Team placeholder create failed: ${fbErr?.message ?? 'unknown'}`)
    }
    return fb.id as string
  }

  throw new Error(`Team placeholder create failed: ${createErr?.message ?? 'unknown error'}`)
}

async function linkGameTeamPlaceholderIds(
  gameId: string,
  homePlayerId: string | undefined,
  oppPlayerId: string | undefined
): Promise<void> {
  if (!supabase) return
  if (!homePlayerId && !oppPlayerId) return

  const payload: Record<string, string> = {}
  if (homePlayerId) payload.home_team_player_id = homePlayerId
  if (oppPlayerId) payload.opp_team_player_id = oppPlayerId

  const { error } = await supabase.from('games').update(payload).eq('id', gameId)
  if (!error) return
  if (isMissingGameTeamPlaceholderColumnError(error)) {
    return
  }
  throw new Error(`Game team placeholder link failed: ${error.message}`)
}

async function ensurePlayerId(
  player: Player,
  teamId: string,
  userId: string,
  existingRemoteId: string | undefined
): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { firstName, lastName } = parsePlayerName(player.name)

  if (isTeamPseudoPlayer(player)) {
    return ensureTeamPlaceholderPlayer(player, userId, existingRemoteId)
  }
  const jerseyNumber = player.number.trim()

  if (existingRemoteId) {
    const { error: updateError } = await supabase
      .from('players')
      .update({ first_name: firstName, last_name: lastName, nickname: null })
      .eq('id', existingRemoteId)

    if (updateError) {
      throw new Error(`Player update failed: ${updateError.message}`)
    }

    await supabase
      .from('team_players')
      .upsert(
        { team_id: teamId, player_id: existingRemoteId, jersey_number: jerseyNumber, is_active: true },
        { onConflict: 'team_id,player_id' }
      )

    return existingRemoteId
  }

  const { data: existingOnTeam, error: junctionLookupError } = await supabase
    .from('team_players')
    .select('player_id, players!inner(id, first_name, last_name)')
    .eq('team_id', teamId)
    .eq('players.first_name', firstName)
    .eq('players.last_name', lastName)
    .limit(1)

  if (!junctionLookupError && existingOnTeam && existingOnTeam.length > 0) {
    const playerId = (existingOnTeam[0] as { player_id: string }).player_id
    await supabase
      .from('team_players')
      .update({ jersey_number: jerseyNumber, is_active: true })
      .eq('team_id', teamId)
      .eq('player_id', playerId)
    return playerId
  }

  const { data: ownedPlayers, error: lookupError } = await supabase
    .from('players')
    .select('id')
    .eq('created_by', userId)
    .eq('first_name', firstName)
    .eq('last_name', lastName)
    .limit(1)

  if (lookupError) {
    throw new Error(`Player lookup failed: ${lookupError.message}`)
  }

  let playerId: string

  if (ownedPlayers && ownedPlayers.length > 0) {
    playerId = ownedPlayers[0].id as string
  } else {
    const { data: createdPlayer, error: createError } = await supabase
      .from('players')
      .insert({ first_name: firstName, last_name: lastName, created_by: userId })
      .select('id')
      .single()

    if (createError || !createdPlayer) {
      throw new Error(`Player creation failed: ${createError?.message ?? 'unknown error'}`)
    }

    playerId = createdPlayer.id as string

    await supabase
      .from('player_guardians')
      .upsert(
        { player_id: playerId, user_id: userId, relationship: 'parent' },
        { onConflict: 'player_id,user_id' }
      )
  }

  await supabase
    .from('team_players')
    .upsert(
      { team_id: teamId, player_id: playerId, jersey_number: jerseyNumber, is_active: true },
      { onConflict: 'team_id,player_id' }
    )

  return playerId
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

async function syncShotChartToCloud(
  state: GameState,
  userId: string,
  gameId: string,
  playerIdMap: Record<string, string>
): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }
  if (state.sport?.id !== 'basketball') {
    return
  }

  const { error: delError } = await supabase
    .from('shot_chart')
    .delete()
    .eq('game_id', gameId)
    .eq('recorded_by', userId)

  if (delError) {
    if (isMissingShotChartTableError(delError)) {
      return
    }
    throw new Error(`Shot chart sync (delete) failed: ${delError.message}`)
  }

  if (state.shotChart.length === 0) {
    return
  }

  const rows: Array<{
    game_id: string
    player_id: string
    recorded_by: string
    client_shot_id: string
    x: number
    y: number
    made: boolean
    shot_type: '2pt' | '3pt'
    zone: ShotRecord['zone']
  }> = []

  for (const shot of state.shotChart) {
    const remotePlayerId = playerIdMap[shot.playerId]
    if (!remotePlayerId) continue
    rows.push({
      game_id: gameId,
      player_id: remotePlayerId,
      recorded_by: userId,
      client_shot_id: shot.id,
      x: shot.x,
      y: shot.y,
      made: shot.made,
      shot_type: shot.shotType,
      zone: shot.zone,
    })
  }

  if (rows.length === 0) {
    return
  }

  const { error: insError } = await supabase.from('shot_chart').insert(rows)
  if (insError) {
    if (isMissingShotChartTableError(insError)) {
      return
    }
    throw new Error(`Shot chart sync (insert) failed: ${insError.message}`)
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

  if (state.cloudSync.gameId) {
    const { data: gameRow, error: statusError } = await supabase
      .from('games')
      .select('status')
      .eq('id', state.cloudSync.gameId)
      .maybeSingle()

    if (statusError) {
      throw new Error(`Could not verify game before sync: ${statusError.message}`)
    }

    if (gameRow?.status === 'final') {
      return {
        seasonId: state.cloudSync.seasonId ?? '',
        teamId: state.cloudSync.teamId ?? '',
        gameId: state.cloudSync.gameId,
        playerIdMap: state.cloudSync.playerIdMap,
        syncedAt: new Date().toISOString(),
        skippedFinalGame: true,
      }
    }
  }

  const seasonId = await ensureSeason(state, userId)
  const teamId = await ensureTeam(state, userId, seasonId)
  const gameId = await ensureGame(state, userId, teamId, seasonId)

  const nextPlayerIdMap: Record<string, string> = {}
  for (const player of state.players) {
    const remotePlayerId = await ensurePlayerId(
      player,
      teamId,
      userId,
      state.cloudSync.playerIdMap[player.id]
    )
    nextPlayerIdMap[player.id] = remotePlayerId
  }

  await upsertGameStats(state, userId, gameId, nextPlayerIdMap)

  await syncShotChartToCloud(state, userId, gameId, nextPlayerIdMap)

  await linkGameTeamPlaceholderIds(
    gameId,
    nextPlayerIdMap[TEAM_PLAYER_HOME_ID],
    nextPlayerIdMap[TEAM_PLAYER_OPP_ID]
  )

  // Best-effort metadata touch for deterministic resume selection across devices.
  // If the optional migration adding games.last_opened_at is not applied yet,
  // this call safely no-ops.
  await touchCloudGameLastOpened(gameId).catch(() => {})

  return {
    seasonId,
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
    .select('id,name,season_id')
    .eq('id', gameRow.team_id)
    .maybeSingle()

  if (teamError) {
    throw new Error(`Team load failed: ${teamError.message}`)
  }

  if (!teamRow) {
    throw new Error('Team missing for requested game')
  }

  let sportId = ''
  let teamStatsConfig: Record<string, unknown> | null = null
  const seasonId =
    (gameRow.season_id as string | null | undefined) ??
    (teamRow.season_id as string | null) ??
    null
  if (seasonId) {
    const { data: seasonRow, error: seasonErr } = await supabase
      .from('seasons')
      .select('sport,team_stats_config')
      .eq('id', seasonId)
      .maybeSingle()
    if (seasonErr && isMissingTeamStatsConfigColumnError(seasonErr)) {
      const { data: fallbackSeason } = await supabase
        .from('seasons')
        .select('sport')
        .eq('id', seasonId)
        .maybeSingle()
      sportId = (fallbackSeason?.sport as string | null) ?? ''
    } else if (seasonErr) {
      throw new Error(`Season load failed: ${seasonErr.message}`)
    } else {
      sportId = (seasonRow?.sport as string | null) ?? ''
      teamStatsConfig = parseSeasonTeamStatsConfig(seasonRow?.team_stats_config)
    }
  }

  let statRows:
    | Array<{ player_id: string; stat_id: string; value: number }>
    | null = null
  let statsError: { message?: string } | null = null
  if (gameRow.status === 'final') {
    const { data, error } = await supabase.rpc('get_game_stats_resolved', {
      p_game_id: gameRow.id,
    })
    statRows = (data as Array<{ player_id: string; stat_id: string; value: number }> | null) ?? null
    statsError = error
  } else {
    const { data, error } = await supabase
      .from('game_stats')
      .select('player_id,stat_id,value')
      .eq('game_id', gameRow.id)
      .eq('recorded_by', userId)
    statRows = (data as Array<{ player_id: string; stat_id: string; value: number }> | null) ?? null
    statsError = error
  }

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

  const homeCloudId = gameRow.home_team_player_id ?? null
  const oppCloudId = gameRow.opp_team_player_id ?? null

  const placeholderIds = [homeCloudId, oppCloudId].filter((x): x is string => Boolean(x))
  const placeholderNameById = new Map<string, { first_name: string; last_name: string | null }>()
  if (placeholderIds.length > 0) {
    const { data: phRows, error: phErr } = await supabase
      .from('players')
      .select('id,first_name,last_name')
      .in('id', placeholderIds)
    if (!phErr && phRows) {
      for (const row of phRows as Array<{ id: string; first_name: string; last_name: string | null }>) {
        placeholderNameById.set(row.id, { first_name: row.first_name, last_name: row.last_name })
      }
    }
  }

  const { data: rosterRows, error: rosterError } = await supabase
    .from('team_players')
    .select('player_id, jersey_number, is_active, players!inner(id, first_name, last_name, created_at)')
    .eq('team_id', gameRow.team_id)
    .order('joined_at', { ascending: true })

  if (rosterError) {
    throw new Error(`Roster load failed: ${rosterError.message}`)
  }

  type RosterRow = {
    player_id: string
    jersey_number: string | null
    is_active: boolean
    players: { id: string; first_name: string; last_name: string | null; created_at: string }
  }

  const rosterPlayers: Player[] = ((rosterRows ?? []) as unknown as RosterRow[])
    .filter(row => row.is_active || statsByPlayer.has(row.player_id))
    .filter(
      row =>
        (homeCloudId ? row.player_id !== homeCloudId : true) &&
        (oppCloudId ? row.player_id !== oppCloudId : true)
    )
    .map(row => {
      const playerId = row.player_id
      const p = row.players
      const fullName = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
      return {
        id: playerId,
        name: fullName || 'Player',
        number: row.jersey_number ?? '',
        stats: statsByPlayer.get(playerId) ?? {},
      }
    })

  const teamPlayers: Player[] = []
  if (homeCloudId) {
    const meta = placeholderNameById.get(homeCloudId)
    const fromDb = meta
      ? `${meta.first_name ?? ''} ${meta.last_name ?? ''}`.trim()
      : ''
    teamPlayers.push({
      id: TEAM_PLAYER_HOME_ID,
      name: fromDb || teamRow.name || 'Home',
      number: '★',
      stats: statsByPlayer.get(homeCloudId) ?? {},
      isTeamPlayer: true,
      teamSide: 'home',
    })
  }
  if (oppCloudId) {
    const meta = placeholderNameById.get(oppCloudId)
    const fromDb = meta
      ? `${meta.first_name ?? ''} ${meta.last_name ?? ''}`.trim()
      : ''
    teamPlayers.push({
      id: TEAM_PLAYER_OPP_ID,
      name: fromDb || gameRow.opponent_name || 'Opponent',
      number: '★',
      stats: statsByPlayer.get(oppCloudId) ?? {},
      isTeamPlayer: true,
      teamSide: 'opponent',
    })
  }

  const players: Player[] = [...teamPlayers, ...rosterPlayers]

  const playerIdMap: Record<string, string> = {}
  for (const p of rosterPlayers) {
    playerIdMap[p.id] = p.id
  }
  if (homeCloudId) {
    playerIdMap[TEAM_PLAYER_HOME_ID] = homeCloudId
  }
  if (oppCloudId) {
    playerIdMap[TEAM_PLAYER_OPP_ID] = oppCloudId
  }

  const remoteToLocalPlayerId: Record<string, string> = {}
  for (const [localId, remoteId] of Object.entries(playerIdMap)) {
    remoteToLocalPlayerId[remoteId] = localId
  }

  const shotChart: ShotRecord[] = []
  if (sportId === 'basketball') {
    const { data: shotRows, error: shotErr } = await supabase
      .from('shot_chart')
      .select('player_id, client_shot_id, x, y, made, shot_type, zone, created_at')
      .eq('game_id', gameRow.id)
      .eq('recorded_by', userId)
      .order('created_at', { ascending: true })

    if (shotErr) {
      if (!isMissingShotChartTableError(shotErr)) {
        throw new Error(`Shot chart load failed: ${shotErr.message}`)
      }
    } else {
      const zones: ShotRecord['zone'][] = ['restricted', 'paint', 'mid_range', 'three']
      for (const row of (shotRows ?? []) as Array<{
        player_id: string
        client_shot_id: string
        x: number | string
        y: number | string
        made: boolean
        shot_type: string
        zone: string
        created_at: string
      }>) {
        const localPlayerId = remoteToLocalPlayerId[row.player_id]
        if (!localPlayerId) continue
        const z = row.zone as ShotRecord['zone']
        if (!zones.includes(z)) continue
        const st = row.shot_type === '3pt' ? '3pt' : '2pt'
        shotChart.push({
          id: row.client_shot_id,
          x: Number(row.x),
          y: Number(row.y),
          made: row.made,
          shotType: st,
          zone: z,
          playerId: localPlayerId,
          timestamp: new Date(row.created_at).getTime(),
        })
      }
    }
  }

  const activePlayerId = rosterPlayers[0]?.id ?? teamPlayers[0]?.id ?? null

  return {
    sportId,
    status: gameRow.status,
    gameInfo: {
      teamName: teamRow.name as string,
      opponentName: gameRow.opponent_name,
      tournamentName: gameRow.tournament_name ?? '',
      tournamentId: gameRow.tournament_id ?? null,
      date: gameRow.game_date,
    },
    players,
    activePlayerId,
    opponentScore: gameRow.opponent_score ?? 0,
    homeTeamScore:
      typeof gameRow.home_team_score === 'number' ? gameRow.home_team_score : null,
    homeScoreAdjustment: gameRow.home_score_adjustment ?? 0,
    notes: gameRow.notes ?? '',
    seasonId,
    teamStatsConfig,
    teamId: teamRow.id as string,
    gameId: gameRow.id,
    playerIdMap,
    shotChart,
    hydratedAt: new Date().toISOString(),
  }
}

async function loadLatestGameRow(userId: string): Promise<CloudGameRow | null> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  // All optional columns (may not exist before their respective migrations)
  const allOptional =
    'home_team_score,home_score_adjustment,tournament_id,notes,last_opened_at,season_id,home_team_player_id,opp_team_player_id'
  const baseColumns =
    'id,team_id,opponent_name,tournament_name,game_date,opponent_score,status,created_at'

  const advanced = await supabase
    .from('games')
    .select(`${baseColumns},${allOptional}`)
    .eq('created_by', userId)
    .in('status', ['in_progress', 'scheduled'])
    .order('last_opened_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!advanced.error) {
    lastOpenedPreferenceSupport = 'supported'
    return (advanced.data as CloudGameRow | null) ?? null
  }

  // Detect which optional columns are missing and rebuild the select list.
  const missingLastOpened = isMissingLastOpenedColumnError(advanced.error)
  const missingHomeTeamScore = isMissingHomeTeamScoreColumnError(advanced.error)
  const missingHomeAdjust = isMissingHomeScoreAdjustmentColumnError(advanced.error)
  const missingTournamentId = isMissingTournamentIdColumnError(advanced.error)
  const missingNotes = isMissingNotesColumnError(advanced.error)
  const missingSeasonId = isMissingSeasonIdColumnError(advanced.error)
  const missingTeamPlaceholders = isMissingGameTeamPlaceholderColumnError(advanced.error)

  if (
    !missingLastOpened &&
    !missingHomeTeamScore &&
    !missingHomeAdjust &&
    !missingTournamentId &&
    !missingNotes &&
    !missingSeasonId &&
    !missingTeamPlaceholders
  ) {
    throw new Error(`Game load failed: ${advanced.error.message}`)
  }

  if (missingLastOpened) lastOpenedPreferenceSupport = 'missing'

  const selectColumns =
    baseColumns +
    (!missingHomeTeamScore ? ',home_team_score' : '') +
    (!missingHomeAdjust ? ',home_score_adjustment' : '') +
    (!missingTournamentId ? ',tournament_id' : '') +
    (!missingNotes ? ',notes' : '') +
    (!missingLastOpened ? ',last_opened_at' : '') +
    (!missingSeasonId ? ',season_id' : '') +
    (!missingTeamPlaceholders ? ',home_team_player_id,opp_team_player_id' : '')

  const retry = await supabase
    .from('games')
    .select(selectColumns)
    .eq('created_by', userId)
    .in('status', ['in_progress', 'scheduled'])
    .order(!missingLastOpened ? 'last_opened_at' : 'created_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!retry.error) {
    return (retry.data as CloudGameRow | null) ?? null
  }

  // Final fallback: base columns only (no optional columns at all).
  const isStillOptionalMissing =
    isMissingLastOpenedColumnError(retry.error) ||
    isMissingHomeTeamScoreColumnError(retry.error) ||
    isMissingHomeScoreAdjustmentColumnError(retry.error) ||
    isMissingTournamentIdColumnError(retry.error) ||
    isMissingNotesColumnError(retry.error) ||
    isMissingSeasonIdColumnError(retry.error) ||
    isMissingGameTeamPlaceholderColumnError(retry.error)

  if (isStillOptionalMissing) {
    const finalRetry = await supabase
      .from('games')
      .select(baseColumns)
      .eq('created_by', userId)
      .in('status', ['in_progress', 'scheduled'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (finalRetry.error) {
      throw new Error(`Game load failed: ${finalRetry.error.message}`)
    }
    return (finalRetry.data as CloudGameRow | null) ?? null
  }

  throw new Error(`Game load failed: ${retry.error.message}`)
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

  const baseById = 'id,team_id,opponent_name,tournament_name,game_date,opponent_score,status,created_at'

  const { data: gameRow, error: gameError } = await supabase
    .from('games')
    .select(
      `${baseById},home_team_score,home_score_adjustment,tournament_id,notes,season_id,home_team_player_id,opp_team_player_id`
    )
    .eq('id', gameId)
    .maybeSingle()

  if (gameError) {
    const missingHomeTeamScore = isMissingHomeTeamScoreColumnError(gameError)
    const missingHomeAdj = isMissingHomeScoreAdjustmentColumnError(gameError)
    const missingTournamentId = isMissingTournamentIdColumnError(gameError)
    const missingNotes = isMissingNotesColumnError(gameError)
    const missingSeasonId = isMissingSeasonIdColumnError(gameError)
    const missingTeamPh = isMissingGameTeamPlaceholderColumnError(gameError)
    if (
      !missingHomeTeamScore &&
      !missingHomeAdj &&
      !missingTournamentId &&
      !missingNotes &&
      !missingSeasonId &&
      !missingTeamPh
    ) {
      throw new Error(`Game load failed: ${gameError.message}`)
    }
    const fallbackSelect =
      baseById +
      (!missingHomeTeamScore ? ',home_team_score' : '') +
      (!missingHomeAdj ? ',home_score_adjustment' : '') +
      (!missingTournamentId ? ',tournament_id' : '') +
      (!missingNotes ? ',notes' : '') +
      (!missingSeasonId ? ',season_id' : '') +
      (!missingTeamPh ? ',home_team_player_id,opp_team_player_id' : '')
    const { data: gameRowFallback, error: gameErrorFallback } = await supabase
      .from('games')
      .select(fallbackSelect)
      .eq('id', gameId)
      .maybeSingle()
    if (gameErrorFallback) {
      throw new Error(`Game load failed: ${gameErrorFallback.message}`)
    }
    if (!gameRowFallback) {
      return null
    }
    return hydrateCloudGameFromRow(userId, gameRowFallback as unknown as CloudGameRow)
  }

  if (!gameRow) {
    return null
  }

  return hydrateCloudGameFromRow(userId, gameRow as unknown as CloudGameRow)
}

export async function touchCloudGameLastOpened(gameId: string): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { error } = await supabase
    .from('games')
    .update({ last_opened_at: new Date().toISOString() })
    .eq('id', gameId)

  if (!error) {
    lastOpenedPreferenceSupport = 'supported'
    return
  }
  if (isMissingLastOpenedColumnError(error)) {
    lastOpenedPreferenceSupport = 'missing'
    return
  }

  throw new Error(`Game touch failed: ${error.message}`)
}
