import type { CloudSyncState, GameState } from '../types'
import { SPORT_EVENTS_AUTHORITY } from './gameEvents/authority'

export type EventCloudPolicy = 'automatic' | 'local_only'

/**
 * Event sports with a per-game cloud policy, and the policy a game without one gets.
 * Basketball Event games made before BKE-5C synced automatically; Hockey games made before
 * HKY-5B were local-only, so they stay on the device until the recorder enables sync.
 */
const MISSING_POLICY: Record<string, { label: string; policy: EventCloudPolicy }> = {
  basketball: { label: 'Basketball', policy: 'automatic' },
  hockey: { label: 'Hockey', policy: 'local_only' },
}

export function invalidEventCloudPolicyError(sportLabel: string): string {
  return `${sportLabel} cloud policy is invalid. Cloud sync is blocked until this game is repaired.`
}

function policySport(state: GameState): { label: string; policy: EventCloudPolicy } | null {
  const sportId = state.sport?.id
  if (!sportId || state.gameDataAuthority !== SPORT_EVENTS_AUTHORITY) return null
  return MISSING_POLICY[sportId] ?? null
}

/** `undefined` is a missing policy; anything other than the two values fails closed. */
export function normalizeEventCloudPolicy(value: unknown): EventCloudPolicy | undefined {
  if (value === undefined) return undefined
  if (value === 'automatic' || value === 'local_only') return value
  return 'local_only'
}

export function eventCloudPolicyForState(state: GameState): EventCloudPolicy | null {
  const sport = policySport(state)
  if (!sport) return null
  return normalizeEventCloudPolicy(state.cloudSync.eventCloudPolicy) ?? sport.policy
}

export function isEventGameLocalOnly(state: GameState): boolean {
  return eventCloudPolicyForState(state) === 'local_only'
}

/**
 * Normalize persisted policy without writing the missing-policy default into old games.
 * Local-only games cannot retain binding metadata that could be adopted by a cloud path.
 */
export function normalizeEventCloudPolicyState(state: GameState): GameState {
  const cloudSync = state.cloudSync as CloudSyncState & Record<string, unknown>
  const fieldPresent = Object.prototype.hasOwnProperty.call(cloudSync, 'eventCloudPolicy')
  const sport = policySport(state)

  if (!sport) {
    if (!fieldPresent) return state
    const withoutPolicy: Partial<CloudSyncState> = { ...state.cloudSync }
    delete withoutPolicy.eventCloudPolicy
    return { ...state, cloudSync: withoutPolicy as CloudSyncState }
  }

  const rawPolicy = cloudSync.eventCloudPolicy
  const normalized = normalizeEventCloudPolicy(rawPolicy)
  if (normalized === undefined) return state
  if (normalized === 'automatic') return state

  if (rawPolicy !== 'local_only') {
    return {
      ...state,
      cloudSync: {
        ...state.cloudSync,
        status: 'error',
        lastError: invalidEventCloudPolicyError(sport.label),
      },
    }
  }

  return {
    ...state,
    cloudSync: {
      ...state.cloudSync,
      eventCloudPolicy: 'local_only',
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
