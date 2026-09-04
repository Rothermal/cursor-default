import type { SoccerProjectedParticipant, SoccerRole } from './types'

type SoccerActorParticipant = Pick<
  SoccerProjectedParticipant,
  'participantId' | 'displayName' | 'number' | 'role'
>

const ROLE_RANK: Record<SoccerRole['group'], number> = {
  forward: 0,
  midfielder: 1,
  defender: 2,
  goalkeeper: 3,
  custom: 4,
}

const NATURAL_LABEL_ORDER = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
})

export function sortSoccerActorParticipants<TParticipant extends SoccerActorParticipant>(
  participants: readonly TParticipant[],
  roleFor: (participant: TParticipant) => SoccerRole = participant => participant.role
): TParticipant[] {
  return [...participants].sort((left, right) =>
    ROLE_RANK[roleFor(left).group] - ROLE_RANK[roleFor(right).group] ||
    compareOptionalNumber(left.number, right.number) ||
    NATURAL_LABEL_ORDER.compare(left.displayName, right.displayName) ||
    left.participantId.localeCompare(right.participantId)
  )
}

function compareOptionalNumber(left: string | null, right: string | null): number {
  const leftValue = left?.trim() ?? ''
  const rightValue = right?.trim() ?? ''
  if (leftValue && !rightValue) return -1
  if (!leftValue && rightValue) return 1
  return NATURAL_LABEL_ORDER.compare(leftValue, rightValue)
}
