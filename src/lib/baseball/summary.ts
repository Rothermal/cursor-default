import type { GameState } from '../../types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { findBaseballRulesProfile } from './profiles'
import { BASEBALL_GAME_END_LABELS } from './recentPlays'
import { baseballLineScoreView, type BaseballTeamNames } from './trackerView'
import type {
  BaseballBattingOrderFormat,
  BaseballMatchStatus,
  BaseballSportGameState,
  BaseballTeamSide,
} from './types'

/**
 * Read-only Summary models for a Baseball event game (BSB-5A). Everything is derived from a
 * fresh replay of the stream; nothing here writes events.
 */

export type BaseballSummaryTab = 'overview' | 'box' | 'plays' | 'spray'

export const BASEBALL_SUMMARY_TABS: ReadonlyArray<{ tab: BaseballSummaryTab; label: string }> = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'box', label: 'Box score' },
  { tab: 'plays', label: 'Plays' },
  { tab: 'spray', label: 'Spray' },
]

export const BASEBALL_BATTING_FORMAT_LABELS: Record<BaseballBattingOrderFormat, string> = {
  standard: 'Standard (nine bat)',
  designated_hitter: 'Designated hitter',
  extra_hitter: 'Extra hitters',
  continuous: 'Continuous order',
}

/**
 * Baseball event games open the Baseball Summary. A `gameId` query means a cloud game, which
 * Baseball event games never are yet (BSB-6), so those stay with the other sports' routes.
 */
export function isBaseballSummaryRoute(
  state: Pick<GameState, 'sport' | 'sportGameState' | 'eventStream'>,
  params: URLSearchParams
): boolean {
  if (params.get('gameId')) return false
  return state.sport?.id === 'baseball' && (state.sportGameState?.sportId === 'baseball' || Boolean(state.eventStream))
}

export function parseBaseballSummaryTab(params: URLSearchParams): BaseballSummaryTab {
  const tab = params.get('tab')
  return BASEBALL_SUMMARY_TABS.some(entry => entry.tab === tab) ? (tab as BaseballSummaryTab) : 'overview'
}

export function baseballSummaryPath(tab: BaseballSummaryTab = 'overview'): string {
  return `/summary?tab=${tab}`
}

export interface BaseballSummarySource {
  /** The setup and last stored projection, for names and context even when unhealthy. */
  sport: BaseballSportGameState | null
  /** True when every event inspected and replayed; only then are totals shown. */
  healthy: boolean
  /** The first problem when not healthy. */
  diagnostic: string | null
}

/**
 * Inspects and replays the stream with the tracker's checks instead of trusting the stored
 * projection. An unhealthy stream keeps the setup for context but no official totals.
 */
export function baseballSummarySource(state: GameState): BaseballSummarySource {
  const stored = state.sportGameState?.sportId === 'baseball' ? (state.sportGameState as BaseballSportGameState) : null
  if (!stored) {
    return { sport: null, healthy: false, diagnostic: 'This game has no Baseball setup.' }
  }
  const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  const sport = rebuilt.state.sportGameState?.sportId === 'baseball'
    ? (rebuilt.state.sportGameState as BaseballSportGameState)
    : stored
  if (!rebuilt.inspection.complete) {
    return {
      sport: stored,
      healthy: false,
      diagnostic: rebuilt.inspection.diagnostics[0]?.message ?? 'The game record could not be replayed.',
    }
  }
  return { sport, healthy: true, diagnostic: null }
}

export interface BaseballSummaryLineScoreRow {
  side: BaseballTeamSide
  name: string
  /** Per inning: runs, "X" for a home half not needed, or "" when not played. */
  cells: string[]
  runs: number
  hits: number
  errors: number
  leftOnBase: number
}

export interface BaseballSummaryView {
  /** "Aces 5, Visitors 3", winner first once there is one. */
  scoreLine: string
  /** "Final", "Final in 8", "Final in 5 (run rule)", "In progress · Top 3"... */
  statusLabel: string
  /** "Win", "Loss" or "Tie" for the tracked team once a final result exists. */
  outcomeForTracked: 'Win' | 'Loss' | 'Tie' | null
  note: string | null
  status: BaseballMatchStatus
  innings: number[]
  away: BaseballSummaryLineScoreRow
  home: BaseballSummaryLineScoreRow
  facts: Array<{ label: string; value: string }>
  warningCount: number
  firstWarning: string | null
}

export function baseballSummaryView(
  sport: BaseballSportGameState,
  names: BaseballTeamNames,
  date: string | null = null
): BaseballSummaryView {
  const { projection, setup } = sport
  const rules = setup.rulesSnapshot
  const lineScore = baseballLineScoreView(sport, names)
  const played = projection.lineScore.reduce((most, line) => Math.max(most, line.inning), 0)
  const homeSide = lineScore.home.side

  const row = (entry: typeof lineScore.away): BaseballSummaryLineScoreRow => ({
    side: entry.side,
    name: entry.name,
    cells: entry.innings.map((runs, index) => {
      if (runs !== null) return String(runs)
      // The home team's last half is not played when it already led: shown as "X".
      const inning = index + 1
      return projection.status === 'final' && entry.side === homeSide && inning === played ? 'X' : ''
    }),
    runs: entry.runs,
    hits: entry.hits,
    errors: entry.errors,
    leftOnBase: projection.lineScore
      .filter(line => line.battingSide === entry.side)
      .reduce((sum, line) => sum + line.leftOnBase, 0),
  })

  const result = projection.result
  const winner = result?.winner
  const first: BaseballTeamSide = winner === 'opponent' ? 'opponent' : 'tracked'
  const second: BaseballTeamSide = first === 'tracked' ? 'opponent' : 'tracked'
  const scoreLine = `${names[first]} ${projection.score[first]}, ${names[second]} ${projection.score[second]}`

  const profile = findBaseballRulesProfile(rules.profileId)
  const facts: Array<{ label: string; value: string }> = []
  if (date) facts.push({ label: 'Date', value: date })
  facts.push(
    { label: 'Home', value: names[homeSide] },
    { label: 'Away', value: names[homeSide === 'tracked' ? 'opponent' : 'tracked'] },
    { label: 'Rules', value: profile?.label ?? 'Custom rules' },
    { label: 'Innings', value: played > 0 && played !== rules.scheduledInnings ? `${played} of ${rules.scheduledInnings} scheduled` : `${rules.scheduledInnings} scheduled` },
    { label: 'Batting order', value: BASEBALL_BATTING_FORMAT_LABELS[rules.battingOrderFormat] }
  )

  return {
    scoreLine,
    statusLabel: statusLabel(sport, played),
    outcomeForTracked:
      projection.status !== 'final' || !winner ? null : winner === 'tie' ? 'Tie' : winner === 'tracked' ? 'Win' : 'Loss',
    note: result?.note ?? null,
    status: projection.status,
    innings: lineScore.innings,
    away: row(lineScore.away),
    home: row(lineScore.home),
    facts,
    warningCount: projection.warnings.length,
    firstWarning: projection.warnings[0]?.message ?? null,
  }
}

function statusLabel(sport: BaseballSportGameState, played: number): string {
  const { projection, setup } = sport
  const half = `${projection.half === 'top' ? 'Top' : 'Bottom'} ${projection.inning}`
  switch (projection.status) {
    case 'pregame':
      return 'Not started'
    case 'in_progress':
      return `In progress · ${half}`
    case 'suspended':
      return `Suspended · ${half}`
    case 'abandoned':
      return 'Abandoned'
    case 'final': {
      const outcome = projection.result?.outcome ?? 'completed'
      if (outcome === 'forfeit') return BASEBALL_GAME_END_LABELS.forfeit
      const short = played !== setup.rulesSnapshot.scheduledInnings
      if (outcome === 'run_rule') return `Final in ${played} (run rule)`
      if (outcome === 'time_limit') return `Final in ${played} (time limit)`
      return short ? `Final in ${played}` : 'Final'
    }
  }
}
