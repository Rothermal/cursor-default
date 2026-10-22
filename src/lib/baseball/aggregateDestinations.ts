import { addBaseballAggregatePlayer, baseballAggregateRates, emptyBaseballAggregatePlayer } from './aggregateStats'
import type { BaseballAggregateMatch, BaseballAggregatePlayer } from './aggregateTypes'

export type BaseballAggregateCategory = 'batting' | 'running' | 'pitching' | 'fielding'
export interface BaseballMetric { id: string; label: string; short: string; category: BaseballAggregateCategory; lower?: boolean }
const counters = (category: BaseballAggregateCategory, rows: string[][]): BaseballMetric[] => rows.map(([id, short, label]) => ({ id, short, label, category }))
export const BASEBALL_DESTINATION_METRICS: BaseballMetric[] = [
  ...counters('batting', [['bsb_gs','GS','Games started']]),
  ...counters('batting', [['bsb_gp','GP','Games played'],['bsb_b_gp','Bat GP','Batting appearances'],['bsb_pa','PA','Plate appearances'],['bsb_ab','AB','At bats'],['bsb_h','H','Hits'],['bsb_1b','1B','Singles'],['bsb_2b','2B','Doubles'],['bsb_3b','3B','Triples'],['bsb_hr','HR','Home runs'],['bsb_rbi','RBI','Runs batted in'],['bsb_bb','BB','Walks'],['bsb_ibb','IBB','Intentional walks'],['bsb_hbp','HBP','Hit by pitch'],['bsb_k','K','Strikeouts'],['bsb_sf','SF','Sacrifice flies'],['bsb_sh','SH','Sacrifice hits'],['bsb_tb','TB','Total bases'],['bsb_pitches_seen','Pitches','Pitches seen'],['bsb_k_looking','KL','Strikeouts looking'],['bsb_roe','ROE','Reached on error'],['bsb_fc','FC','Fielder choice'],['bsb_gidp','GIDP','Grounded into double play'],['bsb_ci','CI','Catcher interference']]),
  ...counters('running', [['bsb_running_gp','Run GP','Running appearances'],['bsb_r','R','Runs'],['bsb_sb','SB','Stolen bases'],['bsb_cs','CS','Caught stealing'],['bsb_picked_off','PO','Picked off']]),
  ...counters('pitching', [['bsb_p_gp','GP','Pitching appearances'],['bsb_p_gs','GS','Pitching starts'],['ip','IP','Innings pitched'],['bsb_p_bf','BF','Batters faced'],['bsb_p_k','K','Strikeouts'],['bsb_p_h','H','Hits allowed'],['bsb_p_r','R','Runs allowed'],['bsb_p_er','ER','Earned runs'],['bsb_p_bb','BB','Walks allowed'],['bsb_p_ibb','IBB','Intentional walks allowed'],['bsb_p_hbp','HBP','Hit batters'],['bsb_p_hr','HR','Home runs allowed'],['bsb_p_wp','WP','Wild pitches'],['bsb_p_bk','BK','Balks'],['bsb_p_inherited_runners','IR','Inherited runners'],['bsb_p_inherited_runners_scored','IRS','Inherited runners scored'],['bsb_p_pitches','Pitches','Pitch count'],['bsb_p_strikes','Strikes','Strikes'],['bsb_p_balls','Balls','Balls'],['bsb_p_first_pitch_strikes','FPS','First pitch strikes'],['bsb_p_w','W','Wins'],['bsb_p_l','L','Losses'],['bsb_p_sv','SV','Saves'],['bsb_p_hld','HLD','Holds']]),
  ...counters('fielding', [['bsb_f_gp','GP','Fielding appearances'],['bsb_f_po','PO','Putouts'],['bsb_f_a','A','Assists'],['bsb_f_e','E','Errors'],['bsb_f_dp','DP','Double plays'],['bsb_f_pb','PB','Passed balls'],['bsb_f_sb_allowed','SB','Stolen bases allowed'],['bsb_f_cs','CS','Caught stealing'],['tc','TC','Total chances']]),
  ...['avg','obp','slg','ops'].map(id => ({ id, short: id.toUpperCase(), label: id.toUpperCase(), category: 'batting' as const })),
  { id: 'whip', short: 'WHIP', label: 'WHIP', category: 'pitching', lower: true },
  { id: 'strikePercentage', short: 'Strike %', label: 'Strike percentage (complete games)', category: 'pitching' },
  { id: 'firstPitchStrikePercentage', short: 'FPS %', label: 'First pitch strike percentage (known observations)', category: 'pitching' },
  { id: 'fpct', short: 'FPCT', label: 'Fielding percentage', category: 'fielding' },
  ...Array.from({ length: 15 }, (_, i) => i + 1).flatMap(basis => [
    { id: `era:${basis}`, short: `ERA${basis}`, label: `ERA / ${basis} innings`, category: 'pitching' as const, lower: true },
    { id: `k:${basis}`, short: `K/${basis}`, label: `Strikeouts / ${basis} innings`, category: 'pitching' as const },
  ]),
]
export function baseballMetricValue(player: BaseballAggregatePlayer, id: string): { value: number | null; sample: string | null } {
  const rates = baseballAggregateRates(player)
  if (id.startsWith('bsb_')) return { value: player.stats[id] ?? 0, sample: null }
  if (id === 'ip') return { value: player.stats.bsb_p_outs, sample: null }
  if (id === 'tc') return { value: rates.totalChances, sample: null }
  if (id.startsWith('era:') || id.startsWith('k:')) {
    const bucket = rates.pitchingBases[Number(id.split(':')[1])]
    return { value: bucket ? id.startsWith('era:') ? bucket.era : bucket.strikeoutsPerBasis : null, sample: `${bucket?.outs ?? 0} outs` }
  }
  const samples: Record<string, string> = { avg: `${rates.samples.ab} AB`, slg: `${rates.samples.ab} AB`,
    obp: `${rates.samples.obp} OBP opportunities`, ops: `${rates.samples.ab} AB / ${rates.samples.obp} OBP opportunities`,
    whip: `${rates.samples.outs} outs`, fpct: `${rates.samples.chances} chances`,
    strikePercentage: `${rates.samples.pitches} pitches; ${player.pitchCoverage.includedGames} complete / ${player.pitchCoverage.excludedGames} excluded games`,
    firstPitchStrikePercentage: `${rates.samples.firstPitches} known first pitches; ${player.pitchCoverage.includedGames} complete / ${player.pitchCoverage.excludedGames} excluded games` }
  return { value: rates[id as 'avg'] ?? null, sample: samples[id] ?? null }
}
export function baseballMetricText(player: BaseballAggregatePlayer, id: string): string {
  const { value } = baseballMetricValue(player, id)
  if (value === null) return 'N/A'
  if (id === 'ip') return baseballAggregateRates(player).inningsPitched
  if (id === 'strikePercentage' || id === 'firstPitchStrikePercentage') return `${(value * 100).toFixed(1)}%`
  const lowerBound = id === 'bsb_p_pitches' && player.pitchCountLowerBoundGames > 0 || id === 'bsb_pitches_seen' && player.pitchesSeenLowerBoundGames > 0
  return `${lowerBound ? '>=' : ''}${id.startsWith('bsb_') || id === 'tc' ? value : value.toFixed(id === 'whip' || id.includes(':') ? 2 : 3)}`
}
export function rankBaseballPlayers(players: readonly BaseballAggregatePlayer[], metric: BaseballMetric): BaseballAggregatePlayer[] {
  return [...players].sort((a, b) => {
    const av = baseballMetricValue(a, metric.id).value, bv = baseballMetricValue(b, metric.id).value
    if (av === null || bv === null) return av === bv ? a.displayName.localeCompare(b.displayName) || a.playerId.localeCompare(b.playerId) : av === null ? 1 : -1
    return (metric.lower ? av - bv : bv - av) || a.displayName.localeCompare(b.displayName) || a.playerId.localeCompare(b.playerId)
  })
}
export function baseballPlayerFromGames(games: readonly BaseballAggregateMatch[], identity: { playerId: string; displayName: string; number: string | null }): BaseballAggregatePlayer {
  const player = emptyBaseballAggregatePlayer(identity.playerId, identity.displayName, identity.number)
  for (const game of games) for (const line of game.players) if (line.playerId === player.playerId) addBaseballAggregatePlayer(player, line)
  return player
}
export function baseballCareerSegments(games: readonly BaseballAggregateMatch[], seasonNames: Record<string, string> = {}) {
  const groups = new Map<string, BaseballAggregateMatch[]>()
  for (const game of games) {
    const key = game.game.cloudScope === 'personal' ? 'personal' : `${game.game.teamId}:${game.game.seasonId}`
    groups.set(key, [...(groups.get(key) ?? []), game])
  }
  return [...groups].map(([key, matches]) => {
    const dates = matches.map(row => row.game.date).sort()
    const season = matches[0].game.seasonId
    return { key, games: matches, label: key === 'personal' ? 'Personal' : `${matches[0].game.trackedTeamName} / ${season && seasonNames[season] || (season ? `Season unavailable (${dates[0]} to ${dates[dates.length - 1]})` : 'No season')}` }
  })
}
