import { describe, expect, it, vi } from 'vitest'
import type { SoccerAggregateLoadResult } from '../lib/soccer/aggregateTransport'
import { loadSoccerAggregateDestinationData } from './useSoccerAggregateDestination'

describe('soccer aggregate destination loading', () => {
  it('continues with canonical aggregates when the active roster cannot load', async () => {
    const expected = emptyLoadResult()
    const rosterLoader = vi.fn().mockRejectedValue(new Error('Roster unavailable'))
    const aggregateLoader = vi.fn().mockResolvedValue(expected)

    const loaded = await loadSoccerAggregateDestinationData(
      { type: 'team', id: 'team-1' },
      'team-1',
      new AbortController().signal,
      undefined,
      { rosterLoader, aggregateLoader }
    )

    expect(loaded.result).toBe(expected)
    expect(loaded.rosterWarning).toContain('Zero-appearance players may be missing')
    expect(aggregateLoader).toHaveBeenCalledWith(
      { type: 'team', id: 'team-1' },
      expect.objectContaining({ activeRoster: [] })
    )
  })
})

function emptyLoadResult(): SoccerAggregateLoadResult {
  return {
    aggregate: {
      scope: { type: 'team', id: 'team-1' },
      quality: 'complete',
      includedMatchCount: 0,
      newestMatchDate: null,
      oldestMatchDate: null,
      players: [],
      teams: [],
      games: [],
      exclusions: [],
      metrics: {
        sourceCount: 0,
        includedMatchCount: 0,
        eventCount: 0,
        unresolvedParticipantCount: 0,
        excludedContributionCount: 0,
        malformedPublicationCount: 0,
      },
    },
    metrics: {
      pageCount: 1,
      publicationCount: 0,
      eventCount: 0,
      payloadBytes: 0,
      networkTimeMs: 0,
      projectionTimeMs: 0,
      totalTimeMs: 0,
      maxProjectionBatchMs: 0,
      unresolvedParticipantCount: 0,
      excludedContributionCount: 0,
      malformedPublicationCount: 0,
    },
  }
}
