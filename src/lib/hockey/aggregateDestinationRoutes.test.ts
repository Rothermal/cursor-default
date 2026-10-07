import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const page = (name: string) => read(`src/pages/${name}.tsx`)

/** HKY-6B2: Hockey season stats load before, and instead of, the legacy aggregate RPCs. */
describe('Hockey aggregate destination route contracts', () => {
  it('routes Leaderboard Hockey seasons before legacy season stats', () => {
    const source = page('Leaderboard')
    expect(source).toContain("isSoccerDestination || isBasketballDestination || isHockeyDestination")
    expect(source).toContain('isHockeyDestination && selectedSeasonId')
    expect(source.indexOf('if (isCanonicalAggregateDestination)')).toBeLessThan(source.indexOf("rpc('get_season_stats_resolved'"))
  })

  it.each([
    ['TeamStats', "rpc('get_team_game_log'", "scope={{ type: 'team', id: teamId }}"],
    ['TournamentStats', "rpc('get_tournament_stats_resolved'", "scope={{ type: 'tournament', id: tournamentId }}"],
  ])('routes %s Hockey scopes before legacy RPCs', (name, legacy, scope) => {
    const source = page(name)
    const guard = "teamData.seasons.sport === 'basketball' || teamData.seasons.sport === 'hockey'"
    expect(source).toContain(guard)
    expect(source.indexOf(guard)).toBeLessThan(source.indexOf(legacy))
    expect(source).toContain('HockeyAggregateDestinationPage')
    expect(source).toContain(scope)
  })

  it('routes Hockey Player Profile before legacy season and game-stat readers', () => {
    const source = page('PlayerProfile')
    const guard = "teamData.seasons.sport === 'basketball' || teamData.seasons.sport === 'hockey'"
    expect(source).toContain('<HockeyPlayerAggregateDestination')
    expect(source.indexOf(guard)).toBeLessThan(source.indexOf("rpc('get_season_stats_resolved'"))
    expect(source.indexOf(guard)).toBeLessThan(source.indexOf("from('game_stats')"))
  })

  it('routes Hockey Career before the legacy career and high-game readers', () => {
    const source = page('CareerStats')
    expect(source).toContain("const isHockeyDestination = sportParam === 'hockey'")
    expect(source).toContain('<HockeyPlayerAggregateDestination')
    expect(source.indexOf('if (isAggregateDestination)')).toBeLessThan(source.indexOf("rpc('get_career_stats_resolved'"))
  })

  it('links every game to its Hockey Summary and keeps legacy storage out', () => {
    const components = [
      'src/components/hockey-aggregate/HockeyAggregateDestination.tsx',
      'src/components/hockey-aggregate/HockeyPlayerAggregateDestination.tsx',
      'src/hooks/useHockeyAggregateDestination.ts',
      'src/lib/hockey/aggregateTransport.ts',
    ].map(read).join('\n')
    expect(components).toContain('hockeySummaryPath({ gameId: game.gameId')
    expect(components).toContain('&sport=hockey`}')
    expect(components).not.toContain('gameInfoPath')
    for (const forbidden of ['game_stats', 'shot_chart', 'stat_corrections', 'get_season_stats_resolved']) {
      expect(components).not.toContain(forbidden)
    }
  })
})
