import type { Player } from '../types'
import {
  isTeamPseudoPlayer,
  TEAM_PLAYER_HOME_ID,
  TEAM_PLAYER_OPP_ID,
} from './teamPlayers'

export type ReboundStatId = 'oreb' | 'dreb'
type ReboundSide = 'home' | 'opponent'

export interface ReboundPromptOptions {
  offensiveSide: ReboundSide
  defensiveSide: ReboundSide
  offensiveCandidates: Player[]
  defensiveCandidates: Player[]
  defaultOffensivePlayerId: string | null
  defaultDefensivePlayerId: string | null
}

function oppositeSide(side: ReboundSide): ReboundSide {
  return side === 'home' ? 'opponent' : 'home'
}

function sideForRebound(player: Player): ReboundSide {
  if (isTeamPseudoPlayer(player)) return player.teamSide ?? 'home'
  return player.teamSide ?? 'home'
}

function teamPlayerForSide(players: Player[], side: ReboundSide): Player | undefined {
  const expectedId = side === 'home' ? TEAM_PLAYER_HOME_ID : TEAM_PLAYER_OPP_ID
  return players.find(p => p.id === expectedId) ?? players.find(
    p => isTeamPseudoPlayer(p) && sideForRebound(p) === side
  )
}

function candidatesForSide(players: Player[], side: ReboundSide): Player[] {
  const team = teamPlayerForSide(players, side)
  const individuals = players.filter(p => !isTeamPseudoPlayer(p) && sideForRebound(p) === side)
  return team ? [team, ...individuals] : individuals
}

export function reboundPromptOptionsForMiss(
  players: Player[],
  shooterPlayerId: string
): ReboundPromptOptions | null {
  const shooter = players.find(p => p.id === shooterPlayerId)
  if (!shooter) return null

  const offensiveSide = sideForRebound(shooter)
  const defensiveSide = oppositeSide(offensiveSide)
  const offensiveCandidates = candidatesForSide(players, offensiveSide)
  const defensiveCandidates = candidatesForSide(players, defensiveSide)

  return {
    offensiveSide,
    defensiveSide,
    offensiveCandidates,
    defensiveCandidates,
    defaultOffensivePlayerId: offensiveCandidates[0]?.id ?? null,
    defaultDefensivePlayerId: defensiveCandidates[0]?.id ?? null,
  }
}
