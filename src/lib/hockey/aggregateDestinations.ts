import type { HockeyAggregateGame, HockeyAggregateMatchPlayer, HockeyAggregateResult } from './aggregateProjection'
import type { HockeyAggregateTransportErrorCode } from './aggregateTransport'

/** Labels and copy the Hockey season-stat destinations show (HKY-6B2). */

/** Copy for each load failure; the 074-only backend reads as a backend update, nothing else changes. */
export function hockeyAggregateErrorCopy(code: HockeyAggregateTransportErrorCode): [string, string] {
  switch (code) {
    case 'backend_update_required':
      return ['Season stats need a backend update', 'Apply migration 075 to load Hockey season stats. Games, Summaries and cloud sync are unaffected.']
    case 'client_update_required':
      return ['Update the app', 'The server offers a newer Hockey season-stat contract than this app reads. Reload to update.']
    case 'not_configured':
      return ['Supabase not configured', 'Configure Supabase before loading cloud statistics.']
    case 'access_denied':
      return ['Statistics unavailable', 'You do not have access to these Hockey statistics.']
    case 'invalid_payload':
      return ['Statistics unavailable', 'The Hockey history response was not valid.']
    default:
      return ['Statistics could not load', 'Check your connection and try again.']
  }
}

export function hockeyAggregateQualityMessage(aggregate: HockeyAggregateResult): string | null {
  if (aggregate.quality === 'complete') return null
  const parts: string[] = []
  const malformed = aggregate.metrics.malformedSourceCount
  const unresolved = aggregate.metrics.unresolvedParticipantCount
  const duplicates = aggregate.exclusions.filter(exclusion => exclusion.kind === 'duplicate_source').length
  if (malformed > 0) parts.push(`${malformed} ${malformed === 1 ? 'game' : 'games'} could not be read`)
  if (duplicates > 0) parts.push(`${duplicates} ${duplicates === 1 ? 'game has' : 'games have'} conflicting results`)
  if (unresolved > 0) parts.push(`${unresolved} ${unresolved === 1 ? 'player has' : 'players have'} no team roster identity`)
  return parts.length > 0 ? `${parts.join('; ')}. Their contributions are left out.` : 'Some Hockey contributions are left out.'
}

export function hockeyAggregateOutcomeLabel(game: Pick<HockeyAggregateGame, 'outcome' | 'decidedIn'>): string {
  const suffix = game.decidedIn === 'shootout' ? ' (SO)' : game.decidedIn === 'overtime' ? ' (OT)' : ''
  switch (game.outcome) {
    case 'win':
      return `W${suffix}`
    case 'loss':
      return 'L'
    case 'otl':
      return `L${suffix}`
    default:
      return 'T'
  }
}

/** One game's line: G-A-PTS for a skater, saves and goals against for a goalie. */
export function hockeyGameLineText(player: HockeyAggregateMatchPlayer | null): string {
  if (!player) return 'No line recorded'
  const stat = (id: string) => player.stats[id] ?? 0
  if (player.role === 'goalie') {
    return stat('hky_gp') > 0 ? `${stat('hky_sv')} SV - ${stat('hky_ga')} GA` : 'Dressed, did not play'
  }
  const line = [`${stat('hky_g')} G`, `${stat('hky_a')} A`, `${stat('hky_pts')} PTS`, `${stat('hky_sog')} SOG`]
  if (player.plusMinusComplete) {
    const pm = stat('hky_pm')
    line.push(`${pm > 0 ? `+${pm}` : pm} +/-`)
  }
  return line.join(' - ')
}
