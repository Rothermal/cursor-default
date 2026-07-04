import type { Player, ShotRecord } from '../types'
import { isTeamPseudoPlayer } from './teamPlayers'

/**
 * Shot-chart view filter (F2). `kind: 'player'` with a team pseudo-player id shows that
 * whole side; with an individual id it shows just that player. Display-only — the
 * recording target stays `activePlayerId` (see PLAN_F2 §3.2, D14).
 */
export type ShotChartSelection =
  | { kind: 'all' }
  | { kind: 'player'; playerId: string }

/**
 * Which side a player's shots belong to. StatKeeper has one home roster of individuals
 * plus a single opponent pseudo-player, so individuals are always the home side.
 */
export function sideOf(player: Player): 'home' | 'opponent' {
  if (isTeamPseudoPlayer(player)) return player.teamSide ?? 'home'
  return 'home'
}

/** Shots visible under the given selection. Unknown player ids fall back to all (defensive). */
export function shotsForSelection(
  shots: ShotRecord[],
  players: Player[],
  selection: ShotChartSelection
): ShotRecord[] {
  if (selection.kind === 'all') return shots
  const target = players.find(p => p.id === selection.playerId)
  if (!target) return shots
  if (isTeamPseudoPlayer(target)) {
    const side = sideOf(target)
    const sideIds = new Set(players.filter(p => sideOf(p) === side).map(p => p.id))
    return shots.filter(s => sideIds.has(s.playerId))
  }
  return shots.filter(s => s.playerId === selection.playerId)
}
