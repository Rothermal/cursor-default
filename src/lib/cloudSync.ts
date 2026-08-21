import type { GameInfo, GameState, Player, ShotRecord } from '../types'
import { supabase } from './supabase'
import { isTeamPseudoPlayer, TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from './teamPlayers'
import { hasMappableChartShot } from './shotChartSyncMapping'
import { pickRecorderPerPlayer } from './shotChartReview'
import { isValidRemotePlayerUuid } from './uuidValidation'
import { logClientSyncError } from './logClientSyncError'
import { isAggregateCloudSyncEligible } from './gameSyncFingerprint'
import {
  getSeasonFromDate,
  invertPlayerIdMap,
  isMissingGameTeamPlaceholderColumnError,
  isMissingHomeScoreAdjustmentColumnError,
  isMissingHomeTeamScoreColumnError,
  isMissingIsTeamPlaceholderColumnError,
  isMissingLastOpenedColumnError,
  isMissingNotesColumnError,
  isMissingSeasonIdColumnError,
  isMissingShotChartTableError,
  isMissingTeamStatsConfigColumnError,
  isMissingTournamentIdColumnError,
  mapShotRows,
  parsePlayerName,
  parseSeasonTeamStatsConfig,
  findDuplicatePlayerMappings,
  resolveUnmappedPlayer,
  type RemoteShotRow,
  type TeamPlayerCandidate,
} from './cloudSyncHelpers'
import {
  aggregateStatsByPlayer,
  buildHydratedCloudPlayers,
  buildOptionalGameSelectSuffix,
  detectOptionalGameColumnGaps,
  hasAnyOptionalGameColumnGap,
  hasLoadByIdOptionalGameColumnGap,
  type CloudRosterRow,
} from './cloudSyncHydrate'

interface SyncGameSnapshotInput {
  state: GameState
  userId: string
}

export type ShotChartCloudSyncMode =
  | 'synced'
  /** Upsert-only: hydration dropped unmappable cloud rows; full delete+replace must stay blocked. */
  | 'synced_partial'
  | 'skipped_incomplete_hydration'
  /** Local chart has rows but none map to a cloud `player_id`; never run a full-table delete in that case. */
  | 'skipped_unmappable_shots'

export interface SyncGameSnapshotResult {
  seasonId: string
  teamId: string
  gameId: string
  playerIdMap: Record<string, string>
  syncedAt: string
  /** True when the cloud row is already final — no writes were performed (avoids clobbering scores). */
  skippedFinalGame?: boolean
  /** When set, `shot_chart` was left unchanged (see `CloudSyncState.shotChartHydrationDroppedRows`). */
  shotChartCloudSync?: ShotChartCloudSyncMode
  /** Players whose duplicate cloud link was repaired during this sync, by display name. */
  repairedPlayerLinks?: string[]
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
  /** `shot_chart` rows for this game/recorder that could not be mapped into `shotChart`. */
  shotChartHydrationDroppedRows: number
  hydratedAt: string
}

type CloudGameRow = {
  id: string
  team_id: string
  opponent_name: string
  tournament_name: string | null
  tournament_id?: string | null
  season_id?: string | null
  sport_id?: string | null
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

type EnsuredGame = {
  gameId: string
  created: boolean
}

export type LastOpenedPreferenceSupport = 'unknown' | 'supported' | 'missing'
let lastOpenedPreferenceSupport: LastOpenedPreferenceSupport = 'unknown'

export function getLastOpenedPreferenceSupport(): LastOpenedPreferenceSupport {
  return lastOpenedPreferenceSupport
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
): Promise<EnsuredGame> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }
  const sportId = state.sport?.id
  if (!sportId) {
    throw new Error('Game sport is required for cloud sync')
  }

  const gameInsertPayload = {
    team_id: teamId,
    sport_id: sportId,
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
    sport_id: sportId,
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
      sport_id: sportId,
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
      sport_id: sportId,
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
    return { gameId: state.cloudSync.gameId, created: false }
  }

  return { gameId: await upsertWithFallback('insert', gameInsertPayload), created: true }
}

async function deleteNewlyCreatedGameAfterFailedSync(
  gameId: string,
  userId: string
): Promise<string | null> {
  if (!supabase) return null

  const { error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId)
    .eq('created_by', userId)
    .eq('status', 'in_progress')

  return error?.message ?? null
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

  const remoteId =
    existingRemoteId && isValidRemotePlayerUuid(existingRemoteId) ? existingRemoteId : undefined

  if (remoteId) {
    // The game mapping is authoritative. Another accepted recorder may not own
    // the shared placeholder row and should not need to rewrite it to sync stats.
    return remoteId
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
  existingRemoteId: string | undefined,
  /** Cloud players another local player already resolved to in this sync. */
  claimedPlayerIds: ReadonlySet<string> = new Set<string>()
): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { firstName, lastName } = parsePlayerName(player.name)

  const remoteId =
    existingRemoteId && isValidRemotePlayerUuid(existingRemoteId) ? existingRemoteId : undefined

  if (isTeamPseudoPlayer(player)) {
    return ensureTeamPlaceholderPlayer(player, userId, remoteId)
  }
  const jerseyNumber = player.number.trim()

  if (remoteId) {
    // Existing mappings can belong to a player created by another team member.
    // Roster and identity changes go through their dedicated management screens.
    return remoteId
  }

  // Fetch every same-name teammate with its jersey and decide locally: filtering by
  // jersey in SQL cannot tell "same person, new number" from "different person".
  const { data: existingOnTeam, error: junctionLookupError } = await supabase
    .from('team_players')
    .select('player_id, jersey_number, is_active, players!inner(id, first_name, last_name)')
    .eq('team_id', teamId)
    .eq('players.first_name', firstName)
    .eq('players.last_name', lastName)

  // Never resolve identity from a failed lookup: an empty candidate list would look
  // like "no such teammate" and create a duplicate person from missing information.
  if (junctionLookupError) {
    throw new Error(`Team roster lookup failed: ${junctionLookupError.message}`)
  }

  const candidates: TeamPlayerCandidate[] = (
    (existingOnTeam ?? []) as Array<{
      player_id: string
      jersey_number: string | null
      is_active: boolean | null
    }>
  ).map(row => ({
    playerId: row.player_id,
    jerseyNumber: row.jersey_number,
    isActive: row.is_active !== false,
  }))
  const resolution = resolveUnmappedPlayer({ candidates, jerseyNumber, claimedPlayerIds })

  if (resolution.mode === 'reuse_team_match') {
    // Only adopt a jersey onto a teammate that had none. Never rewrite or clear an
    // existing cloud jersey from a local roster that disagrees.
    const { error: reuseError } = await supabase
      .from('team_players')
      .update(
        resolution.adoptJersey
          ? { jersey_number: jerseyNumber, is_active: true }
          : { is_active: true }
      )
      .eq('team_id', teamId)
      .eq('player_id', resolution.playerId)

    if (reuseError) {
      throw new Error(`Team roster link failed: ${reuseError.message}`)
    }
    return resolution.playerId
  }

  let playerId: string
  // Only set when this call inserted the row, so a failed roster link can clean up
  // after itself without ever deleting a player it merely found.
  let createdPlayerId: string | null = null

  if (resolution.mode === 'create_distinct') {
    const { data: createdPlayer, error: createError } = await supabase
      .from('players')
      .insert({ first_name: firstName, last_name: lastName, created_by: userId })
      .select('id')
      .single()

    if (createError || !createdPlayer) {
      throw new Error(`Player creation failed: ${createError?.message ?? 'unknown error'}`)
    }
    playerId = createdPlayer.id as string
    createdPlayerId = playerId
  } else {
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
      createdPlayerId = playerId
    }
  }

  // New/owned rows own their jersey outright, so an empty local number normalizes to
  // null here. The reuse path above deliberately differs: it never touches a jersey
  // it did not create.
  const { error: rosterLinkError } = await supabase
    .from('team_players')
    .upsert(
      {
        team_id: teamId,
        player_id: playerId,
        jersey_number: jerseyNumber || null,
        is_active: true,
      },
      { onConflict: 'team_id,player_id' }
    )

  // A player id whose roster link failed would sync stats against a team the player
  // is not on, so fail here rather than returning a half-linked identity.
  if (rosterLinkError) {
    // The unlinked row is invisible to the candidate query (it joins `team_players`),
    // so leaving it behind would orphan one player per retry. Best effort: never let a
    // cleanup failure mask the error that actually stopped the sync.
    if (createdPlayerId) {
      const { error: cleanupError } = await supabase
        .from('players')
        .delete()
        .eq('id', createdPlayerId)
        .eq('created_by', userId)
      if (cleanupError) {
        console.warn('[StatKeeper] Failed to clean up unlinked player row', cleanupError.message)
      }
    }
    throw new Error(`Team roster link failed: ${rosterLinkError.message}`)
  }

  return playerId
}

/**
 * Neutralise stat rows a relinked player left on the cloud player it used to share.
 *
 * Only rows this recorder owns are touched — the upsert conflict target includes
 * `recorded_by`, and RLS scopes writes to the caller — so a co-recorder's rows for the
 * same player are never zeroed.
 */
async function clearStatsFromRelinkedPlayer(
  userId: string,
  gameId: string,
  staleStatIdsBySharedPlayerId: Map<string, Set<string>>
): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const zeroRows = [...staleStatIdsBySharedPlayerId].flatMap(([playerId, statIds]) =>
    [...statIds].map(statId => ({
      game_id: gameId,
      player_id: playerId,
      recorded_by: userId,
      stat_id: statId,
      value: 0,
    }))
  )

  if (zeroRows.length === 0) return

  const { error } = await supabase
    .from('game_stats')
    .upsert(zeroRows, { onConflict: 'game_id,player_id,recorded_by,stat_id' })

  if (error) {
    throw new Error(`Stats relink cleanup failed: ${error.message}`)
  }
}

/**
 * Carry this recorder's checkout across to a player that was relinked off a shared id.
 *
 * Only the caller's own row is copied, and deliberately so. A checkout means "this user
 * is recording the player at that cloud id". This device can prove that *its own* map had
 * both locals on the shared id, so its user was recording both. It cannot know whether
 * another recorder's map was corrupted the same way, and copying their row would assert
 * they record a player they may never have seen — potentially making them primary for it,
 * which is the same wrong-authority problem this repair exists to fix. `is_primary` is
 * carried over rather than forced true for the same reason, and only into a target that
 * has no primary yet.
 *
 * The read-then-insert is not atomic, so two devices repairing onto the same target at
 * once could both see the vacancy and both claim primary. Closing that needs a partial
 * unique index on `(game_id, player_id) where is_primary`, which would also change how
 * the existing checkout screen behaves — deliberately out of scope here.
 */
async function copyOwnCheckoutToRelinkedPlayers(
  userId: string,
  gameId: string,
  relinks: Array<{ fromPlayerId: string; toPlayerId: string }>
): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }
  if (relinks.length === 0) return

  // Read the target's checkouts too, not just the source's. Copying blind can promote
  // this recorder over one already primary on the target, and `player_checkouts` only
  // enforces `unique(game_id, player_id, user_id)` — nothing stops two primaries, and
  // `get_game_stats_resolved` breaks a two-primary tie arbitrarily.
  const { data: checkouts, error: lookupError } = await supabase
    .from('player_checkouts')
    .select('player_id, user_id, is_primary')
    .eq('game_id', gameId)
    .in('player_id', [
      ...new Set(relinks.flatMap(relink => [relink.fromPlayerId, relink.toPlayerId])),
    ])

  if (lookupError) {
    throw new Error(`Checkout relink lookup failed: ${lookupError.message}`)
  }

  const checkoutRows = (checkouts ?? []) as Array<{
    player_id: string
    user_id: string
    is_primary: boolean
  }>
  const ownCheckout = (playerId: string) =>
    checkoutRows.find(row => row.player_id === playerId && row.user_id === userId)
  const hasPrimary = (playerId: string) =>
    checkoutRows.some(row => row.player_id === playerId && row.is_primary)

  const rows = relinks.flatMap(relink => {
    const source = ownCheckout(relink.fromPlayerId)
    // Nothing to carry across, or this recorder already has an assignment on the target
    // that is not ours to rewrite.
    if (!source || ownCheckout(relink.toPlayerId)) return []
    return [
      {
        game_id: gameId,
        player_id: relink.toPlayerId,
        user_id: userId,
        // Only claim primary into a vacancy. Someone else already holding it there
        // outranks a claim inherited from a different player's row.
        is_primary: source.is_primary && !hasPrimary(relink.toPlayerId),
      },
    ]
  })

  if (rows.length === 0) return

  const { error: insertError } = await supabase
    .from('player_checkouts')
    .upsert(rows, { onConflict: 'game_id,player_id,user_id', ignoreDuplicates: true })

  if (insertError) {
    throw new Error(`Checkout relink failed: ${insertError.message}`)
  }
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

export async function syncShotChartToCloud(
  state: GameState,
  userId: string,
  gameId: string,
  playerIdMap: Record<string, string>
): Promise<ShotChartCloudSyncMode> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }
  if (state.sport?.id !== 'basketball') {
    return 'synced'
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

  // Hydration skipped one or more DB rows (e.g. shooter not on roster). Do not delete+replace
  // `shot_chart` in that case — local `shotChart` is incomplete and would wipe orphan cloud rows.
  // Still upsert mappable local rows so new shots recorded this session reach the cloud.
  if (state.cloudSync.shotChartHydrationDroppedRows > 0) {
    if (rows.length === 0) {
      return 'skipped_incomplete_hydration'
    }
    const { error: upsertError } = await supabase
      .from('shot_chart')
      .upsert(rows, { onConflict: 'game_id,recorded_by,client_shot_id' })
    if (upsertError) {
      if (isMissingShotChartTableError(upsertError)) {
        return 'synced_partial'
      }
      throw new Error(`Shot chart sync (upsert) failed: ${upsertError.message}`)
    }
    return 'synced_partial'
  }

  // When some local shots have no cloud `player_id` (e.g. roster replaced before we
  // trimmed `shotChart`), still sync stats and the mappable subset of the chart.
  // If *none* map, skip entirely: `delete()` runs before insert, so zero insertable
  // rows would wipe every existing `shot_chart` row for this game/recorder.

  if (state.shotChart.length > 0 && rows.length === 0) {
    return 'skipped_unmappable_shots'
  }

  // Never delete cloud rows when every local shot lacks a remote player id — the delete
  // would run before this function could insert anything, wiping legitimate `shot_chart` history.
  if (state.shotChart.length > 0 && !hasMappableChartShot(state.shotChart, playerIdMap)) {
    return 'skipped_incomplete_hydration'
  }

  const { error: delError } = await supabase
    .from('shot_chart')
    .delete()
    .eq('game_id', gameId)
    .eq('recorded_by', userId)

  if (delError) {
    if (isMissingShotChartTableError(delError)) {
      return 'synced'
    }
    throw new Error(`Shot chart sync (delete) failed: ${delError.message}`)
  }

  if (state.shotChart.length === 0) {
    return 'synced'
  }

  const { error: insError } = await supabase.from('shot_chart').insert(rows)
  if (insError) {
    if (isMissingShotChartTableError(insError)) {
      return 'synced'
    }
    throw new Error(`Shot chart sync (insert) failed: ${insError.message}`)
  }
  return 'synced'
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

  if (!isAggregateCloudSyncEligible(state)) {
    throw new Error('Sport-owned event games cannot use aggregate cloud sync')
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
        shotChartCloudSync: 'synced',
      }
    }
  }

  // An already-corrupted map bypasses every protection below, because a valid existing
  // mapping short-circuits candidate resolution entirely. Repair it rather than failing:
  // the only manual fix available would be removing the player from the roster, which
  // deletes the very stats and shots the recorder is trying to sync.
  const duplicateMappings = findDuplicatePlayerMappings(
    state.cloudSync.playerIdMap,
    state.players.filter(player => !isTeamPseudoPlayer(player)).map(player => player.id)
  )
  // The first local player keeps the cloud row; the rest drop their mapping and fall
  // through to normal resolution, where `claimedPlayerIds` stops them re-collapsing onto
  // it and a distinct cloud player is created instead.
  const playerIdMap = { ...state.cloudSync.playerIdMap }
  const repairedPlayerLinks: string[] = []
  // Stat rows the moved players already wrote under the shared cloud id. Relinking alone
  // leaves them behind, because `upsertGameStats` only writes the keys each player
  // currently has and never clears one written under a different mapping.
  const staleStatIdsBySharedPlayerId = new Map<string, Set<string>>()
  // Local players moved off a shared cloud id, so their checkout can follow them once
  // the loop below has resolved what they moved to.
  const relinkedFromSharedPlayerId = new Map<string, string>()
  for (const duplicate of duplicateMappings) {
    const [keeperLocalId, ...movedLocalIds] = duplicate.localPlayerIds
    const statsFor = (localId: string) =>
      Object.keys(state.players.find(player => player.id === localId)?.stats ?? {})
    const keeperStatIds = new Set(statsFor(keeperLocalId))
    const staleStatIds = staleStatIdsBySharedPlayerId.get(duplicate.remotePlayerId) ?? new Set()

    for (const localPlayerId of movedLocalIds) {
      delete playerIdMap[localPlayerId]
      relinkedFromSharedPlayerId.set(localPlayerId, duplicate.remotePlayerId)
      repairedPlayerLinks.push(
        state.players.find(player => player.id === localPlayerId)?.name ?? localPlayerId
      )
      // Keys the keeper still owns are overwritten with its own values by the normal
      // snapshot upsert, so only the moved player's exclusive keys need clearing.
      for (const statId of statsFor(localPlayerId)) {
        if (!keeperStatIds.has(statId)) staleStatIds.add(statId)
      }
    }

    if (staleStatIds.size > 0) {
      staleStatIdsBySharedPlayerId.set(duplicate.remotePlayerId, staleStatIds)
    }
  }
  if (repairedPlayerLinks.length > 0) {
    console.warn(
      `[StatKeeper] Repaired duplicate cloud player links: ${repairedPlayerLinks.join(', ')}. ` +
        'Earlier syncs of this game merged their stats in the cloud.'
    )
  }

  const seasonId = await ensureSeason(state, userId)
  const teamId = await ensureTeam(state, userId, seasonId)

  // Resolve players and roster links before inserting a brand-new `games` row.
  // This shrinks the orphan window: failures in player/team-player setup no longer
  // leave an in-progress cloud game without stats.
  const nextPlayerIdMap: Record<string, string> = {}
  // Cloud rows already spoken for. Seeded from the durable map so an unmapped local
  // player cannot claim a mapped teammate's row regardless of roster order, then grown
  // as the loop resolves, so two same-named locals never collapse onto one cloud player.
  const claimedPlayerIds = new Set<string>(Object.values(playerIdMap))
  for (const player of state.players) {
    const remotePlayerId = await ensurePlayerId(
      player,
      teamId,
      userId,
      playerIdMap[player.id],
      claimedPlayerIds
    )
    nextPlayerIdMap[player.id] = remotePlayerId
    claimedPlayerIds.add(remotePlayerId)
  }

  const ensuredGame = await ensureGame(state, userId, teamId, seasonId)
  const gameId = ensuredGame.gameId
  let shotChartCloudSync: ShotChartCloudSyncMode = 'synced'

  // Only thrown child-write failures trigger rollback. Shot-chart partial/skipped modes
  // intentionally keep the game row because stats may have synced and local chart state is incomplete.
  try {
    // SEC-1 RLS validates team pseudo-player stats against these game FKs, so link them
    // before any stat or shot rows are written.
    await linkGameTeamPlaceholderIds(
      gameId,
      nextPlayerIdMap[TEAM_PLAYER_HOME_ID],
      nextPlayerIdMap[TEAM_PLAYER_OPP_ID]
    )

    // Zero out what the moved players left on the shared cloud player before writing the
    // snapshot, so the keeper's totals stop counting someone else's stats. Skipped for a
    // game this sync just created, which cannot have prior rows. There is no `game_stats`
    // DELETE policy, so a zero value is the available way to neutralise a row.
    if (!ensuredGame.created && staleStatIdsBySharedPlayerId.size > 0) {
      await clearStatsFromRelinkedPlayer(userId, gameId, staleStatIdsBySharedPlayerId)
    }

    // A checkout keyed by the shared cloud id no longer covers the player that moved off
    // it, so `get_game_stats_resolved` would stop seeing a primary for them.
    if (!ensuredGame.created && relinkedFromSharedPlayerId.size > 0) {
      await copyOwnCheckoutToRelinkedPlayers(
        userId,
        gameId,
        [...relinkedFromSharedPlayerId]
          .map(([localPlayerId, fromPlayerId]) => ({
            fromPlayerId,
            toPlayerId: nextPlayerIdMap[localPlayerId],
          }))
          .filter(relink => relink.toPlayerId && relink.toPlayerId !== relink.fromPlayerId)
      )
    }

    await upsertGameStats(state, userId, gameId, nextPlayerIdMap)

    shotChartCloudSync = await syncShotChartToCloud(state, userId, gameId, nextPlayerIdMap)
  } catch (error) {
    if (ensuredGame.created) {
      const rollbackError = await deleteNewlyCreatedGameAfterFailedSync(gameId, userId).catch(
        err => (err instanceof Error ? err.message : 'unknown rollback failure')
      )
      if (rollbackError) {
        await logClientSyncError(
          userId,
          `Rollback failed for just-created game ${gameId}: ${rollbackError}`,
          state,
          {
            bypassThrottle: true,
            extraContext: {
              rollbackGameId: gameId,
              originalSyncError: error instanceof Error ? error.message : String(error),
            },
          }
        ).catch(() => {})
      }
    }
    throw error
  }

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
    shotChartCloudSync,
    ...(repairedPlayerLinks.length > 0 ? { repairedPlayerLinks } : {}),
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

  const statsByPlayer = aggregateStatsByPlayer(statRows)

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

  const {
    players,
    playerIdMap,
    activePlayerId,
  } = buildHydratedCloudPlayers({
    rosterRows: (rosterRows ?? []) as unknown as CloudRosterRow[],
    statsByPlayer,
    homeCloudId,
    oppCloudId,
    homeTeamName: (teamRow.name as string) || 'Home',
    opponentName: gameRow.opponent_name || 'Opponent',
    placeholderNameById,
  })

  const remoteToLocalPlayerId = invertPlayerIdMap(playerIdMap)

  let shotChart: ShotRecord[] = []
  let shotChartHydrationDroppedRows = 0
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
      const mapped = mapShotRows((shotRows ?? []) as RemoteShotRow[], remoteToLocalPlayerId)
      shotChart = mapped.shotChart
      shotChartHydrationDroppedRows = mapped.droppedRows
    }
  }

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
    shotChartHydrationDroppedRows,
    hydratedAt: new Date().toISOString(),
  }
}

async function loadLatestGameRow(userId: string): Promise<CloudGameRow | null> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  // All optional columns (may not exist before their respective migrations)
  const allOptional =
    'home_team_score,home_score_adjustment,tournament_id,notes,last_opened_at,season_id,sport_id,home_team_player_id,opp_team_player_id'
  const baseColumns =
    'id,team_id,opponent_name,tournament_name,game_date,opponent_score,status,created_at'

  const advanced = await supabase
    .from('games')
    .select(`${baseColumns},${allOptional}`)
    .eq('created_by', userId)
    .not('team_id', 'is', null)
    .is('sport_id', null)
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
  const gaps = detectOptionalGameColumnGaps(advanced.error)

  if (!hasAnyOptionalGameColumnGap(gaps)) {
    throw new Error(`Game load failed: ${advanced.error.message}`)
  }

  if (gaps.lastOpened) lastOpenedPreferenceSupport = 'missing'

  const selectColumns = baseColumns + buildOptionalGameSelectSuffix(gaps)

  let retryQuery = supabase
    .from('games')
    .select(selectColumns)
    .eq('created_by', userId)
    .not('team_id', 'is', null)
    .in('status', ['in_progress', 'scheduled'])

  if (!gaps.sportId) {
    retryQuery = retryQuery.is('sport_id', null)
  }

  const retry = await retryQuery
    .order(!gaps.lastOpened ? 'last_opened_at' : 'created_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!retry.error) {
    return (retry.data as CloudGameRow | null) ?? null
  }

  // Final fallback: base columns only (no optional columns at all).
  const retryGaps = detectOptionalGameColumnGaps(retry.error)
  if (hasAnyOptionalGameColumnGap(retryGaps)) {
    const sportIdMissing = gaps.sportId || retryGaps.sportId
    let finalQuery = supabase
      .from('games')
      .select(baseColumns + (!sportIdMissing ? ',sport_id' : ''))
      .eq('created_by', userId)
      .not('team_id', 'is', null)
      .in('status', ['in_progress', 'scheduled'])

    if (!sportIdMissing) {
      finalQuery = finalQuery.is('sport_id', null)
    }

    const finalRetry = await finalQuery
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
  if (!latestGame || latestGame.sport_id) {
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
      `${baseById},home_team_score,home_score_adjustment,tournament_id,notes,season_id,sport_id,home_team_player_id,opp_team_player_id`
    )
    .eq('id', gameId)
    .maybeSingle()

  if (gameError) {
    const gaps = detectOptionalGameColumnGaps(gameError)
    if (!hasLoadByIdOptionalGameColumnGap(gaps)) {
      throw new Error(`Game load failed: ${gameError.message}`)
    }
    const fallbackSelect =
      baseById + buildOptionalGameSelectSuffix(gaps, { includeLastOpened: false })
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
    const fallbackRow = gameRowFallback as unknown as CloudGameRow
    if (fallbackRow.sport_id) {
      return null
    }
    return hydrateCloudGameFromRow(userId, fallbackRow)
  }

  if (!gameRow) {
    return null
  }

  const selectedRow = gameRow as unknown as CloudGameRow
  if (selectedRow.sport_id) {
    return null
  }
  return hydrateCloudGameFromRow(userId, selectedRow)
}

export interface GameShotChartReview {
  /** One recorder's shots per player (primary → creator → lowest recorder), local player ids. */
  shotChart: ShotRecord[]
  /** Rows skipped because the player id could not be mapped or the zone was invalid. */
  droppedRows: number
}

/**
 * All-recorder shot chart for cloud-game review (F3 §2.2a). Fetches every team-visible
 * `shot_chart` row for the game (RLS scopes to the viewer's teams), de-duplicates to one
 * recorder per player via `pickRecorderPerPlayer`, and maps remote player ids to local
 * ones via `playerIdMap`. **Display-only** — callers must never dispatch the result into
 * `GameState.shotChart` (F3 D6: review shots must not sync).
 */
export async function loadGameShotChartForReview(
  gameId: string,
  playerIdMap: Record<string, string>
): Promise<GameShotChartReview> {
  if (!supabase) {
    throw new Error('Supabase client not configured')
  }

  const { data: shotRows, error: shotErr } = await supabase
    .from('shot_chart')
    .select('player_id, recorded_by, client_shot_id, x, y, made, shot_type, zone, created_at')
    .eq('game_id', gameId)
    .order('created_at', { ascending: true })

  if (shotErr) {
    if (isMissingShotChartTableError(shotErr)) {
      return { shotChart: [], droppedRows: 0 }
    }
    throw new Error(`Shot chart review load failed: ${shotErr.message}`)
  }

  const rows = (shotRows ?? []) as Array<RemoteShotRow & { recorded_by: string }>
  if (rows.length === 0) {
    return { shotChart: [], droppedRows: 0 }
  }

  // Primary recorder per player (best-effort; empty map on error → creator fallback).
  const primaryByPlayerRemoteId: Record<string, string> = {}
  const { data: checkoutRows, error: checkoutErr } = await supabase
    .from('player_checkouts')
    .select('player_id, user_id, is_primary')
    .eq('game_id', gameId)
  if (!checkoutErr) {
    for (const row of (checkoutRows ?? []) as Array<{
      player_id: string
      user_id: string
      is_primary: boolean
    }>) {
      if (row.is_primary) {
        primaryByPlayerRemoteId[row.player_id] = row.user_id
      }
    }
  }

  // Game creator (fallback recorder); best-effort.
  let creatorId: string | null = null
  const { data: gameRow, error: gameErr } = await supabase
    .from('games')
    .select('created_by')
    .eq('id', gameId)
    .maybeSingle()
  if (!gameErr && gameRow) {
    creatorId = (gameRow as { created_by: string | null }).created_by ?? null
  }

  const resolvedRows = pickRecorderPerPlayer(rows, primaryByPlayerRemoteId, creatorId)
  return mapShotRows(resolvedRows, invertPlayerIdMap(playerIdMap))
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
