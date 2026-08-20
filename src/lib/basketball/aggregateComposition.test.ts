import { describe, expect, it } from 'vitest'
import {
  BasketballAggregateAuthorityCollisionError,
  aggregateBasketballMatches,
  aggregateBasketballSources,
  projectBasketballLegacyAggregateSource,
} from './aggregateComposition'
import {
  AGGREGATE_PLAYERS,
  makeCanonicalAggregateSource,
  makeLegacyAggregateSource,
} from './aggregateTestFixtures'
import { projectBasketballCanonicalAggregateSource } from './aggregateProjection'

describe('Basketball mixed-authority aggregate composition', () => {
  it('maps correction-resolved legacy counters without fabricating event-only metrics', () => {
    const projected = projectBasketballLegacyAggregateSource(makeLegacyAggregateSource())
    expect(projected.ok).toBe(true)
    if (!projected.ok) throw new Error(projected.exclusion.message)
    expect(projected.match.players[0].stats).toMatchObject({
      bk_app: 1,
      bk_start: 0,
      bk_pts: 11,
      bk_fgm: 4,
      bk_fga: 7,
      bk_fta: 3,
      bk_reb: 6,
      bk_min_sec: 1_200,
      bk_dq: 0,
      bk_eject: 0,
    })
    expect(projected.match.availableMetricIds).not.toContain('bk_start')
    expect(projected.match.availableMetricIds).not.toContain('bk_dq')
    expect(projected.match.availableMetricIds).not.toContain('bk_eject')
    expect(projected.match.teamStats.tracked.bk_dreb).toBe(5)

    const malformed = makeLegacyAggregateSource()
    malformed.players[0].stats.ast = -1
    expect(projectBasketballLegacyAggregateSource(malformed)).toMatchObject({
      ok: false,
      exclusion: { kind: 'malformed_source' },
    })
  })

  it('combines canonical and legacy history by stable identity and summed denominators', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'team', id: 'team-1' },
      [makeCanonicalAggregateSource()],
      [makeLegacyAggregateSource()],
      [{
        playerId: 'active-zero', displayName: 'Active Zero', number: '40', teamId: 'team-1',
      }]
    )
    expect(aggregate).toMatchObject({
      quality: 'complete',
      provenance: 'mixed',
      includedGameCount: 2,
      metrics: { canonicalGameCount: 1, legacyGameCount: 1 },
    })
    expect(aggregate.availableMetricIds).not.toContain('bk_start')
    expect(aggregate.availableMetricIds).not.toContain('bk_dq')
    expect(aggregate.players.find(player => player.playerId === 'active-zero')?.stats.bk_app)
      .toBe(0)

    const starter = aggregate.players.find(
      player => player.playerId === AGGREGATE_PLAYERS.starter
    )
    expect(starter?.stats).toMatchObject({
      bk_app: 2, bk_pts: 13, bk_fgm: 5, bk_fga: 9, bk_min_sec: 1_920,
    })
    expect(starter?.rates.field_goal_percentage?.value).toBeCloseTo(5 / 9)
    expect(starter?.rates.points_per_game?.value).toBe(6.5)
    expect(aggregate.teams[0]).toMatchObject({
      record: {
        games: 2, wins: 1, draws: 0, losses: 1,
        pointsFor: 16, pointsAgainst: 19, pointDifference: -3,
      },
    })
  })

  it('keeps personal games in player/career only and labels their game authority', () => {
    const personalCanonical = makeCanonicalAggregateSource({
      gameId: 'personal-canonical', cloudScope: 'personal', teamId: null,
    })
    const personalLegacy = makeLegacyAggregateSource({
      gameId: 'personal-legacy', cloudScope: 'personal', teamId: null,
    })
    const teamAggregate = aggregateBasketballSources(
      { type: 'team', id: 'team-1' },
      [personalCanonical],
      [personalLegacy]
    )
    expect(teamAggregate.includedGameCount).toBe(0)

    const career = aggregateBasketballSources(
      { type: 'career', id: AGGREGATE_PLAYERS.starter },
      [personalCanonical],
      [personalLegacy]
    )
    expect(career.includedGameCount).toBe(2)
    expect(career.games.map(game => game.cloudScope)).toEqual(['personal', 'personal'])
    expect(career.games.map(game => game.authority).sort()).toEqual(['canonical', 'legacy'])
    expect(career.teams).toEqual([])
  })

  it('marks unresolved contributions partial while zero-contribution DNP mappings stay harmless', () => {
    const aggregate = aggregateBasketballSources(
      { type: 'team', id: 'team-1' },
      [makeCanonicalAggregateSource({ includeStableMappings: false })],
      []
    )
    expect(aggregate.quality).toBe('partial')
    expect(aggregate.metrics.unresolvedParticipantCount).toBe(3)
    expect(aggregate.exclusions.every(
      exclusion => exclusion.kind === 'unresolved_participant'
    )).toBe(true)
  })

  it('fails closed when one game appears under both authority families', () => {
    const canonical = projectBasketballCanonicalAggregateSource(
      makeCanonicalAggregateSource({ gameId: 'collision-game' })
    )
    const legacy = projectBasketballLegacyAggregateSource(
      makeLegacyAggregateSource({ gameId: 'collision-game' })
    )
    if (!canonical.ok || !legacy.ok) throw new Error('Fixtures did not project.')
    expect(() => aggregateBasketballMatches(
      { type: 'team', id: 'team-1' },
      [canonical.match, legacy.match]
    )).toThrow(BasketballAggregateAuthorityCollisionError)
    try {
      aggregateBasketballMatches(
        { type: 'team', id: 'team-1' },
        [canonical.match, legacy.match]
      )
    } catch (error) {
      expect(error).toMatchObject({ gameIds: ['collision-game'] })
    }
  })

  it('deduplicates identical page rows and excludes conflicting duplicates', () => {
    const projected = projectBasketballLegacyAggregateSource(makeLegacyAggregateSource())
    if (!projected.ok) throw new Error(projected.exclusion.message)
    const deduped = aggregateBasketballMatches(
      { type: 'team', id: 'team-1' },
      [projected.match, structuredClone(projected.match)]
    )
    expect(deduped.includedGameCount).toBe(1)
    const conflicting = structuredClone(projected.match)
    conflicting.sourceFingerprint = 'different'
    const rejected = aggregateBasketballMatches(
      { type: 'team', id: 'team-1' },
      [projected.match, conflicting]
    )
    expect(rejected.includedGameCount).toBe(0)
    expect(rejected).toMatchObject({
      quality: 'partial',
      exclusions: [expect.objectContaining({ kind: 'duplicate_source' })],
    })
  })
})
