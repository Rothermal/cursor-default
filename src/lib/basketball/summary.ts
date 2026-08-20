import type { GameState } from '../../types'
import type { BasketballMatchEvent, BasketballMatchProjection } from './types'

export type BasketballSummaryTab = 'overview' | 'players' | 'timeline' | 'shots' | 'team'
export type BasketballSummaryFrom = 'tracker' | 'games' | 'game-info' | 'team' | 'sport'

export interface BasketballSummaryQuery {
  gameId: string | null
  tab: BasketballSummaryTab
  requestedTab: string | null
  recordingId: string | null
  from: BasketballSummaryFrom | null
  teamId: string | null
}

export interface BasketballSummaryPathOptions {
  gameId?: string | null
  tab?: BasketballSummaryTab
  recordingId?: string | null
  from?: BasketballSummaryFrom | null
  teamId?: string | null
}

export interface BasketballSummaryResult {
  trackedScore: number
  opponentScore: number
  resultLabel: string
  gameStateLabel: string
}

export interface BasketballPeriodScore {
  periodId: string
  label: string
  order: number
  tracked: number
  opponent: number
}

export interface BasketballComparisonRow {
  id: string
  label: string
  tracked: number
  opponent: number
  format?: 'number' | 'made_attempted'
  trackedAttempted?: number
  opponentAttempted?: number
}

export interface BasketballComparisonSection {
  id: 'shooting' | 'rebounding' | 'playmaking' | 'defense' | 'discipline'
  label: string
  rows: BasketballComparisonRow[]
}

export type BasketballLeaderCategory = 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks'

export interface BasketballLeaderEntry {
  participantId: string
  playerId: string | null
  displayName: string
  number: string | null
  value: number
}

export interface BasketballMatchLeader {
  id: BasketballLeaderCategory
  label: string
  leaders: BasketballLeaderEntry[]
}

const SHIPPED_TABS = new Set<BasketballSummaryTab>(['overview'])
const VALID_FROM = new Set<BasketballSummaryFrom>([
  'tracker',
  'games',
  'game-info',
  'team',
  'sport',
])

export function parseBasketballSummaryQuery(
  params: URLSearchParams
): BasketballSummaryQuery {
  const requestedTab = cleanParam(params.get('tab'))
  const from = cleanParam(params.get('from'))
  return {
    gameId: cleanParam(params.get('gameId')),
    tab: requestedTab && SHIPPED_TABS.has(requestedTab as BasketballSummaryTab)
      ? requestedTab as BasketballSummaryTab
      : 'overview',
    requestedTab,
    recordingId: cleanParam(params.get('recording')),
    from: from && VALID_FROM.has(from as BasketballSummaryFrom)
      ? from as BasketballSummaryFrom
      : null,
    teamId: cleanParam(params.get('teamId')),
  }
}

export function basketballSummaryPath(
  options: BasketballSummaryPathOptions = {}
): string {
  const params = new URLSearchParams({ sport: 'basketball' })
  if (options.gameId) params.set('gameId', options.gameId)
  params.set('tab', options.tab ?? 'overview')
  if (options.recordingId) params.set('recording', options.recordingId)
  if (options.from) params.set('from', options.from)
  if (options.teamId) params.set('teamId', options.teamId)
  return `/summary?${params.toString()}`
}

export function basketballSummaryBackPath(query: BasketballSummaryQuery): string {
  switch (query.from) {
    case 'tracker':
      return '/game'
    case 'games':
      return '/games?sport=basketball'
    case 'game-info': {
      if (!query.gameId) return '/sport/basketball'
      const params = new URLSearchParams({ gameId: query.gameId })
      if (query.teamId) params.set('teamId', query.teamId)
      return `/game-info?${params.toString()}`
    }
    case 'team':
      return query.teamId
        ? `/team?teamId=${encodeURIComponent(query.teamId)}`
        : '/sport/basketball'
    default:
      return '/sport/basketball'
  }
}

export function isBasketballSummaryRoute(
  state: Pick<GameState, 'gameDataAuthority' | 'sport' | 'sportGameState'>,
  params: URLSearchParams
): boolean {
  if (params.get('gameId')) return params.get('sport') === 'basketball'
  return (
    state.gameDataAuthority === 'sport_events' &&
    state.sport?.id === 'basketball' &&
    state.sportGameState?.sportId === 'basketball'
  )
}

export function basketballSummaryResult(
  projection: BasketballMatchProjection
): BasketballSummaryResult {
  let resultLabel: string
  if (projection.endReason === 'abandoned' || projection.result === 'abandoned') {
    resultLabel = 'Abandoned'
  } else if (projection.status === 'suspended' || projection.result === 'suspended') {
    resultLabel = 'Suspended'
  } else if (projection.status !== 'ended') {
    resultLabel = basketballStatusLabel(projection.status)
  } else if (projection.result === 'tracked_win') {
    resultLabel = 'Win'
  } else if (projection.result === 'opponent_win') {
    resultLabel = 'Loss'
  } else if (projection.result === 'draw') {
    resultLabel = 'Tie'
  } else {
    resultLabel = 'Result pending'
  }
  return {
    trackedScore: projection.score.tracked,
    opponentScore: projection.score.opponent,
    resultLabel,
    gameStateLabel: basketballStatusLabel(projection.status),
  }
}

export function basketballPeriodScoring(
  projection: BasketballMatchProjection,
  events: BasketballMatchEvent[]
): BasketballPeriodScore[] {
  const rows = projection.periods.map(period => ({
    periodId: period.id,
    label: period.label,
    order: period.order,
    tracked: 0,
    opponent: 0,
  }))
  const byId = new Map(rows.map(row => [row.periodId, row]))
  for (const event of events) {
    const row = byId.get(event.period.id)
    if (!row) continue
    if (event.eventType === 'basketball.shot' && event.payload.made) {
      row[event.teamSide] += event.payload.value
    } else if (event.eventType === 'basketball.score_adjustment') {
      row[event.teamSide] += event.payload.delta
    }
  }
  return rows
}

export function basketballTeamComparison(
  projection: BasketballMatchProjection
): BasketballComparisonSection[] {
  const tracked = projection.sideStats.tracked
  const opponent = projection.sideStats.opponent
  const attempts = (made: number, missed: number) => made + missed
  const row = (
    id: string,
    label: string,
    trackedValue: number,
    opponentValue: number,
    always = false
  ): BasketballComparisonRow | null => (
    always || trackedValue !== 0 || opponentValue !== 0
      ? { id, label, tracked: trackedValue, opponent: opponentValue }
      : null
  )
  const madeAttempted = (
    id: string,
    label: string,
    trackedMade: number,
    trackedAttempts: number,
    opponentMade: number,
    opponentAttempts: number
  ): BasketballComparisonRow => ({
    id,
    label,
    tracked: trackedMade,
    opponent: opponentMade,
    trackedAttempted: trackedAttempts,
    opponentAttempted: opponentAttempts,
    format: 'made_attempted',
  })
  const rows = (...items: Array<BasketballComparisonRow | null>) =>
    items.filter((item): item is BasketballComparisonRow => item !== null)

  const trackedFieldGoals = tracked['2pt'] + tracked['3pt']
  const opponentFieldGoals = opponent['2pt'] + opponent['3pt']
  const trackedFieldAttempts = attempts(tracked['2pt'], tracked['2pt_miss']) +
    attempts(tracked['3pt'], tracked['3pt_miss'])
  const opponentFieldAttempts = attempts(opponent['2pt'], opponent['2pt_miss']) +
    attempts(opponent['3pt'], opponent['3pt_miss'])
  const chargedTimeouts = (side: 'tracked' | 'opponent') =>
    Object.values(projection.periodTimeouts)
      .reduce((total, period) => total + period[side], 0)

  return [
    {
      id: 'shooting',
      label: 'Shooting',
      rows: [
        madeAttempted(
          'field_goals',
          'Field goals',
          trackedFieldGoals,
          trackedFieldAttempts,
          opponentFieldGoals,
          opponentFieldAttempts
        ),
        madeAttempted(
          'three_pointers',
          '3-pointers',
          tracked['3pt'],
          attempts(tracked['3pt'], tracked['3pt_miss']),
          opponent['3pt'],
          attempts(opponent['3pt'], opponent['3pt_miss'])
        ),
        madeAttempted(
          'free_throws',
          'Free throws',
          tracked.ft,
          attempts(tracked.ft, tracked.ft_miss),
          opponent.ft,
          attempts(opponent.ft, opponent.ft_miss)
        ),
      ],
    },
    {
      id: 'rebounding',
      label: 'Rebounding',
      rows: rows(
        row('rebounds', 'Total rebounds', tracked.oreb + tracked.dreb, opponent.oreb + opponent.dreb, true),
        row('offensive_rebounds', 'Offensive rebounds', tracked.oreb, opponent.oreb),
        row('defensive_rebounds', 'Defensive rebounds', tracked.dreb, opponent.dreb)
      ),
    },
    {
      id: 'playmaking',
      label: 'Playmaking',
      rows: rows(
        row('assists', 'Assists', tracked.ast, opponent.ast, true),
        row('turnovers', 'Turnovers', tracked.to, opponent.to, true)
      ),
    },
    {
      id: 'defense',
      label: 'Defense',
      rows: rows(
        row('steals', 'Steals', tracked.stl, opponent.stl, true),
        row('blocks', 'Blocks', tracked.blk, opponent.blk, true)
      ),
    },
    {
      id: 'discipline',
      label: 'Fouls & timeouts',
      rows: rows(
        row('fouls', 'Personal/team fouls', tracked.pf, opponent.pf, true),
        row(
          'timeouts',
          'Charged timeouts',
          chargedTimeouts('tracked'),
          chargedTimeouts('opponent'),
          true
        )
      ),
    },
  ]
}

export function basketballMatchLeaders(
  projection: BasketballMatchProjection
): BasketballMatchLeader[] {
  const participants = Object.values(projection.participants)
    .filter(participant => participant.teamSide === 'tracked')
  const categories: Array<{
    id: BasketballLeaderCategory
    label: string
    value: (participant: typeof participants[number]) => number
  }> = [
    {
      id: 'points',
      label: 'Points',
      value: participant => participant.stats.ft +
        participant.stats['2pt'] * 2 + participant.stats['3pt'] * 3,
    },
    {
      id: 'rebounds',
      label: 'Rebounds',
      value: participant => participant.stats.oreb + participant.stats.dreb,
    },
    { id: 'assists', label: 'Assists', value: participant => participant.stats.ast },
    { id: 'steals', label: 'Steals', value: participant => participant.stats.stl },
    { id: 'blocks', label: 'Blocks', value: participant => participant.stats.blk },
  ]
  return categories.flatMap(category => {
    const top = participants.reduce(
      (maximum, participant) => Math.max(maximum, category.value(participant)),
      0
    )
    if (top <= 0) return []
    return [{
      id: category.id,
      label: category.label,
      leaders: participants
        .filter(participant => category.value(participant) === top)
        .map(participant => ({
          participantId: participant.participantId,
          playerId: participant.playerId,
          displayName: participant.displayName,
          number: participant.number,
          value: top,
        })),
    }]
  })
}

export function basketballStatusLabel(
  status: BasketballMatchProjection['status']
): string {
  switch (status) {
    case 'not_started': return 'Not started'
    case 'in_progress': return 'In progress'
    case 'period_break': return 'Period break'
    case 'suspended': return 'Suspended'
    case 'ended': return 'Ended'
  }
}

function cleanParam(value: string | null): string | null {
  const cleaned = value?.trim()
  return cleaned ? cleaned : null
}
