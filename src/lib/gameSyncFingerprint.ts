import type { GameState } from '../types'
import { canonicalGameEventStreamForFingerprint } from './gameEvents/stream'
import { sportGameStateForFingerprint } from './soccer/state'

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
    eventStream: canonicalGameEventStreamForFingerprint(state.eventStream),
    sportGameState: sportGameStateForFingerprint(state.sportGameState),
    players: state.players.map(player => ({
      id: player.id,
      name: player.name,
      number: player.number,
      stats: player.stats,
    })),
  })
}

/** Sport-owned setup/events use their repository and cannot enter legacy aggregate auto-sync. */
export function isAggregateCloudSyncEligible(state: GameState): boolean {
  return state.eventStream === null && state.sportGameState === null
}

/** Soccer owns its event stream and setup snapshot; it syncs through the event repository. */
export function isSoccerEventCloudSyncEligible(state: GameState): boolean {
  return Boolean(
    state.sport?.id === 'soccer' &&
      state.eventStream !== null &&
      state.sportGameState?.sportId === 'soccer'
  )
}

export function isCloudSyncEligible(state: GameState): boolean {
  return isAggregateCloudSyncEligible(state) || isSoccerEventCloudSyncEligible(state)
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
 * After cloud `status=final` succeeds, skip clearing local parking when newer edits
 * arrived during the update await (e.g. header back → tracker). Those edits cannot
 * upload to a finalized game; wiping would permanently lose them.
 */
export function shouldPreserveLocalAfterFinalizeSuccess(
  state: GameState,
  pendingDurable: boolean
): boolean {
  return shouldBlockDiscardUnsyncedGame(state, pendingDurable)
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

/** Only in-progress / scheduled cloud games may replace the active local session on hydrate. */
export function canHydrateAsActiveGame(status: string): boolean {
  return status === 'in_progress' || status === 'scheduled'
}

/**
 * Auto cloud-resume must not replace a local session already bound to a different cloud game.
 * Manual open paths park first via `openGameSnapshot`; auto-hydrate used to overwrite the
 * active localStorage slot and silently drop the prior binding.
 */
export function shouldSkipAutoHydrateForDifferentCloudGame(
  localState: GameState,
  cloudGameId: string | null | undefined
): boolean {
  const localId = localState.cloudSync.gameId
  return Boolean(
    localState.sport &&
      localState.gameInfo &&
      localId &&
      cloudGameId &&
      localId !== cloudGameId
  )
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
