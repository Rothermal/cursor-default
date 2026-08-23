import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), `src/pages/${name}.tsx`), 'utf8')

describe('soccer aggregate destination route contracts', () => {
  it('routes Leaderboard soccer seasons to canonical sources before legacy stats', () => {
    const source = page('Leaderboard')
    const guard = 'if (isCanonicalAggregateDestination)'
    expect(source).toContain("scope={{ type: 'season', id: selectedSeasonId }}")
    expect(source).toContain('isSoccerDestination || isBasketballDestination')
    expect(source).toContain(guard)
    expect(source.indexOf(guard)).toBeLessThan(
      source.indexOf("rpc('get_season_stats_resolved'")
    )
  })

  it('routes Team Stats to canonical sources before legacy game-log RPCs', () => {
    const source = page('TeamStats')
    const guard = "teamData.seasons.sport === 'soccer'"
    expect(source).toContain("scope={{ type: 'team', id: teamId }}")
    expect(source).toContain(guard)
    expect(source.indexOf(guard)).toBeLessThan(
      source.indexOf("rpc('get_team_game_log'")
    )
  })

  it('routes Tournament Stats to canonical sources before legacy stat RPCs', () => {
    const source = page('TournamentStats')
    const guard = "teamData.seasons.sport === 'soccer'"
    expect(source).toContain("scope={{ type: 'tournament', id: tournamentId }}")
    expect(source).toContain(guard)
    expect(source.indexOf(guard)).toBeLessThan(
      source.indexOf("rpc('get_tournament_stats_resolved'")
    )
  })

  it('routes Player Profile soccer scopes before legacy season RPCs', () => {
    const source = page('PlayerProfile')
    const guard =
      "if (teamData.seasons.sport === 'soccer' || teamData.seasons.sport === 'basketball')"
    expect(source).toContain("type: 'player'")
    expect(source).toContain('seasonId: seasonIdFromUrl ?? team.season_id')
    expect(source).toContain(guard)
    expect(source.indexOf(guard)).toBeLessThan(
      source.indexOf("rpc('get_season_stats_resolved'")
    )
  })

  it('routes Career Stats soccer scopes before the legacy career RPC', () => {
    const source = page('CareerStats')
    const guard = 'if (isAggregateDestination)'
    expect(source).toContain("scope={{ type: 'career', playerId }}")
    expect(source).toContain("from('team_players')")
    expect(source).toContain('availableSports')
    expect(source).toContain(guard)
    expect(source.indexOf(guard)).toBeLessThan(
      source.indexOf("rpc('get_career_stats_resolved'")
    )
  })
})
