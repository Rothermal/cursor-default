import type { GameState } from '../types'

/**
 * Canonical snapshot of game fields that are uploaded on cloud sync (excludes sync metadata).
 * Used to detect local edits that have not been reflected in the last successful sync fingerprint.
 */
export function buildGameSyncFingerprint(state: GameState): string {
  return JSON.stringify({
    sportId: state.sport?.id ?? null,
    gameInfo: state.gameInfo,
    opponentScore: state.opponentScore,
    homeTeamScore: state.homeTeamScore,
    homeScoreAdjustment: state.homeScoreAdjustment,
    notes: state.notes,
    currentPeriod: state.currentPeriod,
    teamStatsConfig: state.teamStatsConfig,
    shotChart: state.shotChart,
    players: state.players.map(player => ({
      id: player.id,
      name: player.name,
      number: player.number,
      stats: player.stats,
    })),
  })
}

/**
 * Record that the current game payload matches what was last loaded from or pushed to the cloud.
 * Call after building state from a cloud row or after a successful sync upload.
 */
export function withLastSyncedGameFingerprint(state: GameState): GameState {
  return {
    ...state,
    cloudSync: {
      ...state.cloudSync,
      lastSyncedGameFingerprint: buildGameSyncFingerprint(state),
    },
  }
}

/**
 * `currentPeriod` is not stored in the cloud games row; preserve it from local state when
 * hydrating the same active game (e.g. after reload).
 */
export function currentPeriodForCloudHydrate(
  localState: GameState,
  targetGameId: string | null | undefined
): number {
  if (
    targetGameId &&
    localState.cloudSync.gameId === targetGameId &&
    typeof localState.currentPeriod === 'number' &&
    localState.currentPeriod >= 1
  ) {
    return Math.floor(localState.currentPeriod)
  }
  return 1
}

/** Block manual "open game" hydration when local progress would be silently overwritten. */
export function shouldBlockManualCloudHydrate(state: GameState, pendingDurable: boolean): boolean {
  return shouldDeferCloudResumeHydration(state, pendingDurable)
}

/**
 * Block discarding the active game (New Game / SET_SPORT wipe) when that would lose
 * cloud-bound progress that has not been synced.
 *
 * Unlike {@link shouldBlockManualCloudHydrate}, pure local games (no `teamId` /
 * `gameId`) are allowed — callers still confirm. Reusing the hydrate helper here
 * permanently blocks offline-only New Game because hydrate defers on `!gameId`.
 */
export function shouldBlockDiscardUnsyncedGame(
  state: GameState,
  pendingDurable: boolean
): boolean {
  if (!state.sport || !state.gameInfo) return false
  const cs = state.cloudSync

  // Pure local — discard only loses device-local state; confirm is enough.
  if (!cs.gameId && !cs.teamId) {
    return false
  }

  // Cloud team selected but game row not created yet — local is the only copy.
  if (!cs.gameId) {
    return true
  }

  return Boolean(
    pendingDurable ||
      cs.lastSyncedGameFingerprint == null ||
      buildGameSyncFingerprint(state) !== cs.lastSyncedGameFingerprint
  )
}

/**
 * When the cloud game is already `final`, sync is a no-op. Reject treating that as success if
 * local edits were never uploaded — otherwise flush/finalize reports ok while stats are lost.
 */
export function shouldRejectSkippedFinalSync(state: GameState): boolean {
  const cs = state.cloudSync
  if (cs.lastSyncedGameFingerprint == null) {
    return true
  }
  return buildGameSyncFingerprint(state) !== cs.lastSyncedGameFingerprint
}

/**
 * When true, automatic "resume latest cloud game" hydration must not replace `state` — local
 * progress is ahead of the last known synced snapshot, or the durable pending-sync flag is set.
 */
export function shouldDeferCloudResumeHydration(state: GameState, pendingDurable: boolean): boolean {
  const cs = state.cloudSync
  return Boolean(
    state.sport &&
      state.gameInfo &&
      (!cs.gameId ||
        pendingDurable ||
        cs.lastSyncedGameFingerprint == null ||
        buildGameSyncFingerprint(state) !== cs.lastSyncedGameFingerprint)
  )
}
