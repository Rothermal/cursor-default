import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BasketballAggregateLoadResult } from '../lib/basketball/aggregateTransport'
import { loadBasketballAggregateDestinationData } from './useBasketballAggregateDestination'

describe('Basketball aggregate destination loading', () => {
  it('continues with aggregate history when the active roster cannot load', async () => {
    const expected = emptyLoadResult()
    const rosterLoader = vi.fn().mockRejectedValue(new Error('Roster unavailable'))
    const aggregateLoader = vi.fn().mockResolvedValue(expected)

    const loaded = await loadBasketballAggregateDestinationData(
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

  it('marks active team roster rows for the requested tournament scope', async () => {
    const expected = emptyLoadResult()
    const aggregateLoader = vi.fn().mockResolvedValue(expected)

    await loadBasketballAggregateDestinationData(
      { type: 'tournament', id: 'tournament-1' },
      'team-1',
      new AbortController().signal,
      undefined,
      {
        rosterLoader: vi.fn().mockResolvedValue([{
          playerId: 'player-1',
          displayName: 'Player One',
          number: '1',
          teamId: 'team-1',
          seasonId: 'season-1',
        }]),
        aggregateLoader,
      }
    )

    expect(aggregateLoader).toHaveBeenCalledWith(
      { type: 'tournament', id: 'tournament-1' },
      expect.objectContaining({
        activeRoster: [expect.objectContaining({ tournamentId: 'tournament-1' })],
      })
    )
  })

  it('keeps the focus-refresh debounce stable across equivalent scope renders', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/hooks/useBasketballAggregateDestination.ts'),
      'utf8'
    )
    expect(source).toContain('const lastAutoRefreshAtRef = useRef(0)')
    expect(source).toContain('lastRefreshAt: lastAutoRefreshAtRef.current')
    expect(source).toContain('}, [enabled, refresh, scopeKey])')
  })
})

function emptyLoadResult(): BasketballAggregateLoadResult {
  return {
    aggregate: {
      scope: { type: 'team', id: 'team-1' },
      quality: 'complete',
      provenance: null,
      minutesBasis: 'recorded',
      includedGameCount: 0,
      newestGameDate: null,
      oldestGameDate: null,
      availableMetricIds: [],
      players: [],
      teams: [],
      games: [],
      exclusions: [],
      metrics: {
        sourceCount: 0,
        includedGameCount: 0,
        canonicalGameCount: 0,
        legacyGameCount: 0,
        eventCount: 0,
        unresolvedParticipantCount: 0,
        excludedContributionCount: 0,
        malformedSourceCount: 0,
      },
    },
    metrics: {
      canonicalPageCount: 0,
      legacyPageCount: 0,
      canonicalSourceCount: 0,
      legacySourceCount: 0,
      eventCount: 0,
      payloadBytes: 0,
      networkTimeMs: 0,
      projectionTimeMs: 0,
      totalTimeMs: 0,
      maxProjectionBatchMs: 0,
      unresolvedParticipantCount: 0,
      excludedContributionCount: 0,
      malformedSourceCount: 0,
    },
  }
}
