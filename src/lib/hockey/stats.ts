import type { GameEvent } from '../gameEvents/types'
import type { HockeyEvent, HockeyMatchParticipant, HockeyMatchSetup } from './types'

export type HockeyStatGroup = 'skater' | 'goalie' | 'plus_minus' | 'play' | 'penalty'

export interface HockeyStatDefinition {
  id: string
  label: string
  group: HockeyStatGroup
}

/** The `hky_*` catalog. Ids are final so HKY-6 aggregates can reuse them. */
export const HOCKEY_STAT_CATALOG: readonly HockeyStatDefinition[] = Object.freeze(([
  { id: 'hky_g', label: 'Goals', group: 'skater' },
  { id: 'hky_a', label: 'Assists', group: 'skater' },
  { id: 'hky_a1', label: 'Primary assists', group: 'skater' },
  { id: 'hky_a2', label: 'Secondary assists', group: 'skater' },
  { id: 'hky_pts', label: 'Points', group: 'skater' },
  { id: 'hky_sog', label: 'Shots on goal', group: 'skater' },
  { id: 'hky_sat', label: 'Shot attempts', group: 'skater' },
  { id: 'hky_miss', label: 'Missed shots', group: 'skater' },
  { id: 'hky_blocked_by', label: 'Shots blocked by opponents', group: 'skater' },
  { id: 'hky_blk', label: 'Blocked shots', group: 'skater' },
  { id: 'hky_ga', label: 'Goals against', group: 'goalie' },
  { id: 'hky_sa', label: 'Shots against', group: 'goalie' },
  { id: 'hky_sv', label: 'Saves', group: 'goalie' },
  { id: 'hky_ppg', label: 'Power-play goals', group: 'skater' },
  { id: 'hky_ppa', label: 'Power-play assists', group: 'skater' },
  { id: 'hky_shg', label: 'Short-handed goals', group: 'skater' },
  { id: 'hky_sha', label: 'Short-handed assists', group: 'skater' },
  { id: 'hky_pm', label: 'Plus/minus', group: 'plus_minus' },
  { id: 'hky_fow', label: 'Faceoffs won', group: 'play' },
  { id: 'hky_fol', label: 'Faceoffs lost', group: 'play' },
  { id: 'hky_hit', label: 'Hits', group: 'play' },
  { id: 'hky_tk', label: 'Takeaways', group: 'play' },
  { id: 'hky_gv', label: 'Giveaways', group: 'play' },
  { id: 'hky_pim', label: 'Penalty minutes', group: 'penalty' },
  { id: 'hky_pen', label: 'Penalties taken', group: 'penalty' },
  { id: 'hky_pend', label: 'Penalties drawn', group: 'penalty' },
] as HockeyStatDefinition[]).map(definition => Object.freeze(definition)))

/** Stats replay fills; every catalog entry since HKY-3B. */
export const HOCKEY_FILLED_STAT_IDS = HOCKEY_STAT_CATALOG.map(definition => definition.id)

export type HockeyParticipantStats = Record<string, Record<string, number>>

export function emptyHockeyParticipantStats(setup: HockeyMatchSetup): HockeyParticipantStats {
  return Object.fromEntries(
    setup.participants.map(participant => [
      participant.id,
      Object.fromEntries(HOCKEY_FILLED_STAT_IDS.map(id => [id, 0])),
    ])
  )
}

/**
 * Credits one accepted shot to tracked participants. Goalie credit follows the goalie
 * stamped at capture, not the one replay now puts in net.
 */
export function accumulateHockeyShotStats(stats: HockeyParticipantStats, event: HockeyEvent<'hockey.shot'>): void {
  const { outcome, emptyNet, strength } = event.payload
  const add = (role: string, statIds: string[]) => {
    const participantId = trackedActor(event, role)
    if (!participantId || !stats[participantId]) return
    for (const id of statIds) stats[participantId][id] += 1
  }
  if (event.teamSide === 'tracked') {
    const shooterStats = ['hky_sat']
    if (outcome === 'goal') shooterStats.push('hky_g', 'hky_pts', 'hky_sog')
    if (outcome === 'saved') shooterStats.push('hky_sog')
    if (outcome === 'missed') shooterStats.push('hky_miss')
    if (outcome === 'blocked') shooterStats.push('hky_blocked_by')
    const special = outcome === 'goal' && (strength === 'pp' || strength === 'sh') ? strength : null
    if (special) shooterStats.push(special === 'pp' ? 'hky_ppg' : 'hky_shg')
    const assistExtra = special ? [special === 'pp' ? 'hky_ppa' : 'hky_sha'] : []
    add('shooter', shooterStats)
    add('assist_primary', ['hky_a', 'hky_a1', 'hky_pts', ...assistExtra])
    add('assist_secondary', ['hky_a', 'hky_a2', 'hky_pts', ...assistExtra])
    return
  }
  add('blocker', ['hky_blk'])
  if (emptyNet) return
  if (outcome === 'goal') add('goalie', ['hky_sa', 'hky_ga'])
  if (outcome === 'saved') add('goalie', ['hky_sa', 'hky_sv'])
}

/**
 * Plus/minus (HKY-3B): every tracked skater in a complete on-ice set gets +1 for a goal for
 * and -1 for a goal against, when the scoring side was even strength or short-handed (empty
 * net included). Power-play goals never count. Returns false for a goal left out because its
 * on-ice set is not complete or its strength was not recorded.
 */
export function accumulateHockeyPlusMinus(stats: HockeyParticipantStats, event: HockeyEvent<'hockey.shot'>): boolean {
  const { outcome, onIce, strength } = event.payload
  if (outcome !== 'goal') return true
  if (!onIce || onIce.status !== 'complete' || strength === null) return false
  if (strength === 'pp') return true
  const delta = event.teamSide === 'tracked' ? 1 : -1
  for (const id of onIce.skaterParticipantIds) {
    if (stats[id]) stats[id].hky_pm += delta
  }
  return true
}

/** Credits a faceoff, hit, takeaway or giveaway to its tracked actor (HKY-2C). */
export function accumulateHockeyPlayStats(stats: HockeyParticipantStats, event: GameEvent): void {
  const credit = (role: string, statId: string) => {
    const participantId = trackedActor(event, role)
    if (participantId && stats[participantId]) stats[participantId][statId] += 1
  }
  switch (event.eventType) {
    case 'hockey.faceoff':
      credit('taker', (event.payload as { winner: string }).winner === 'tracked' ? 'hky_fow' : 'hky_fol')
      return
    case 'hockey.hit':
      if (event.teamSide === 'tracked') credit('hitter', 'hky_hit')
      return
    case 'hockey.takeaway':
      if (event.teamSide === 'tracked') credit('player', 'hky_tk')
      return
    case 'hockey.giveaway':
      if (event.teamSide === 'tracked') credit('player', 'hky_gv')
      return
  }
}

/**
 * Credits a penalty (HKY-3A): PIM and a penalty taken to a tracked offender, or a penalty
 * drawn to the tracked player an opponent penalty was drawn by. PIM is in minutes.
 */
export function accumulateHockeyPenaltyStats(stats: HockeyParticipantStats, event: HockeyEvent<'hockey.penalty'>): void {
  if (event.teamSide === 'tracked') {
    const offender = trackedActor(event, 'offender')
    if (!offender || !stats[offender]) return
    stats[offender].hky_pen += 1
    stats[offender].hky_pim += event.payload.durationMs / 60_000
    return
  }
  const drawnBy = trackedActor(event, 'drawn_by')
  if (drawnBy && stats[drawnBy]) stats[drawnBy].hky_pend += 1
}

/**
 * Maps participant stats to `playerStatsById` for the generic surfaces. Only non-zero
 * values are written, so a game with no captures keeps the empty stats (and fingerprint)
 * it had before HKY-2B. A local participant has no cloud `playerId`, so its row is keyed
 * by the participant id, the same key `createHockeyEventGameState` gives its player row.
 */
/** The local player-row key: the cloud player id, else the participant id. */
export function hockeyLocalPlayerKey(participant: Pick<HockeyMatchParticipant, 'id' | 'playerId'>): string {
  return participant.playerId ?? participant.id
}

export function hockeyPlayerStatsById(
  setup: HockeyMatchSetup,
  stats: HockeyParticipantStats
): Record<string, Record<string, number>> {
  const byPlayer: Record<string, Record<string, number>> = {}
  for (const participant of setup.participants) {
    const values = stats[participant.id]
    if (!values) continue
    const nonZero = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== 0))
    if (Object.keys(nonZero).length > 0) byPlayer[hockeyLocalPlayerKey(participant)] = nonZero
  }
  return byPlayer
}

function trackedActor(event: GameEvent, role: string): string | null {
  const actor = event.actors.find(entry => entry.role === role)
  return actor?.participantId ?? null
}
