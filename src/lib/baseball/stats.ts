import type {
  BaseballBattingLine,
  BaseballFieldingLine,
  BaseballMatchProjection,
  BaseballMatchSetup,
  BaseballPitchingLine,
} from './types'

/** Aggregate ids use the `bsb_*` namespace (Soccer `soc_*`, Basketball `bk_*`). */
const BATTING_KEYS: Record<keyof BaseballBattingLine, string> = {
  pa: 'bsb_pa',
  ab: 'bsb_ab',
  h: 'bsb_h',
  singles: 'bsb_1b',
  doubles: 'bsb_2b',
  triples: 'bsb_3b',
  hr: 'bsb_hr',
  r: 'bsb_r',
  rbi: 'bsb_rbi',
  bb: 'bsb_bb',
  ibb: 'bsb_ibb',
  hbp: 'bsb_hbp',
  k: 'bsb_k',
  kLooking: 'bsb_k_looking',
  sh: 'bsb_sh',
  sf: 'bsb_sf',
  roe: 'bsb_roe',
  fc: 'bsb_fc',
  gidp: 'bsb_gidp',
  ci: 'bsb_ci',
  tb: 'bsb_tb',
  sb: 'bsb_sb',
  cs: 'bsb_cs',
  pickedOff: 'bsb_picked_off',
  pitchesSeen: 'bsb_pitches_seen',
}

const PITCHING_KEYS: Partial<Record<keyof BaseballPitchingLine, string>> = {
  outs: 'bsb_p_outs',
  bf: 'bsb_p_bf',
  pitches: 'bsb_p_pitches',
  strikes: 'bsb_p_strikes',
  balls: 'bsb_p_balls',
  firstPitchStrikes: 'bsb_p_first_pitch_strikes',
  h: 'bsb_p_h',
  r: 'bsb_p_r',
  er: 'bsb_p_er',
  bb: 'bsb_p_bb',
  ibb: 'bsb_p_ibb',
  k: 'bsb_p_k',
  hbp: 'bsb_p_hbp',
  wp: 'bsb_p_wp',
  bk: 'bsb_p_bk',
  hr: 'bsb_p_hr',
  inheritedRunners: 'bsb_p_inherited_runners',
  inheritedRunnersScored: 'bsb_p_inherited_runners_scored',
}

const FIELDING_KEYS: Record<keyof BaseballFieldingLine, string> = {
  po: 'bsb_f_po',
  a: 'bsb_f_a',
  e: 'bsb_f_e',
  dp: 'bsb_f_dp',
  pb: 'bsb_f_pb',
  sbAllowed: 'bsb_f_sb_allowed',
  cs: 'bsb_f_cs',
}

/** Per-player projected totals keyed by local player id, for legacy/aggregate surfaces. */
export function baseballPlayerStatsById(
  setup: BaseballMatchSetup,
  projection: BaseballMatchProjection
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {}
  for (const participant of setup.participants) {
    if (!participant.playerId) continue
    const stats: Record<string, number> = {}
    addLine(stats, projection.battingLines[participant.id], BATTING_KEYS)
    addLine(stats, projection.pitchingLines[participant.id], PITCHING_KEYS)
    addLine(stats, projection.fieldingLines[participant.id], FIELDING_KEYS)
    if (Object.keys(stats).length > 0) {
      const existing = result[participant.playerId] ?? {}
      for (const [key, value] of Object.entries(stats)) existing[key] = (existing[key] ?? 0) + value
      result[participant.playerId] = existing
    }
  }
  return result
}

function addLine<T extends object>(
  target: Record<string, number>,
  line: T | undefined,
  keys: Partial<Record<keyof T, string>>
): void {
  if (!line) return
  for (const [field, id] of Object.entries(keys) as Array<[keyof T, string]>) {
    const value = line[field]
    if (typeof value === 'number' && value !== 0) target[id] = value
  }
}

/** Innings pitched in scorebook notation, e.g. 20 outs -> "6.2". */
export function formatInningsPitched(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

export function battingAverage(line: BaseballBattingLine): number | null {
  return line.ab > 0 ? line.h / line.ab : null
}

export function onBasePercentage(line: BaseballBattingLine): number | null {
  const denominator = line.ab + line.bb + line.hbp + line.sf
  return denominator > 0 ? (line.h + line.bb + line.hbp) / denominator : null
}

export function sluggingPercentage(line: BaseballBattingLine): number | null {
  return line.ab > 0 ? line.tb / line.ab : null
}

/** ERA scaled to the rules' regulation innings (7 for high school, 9 for MLB). */
export function earnedRunAverage(line: BaseballPitchingLine, scheduledInnings: number): number | null {
  return line.outs > 0 ? (line.er * scheduledInnings * 3) / line.outs : null
}

export function whip(line: BaseballPitchingLine): number | null {
  return line.outs > 0 ? ((line.bb + line.h) * 3) / line.outs : null
}

export function fieldingPercentage(line: BaseballFieldingLine): number | null {
  const chances = line.po + line.a + line.e
  return chances > 0 ? (line.po + line.a) / chances : null
}
