import { BASEBALL_COUNTER_STAT_IDS, formatInningsPitched } from './stats'
import type { BaseballAggregatePlayer, BaseballAggregateStats, BaseballDecisionCoverage, BaseballPitchCoverage } from './aggregateTypes'

export const BASEBALL_APPEARANCE_STAT_IDS = [
  'bsb_gp', 'bsb_gs', 'bsb_b_gp', 'bsb_f_gp', 'bsb_p_gp', 'bsb_p_gs', 'bsb_running_gp',
] as const
export const BASEBALL_DECISION_STAT_IDS = ['bsb_p_w', 'bsb_p_l', 'bsb_p_sv', 'bsb_p_hld'] as const
export const BASEBALL_AGGREGATE_STAT_IDS: readonly string[] = Object.freeze([
  ...BASEBALL_COUNTER_STAT_IDS, ...BASEBALL_APPEARANCE_STAT_IDS, ...BASEBALL_DECISION_STAT_IDS,
])
export const BASEBALL_AGGREGATE_CATEGORIES = [
  { id: 'batting', label: 'Batting / Baserunning', defaultMetricId: 'bsb_h' },
  { id: 'pitching', label: 'Pitching', defaultMetricId: 'bsb_p_k' },
  { id: 'fielding', label: 'Fielding', defaultMetricId: 'bsb_f_po' },
] as const

export function emptyBaseballAggregateStats(): BaseballAggregateStats {
  return Object.fromEntries(BASEBALL_AGGREGATE_STAT_IDS.map(id => [id, 0]))
}
export function emptyBaseballPitchCoverage(): BaseballPitchCoverage {
  return { includedGames: 0, excludedGames: 0, recordedPitches: 0, recordedStrikes: 0,
    firstPitchObservations: 0, firstPitchStrikes: 0, unlocatedPitches: 0 }
}
export function emptyBaseballDecisionCoverage(): BaseballDecisionCoverage {
  return { valid: 0, reviewedEmpty: 0, absent: 0, reviewNeeded: 0 }
}
export function emptyBaseballAggregatePlayer(playerId: string, displayName: string, number: string | null): BaseballAggregatePlayer {
  return { playerId, displayName, number, stats: emptyBaseballAggregateStats(), pitchingBases: {},
    pitchCoverage: emptyBaseballPitchCoverage(), pitchCountLowerBoundGames: 0,
    pitchesSeenLowerBoundGames: 0, decisions: emptyBaseballDecisionCoverage() }
}
export function addBaseballAggregatePlayer(target: BaseballAggregatePlayer, source: BaseballAggregatePlayer): void {
  for (const id of BASEBALL_AGGREGATE_STAT_IDS) target.stats[id] += source.stats[id] ?? 0
  for (const [basis, line] of Object.entries(source.pitchingBases)) {
    const bucket = target.pitchingBases[Number(basis)] ??= { outs: 0, er: 0, k: 0 }
    for (const key of ['outs', 'er', 'k'] as const) bucket[key] += line[key]
  }
  for (const key of Object.keys(target.pitchCoverage) as Array<keyof BaseballPitchCoverage>) target.pitchCoverage[key] += source.pitchCoverage[key]
  for (const key of Object.keys(target.decisions) as Array<keyof BaseballDecisionCoverage>) target.decisions[key] += source.decisions[key]
  target.pitchCountLowerBoundGames += source.pitchCountLowerBoundGames
  target.pitchesSeenLowerBoundGames += source.pitchesSeenLowerBoundGames
}
const ratio = (numerator: number, denominator: number): number | null => denominator > 0 ? numerator / denominator : null

/** Rates are always read from pooled inputs. ERA/K basis is explicit, never inferred. */
export function baseballAggregateRates(player: BaseballAggregatePlayer) {
  const s = player.stats
  const avg = ratio(s.bsb_h, s.bsb_ab)
  const obp = ratio(s.bsb_h + s.bsb_bb + s.bsb_hbp, s.bsb_ab + s.bsb_bb + s.bsb_hbp + s.bsb_sf)
  const slg = ratio(s.bsb_tb, s.bsb_ab)
  const chances = s.bsb_f_po + s.bsb_f_a + s.bsb_f_e
  const coverage = player.pitchCoverage
  return { avg, obp, slg, ops: obp !== null && slg !== null ? obp + slg : null,
    whip: ratio(3 * (s.bsb_p_bb + s.bsb_p_h), s.bsb_p_outs),
    totalChances: chances, fpct: ratio(s.bsb_f_po + s.bsb_f_a, chances),
    inningsPitched: formatInningsPitched(s.bsb_p_outs),
    strikePercentage: ratio(coverage.recordedStrikes, coverage.recordedPitches),
    firstPitchStrikePercentage: ratio(coverage.firstPitchStrikes, coverage.firstPitchObservations),
    pitchingBases: Object.fromEntries(Object.entries(player.pitchingBases).map(([basis, line]) => [basis, {
      era: ratio(3 * Number(basis) * line.er, line.outs),
      strikeoutsPerBasis: ratio(3 * Number(basis) * line.k, line.outs), outs: line.outs,
    }])),
    samples: { ab: s.bsb_ab, obp: s.bsb_ab + s.bsb_bb + s.bsb_hbp + s.bsb_sf,
      outs: s.bsb_p_outs, chances, pitches: coverage.recordedPitches, firstPitches: coverage.firstPitchObservations },
  }
}
