import type { SoccerMatchProjection, SoccerMatchRules } from './types'

export type SoccerSummaryTab = 'overview' | 'players' | 'timeline' | 'field'
export type SoccerSummaryFrom = 'tracker' | 'games' | 'game-info' | 'team'

export interface SoccerSummaryQuery {
  gameId: string | null
  tab: SoccerSummaryTab
  requestedTab: string | null
  from: SoccerSummaryFrom | null
  teamId: string | null
}

export interface SoccerSummaryPathOptions {
  gameId?: string | null
  tab?: SoccerSummaryTab
  from?: SoccerSummaryFrom | null
  teamId?: string | null
}

export interface SoccerSummaryResult {
  trackedScore: number
  opponentScore: number
  resultLabel: string
  matchStateLabel: string
  decisionLabel: 'AET' | 'Pens' | null
  shootoutScore: { tracked: number; opponent: number } | null
}

export interface SoccerComparisonRow {
  id: string
  label: string
  tracked: number
  opponent: number
}

export interface SoccerComparisonSection {
  id: 'attack' | 'defense' | 'discipline'
  label: string
  rows: SoccerComparisonRow[]
}

export type SoccerLeaderCategory =
  | 'goals'
  | 'assists'
  | 'shots_on_target'
  | 'saves'
  | 'defensive_actions'

export interface SoccerLeaderEntry {
  participantId: string
  playerId: string | null
  displayName: string
  number: string | null
  value: number
}

export interface SoccerMatchLeader {
  id: SoccerLeaderCategory
  label: string
  leaders: SoccerLeaderEntry[]
}

const VALID_FROM = new Set<SoccerSummaryFrom>([
  'tracker',
  'games',
  'game-info',
  'team',
])
const VALID_TABS = new Set<SoccerSummaryTab>([
  'overview',
  'players',
  'timeline',
  'field',
])

export function parseSoccerSummaryQuery(
  params: URLSearchParams
): SoccerSummaryQuery {
  const requestedTab = cleanParam(params.get('tab'))
  const from = cleanParam(params.get('from'))
  return {
    gameId: cleanParam(params.get('gameId')),
    tab: requestedTab && VALID_TABS.has(requestedTab as SoccerSummaryTab)
      ? requestedTab as SoccerSummaryTab
      : 'overview',
    requestedTab,
    from: from && VALID_FROM.has(from as SoccerSummaryFrom)
      ? from as SoccerSummaryFrom
      : null,
    teamId: cleanParam(params.get('teamId')),
  }
}

export function soccerSummaryPath(options: SoccerSummaryPathOptions = {}): string {
  const params = new URLSearchParams()
  if (options.gameId) params.set('gameId', options.gameId)
  params.set('tab', options.tab ?? 'overview')
  if (options.from) params.set('from', options.from)
  if (options.teamId) params.set('teamId', options.teamId)
  return `/summary?${params.toString()}`
}

export function legacySoccerReviewSummaryPath(search: string): string {
  const query = parseSoccerSummaryQuery(new URLSearchParams(search))
  return soccerSummaryPath(query)
}

export function soccerSummaryBackPath(query: SoccerSummaryQuery): string {
  switch (query.from) {
    case 'tracker':
      return '/game'
    case 'games':
      return '/games?sport=soccer'
    case 'game-info': {
      if (!query.gameId) return '/sport/soccer'
      const params = new URLSearchParams({ gameId: query.gameId })
      if (query.teamId) params.set('teamId', query.teamId)
      return `/game-info?${params.toString()}`
    }
    case 'team':
      return query.teamId
        ? `/team?teamId=${encodeURIComponent(query.teamId)}`
        : '/sport/soccer'
    default:
      return '/sport/soccer'
  }
}

export function isSoccerSummaryRoute(
  activeSportId: string | null | undefined,
  params: URLSearchParams
): boolean {
  return activeSportId === 'soccer' || Boolean(cleanParam(params.get('gameId')))
}

export function soccerSummaryResult(
  projection: SoccerMatchProjection
): SoccerSummaryResult {
  const shootoutScore = projection.shootout
    ? { ...projection.shootout.score }
    : null
  const decisionLabel =
    projection.decidedStage === 'extra_time'
      ? 'AET'
      : projection.decidedStage === 'shootout'
        ? 'Pens'
        : null

  let resultLabel: string
  if (projection.endReason === 'abandoned' || projection.result === 'abandoned') {
    resultLabel = 'Abandoned'
  } else if (projection.status === 'suspended' || projection.result === 'suspended') {
    resultLabel = 'Suspended'
  } else if (projection.status !== 'ended') {
    resultLabel = matchStatusLabel(projection.status)
  } else {
    resultLabel = projection.result === 'tracked_win'
      ? 'Win'
      : projection.result === 'opponent_win'
        ? 'Loss'
        : projection.result === 'draw'
          ? 'Draw'
          : 'Result pending'
  }

  return {
    trackedScore: projection.sideTotals.tracked.score,
    opponentScore: projection.sideTotals.opponent.score,
    resultLabel,
    matchStateLabel: matchStatusLabel(projection.status),
    decisionLabel,
    shootoutScore,
  }
}

export function soccerTeamComparison(
  projection: SoccerMatchProjection
): SoccerComparisonSection[] {
  const tracked = projection.sideTotals.tracked
  const opponent = projection.sideTotals.opponent
  const row = (
    id: string,
    label: string,
    trackedValue: number,
    opponentValue: number,
    always = false
  ): SoccerComparisonRow | null =>
    always || trackedValue !== 0 || opponentValue !== 0
      ? { id, label, tracked: trackedValue, opponent: opponentValue }
      : null
  const rows = (...items: Array<SoccerComparisonRow | null>) =>
    items.filter((item): item is SoccerComparisonRow => item !== null)

  return [
    {
      id: 'attack',
      label: 'Attack',
      rows: rows(
        row('shots', 'Shots', tracked.shots, opponent.shots, true),
        row(
          'shots_on_target',
          'Shots on target',
          tracked.shotsOnTarget,
          opponent.shotsOnTarget,
          true
        ),
        row('corners', 'Corners', tracked.corners, opponent.corners, true),
        row('offsides', 'Offsides', tracked.offsides, opponent.offsides),
        row(
          'penalty_attempts',
          'Penalty attempts',
          tracked.penaltyAttempts,
          opponent.penaltyAttempts
        ),
        row(
          'penalty_goals',
          'Penalty goals',
          tracked.penaltyGoals,
          opponent.penaltyGoals
        )
      ),
    },
    {
      id: 'defense',
      label: 'Defense',
      rows: rows(
        row('saves', 'Saves', opponent.saved, tracked.saved, true),
        row('tackles_won', 'Tackles won', tracked.tacklesWon, opponent.tacklesWon),
        row('interceptions', 'Interceptions', tracked.interceptions, opponent.interceptions),
        row('clearances', 'Clearances', tracked.clearances, opponent.clearances),
        row('recoveries', 'Recoveries', tracked.recoveries, opponent.recoveries),
        row('blocked_shots', 'Blocked shots', tracked.blockedShots, opponent.blockedShots)
      ),
    },
    {
      id: 'discipline',
      label: 'Discipline',
      rows: rows(
        row('fouls', 'Fouls', tracked.foulsCommitted, opponent.foulsCommitted, true),
        row('yellow_cards', 'Yellow cards', tracked.yellowCards, opponent.yellowCards, true),
        row('red_cards', 'Red cards', tracked.redCards, opponent.redCards, true),
        row('penalties_won', 'Penalties won', tracked.penaltiesWon, opponent.penaltiesWon),
        row(
          'penalties_conceded',
          'Penalties conceded',
          tracked.penaltiesConceded,
          opponent.penaltiesConceded
        ),
        row(
          'staff_yellow_cards',
          'Staff yellow cards',
          tracked.staffYellowCards,
          opponent.staffYellowCards
        ),
        row(
          'staff_red_cards',
          'Staff red cards',
          tracked.staffRedCards,
          opponent.staffRedCards
        )
      ),
    },
  ]
}

export function soccerMatchLeaders(
  projection: SoccerMatchProjection
): SoccerMatchLeader[] {
  const categories: Array<{
    id: SoccerLeaderCategory
    label: string
    value: (participantId: string) => number
  }> = [
    {
      id: 'goals',
      label: 'Goals',
      value: id => projection.participantStats[id]?.goals ?? 0,
    },
    {
      id: 'assists',
      label: 'Assists',
      value: id => {
        const stats = projection.participantStats[id]
        return (stats?.primaryAssists ?? 0) + (stats?.secondaryAssists ?? 0)
      },
    },
    {
      id: 'shots_on_target',
      label: 'Shots on target',
      value: id => projection.participantStats[id]?.shotsOnTarget ?? 0,
    },
    {
      id: 'saves',
      label: 'Saves',
      value: id => projection.participantStats[id]?.goalkeeperSaves ?? 0,
    },
    {
      id: 'defensive_actions',
      label: 'Defensive actions',
      value: id => {
        const stats = projection.participantStats[id]
        return (
          (stats?.tacklesWon ?? 0) +
          (stats?.interceptions ?? 0) +
          (stats?.clearances ?? 0) +
          (stats?.recoveries ?? 0) +
          (stats?.blockedShots ?? 0)
        )
      },
    },
  ]

  return categories.flatMap(category => {
    const values = Object.values(projection.participants).map(participant => ({
      participant,
      value: category.value(participant.participantId),
    }))
    const maximum = Math.max(0, ...values.map(item => item.value))
    if (maximum === 0) return []
    const leaders = values
      .filter(item => item.value === maximum)
      .map(({ participant, value }) => ({
        participantId: participant.participantId,
        playerId: participant.playerId,
        displayName: participant.displayName,
        number: participant.number,
        value,
      }))
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName) ||
        left.participantId.localeCompare(right.participantId)
      )
    return [{ id: category.id, label: category.label, leaders }]
  })
}

export function formatSoccerMatchFormat(rules: SoccerMatchRules): string {
  const segments = rules.regulationSegments
  const durations = new Set(segments.map(segment => segment.durationMs))
  const regulation = durations.size === 1
    ? `${segments.length} x ${formatMinutes(segments[0].durationMs)} min`
    : segments.map(segment => `${formatMinutes(segment.durationMs)} min`).join(' + ')
  const extraTime = rules.extraTimeAvailable
    ? `, ET ${rules.extraTimeSegments.map(segment => formatMinutes(segment.durationMs)).join(' + ')} min`
    : ''
  return `${regulation}${extraTime}`
}

function matchStatusLabel(status: SoccerMatchProjection['status']): string {
  switch (status) {
    case 'not_started':
      return 'Not started'
    case 'in_progress':
      return 'Live'
    case 'period_break':
      return 'Period break'
    case 'shootout':
      return 'Shootout'
    case 'suspended':
      return 'Suspended'
    case 'ended':
      return 'Ended'
  }
}

function formatMinutes(durationMs: number): string {
  return Number.isInteger(durationMs / 60_000)
    ? String(durationMs / 60_000)
    : (durationMs / 60_000).toFixed(1)
}

function cleanParam(value: string | null): string | null {
  const cleaned = value?.trim()
  return cleaned ? cleaned : null
}
