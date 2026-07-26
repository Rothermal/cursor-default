import { describe, expect, it } from 'vitest'
import {
  SOCCER_AGGREGATE_DESTINATION_CATEGORIES,
  soccerAggregateCategoryHasValues,
  soccerAggregateGenericQualityMessage,
  soccerAggregateManagedDiagnostics,
  soccerAggregateVisibleColumns,
  sortSoccerAggregatePlayers,
} from './aggregateDestinations'
import {
  SOCCER_CANONICAL_STAT_IDS,
  emptySoccerAggregateStats,
  soccerAggregateRates,
} from './aggregateStats'
import type {
  SoccerAggregatePlayer,
  SoccerAggregateResult,
} from './aggregateProjection'

describe('soccer aggregate destination model', () => {
  it('exposes every canonical stat without rendering more than five value columns', () => {
    const exposed = new Set(
      SOCCER_AGGREGATE_DESTINATION_CATEGORIES.flatMap(category => category.metricIds)
    )
    expect([...SOCCER_CANONICAL_STAT_IDS].every(id => exposed.has(id))).toBe(true)

    for (const category of SOCCER_AGGREGATE_DESTINATION_CATEGORIES) {
      for (const metricId of category.metricIds) {
        const columns = soccerAggregateVisibleColumns(category, metricId)
        expect(columns).toContain(metricId)
        expect(columns.length).toBeLessThanOrEqual(5)
      }
    }
  })

  it('uses goals-first soccer ordering and the reviewed tie breakers', () => {
    const casey = player('casey', 'Casey', {
      soc_goal: 2,
      soc_ast: 1,
      soc_sot: 5,
      soc_min_sec: 2_000,
    })
    const alex = player('alex', 'Alex', {
      soc_goal: 2,
      soc_ast: 2,
      soc_sot: 3,
      soc_min_sec: 1_900,
    })
    const jordan = player('jordan', 'Jordan', {
      soc_goal: 1,
      soc_ast: 8,
      soc_sot: 10,
      soc_min_sec: 3_000,
    })

    expect(
      sortSoccerAggregatePlayers([casey, jordan, alex], 'soc_goal')
        .map(row => row.playerId)
    ).toEqual(['alex', 'casey', 'jordan'])
  })

  it('keeps zero-appearance roster players visible in Participation', () => {
    const participation = SOCCER_AGGREGATE_DESTINATION_CATEGORIES.find(
      category => category.id === 'participation'
    )!
    expect(soccerAggregateCategoryHasValues(
      [player('reserve', 'Reserve', {})],
      participation
    )).toBe(true)
  })

  it('reveals diagnostic detail only for managed-team exclusions', () => {
    const aggregate = aggregateResult()
    expect(soccerAggregateGenericQualityMessage(aggregate)).toContain('2 canonical')
    expect(soccerAggregateManagedDiagnostics(aggregate)).toMatchObject([
      { publicationId: 'managed', message: 'Manager detail' },
    ])
  })
})

function player(
  playerId: string,
  displayName: string,
  values: Partial<Record<(typeof SOCCER_CANONICAL_STAT_IDS)[number], number>>
): SoccerAggregatePlayer {
  const stats = { ...emptySoccerAggregateStats(), ...values }
  return {
    playerId,
    displayName,
    number: null,
    teamIds: ['team-1'],
    matchIds: values.soc_app ? ['game-1'] : [],
    stats,
    rates: soccerAggregateRates(stats),
  }
}

function aggregateResult(): SoccerAggregateResult {
  return {
    scope: { type: 'season', id: 'season-1' },
    quality: 'partial',
    includedMatchCount: 1,
    newestMatchDate: '2026-07-25',
    oldestMatchDate: '2026-07-25',
    players: [],
    teams: [],
    games: [],
    exclusions: [
      {
        kind: 'malformed_publication',
        publicationId: 'managed',
        gameId: 'game-1',
        gameDate: '2026-07-25',
        message: 'Manager detail',
        canManage: true,
      },
      {
        kind: 'unresolved_participant',
        publicationId: 'generic',
        gameId: 'game-2',
        gameDate: '2026-07-24',
        message: 'Hidden scorer detail',
        canManage: false,
      },
    ],
    metrics: {
      sourceCount: 2,
      includedMatchCount: 1,
      eventCount: 10,
      unresolvedParticipantCount: 1,
      excludedContributionCount: 2,
      malformedPublicationCount: 1,
    },
  }
}
