import { describe, expect, it } from 'vitest'
import { normalizeSoccerIncidentActorSelection } from './incidentAttribution'

describe('soccer incident actor attribution', () => {
  it('removes a tracked participant from an opponent actor', () => {
    expect(normalizeSoccerIncidentActorSelection(
      'opponent',
      'participant',
      'tracked-participant-1'
    )).toEqual({ attribution: 'unknown', participantId: '' })
  })

  it('preserves tracked participant attribution', () => {
    expect(normalizeSoccerIncidentActorSelection(
      'tracked',
      'participant',
      'tracked-participant-1'
    )).toEqual({
      attribution: 'participant',
      participantId: 'tracked-participant-1',
    })
  })

  it('preserves non-player attribution without retaining a participant id', () => {
    expect(normalizeSoccerIncidentActorSelection(
      'opponent',
      'staff',
      'stale-participant-id'
    )).toEqual({ attribution: 'staff', participantId: '' })
    expect(normalizeSoccerIncidentActorSelection(
      'tracked',
      'team',
      'stale-participant-id'
    )).toEqual({ attribution: 'team', participantId: '' })
  })
})
