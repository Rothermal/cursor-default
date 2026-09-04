import { describe, expect, it } from 'vitest'
import { sortSoccerActorParticipants } from './actorOrder'
import type { SoccerRole } from './types'

function participant(
  participantId: string,
  group: SoccerRole['group'],
  number: string | null,
  displayName = participantId
) {
  return {
    participantId,
    displayName,
    number,
    role: { group, label: group === 'custom' ? 'Utility' : null } satisfies SoccerRole,
  }
}

describe('sortSoccerActorParticipants', () => {
  it('orders Soccer roles for sideline actor selection without mutating the source', () => {
    const source = [
      participant('keeper', 'goalkeeper', '1'),
      participant('defender', 'defender', '4'),
      participant('custom', 'custom', '8'),
      participant('forward', 'forward', '9'),
      participant('midfielder', 'midfielder', '6'),
    ]

    expect(sortSoccerActorParticipants(source).map(item => item.participantId)).toEqual([
      'forward',
      'midfielder',
      'defender',
      'keeper',
      'custom',
    ])
    expect(source.map(item => item.participantId)).toEqual([
      'keeper',
      'defender',
      'custom',
      'forward',
      'midfielder',
    ])
  })

  it('uses natural jersey order, then display name, then stable participant id', () => {
    const source = [
      participant('no-number', 'forward', null, 'Alex'),
      participant('ten', 'forward', '10', 'Casey'),
      participant('two-b', 'forward', '2', 'Blair'),
      participant('two-a-2', 'forward', '2', 'Alex'),
      participant('two-a-1', 'forward', '2', 'Alex'),
    ]

    expect(sortSoccerActorParticipants(source).map(item => item.participantId)).toEqual([
      'two-a-1',
      'two-a-2',
      'two-b',
      'ten',
      'no-number',
    ])
  })

  it('can order historical choices by their role at the event moment', () => {
    const source = [
      participant('current-forward', 'forward', '7'),
      participant('current-defender', 'defender', '5'),
    ]
    const historicalRoles: Record<string, SoccerRole> = {
      'current-forward': { group: 'defender', label: null },
      'current-defender': { group: 'forward', label: null },
    }

    expect(sortSoccerActorParticipants(
      source,
      item => historicalRoles[item.participantId]
    ).map(item => item.participantId)).toEqual([
      'current-defender',
      'current-forward',
    ])
  })
})
