import type { CloudSyncState, GameState } from '../../types'
import { SPORT_EVENTS_AUTHORITY } from '../gameEvents/authority'

export type BasketballEventCloudPolicy = 'automatic' | 'local_only'

function isBasketballEventPolicyState(state: GameState): boolean {
  return state.sport?.id === 'basketball' &&
    state.gameDataAuthority === SPORT_EVENTS_AUTHORITY
}

export function normalizeBasketballEventCloudPolicy(
  value: unknown,
  fieldPresent: boolean
): BasketballEventCloudPolicy | undefined {
  if (!fieldPresent) return undefined
  if (value === 'automatic' || value === 'local_only') return value
  return 'local_only'
}

/** Missing preserves the automatic behavior of Basketball Event games created before BKE-5C. */
export function basketballEventCloudPolicyForState(
  state: GameState
): BasketballEventCloudPolicy | null {
  if (!isBasketballEventPolicyState(state)) return null
  const cloudSync = state.cloudSync as CloudSyncState & Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(cloudSync, 'eventCloudPolicy')) {
    return 'automatic'
  }
  return normalizeBasketballEventCloudPolicy(cloudSync.eventCloudPolicy, true) ?? 'local_only'
}

export function isBasketballEventLocalOnly(state: GameState): boolean {
  return basketballEventCloudPolicyForState(state) === 'local_only'
}

/**
 * Normalize persisted policy without writing the compatibility default into old games.
 * Local-only games cannot retain binding metadata that could be adopted by a cloud path.
 */
export function normalizeBasketballEventCloudPolicyState(state: GameState): GameState {
  const cloudSync = state.cloudSync as CloudSyncState & Record<string, unknown>
  const fieldPresent = Object.prototype.hasOwnProperty.call(cloudSync, 'eventCloudPolicy')

  if (!isBasketballEventPolicyState(state)) {
    if (!fieldPresent) return state
    const withoutPolicy: Partial<CloudSyncState> = { ...state.cloudSync }
    delete withoutPolicy.eventCloudPolicy
    return { ...state, cloudSync: withoutPolicy as CloudSyncState }
  }

  const normalized = normalizeBasketballEventCloudPolicy(
    cloudSync.eventCloudPolicy,
    fieldPresent
  )
  if (normalized === undefined) return state
  if (normalized === 'automatic' && cloudSync.eventCloudPolicy === normalized) return state

  if (normalized === 'local_only') {
    return {
      ...state,
      cloudSync: {
        ...state.cloudSync,
        eventCloudPolicy: normalized,
        seasonId: null,
        teamId: null,
        gameId: null,
        gameStatus: null,
        playerIdMap: {},
        status: state.cloudSync.status === 'offline' ? 'offline' : 'idle',
        lastSyncedAt: null,
        lastError: null,
        lastSyncedGameFingerprint: null,
        shotChartHydrationDroppedRows: 0,
        repairedPlayerLinks: undefined,
        eventSyncBase: {},
        eventConflicts: [],
        pendingEventConflictResolutions: [],
      },
    }
  }

  return {
    ...state,
    cloudSync: { ...state.cloudSync, eventCloudPolicy: normalized },
  }
}
