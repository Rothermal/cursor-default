import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), `src/pages/${name}.tsx`), 'utf8')

describe('soccer aggregate destination route contracts', () => {
  it('routes Leaderboard soccer seasons to canonical sources before legacy stats', () => {
    const source = page('Leaderboard')
    expect(source).toContain("scope={{ type: 'season', id: selectedSeasonId }}")
    expect(source.indexOf("if (sport?.id === 'soccer')")).toBeLessThan(
      source.indexOf("rpc('get_season_stats_resolved'")
    )
  })

  it('routes Team Stats to canonical sources before legacy game-log RPCs', () => {
    const source = page('TeamStats')
    expect(source).toContain("scope={{ type: 'team', id: teamId }}")
    expect(source.indexOf("teamData.seasons.sport === 'soccer'")).toBeLessThan(
      source.indexOf("rpc('get_team_game_log'")
    )
  })

  it('routes Tournament Stats to canonical sources before legacy stat RPCs', () => {
    const source = page('TournamentStats')
    expect(source).toContain("scope={{ type: 'tournament', id: tournamentId }}")
    expect(source.indexOf("teamData.seasons.sport === 'soccer'")).toBeLessThan(
      source.indexOf("rpc('get_tournament_stats_resolved'")
    )
  })
})
