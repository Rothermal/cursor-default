import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), `src/pages/${name}.tsx`), 'utf8')

describe('Basketball aggregate destination route contracts', () => {
  it('routes Leaderboard Basketball seasons before legacy season stats', () => {
    const source = page('Leaderboard')
    const guard = 'if (isCanonicalAggregateDestination)'
    expect(source).toContain("scope={{ type: 'season', id: selectedSeasonId }}")
    expect(source).toContain('isBasketballDestination && selectedSeasonId')
    expect(source.indexOf(guard)).toBeLessThan(
      source.indexOf("rpc('get_season_stats_resolved'")
    )
  })

  it('routes Team Stats Basketball teams before legacy game-log RPCs', () => {
    const source = page('TeamStats')
    const guard = "teamData.seasons.sport === 'soccer' || teamData.seasons.sport === 'basketball'"
    expect(source).toContain("scope={{ type: 'team', id: teamId }}")
    expect(source).toContain(guard)
    expect(source.indexOf(guard)).toBeLessThan(source.indexOf("rpc('get_team_game_log'"))
  })

  it('routes Tournament Stats Basketball scopes before legacy stat RPCs', () => {
    const source = page('TournamentStats')
    const guard = "teamData.seasons.sport === 'soccer' || teamData.seasons.sport === 'basketball'"
    expect(source).toContain("scope={{ type: 'tournament', id: tournamentId }}")
    expect(source).toContain(guard)
    expect(source.indexOf(guard)).toBeLessThan(
      source.indexOf("rpc('get_tournament_stats_resolved'")
    )
  })

  it('routes canonical rows to event Summary and legacy rows through Game Info', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/components/basketball-aggregate/BasketballAggregateDestination.tsx'
      ),
      'utf8'
    )
    expect(source).toContain('basketballSummaryPath({')
    expect(source).toContain("game.authority === 'canonical'")
    expect(source).toContain('gameId: game.gameId')
    expect(source).toContain("from: 'team'")
    expect(source).toContain(': gameInfoPath(game.gameId, game.teamId ?? teamIdForLinks)')
  })

  it('filters ranking tie-breaks through scope metric availability', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/components/basketball-aggregate/BasketballAggregateDestination.tsx'
      ),
      'utf8'
    )
    expect(source).toContain('basketballAggregateRankingMetrics(aggregate, category)')
    expect(source).not.toContain(
      'sortBasketballAggregatePlayers(aggregate.players, metricId, category.rankingMetricIds)'
    )
  })
})
