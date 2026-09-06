import { sortSoccerActorParticipants } from './actorOrder'
import {
  soccerLineupDefaultStatusForPlayer,
  type SoccerTeamLineupDefaultsV1,
} from './lineupDefaults'
import type { SoccerRole } from './types'

export interface SoccerLineupDefaultsRosterPlayer {
  id: string
  name: string
  number: string | null
  role: SoccerRole
}

export interface SoccerLineupDefaultsEditorState {
  starters: SoccerLineupDefaultsRosterPlayer[]
  bench: SoccerLineupDefaultsRosterPlayer[]
  warnings: string[]
}

export function deriveSoccerLineupDefaultsEditorState(
  defaults: SoccerTeamLineupDefaultsV1,
  roster: readonly SoccerLineupDefaultsRosterPlayer[],
  maxOnFieldPlayers: number
): SoccerLineupDefaultsEditorState {
  const ordered = sortSoccerActorParticipants(roster.map(player => ({
    ...player,
    participantId: player.id,
    displayName: player.name,
  })))
  const starters = ordered.filter(
    player => soccerLineupDefaultStatusForPlayer(defaults, player.id) === 'starter'
  )
  const bench = ordered.filter(
    player => soccerLineupDefaultStatusForPlayer(defaults, player.id) === 'bench'
  )
  const goalkeeperCount = starters.filter(
    player => player.role.group === 'goalkeeper'
  ).length
  const warnings: string[] = []
  if (starters.length === 0) {
    warnings.push('No default starters are selected.')
  }
  if (starters.length > maxOnFieldPlayers) {
    warnings.push(
      `${starters.length} starters are selected for ${maxOnFieldPlayers} on-field places.`
    )
  }
  if (goalkeeperCount !== 1) {
    warnings.push(
      `Default starters need exactly one goalkeeper; currently ${goalkeeperCount}.`
    )
  }
  return { starters, bench, warnings }
}
