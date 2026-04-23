import type { Player, ShotRecord } from '../types'

/** Shot chart rows whose `playerId` is still on the roster (avoids sync FK issues and orphaned shots). */
export function shotChartForRoster(shotChart: ShotRecord[], players: Player[]): ShotRecord[] {
  const ids = new Set(players.map(p => p.id))
  return shotChart.filter(s => ids.has(s.playerId))
}

/**
 * Drops `playerIdMap` entries for locals no longer on the roster.
 * After `SET_PLAYERS` replaces ids (e.g. cloud roster load), stale keys would otherwise
 * pass the wrong `existingRemoteId` into `ensurePlayerId` and corrupt the wrong cloud row.
 */
export function playerIdMapForRoster(
  playerIdMap: Record<string, string>,
  players: Player[]
): Record<string, string> {
  const ids = new Set(players.map(p => p.id))
  return Object.fromEntries(Object.entries(playerIdMap).filter(([localId]) => ids.has(localId)))
}
