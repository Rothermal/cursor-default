import { describe, expect, it } from 'vitest'
import { BASEBALL_DESTINATION_METRICS, baseballCareerSegments, baseballMetricText, baseballMetricValue, baseballPlayerFromGames, rankBaseballPlayers } from './aggregateDestinations'
import { BASEBALL_AGGREGATE_STAT_IDS, emptyBaseballAggregatePlayer } from './aggregateStats'
import type { BaseballAggregateMatch } from './aggregateTypes'
const identity = { playerId: 'p', displayName: 'Player', number: null }
function match(hits: number, teamId: string | null, seasonId: string | null): BaseballAggregateMatch {
  const player = emptyBaseballAggregatePlayer('p', 'Frozen Player', null)
  player.stats.bsb_h = hits; player.stats.bsb_gp = 1
  return { sourceId: `${teamId}:${seasonId}`, game: { cloudScope: teamId ? 'team' : 'personal', teamId, seasonId, trackedTeamName: 'Falcons', date: '2026-10-21' }, players: [player] } as BaseballAggregateMatch
}
describe('BSB-7B destination metrics and scope breakdown', () => {
  it('exposes the event counter catalog without losing integer-outs IP', () => {
    const ids = BASEBALL_DESTINATION_METRICS.map(row => row.id)
    expect(BASEBALL_AGGREGATE_STAT_IDS.filter(id => !ids.includes(id))).toEqual(['bsb_p_outs'])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('ip')
  })
  it('keeps GP-0 and pitcher-only batting rates null and behind a valid zero', () => {
    const noAtBats = emptyBaseballAggregatePlayer('none', 'A', null)
    noAtBats.stats.bsb_gp = 1; noAtBats.stats.bsb_p_gp = 1
    const zero = emptyBaseballAggregatePlayer('zero', 'Z', null); zero.stats.bsb_ab = 3
    const metric = BASEBALL_DESTINATION_METRICS.find(row => row.id === 'avg')!
    expect(baseballMetricValue(noAtBats, 'avg')).toEqual({ value: null, sample: '0 AB' })
    expect(rankBaseballPlayers([noAtBats, zero], metric).map(row => row.playerId)).toEqual(['zero','none'])
    expect(baseballMetricText(noAtBats, 'avg')).toBe('N/A')
  })
  it.each(Array.from({ length: 15 }, (_, i) => i + 1))('shows frozen %i-inning basis rates and exact outs samples', basis => {
    const player = emptyBaseballAggregatePlayer('p', 'P', null)
    player.pitchingBases[basis] = { outs: 6, er: 2, k: 3 }
    expect(baseballMetricValue(player, `era:${basis}`)).toEqual({ value: basis, sample: '6 outs' })
    expect(baseballMetricValue(player, `k:${basis}`).value).toBe(basis * 1.5)
    expect(BASEBALL_DESTINATION_METRICS.some(row => row.id === `era:${basis}`)).toBe(true)
  })
  it('formats pitch percentages as percentages and preserves complete/excluded coverage', () => {
    const player = emptyBaseballAggregatePlayer('p', 'P', null)
    Object.assign(player.pitchCoverage, { recordedPitches: 10, recordedStrikes: 6, includedGames: 2, excludedGames: 1 })
    expect(baseballMetricText(player, 'strikePercentage')).toBe('60.0%')
    expect(baseballMetricValue(player, 'strikePercentage').sample).toContain('2 complete / 1 excluded')
    player.pitchCountLowerBoundGames = 1; player.stats.bsb_p_pitches = 15
    expect(baseballMetricText(player, 'bsb_p_pitches')).toBe('>=15')
  })
  it('keeps Profile S1, Personal and Career segments separate and sums integer outs first', () => {
    const games = [match(2,'team','s1'), match(3,'team','s2'), match(5,null,null)]
    expect(baseballPlayerFromGames(games.filter(row => row.game.seasonId === 's1'), identity).stats.bsb_h).toBe(2)
    expect(baseballPlayerFromGames(games.filter(row => row.game.cloudScope === 'personal'), identity).stats.bsb_h).toBe(5)
    expect(baseballPlayerFromGames(games, identity).stats.bsb_h).toBe(10)
    const segments = baseballCareerSegments(games, { s1: 'Spring', s2: 'Fall' })
    expect(segments.map(row => row.label)).toEqual(['Falcons / Spring','Falcons / Fall','Personal'])
    games[0].players[0].stats.bsb_p_outs = 2; games[1].players[0].stats.bsb_p_outs = 2
    expect(baseballMetricText(baseballPlayerFromGames(games, identity), 'ip')).toBe('1.1')
    expect(baseballCareerSegments(games)[0].label).toContain('Season unavailable (2026-10-21')
  })
})
