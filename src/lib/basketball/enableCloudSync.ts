import type { GameState } from '../../types'
import { loadCurrentAppAccess, type AppAccess } from '../appAccess'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { supabase } from '../supabase'
import { canTrackGames, parseTeamRole, type TeamRole } from '../teamPermissions'
import {
  assertHealthyBasketballEventGame,
  syncBasketballEventGameToCloud,
  type SyncBasketballEventGameInput,
  type SyncBasketballEventGameResult,
} from './cloudSync'
import {
  ensureBasketballReleaseCapabilities,
  type BasketballReleaseCapabilityResult,
} from './releaseCapabilities'

export interface EnableBasketballEventCloudInput {
  state: GameState
  userId: string
  localGameId: string
  assertCurrent?: () => void
  validateBinding?: (gameId: string) => void | Promise<void>
}

export interface EnableBasketballEventCloudDependencies {
  loadAppAccess: () => Promise<{ access: AppAccess | null; error: string | null }>
  loadCapabilities: (userId: string) => Promise<BasketballReleaseCapabilityResult>
  loadTeamRole: (teamId: string) => Promise<TeamRole | null>
  sync: (input: SyncBasketballEventGameInput) => Promise<SyncBasketballEventGameResult>
}

export interface EnableBasketballEventCloudResult {
  state: GameState
  cloudGameId: string
}

const defaultDependencies: EnableBasketballEventCloudDependencies = {
  loadAppAccess: loadCurrentAppAccess,
  loadCapabilities: userId => ensureBasketballReleaseCapabilities(userId, { force: true }),
  loadTeamRole: loadFreshTeamRole,
  sync: syncBasketballEventGameToCloud,
}

export function canOfferBasketballEventCloudEnable(
  state: GameState,
  userId: string | null
): boolean {
  if (
    !userId ||
    state.sport?.id !== 'basketball' ||
    state.gameDataAuthority !== 'sport_events' ||
    state.sportGameState?.sportId !== 'basketball' ||
    state.cloudSync.eventCloudPolicy !== 'local_only' ||
    hasCloudBindingMetadata(state) ||
    !state.eventStream ||
    state.eventStream.events.length === 0
  ) return false

  try {
    assertHealthyBasketballEventGame(state)
  } catch {
    return false
  }

  return state.eventStream.events.every(
    event => isGameEventEnvelope(event) &&
      event.sportId === 'basketball' &&
      event.recorderUserId === userId
  )
}

export async function enableBasketballEventCloud(
  input: EnableBasketballEventCloudInput,
  dependencies: EnableBasketballEventCloudDependencies = defaultDependencies
): Promise<EnableBasketballEventCloudResult> {
  const { state, userId, localGameId } = input
  if (!userId.trim()) throw new Error('Sign in again before enabling Basketball cloud sync.')
  if (!localGameId.trim()) throw new Error('This local Basketball game is unavailable.')
  if (state.cloudSync.eventCloudPolicy !== 'local_only') {
    throw new Error('Only an explicit local-only Basketball Event game can enable cloud sync.')
  }
  if (hasCloudBindingMetadata(state)) {
    throw new Error('This local-only game contains unexpected cloud binding metadata.')
  }

  const sportState = assertHealthyBasketballEventGame(state)
  if (!state.eventStream?.events.length || state.eventStream.events.some(event =>
    !isGameEventEnvelope(event) ||
    event.sportId !== 'basketball' ||
    event.recorderUserId !== userId
  )) {
    throw new Error('Only the owner of this Basketball recorder stream can enable cloud sync.')
  }

  const appAccess = await dependencies.loadAppAccess()
  if (!appAccess.access || appAccess.access.status !== 'active') {
    throw new Error(appAccess.error ?? 'Your account is not active for Basketball cloud sync.')
  }

  if (sportState.setup.sourceTeamId) {
    const role = await dependencies.loadTeamRole(sportState.setup.sourceTeamId)
    if (!canTrackGames(role)) {
      throw new Error('Your current team role cannot enable cloud sync for this game.')
    }
  }

  const capabilities = await dependencies.loadCapabilities(userId)
  if (capabilities.status !== 'ready') throw new Error(capabilities.error)
  input.assertCurrent?.()

  const automaticCandidate: GameState = {
    ...state,
    cloudSync: {
      ...state.cloudSync,
      eventCloudPolicy: 'automatic',
      status: 'idle',
      lastError: null,
    },
  }
  const synced = await dependencies.sync({
    state: automaticCandidate,
    userId,
    localGameId,
    validateBinding: input.validateBinding,
  })

  const nextWithoutFingerprint: GameState = {
    ...synced.syncedState,
    cloudSync: {
      ...synced.syncedState.cloudSync,
      eventCloudPolicy: 'automatic',
      seasonId: synced.seasonId,
      teamId: synced.teamId,
      gameId: synced.gameId,
      gameStatus: synced.gameStatus,
      playerIdMap: synced.playerIdMap,
      status: 'synced',
      lastSyncedAt: synced.syncedAt,
      lastError: null,
      lastSyncedGameFingerprint: null,
    },
  }
  const nextState: GameState = {
    ...nextWithoutFingerprint,
    cloudSync: {
      ...nextWithoutFingerprint.cloudSync,
      lastSyncedGameFingerprint: buildGameSyncFingerprint(nextWithoutFingerprint),
    },
  }
  return { state: nextState, cloudGameId: synced.gameId }
}

function hasCloudBindingMetadata(state: GameState): boolean {
  return Boolean(
    state.cloudSync.gameId ||
    state.cloudSync.teamId ||
    state.cloudSync.seasonId ||
    Object.keys(state.cloudSync.playerIdMap).length > 0 ||
    Object.keys(state.cloudSync.eventSyncBase ?? {}).length > 0 ||
    (state.cloudSync.eventConflicts?.length ?? 0) > 0 ||
    (state.cloudSync.pendingEventConflictResolutions?.length ?? 0) > 0
  )
}

async function loadFreshTeamRole(teamId: string): Promise<TeamRole | null> {
  if (!supabase) throw new Error('Supabase client not configured')
  const { data, error } = await supabase.rpc('current_team_role', { p_team_id: teamId })
  if (error) throw new Error(`Basketball team access could not be checked: ${error.message}`)
  return parseTeamRole(data)
}
