import type { GameState } from '../../types'
import { inspectSoccerHistory } from './live'
import { currentSoccerTargetLineup } from './targetLineup'
import type { SoccerLineupEntry, SoccerLineupTransitionSource, SoccerMatchProjection } from './types'

export function soccerLineupEntryUnavailable(projection: SoccerMatchProjection, id: string): string | null {
  const participant = projection.participants[id]
  if (!participant) return 'Not in this match'
  if (projection.participantDiscipline[id]?.ejected) return 'Ejected'
  if (participant.status !== 'on_field' && participant.hasExited && !projection.currentRules.allowReturnSubstitutions) return 'Return substitutions disabled'
  return null
}

export function soccerLineupPreset(state: GameState, source: SoccerLineupTransitionSource): {
  onField: SoccerLineupEntry[]
  unavailable: Array<{ participantId: string; name: string; reason: string }>
} | null {
  if (state.sportGameState?.sportId !== 'soccer') return null
  const { setup, projection } = state.sportGameState
  const opening = inspectSoccerHistory(state).activeEvents.find(event => event.eventType === 'soccer.opening_lineup')
  const entries = source === 'manual' ? currentSoccerTargetLineup(projection)
    : source === 'opening_lineup' ? opening?.payload.starters
      : setup.version === 2 ? setup.teamDefaultLineup?.entries : null
  if (!entries) return null
  const unavailable: Array<{ participantId: string; name: string; reason: string }> = []
  const onField = entries.filter(entry => {
    const reason = soccerLineupEntryUnavailable(projection, entry.participantId)
    if (!reason) return true
    unavailable.push({ participantId: entry.participantId,
      name: projection.participants[entry.participantId]?.displayName ?? setup.participants.find(p => p.id === entry.participantId)?.displayName ?? entry.participantId,
      reason })
    return false
  })
  return { onField: structuredClone(onField), unavailable }
}
