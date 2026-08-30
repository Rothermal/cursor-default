import {
  BASKETBALL_CANONICAL_STAT_IDS,
  addBasketballAggregateStatsInPlace,
  basketballAggregateRates,
  basketballCanonicalStatsFromTotals,
  emptyBasketballAggregateStats,
  hasBasketballBaseContribution,
  type BasketballAggregateRates,
  type BasketballAggregateStats,
  type BasketballCanonicalStatId,
} from './aggregateStats'
import {
  projectBasketballCanonicalAggregateSource,
  type BasketballAggregateExclusion,
  type BasketballAggregateMatch,
  type BasketballAggregateMatchPlayer,
  type BasketballAggregatePeriodScore,
  type BasketballAggregateMetricEligibility,
  type BasketballAggregateParticipationBasis,
  type BasketballAggregateScope,
  type BasketballAggregateSourceGame,
  type BasketballAggregateUnresolvedParticipant,
  type BasketballCanonicalAggregateSource,
} from './aggregateProjection'
import type { BasketballStatTotals } from './types'

export interface BasketballLegacyAggregatePlayerSource {
  playerId: string | null
  displayName: string
  number: string | null
  stats: BasketballStatTotals
  participationEvidence: boolean
}

export interface BasketballLegacyAggregateSource {
  authority: 'legacy'
  sourceId: string
  sourceFingerprint: string
  resolvedAt: string
  game: BasketballAggregateSourceGame
  players: BasketballLegacyAggregatePlayerSource[]
  trackedStats: BasketballStatTotals
  opponentStats: BasketballStatTotals
  score: { tracked: number; opponent: number }
  periods: BasketballAggregatePeriodScore[]
  canManage: boolean
}

export interface BasketballAggregateRosterPlayer {
  playerId: string
  displayName: string
  number: string | null
  teamId: string
  seasonId?: string | null
  tournamentId?: string | null
}

export interface BasketballAggregatePlayer {
  playerId: string
  displayName: string
  number: string | null
  teamIds: string[]
  matchIds: string[]
  participationBasis: BasketballAggregateParticipationBasis | 'mixed' | null
  metricCoverage: BasketballAggregateMetricCoverage
  stats: BasketballAggregateStats
  rates: BasketballAggregateRates
}

export interface BasketballAggregateMetricCoverageEntry {
  includedGameCount: number
  totalGameCount: number
  complete: boolean
  reasons: string[]
}

export type BasketballAggregateMetricCoverage = Partial<Record<
  BasketballCanonicalStatId,
  BasketballAggregateMetricCoverageEntry
>>

export interface BasketballAggregateTeamRecord {
  games: number
  wins: number
  draws: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDifference: number
}

export interface BasketballAggregateTeam {
  teamId: string
  teamName: string
  record: BasketballAggregateTeamRecord
  trackedStats: BasketballAggregateStats
  opponentStats: BasketballAggregateStats
}

export interface BasketballAggregateGame {
  authority: 'canonical' | 'legacy'
  sourceId: string
  gameId: string
  cloudScope: 'team' | 'personal'
  teamId: string | null
  seasonId: string | null
  tournamentId: string | null
  date: string
  trackedTeamName: string
  opponentName: string
  trackedScore: number
  opponentScore: number
  result: 'win' | 'draw' | 'loss'
  periods: BasketballAggregatePeriodScore[]
  availableMetricIds: BasketballCanonicalStatId[]
  participationBasis: BasketballAggregateParticipationBasis
  playerMetricEligibility?: Record<string, BasketballAggregateMetricEligibility>
  playerStats?: Record<string, BasketballAggregateStats>
}

export interface BasketballAggregateMetrics {
  sourceCount: number
  includedGameCount: number
  canonicalGameCount: number
  legacyGameCount: number
  eventCount: number
  unresolvedParticipantCount: number
  excludedContributionCount: number
  malformedSourceCount: number
}

export interface BasketballAggregateResult {
  scope: BasketballAggregateScope
  quality: 'complete' | 'partial'
  provenance: 'canonical' | 'legacy' | 'mixed' | null
  minutesBasis: 'recorded'
  participationBasis: BasketballAggregateParticipationBasis | 'mixed' | null
  metricCoverage: BasketballAggregateMetricCoverage
  includedGameCount: number
  newestGameDate: string | null
  oldestGameDate: string | null
  availableMetricIds: BasketballCanonicalStatId[]
  players: BasketballAggregatePlayer[]
  teams: BasketballAggregateTeam[]
  games: BasketballAggregateGame[]
  exclusions: BasketballAggregateExclusion[]
  metrics: BasketballAggregateMetrics
}

export class BasketballAggregateAuthorityCollisionError extends Error {
  readonly code = 'basketball_aggregate_authority_collision'
  readonly gameIds: string[]

  constructor(gameIds: string[]) {
    super('A Basketball game was returned by both canonical and legacy authority sources.')
    this.name = 'BasketballAggregateAuthorityCollisionError'
    this.gameIds = [...new Set(gameIds)].sort()
  }
}

export function projectBasketballLegacyAggregateSource(
  source: BasketballLegacyAggregateSource
): { ok: true; match: BasketballAggregateMatch } |
  { ok: false; exclusion: BasketballAggregateExclusion } {
  const exclusion = (
    kind: 'ineligible_source' | 'malformed_source',
    message: string
  ) => ({
    ok: false as const,
    exclusion: legacyExclusion(source, kind, message),
  })
  if (
    source.game.status !== 'final' ||
    !isIsoDate(source.game.date) ||
    !isTimestamp(source.resolvedAt) ||
    !nonNegativeScore(source.score.tracked) ||
    !nonNegativeScore(source.score.opponent)
  ) {
    return exclusion(
      'ineligible_source',
      'Only correction-resolved final Basketball legacy games can aggregate.'
    )
  }
  if (
    !validBaseStats(source.trackedStats) ||
    !validBaseStats(source.opponentStats) ||
    source.players.some(player => !validBaseStats(player.stats))
  ) {
    return exclusion('malformed_source', 'Legacy Basketball base counters are invalid.')
  }

  const players: BasketballAggregateMatchPlayer[] = []
  const unresolvedParticipants: BasketballAggregateUnresolvedParticipant[] = []
  source.players.forEach((row, index) => {
    const appeared = row.participationEvidence || hasBasketballBaseContribution(row.stats)
    const stats = basketballCanonicalStatsFromTotals(row.stats, {
      appeared,
      started: false,
      disqualified: false,
      ejected: false,
    })
    const playerId = row.playerId?.trim() || null
    if (!playerId) {
      const contributionCount = nonZeroContributionCount(stats)
      if (contributionCount > 0) {
        unresolvedParticipants.push({
          participantId: `legacy:${source.game.id}:${index}`,
          localPlayerId: null,
          displayName: row.displayName,
          number: row.number,
          reason: 'missing_mapping',
          stats,
          contributionCount,
        })
      }
      return
    }
    players.push({
      playerId,
      participantIds: [],
      displayName: row.displayName,
      number: row.number,
      teamSide: 'tracked',
      participationBasis: 'recorded_manual',
      metricEligibility: {
        bk_dnp: { eligible: false, reason: 'DNP requires anchored lineup authority.' },
        bk_pm: { eligible: false, reason: 'Plus-minus requires anchored lineup authority.' },
      },
      stats,
    })
  })

  return {
    ok: true,
    match: {
      authority: 'legacy',
      sourceId: source.sourceId,
      sourceFingerprint: source.sourceFingerprint,
      sourceTimestamp: source.resolvedAt,
      canManage: source.canManage,
      game: structuredClone(source.game),
      eventCount: 0,
      participationBasis: 'recorded_manual',
      players: mergeLegacyPlayers(players),
      unresolvedParticipants,
      teamStats: {
        tracked: teamStats(source.trackedStats),
        opponent: teamStats(source.opponentStats),
      },
      score: structuredClone(source.score),
      result: source.score.tracked > source.score.opponent
        ? 'win'
        : source.score.tracked < source.score.opponent
          ? 'loss'
          : 'draw',
      periods: structuredClone(source.periods),
      availableMetricIds: BASKETBALL_CANONICAL_STAT_IDS.filter(
        id => id !== 'bk_start' && id !== 'bk_dnp' && id !== 'bk_pm' &&
          id !== 'bk_dq' && id !== 'bk_eject'
      ),
    },
  }
}

export function aggregateBasketballSources(
  scope: BasketballAggregateScope,
  canonicalSources: BasketballCanonicalAggregateSource[],
  legacySources: BasketballLegacyAggregateSource[],
  activeRoster: BasketballAggregateRosterPlayer[] = []
): BasketballAggregateResult {
  const matches: BasketballAggregateMatch[] = []
  const exclusions: BasketballAggregateExclusion[] = []
  for (const source of canonicalSources) {
    const projected = projectBasketballCanonicalAggregateSource(source)
    if (projected.ok) matches.push(projected.match)
    else exclusions.push(projected.exclusion)
  }
  for (const source of legacySources) {
    const projected = projectBasketballLegacyAggregateSource(source)
    if (projected.ok) matches.push(projected.match)
    else exclusions.push(projected.exclusion)
  }
  return aggregateBasketballMatches(
    scope,
    matches,
    exclusions,
    activeRoster,
    canonicalSources.length + legacySources.length
  )
}

export function aggregateBasketballMatches(
  scope: BasketballAggregateScope,
  matches: BasketballAggregateMatch[],
  initialExclusions: BasketballAggregateExclusion[] = [],
  activeRoster: BasketballAggregateRosterPlayer[] = [],
  sourceCount = matches.length + initialExclusions.length
): BasketballAggregateResult {
  const exclusions = [...initialExclusions]
  const eligible = matches.filter(match => {
    if (matchesScope(match, scope)) return true
    exclusions.push(matchExclusion(
      match,
      'ineligible_source',
      'Basketball source does not belong to the requested aggregate scope.'
    ))
    return false
  })

  const authorityByGame = new Map<string, Set<BasketballAggregateMatch['authority']>>()
  for (const match of eligible) {
    const authorities = authorityByGame.get(match.game.id) ?? new Set()
    authorities.add(match.authority)
    authorityByGame.set(match.game.id, authorities)
  }
  const collisions = [...authorityByGame.entries()]
    .filter(([, authorities]) => authorities.size > 1)
    .map(([gameId]) => gameId)
  if (collisions.length > 0) throw new BasketballAggregateAuthorityCollisionError(collisions)

  const included: BasketballAggregateMatch[] = []
  for (const group of groupMatchesByAuthorityAndGame(eligible).values()) {
    const first = group[0]
    const identical = group.every(match => (
      match.sourceId === first.sourceId &&
      match.sourceFingerprint === first.sourceFingerprint
    ))
    if (identical) {
      included.push(first)
    } else {
      exclusions.push(matchExclusion(
        first,
        'duplicate_source',
        'Duplicate Basketball source rows disagree for the same game authority.'
      ))
    }
  }
  included.sort(compareMatches)

  const players = new Map<string, BasketballAggregatePlayer>()
  const teams = new Map<string, BasketballAggregateTeam>()
  for (const match of included) {
    for (const unresolved of match.unresolvedParticipants) {
      exclusions.push({
        ...matchExclusion(
          match,
          'unresolved_participant',
          `${unresolved.displayName} has no stable cloud player identity.`
        ),
        participantId: unresolved.participantId,
        contributionCount: unresolved.contributionCount,
      })
    }
    for (const row of match.players) {
      if (row.teamSide !== 'tracked') continue
      if (
        (scope.type === 'player' || scope.type === 'career') &&
        row.playerId !== scope.id
      ) continue
      const existing = players.get(row.playerId)
      if (existing) {
        addBasketballAggregateStatsInPlace(existing.stats, row.stats)
        existing.rates = basketballAggregateRates(existing.stats)
        existing.matchIds.push(match.game.id)
        if (match.game.teamId) existing.teamIds.push(match.game.teamId)
        existing.matchIds = [...new Set(existing.matchIds)]
        existing.teamIds = [...new Set(existing.teamIds)].sort()
        existing.participationBasis = mergeParticipationBasis(
          existing.participationBasis,
          row.participationBasis
        )
        addMetricCoverage(existing.metricCoverage, row.metricEligibility)
      } else {
        const stats = structuredClone(row.stats)
        players.set(row.playerId, {
          playerId: row.playerId,
          displayName: row.displayName,
          number: row.number,
          teamIds: match.game.teamId ? [match.game.teamId] : [],
          matchIds: [match.game.id],
          participationBasis: row.participationBasis,
          metricCoverage: metricCoverageFromEligibility(row.metricEligibility),
          stats,
          rates: basketballAggregateRates(stats),
        })
      }
    }
    if (match.game.cloudScope === 'team' && match.game.teamId) {
      const existing = teams.get(match.game.teamId)
      if (existing) {
        addTeamMatch(existing, match)
      } else {
        teams.set(match.game.teamId, teamFromMatch(match))
      }
    }
  }

  for (const rosterPlayer of activeRoster) {
    if (!rosterBelongsToScope(rosterPlayer, scope)) continue
    const existing = players.get(rosterPlayer.playerId)
    if (existing) {
      existing.displayName = rosterPlayer.displayName
      existing.number = rosterPlayer.number
      existing.teamIds = [...new Set([...existing.teamIds, rosterPlayer.teamId])].sort()
      continue
    }
    const stats = emptyBasketballAggregateStats()
    players.set(rosterPlayer.playerId, {
      playerId: rosterPlayer.playerId,
      displayName: rosterPlayer.displayName,
      number: rosterPlayer.number,
      teamIds: [rosterPlayer.teamId],
      matchIds: [],
      participationBasis: null,
      metricCoverage: {},
      stats,
      rates: basketballAggregateRates(stats),
    })
  }

  const unavailableFromAnyMatch = included.reduce<Set<BasketballCanonicalStatId>>(
    (available, match) => intersection(available, matchAvailability(match)),
    new Set(BASKETBALL_CANONICAL_STAT_IDS)
  )
  if (included.length === 0) {
    unavailableFromAnyMatch.delete('bk_dnp')
    unavailableFromAnyMatch.delete('bk_pm')
  }
  const harmfulExclusions = exclusions.filter(exclusion => [
    'malformed_source',
    'unresolved_participant',
    'duplicate_source',
  ].includes(exclusion.kind))
  const canonicalCount = included.filter(match => match.authority === 'canonical').length
  const legacyCount = included.filter(match => match.authority === 'legacy').length
  const dates = included.map(match => match.game.date)
  return {
    scope,
    quality: harmfulExclusions.length > 0 ? 'partial' : 'complete',
    provenance: canonicalCount > 0 && legacyCount > 0
      ? 'mixed'
      : canonicalCount > 0 ? 'canonical' : legacyCount > 0 ? 'legacy' : null,
    minutesBasis: 'recorded',
    participationBasis: aggregateParticipationBasis(included),
    metricCoverage: aggregateMetricCoverage(included),
    includedGameCount: included.length,
    newestGameDate: dates.length ? dates.reduce((latest, date) => date > latest ? date : latest) : null,
    oldestGameDate: dates.length ? dates.reduce((earliest, date) => date < earliest ? date : earliest) : null,
    availableMetricIds: [...unavailableFromAnyMatch],
    players: [...players.values()].sort(comparePlayers),
    teams: [...teams.values()].sort((left, right) =>
      left.teamName.localeCompare(right.teamName) || left.teamId.localeCompare(right.teamId)
    ),
    games: included.map(match => gameRow(match, scope)),
    exclusions,
    metrics: {
      sourceCount,
      includedGameCount: included.length,
      canonicalGameCount: canonicalCount,
      legacyGameCount: legacyCount,
      eventCount: included.reduce((sum, match) => sum + match.eventCount, 0),
      unresolvedParticipantCount: exclusions.filter(
        exclusion => exclusion.kind === 'unresolved_participant'
      ).length,
      excludedContributionCount: exclusions.reduce(
        (sum, exclusion) => sum + (exclusion.contributionCount ?? 0),
        0
      ),
      malformedSourceCount: exclusions.filter(
        exclusion => exclusion.kind === 'malformed_source'
      ).length,
    },
  }
}

function matchesScope(match: BasketballAggregateMatch, scope: BasketballAggregateScope): boolean {
  if (!isIsoDate(match.game.date) || match.game.status !== 'final') return false
  if (scope.type === 'team') {
    return match.game.cloudScope === 'team' && match.game.teamId === scope.id
  }
  if (scope.type === 'season') {
    return match.game.cloudScope === 'team' && match.game.seasonId === scope.id
  }
  if (scope.type === 'tournament') {
    return match.game.cloudScope === 'team' && match.game.tournamentId === scope.id
  }
  if (!scope.id) return false
  return match.players.some(player => (
    player.teamSide === 'tracked' && player.playerId === scope.id
  ))
}

function rosterBelongsToScope(
  player: BasketballAggregateRosterPlayer,
  scope: BasketballAggregateScope
): boolean {
  if (scope.type === 'team') return player.teamId === scope.id
  if (scope.type === 'season') return player.seasonId === scope.id
  if (scope.type === 'tournament') return player.tournamentId === scope.id
  return false
}

function groupMatchesByAuthorityAndGame(matches: BasketballAggregateMatch[]) {
  const groups = new Map<string, BasketballAggregateMatch[]>()
  for (const match of matches) {
    const key = `${match.authority}:${match.game.id}`
    groups.set(key, [...(groups.get(key) ?? []), match])
  }
  return groups
}

function matchAvailability(match: BasketballAggregateMatch): Set<BasketballCanonicalStatId> {
  return new Set(match.availableMetricIds)
}

function intersection<T>(left: Set<T>, right: Set<T>): Set<T> {
  return new Set([...left].filter(value => right.has(value)))
}

function teamStats(stats: BasketballStatTotals): BasketballAggregateStats {
  return basketballCanonicalStatsFromTotals(stats, {
    appeared: false,
    started: false,
    disqualified: false,
    ejected: false,
  })
}

function mergeLegacyPlayers(
  rows: BasketballAggregateMatchPlayer[]
): BasketballAggregateMatchPlayer[] {
  const players = new Map<string, BasketballAggregateMatchPlayer>()
  for (const row of rows) {
    const existing = players.get(row.playerId)
    if (existing) {
      const appearances = Math.max(existing.stats.bk_app, row.stats.bk_app)
      addBasketballAggregateStatsInPlace(existing.stats, row.stats)
      existing.stats.bk_app = appearances
    } else {
      players.set(row.playerId, structuredClone(row))
    }
  }
  return [...players.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName) || left.playerId.localeCompare(right.playerId)
  )
}

function teamFromMatch(match: BasketballAggregateMatch): BasketballAggregateTeam {
  if (!match.game.teamId) throw new Error('Team aggregate match requires a team id.')
  return {
    teamId: match.game.teamId,
    teamName: match.game.trackedTeamName,
    record: recordFromMatch(match),
    trackedStats: structuredClone(match.teamStats.tracked),
    opponentStats: structuredClone(match.teamStats.opponent),
  }
}

function addTeamMatch(team: BasketballAggregateTeam, match: BasketballAggregateMatch): void {
  const record = recordFromMatch(match)
  team.record.games += 1
  team.record.wins += record.wins
  team.record.draws += record.draws
  team.record.losses += record.losses
  team.record.pointsFor += match.score.tracked
  team.record.pointsAgainst += match.score.opponent
  team.record.pointDifference = team.record.pointsFor - team.record.pointsAgainst
  addBasketballAggregateStatsInPlace(team.trackedStats, match.teamStats.tracked)
  addBasketballAggregateStatsInPlace(team.opponentStats, match.teamStats.opponent)
}

function recordFromMatch(match: BasketballAggregateMatch): BasketballAggregateTeamRecord {
  return {
    games: 1,
    wins: match.result === 'win' ? 1 : 0,
    draws: match.result === 'draw' ? 1 : 0,
    losses: match.result === 'loss' ? 1 : 0,
    pointsFor: match.score.tracked,
    pointsAgainst: match.score.opponent,
    pointDifference: match.score.tracked - match.score.opponent,
  }
}

function gameRow(
  match: BasketballAggregateMatch,
  scope: BasketballAggregateScope
): BasketballAggregateGame {
  const playerId = scope.type === 'player' || scope.type === 'career' ? scope.id : null
  const player = playerId
    ? match.players.find(candidate => candidate.playerId === playerId)
    : null
  return {
    authority: match.authority,
    sourceId: match.sourceId,
    gameId: match.game.id,
    cloudScope: match.game.cloudScope,
    teamId: match.game.teamId,
    seasonId: match.game.seasonId,
    tournamentId: match.game.tournamentId,
    date: match.game.date,
    trackedTeamName: match.game.trackedTeamName,
    opponentName: match.game.opponentName,
    trackedScore: match.score.tracked,
    opponentScore: match.score.opponent,
    result: match.result,
    periods: structuredClone(match.periods),
    availableMetricIds: [...match.availableMetricIds],
    participationBasis: player?.participationBasis ?? matchParticipationBasis(match),
    ...(playerId && player
      ? { playerMetricEligibility: { [playerId]: structuredClone(player.metricEligibility) } }
      : {}),
    ...(playerId && player
      ? { playerStats: { [playerId]: structuredClone(player.stats) } }
      : {}),
  }
}

function matchParticipationBasis(match: BasketballAggregateMatch): BasketballAggregateParticipationBasis {
  return match.participationBasis
}

function aggregateParticipationBasis(
  matches: BasketballAggregateMatch[]
): BasketballAggregateParticipationBasis | 'mixed' | null {
  if (matches.length === 0) return null
  const values = new Set(matches.map(matchParticipationBasis))
  return values.size === 1 ? [...values][0] : 'mixed'
}

function mergeParticipationBasis(
  left: BasketballAggregateParticipationBasis | 'mixed' | null,
  right: BasketballAggregateParticipationBasis
): BasketballAggregateParticipationBasis | 'mixed' {
  if (left === null) return right
  return left === right ? left : 'mixed'
}

function metricCoverageFromEligibility(
  eligibility: BasketballAggregateMetricEligibility
): BasketballAggregateMetricCoverage {
  const coverage: BasketballAggregateMetricCoverage = {}
  addMetricCoverage(coverage, eligibility)
  return coverage
}

function addMetricCoverage(
  coverage: BasketballAggregateMetricCoverage,
  eligibility: BasketballAggregateMetricEligibility
): void {
  for (const id of BASKETBALL_CANONICAL_STAT_IDS) {
    const entry = eligibility[id]
    if (!entry) continue
    const current = coverage[id] ?? {
      includedGameCount: 0,
      totalGameCount: 0,
      complete: true,
      reasons: [],
    }
    current.totalGameCount += 1
    if (entry.eligible) current.includedGameCount += 1
    else if (entry.reason) current.reasons.push(entry.reason)
    current.complete = current.includedGameCount === current.totalGameCount
    current.reasons = [...new Set(current.reasons)]
    coverage[id] = current
  }
}

function aggregateMetricCoverage(
  matches: BasketballAggregateMatch[]
): BasketballAggregateMetricCoverage {
  const coverage: BasketballAggregateMetricCoverage = {}
  for (const match of matches) {
    for (const id of ['bk_dnp', 'bk_pm'] as const) {
      const eligible = match.availableMetricIds.includes(id)
      const reasons = match.players
        .filter(player => player.teamSide === 'tracked')
        .map(player => player.metricEligibility[id])
        .filter(entry => entry && !entry.eligible && entry.reason)
        .map(entry => entry!.reason!)
      addMetricCoverage(coverage, {
        [id]: {
          eligible,
          reason: eligible ? null : reasons[0] ?? `${id} is unavailable for this game.`,
        },
      })
    }
  }
  return coverage
}

function matchExclusion(
  match: BasketballAggregateMatch,
  kind: BasketballAggregateExclusion['kind'],
  message: string
): BasketballAggregateExclusion {
  return {
    kind,
    authority: match.authority,
    sourceId: match.sourceId,
    gameId: match.game.id,
    gameDate: match.game.date,
    message,
    canManage: match.canManage,
  }
}

function legacyExclusion(
  source: BasketballLegacyAggregateSource,
  kind: BasketballAggregateExclusion['kind'],
  message: string
): BasketballAggregateExclusion {
  return {
    kind,
    authority: 'legacy',
    sourceId: source.sourceId,
    gameId: source.game.id,
    gameDate: source.game.date,
    message,
    canManage: source.canManage,
  }
}

function compareMatches(left: BasketballAggregateMatch, right: BasketballAggregateMatch): number {
  return right.game.date.localeCompare(left.game.date) ||
    right.sourceTimestamp.localeCompare(left.sourceTimestamp) ||
    left.sourceId.localeCompare(right.sourceId)
}

function comparePlayers(left: BasketballAggregatePlayer, right: BasketballAggregatePlayer): number {
  return right.stats.bk_pts - left.stats.bk_pts ||
    (right.rates.points_per_game?.value ?? -1) - (left.rates.points_per_game?.value ?? -1) ||
    right.stats.bk_app - left.stats.bk_app ||
    left.displayName.localeCompare(right.displayName) ||
    left.playerId.localeCompare(right.playerId)
}

function nonZeroContributionCount(stats: BasketballAggregateStats): number {
  return BASKETBALL_CANONICAL_STAT_IDS.filter(id => id !== 'bk_dnp' && stats[id] !== 0).length
}

function nonNegativeScore(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function validBaseStats(stats: BasketballStatTotals): boolean {
  return Object.values(stats).every(value =>
    Number.isSafeInteger(value) && value >= 0
  )
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isTimestamp(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value))
}
