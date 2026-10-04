import type { GameState } from '../../types'
import { loadCurrentAppAccess, type AppAccess } from '../appAccess'
import { eventCloudPolicyForState } from '../eventCloudPolicy'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import { supabase } from '../supabase'
import { canTrackGames, parseTeamRole, type TeamRole } from '../teamPermissions'
import {
  assertHealthyHockeyEventGame,
  syncHockeyEventGameToCloud,
  type SyncHockeyEventGameInput,
  type SyncHockeyEventGameResult,
} from './cloudSync'
import { ensureHockeyReleaseCapabilities, type HockeyReleaseCapabilityResult } from './releaseCapabilities'

export interface EnableHockeyEventCloudInput {
  state: GameState
  userId: string
  localGameId: string
  assertCurrent?: () => void
  validateBinding?: (gameId: string) => void | Promise<void>
}

export interface EnableHockeyEventCloudDependencies {
  loadAppAccess: () => Promise<{ access: AppAccess | null; error: string | null }>
  loadCapabilities: (userId: string) => Promise<HockeyReleaseCapabilityResult>
  loadTeamRole: (teamId: string) => Promise<TeamRole | null>
  sync: (input: SyncHockeyEventGameInput) => Promise<SyncHockeyEventGameResult>
}

const defaultDependencies: EnableHockeyEventCloudDependencies = {
  loadAppAccess: loadCurrentAppAccess,
  loadCapabilities: userId => ensureHockeyReleaseCapabilities(userId, { force: true }),
  loadTeamRole: loadFreshTeamRole,
  sync: syncHockeyEventGameToCloud,
}

export type HockeyCloudEnableAvailability =
  | { offer: true }
  | { offer: false; reason: string | null }

/**
 * Enable cloud sync is offered for a local-only Hockey event game (explicit, or made before
 * HKY-5B with no policy) whose every event this account recorded. Games recorded signed out
 * or by another account stay on this device.
 */
export function hockeyCloudEnableAvailability(
  state: GameState,
  userId: string | null
): HockeyCloudEnableAvailability {
  if (
    state.sport?.id !== 'hockey' ||
    state.gameDataAuthority !== 'sport_events' ||
    state.sportGameState?.sportId !== 'hockey' ||
    eventCloudPolicyForState(state) !== 'local_only' ||
    hasCloudBindingMetadata(state) ||
    !state.eventStream ||
    state.eventStream.events.length === 0
  ) return { offer: false, reason: null }
  if (!userId) return { offer: false, reason: 'Sign in to sync this game to the cloud.' }
  try {
    assertHealthyHockeyEventGame(state)
  } catch {
    return { offer: false, reason: 'This game needs its history repaired before it can sync.' }
  }
  const ownEvents = state.eventStream.events.every(
    event => isGameEventEnvelope(event) && event.sportId === 'hockey' && event.recorderUserId === userId
  )
  return ownEvents
    ? { offer: true }
    : { offer: false, reason: 'This game was recorded signed out or by another account, so it stays on this device.' }
}

export async function enableHockeyEventCloud(
  input: EnableHockeyEventCloudInput,
  dependencies: EnableHockeyEventCloudDependencies = defaultDependencies
): Promise<{ state: GameState; cloudGameId: string }> {
  const { state, userId, localGameId } = input
  if (!userId.trim()) throw new Error('Sign in again before enabling Hockey cloud sync.')
  if (!localGameId.trim()) throw new Error('This local Hockey game is unavailable.')
  const availability = hockeyCloudEnableAvailability(state, userId)
  if (!availability.offer) {
    throw new Error(availability.reason ?? 'Only a Hockey game saved on this device can enable cloud sync.')
  }
  const sportState = assertHealthyHockeyEventGame(state)

  const appAccess = await dependencies.loadAppAccess()
  if (!appAccess.access || appAccess.access.status !== 'active') {
    throw new Error(appAccess.error ?? 'Your account is not active for Hockey cloud sync.')
  }
  if (sportState.setup.sourceTeamId) {
    const role = await dependencies.loadTeamRole(sportState.setup.sourceTeamId)
    if (!canTrackGames(role)) throw new Error('Your current team role cannot enable cloud sync for this game.')
  }
  const capabilities = await dependencies.loadCapabilities(userId)
  if (capabilities.status !== 'ready') throw new Error(capabilities.error)
  input.assertCurrent?.()

  const synced = await dependencies.sync({
    state: { ...state, cloudSync: { ...state.cloudSync, eventCloudPolicy: 'automatic', status: 'idle', lastError: null } },
    userId,
    localGameId,
    validateBinding: input.validateBinding,
    assertCurrent: input.assertCurrent,
  })
  const next: GameState = {
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
  return {
    state: { ...next, cloudSync: { ...next.cloudSync, lastSyncedGameFingerprint: buildGameSyncFingerprint(next) } },
    cloudGameId: synced.gameId,
  }
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
  if (error) throw new Error(`Hockey team access could not be checked: ${error.message}`)
  return parseTeamRole(data)
}
