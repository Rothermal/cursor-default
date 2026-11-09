import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createOpponentTeam,
  normalizeOpponentLabel,
  opponentSaveCandidate,
  updateOpponentTeam,
  type OpponentTeam,
} from './opponentTeams'

/**
 * RTN-1/RTN-3: best-effort label saves after a sport's setup commits. Saves the
 * opponent for future games (new name, or a changed nickname on a saved one)
 * and the team's nickname when asked. Never throws and never blocks the game.
 * Resolves with the team nickname that was saved, or undefined when none was.
 */
export function persistSetupLabels(input: {
  client: SupabaseClient
  sportId: string
  savedOpponents: OpponentTeam[]
  opponentName: string
  opponentNickname: string
  saveOpponent: boolean
  teamNickname?: { teamId: string; value: string } | null
}): Promise<string | null | undefined> {
  const { client } = input
  const candidate = opponentSaveCandidate(input.savedOpponents, input.opponentName, input.opponentNickname)
  if (input.saveOpponent && candidate) {
    const nickname = normalizeOpponentLabel(input.opponentNickname)
    const write = candidate.kind === 'new'
      ? createOpponentTeam(client, input.sportId, input.opponentName, nickname)
      : updateOpponentTeam(client, candidate.opponent.id, candidate.opponent.name, nickname)
    void write.catch((error: unknown) => {
      console.warn('[StatKeeper] Saved opponent could not be stored', error instanceof Error ? error.message : error)
    })
  }
  const team = input.teamNickname
  if (!team) return Promise.resolve(undefined)
  const value = normalizeOpponentLabel(team.value)
  return Promise.resolve(client.from('teams').update({ nickname: value }).eq('id', team.teamId))
    .then(({ error }) => {
      if (error) {
        console.warn('[StatKeeper] Team nickname could not be saved', error.message)
        return undefined
      }
      return value
    })
}
