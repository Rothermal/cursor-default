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

/** "{view}" part of the context label (§3.3): who the chart is currently showing. */
export function shotViewLabel(selection: ShotChartSelection, players: Player[]): string {
  if (selection.kind === 'all') return 'All shots'
  const target = players.find(p => p.id === selection.playerId)
  if (!target) return 'All shots'
  if (isTeamPseudoPlayer(target)) return `${target.name} (team)`
  return `#${target.number || '?'} ${target.name}`
}

/** Empty-state copy per view (§3.4 / D10). */
export function shotViewEmptyCopy(selection: ShotChartSelection, players: Player[]): string {
  if (selection.kind === 'all') return 'No chart shots recorded.'
  const target = players.find(p => p.id === selection.playerId)
  if (!target) return 'No chart shots recorded.'
  if (isTeamPseudoPlayer(target)) return `No shots recorded for ${target.name} yet.`
  return `No shots for ${target.name}.`
}

/** `made/att (FG%)` line for the context label. */
export function shootingLine(shots: ShotRecord[]): string {
  const att = shots.length
  const made = shots.filter(s => s.made).length
  if (att === 0) return '0/0'
  return `${made}/${att} (${Math.round((made / att) * 100)}%)`
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
