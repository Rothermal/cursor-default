import type { GameState } from '../types'

/** Stable fingerprint of sync-relevant game fields (excludes cloudSync metadata). */
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
