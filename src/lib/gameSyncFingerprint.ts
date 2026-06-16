import type { GameState } from '../types'

/** Fingerprint of game fields that sync to cloud — used to detect unsynced local edits. */
export function buildSyncFingerprint(state: GameState): string {
  return JSON.stringify({
    sportId: state.sport?.id ?? null,
    gameInfo: state.gameInfo,
    opponentScore: state.opponentScore,
    homeTeamScore: state.homeTeamScore,
    homeScoreAdjustment: state.homeScoreAdjustment,
    notes: state.notes,
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

/** True when local state differs from the last successful cloud sync snapshot. */
export function hasDirtyLocalSinceSync(state: GameState): boolean {
  const lastSynced = state.cloudSync.lastSyncedFingerprint
  if (!lastSynced) return false
  return buildSyncFingerprint(state) !== lastSynced
}
