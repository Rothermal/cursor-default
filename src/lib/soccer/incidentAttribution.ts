import type { SoccerTeamSide } from './types'

export type SoccerIncidentAttribution =
  | 'participant'
  | 'team'
  | 'unknown'
  | 'staff'

export function normalizeSoccerIncidentActorSelection<
  TAttribution extends SoccerIncidentAttribution,
>(
  side: SoccerTeamSide,
  attribution: TAttribution,
  participantId: string
): { attribution: TAttribution | 'unknown'; participantId: string } {
  const normalizedAttribution =
    side === 'opponent' && attribution === 'participant'
      ? 'unknown'
      : attribution
  return {
    attribution: normalizedAttribution,
    participantId:
      normalizedAttribution === 'participant' ? participantId : '',
  }
}
