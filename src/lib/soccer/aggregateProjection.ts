import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { isPlainObject } from '../gameEvents/envelope'
import { createInitialState } from '../gameReducer'
import {
  inspectSoccerCanonicalSnapshot,
  type SoccerCanonicalSnapshot,
} from './finalization'
import type { SoccerRecorderSummary } from './recorders'
import {
  soccerPlayerReview,
  type SoccerPlayerReviewRow,
} from './summaryPlayers'
import {
  addSoccerAggregateStatsInPlace,
  compareSoccerAggregatePlayerRows,
  emptySoccerAggregateStats,
  soccerCanonicalStatsFromTotals,
  soccerAggregateRates,
  type SoccerAggregateRates,
  type SoccerAggregateStats,
} from './aggregateStats'
import type { SoccerSideAttackingTotals } from './types'

export type SoccerAggregateScopeType =
  | 'team'
  | 'season'
  | 'tournament'
  | 'player'
  | 'career'

export interface SoccerAggregateScope {
  type: SoccerAggregateScopeType
  id: string | null
}

export interface SoccerAggregateSourceGame {
  id: string
  date: string
  status: string
  cloudScope: 'team' | 'personal'
  teamId: string | null
  seasonId: string | null
  tournamentId: string | null
  trackedTeamName: string
  opponentName: string
}

export interface SoccerCanonicalAggregateSource {
  publicationId: string
  publicationNumber: number
  snapshotFingerprint: string
  finalizedAt: string
  game: SoccerAggregateSourceGame
  canonicalSnapshot: SoccerCanonicalSnapshot
  participantSourceMap: Record<string, string>
  canManage: boolean
}

export interface SoccerAggregateForAgainstSide {
  goals: number
  shots: number
  shotsOnTarget: number
  corners: number
  offsides: number
  fouls: number
  yellowCards: number
  redCards: number
}

export interface SoccerAggregateForAgainst {
  tracked: SoccerAggregateForAgainstSide
  opponent: SoccerAggregateForAgainstSide
}

export interface SoccerAggregateTeamResult {
  matches: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  cleanSheets: number
}

export interface SoccerAggregateMatchPlayer {
  playerId: string
  participantIds: string[]
  displayName: string
  number: string | null
  stats: SoccerAggregateStats
}

export interface SoccerAggregateUnresolvedParticipant {
  participantId: string
  localPlayerId: string | null
  displayName: string
  number: string | null
  reason: 'missing_mapping' | 'conflicting_mapping'
  stats: SoccerAggregateStats
  contributionCount: number
}

export interface SoccerAggregateMatch {
  publicationId: string
  publicationNumber: number
  snapshotFingerprint: string
  finalizedAt: string
  canManage: boolean
  game: SoccerAggregateSourceGame
  eventCount: number
  players: SoccerAggregateMatchPlayer[]
  unresolvedParticipants: SoccerAggregateUnresolvedParticipant[]
  teamResult: SoccerAggregateTeamResult
  forAgainst: SoccerAggregateForAgainst
}

export type SoccerAggregateExclusionKind =
  | 'unresolved_participant'
  | 'malformed_publication'
  | 'abandoned_match'
  | 'ineligible_source'
  | 'duplicate_publication'

export interface SoccerAggregateExclusion {
  kind: SoccerAggregateExclusionKind
  publicationId: string
  gameId: string
  gameDate: string
  message: string
  participantId?: string
  contributionCount?: number
  canManage: boolean
}

export interface SoccerAggregatePlayer {
  playerId: string
  displayName: string
  number: string | null
  teamIds: string[]
  /** Included match sources, including DNP roster rows. Use soc_app for games played. */
  matchIds: string[]
  stats: SoccerAggregateStats
  rates: SoccerAggregateRates
}

export interface SoccerAggregateTeam {
  teamId: string
  teamName: string
  result: SoccerAggregateTeamResult
  forAgainst: SoccerAggregateForAgainst
}

export interface SoccerAggregateGame {
  publicationId: string
  gameId: string
  teamId: string
  seasonId: string | null
  tournamentId: string | null
  date: string
  trackedTeamName: string
  opponentName: string
  trackedScore: number
  opponentScore: number
  result: 'win' | 'draw' | 'loss'
  /** Retained only for player/career scopes and only for the requested stable player. */
  playerStats?: Record<string, SoccerAggregateStats>
}

export interface SoccerAggregateMetrics {
  sourceCount: number
  includedMatchCount: number
  /** Rebuilt event count from included matches only, unlike transport fetch metrics. */
  eventCount: number
  unresolvedParticipantCount: number
  excludedContributionCount: number
  malformedPublicationCount: number
}

export interface SoccerAggregateResult {
  scope: SoccerAggregateScope
  quality: 'complete' | 'partial'
  includedMatchCount: number
  newestMatchDate: string | null
  oldestMatchDate: string | null
  players: SoccerAggregatePlayer[]
  teams: SoccerAggregateTeam[]
  games: SoccerAggregateGame[]
  exclusions: SoccerAggregateExclusion[]
  metrics: SoccerAggregateMetrics
}

export interface SoccerAggregateRosterPlayer {
  playerId: string
  displayName: string
  number: string | null
  teamId: string
}

export type SoccerAggregateSourceProjection =
  | { ok: true; match: SoccerAggregateMatch }
  | { ok: false; exclusion: SoccerAggregateExclusion }

type EligibleSoccerAggregateMatch = SoccerAggregateMatch & {
  game: SoccerAggregateSourceGame & { teamId: string }
}

export function projectSoccerCanonicalAggregateSource(
  source: SoccerCanonicalAggregateSource
): SoccerAggregateSourceProjection {
  const exclusion = (
    kind: Exclude<SoccerAggregateExclusionKind, 'unresolved_participant'>,
    message: string
  ): SoccerAggregateSourceProjection => ({
    ok: false,
    exclusion: sourceExclusion(source, kind, message),
  })

  if (
    source.game.status !== 'final' ||
    source.game.cloudScope !== 'team' ||
    !source.game.teamId ||
    !isIsoDate(source.game.date)
  ) {
    return exclusion(
      'ineligible_source',
      'Only final team-scoped games with an ISO calendar date can aggregate.'
    )
  }
  if (source.canonicalSnapshot.gameId !== source.game.id) {
    return exclusion('malformed_publication', 'Canonical snapshot game identity does not match.')
  }

  try {
    const recorder = aggregateRecorder(source.canonicalSnapshot)
    const rebuilt = inspectSoccerCanonicalSnapshot(
      aggregateBaseState(source),
      recorder,
      source.canonicalSnapshot
    )
    const sportState = rebuilt.state.sportGameState
    if (!rebuilt.inspection.complete || sportState?.sportId !== 'soccer') {
      return exclusion(
        'malformed_publication',
        rebuilt.inspection.diagnostics[0]?.message ??
          'Canonical publication does not rebuild completely.'
      )
    }
    if (sportState.projection.endReason === 'abandoned') {
      return exclusion('abandoned_match', 'Abandoned matches do not enter aggregates.')
    }
    if (
      sportState.projection.status !== 'ended' ||
      sportState.projection.endReason !== 'completed'
    ) {
      return exclusion(
        'malformed_publication',
        'Canonical publication does not reproduce a completed match.'
      )
    }

    const review = soccerPlayerReview(rebuilt.state, rebuilt.inspection)
    const players = new Map<string, SoccerAggregateMatchPlayer>()
    const unresolvedParticipants: SoccerAggregateUnresolvedParticipant[] = []

    for (const row of review.tracked.rows) {
      const participant = sportState.projection.participants[row.participantId]
      const stats = statsFromReviewRow(row)
      const mapping = stablePlayerId(
        row.participantId,
        participant?.playerId ?? row.playerId,
        source.participantSourceMap
      )
      if (!mapping.playerId) {
        unresolvedParticipants.push({
          participantId: row.participantId,
          localPlayerId: participant?.playerId ?? row.playerId,
          displayName: row.displayName,
          number: row.number,
          reason: mapping.reason,
          stats,
          contributionCount: nonZeroContributionCount(stats),
        })
        continue
      }

      const existing = players.get(mapping.playerId)
      const next: SoccerAggregateMatchPlayer = {
        playerId: mapping.playerId,
        participantIds: [row.participantId],
        displayName: row.displayName,
        number: row.number,
        stats,
      }
      players.set(
        mapping.playerId,
        existing ? mergeMatchPlayers(existing, next) : next
      )
    }

    const trackedScore = sportState.projection.sideTotals.tracked.score
    const opponentScore = sportState.projection.sideTotals.opponent.score
    return {
      ok: true,
      match: {
        publicationId: source.publicationId,
        publicationNumber: source.publicationNumber,
        snapshotFingerprint: source.snapshotFingerprint,
        finalizedAt: source.finalizedAt,
        canManage: source.canManage,
        game: structuredClone(source.game),
        eventCount: source.canonicalSnapshot.eventStream.events.length,
        players: [...players.values()].sort((left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.playerId.localeCompare(right.playerId)
        ),
        unresolvedParticipants,
        teamResult: matchTeamResult(trackedScore, opponentScore),
        forAgainst: matchForAgainst(
          sportState.projection.sideTotals.tracked,
          sportState.projection.sideTotals.opponent
        ),
      },
    }
  } catch (error) {
    return exclusion(
      'malformed_publication',
      error instanceof Error ? error.message : 'Canonical publication is invalid.'
    )
  }
}

export function aggregateSoccerCanonicalSources(
  scope: SoccerAggregateScope,
  sources: SoccerCanonicalAggregateSource[],
  activeRoster: SoccerAggregateRosterPlayer[] = []
): SoccerAggregateResult {
  const matches: SoccerAggregateMatch[] = []
  const exclusions: SoccerAggregateExclusion[] = []
  for (const source of sources) {
    const projected = projectSoccerCanonicalAggregateSource(source)
    if (projected.ok) {
      matches.push(projected.match)
    } else {
      exclusions.push(projected.exclusion)
    }
  }
  return aggregateSoccerMatches(scope, matches, exclusions, activeRoster, sources.length)
}

export function aggregateSoccerMatches(
  scope: SoccerAggregateScope,
  matches: SoccerAggregateMatch[],
  initialExclusions: SoccerAggregateExclusion[] = [],
  activeRoster: SoccerAggregateRosterPlayer[] = [],
  sourceCount = matches.length + initialExclusions.length
): SoccerAggregateResult {
  const exclusions = [...initialExclusions]
  const eligibleMatches: EligibleSoccerAggregateMatch[] = []
  for (const match of matches) {
    if (isEligibleAggregateMatch(match)) {
      eligibleMatches.push(match)
      continue
    }
    exclusions.push({
      kind: 'ineligible_source',
      publicationId: match.publicationId,
      gameId: match.game.id,
      gameDate: match.game.date,
      message: 'Aggregate matches require a final team scope and ISO calendar date.',
      canManage: match.canManage,
    })
  }

  const uniqueMatches = new Map<string, EligibleSoccerAggregateMatch>()
  const conflictedPublicationIds = new Set<string>()
  for (const match of [...eligibleMatches].sort(compareMatches)) {
    if (conflictedPublicationIds.has(match.publicationId)) continue
    const existing = uniqueMatches.get(match.publicationId)
    if (!existing) {
      uniqueMatches.set(match.publicationId, match)
      continue
    }
    if (existing.snapshotFingerprint !== match.snapshotFingerprint) {
      exclusions.push({
        kind: 'duplicate_publication',
        publicationId: match.publicationId,
        gameId: match.game.id,
        gameDate: match.game.date,
        message: 'Duplicate publication id has conflicting canonical content.',
        canManage: existing.canManage || match.canManage,
      })
      uniqueMatches.delete(match.publicationId)
      conflictedPublicationIds.add(match.publicationId)
    }
  }

  const included = [...uniqueMatches.values()].sort(compareMatches)
  const players = new Map<string, SoccerAggregatePlayer>()
  const teams = new Map<string, SoccerAggregateTeam>()

  for (const match of included) {
    const teamId = match.game.teamId
    for (const unresolved of match.unresolvedParticipants) {
      exclusions.push({
        kind: 'unresolved_participant',
        publicationId: match.publicationId,
        gameId: match.game.id,
        gameDate: match.game.date,
        participantId: unresolved.participantId,
        contributionCount: unresolved.contributionCount,
        message: `${unresolved.displayName} has no stable cloud player identity.`,
        canManage: match.canManage,
      })
    }
    for (const row of match.players) {
      const existing = players.get(row.playerId)
      if (!existing) {
        players.set(row.playerId, {
          playerId: row.playerId,
          displayName: row.displayName,
          number: row.number,
          teamIds: [teamId],
          matchIds: [match.game.id],
          stats: structuredClone(row.stats),
          rates: soccerAggregateRates(row.stats),
        })
        continue
      }
      addSoccerAggregateStatsInPlace(existing.stats, row.stats)
      if (!existing.teamIds.includes(teamId)) existing.teamIds.push(teamId)
      if (!existing.matchIds.includes(match.game.id)) existing.matchIds.push(match.game.id)
    }

    const existingTeam = teams.get(teamId)
    if (!existingTeam) {
      teams.set(teamId, {
        teamId,
        teamName: match.game.trackedTeamName,
        result: structuredClone(match.teamResult),
        forAgainst: structuredClone(match.forAgainst),
      })
    } else {
      addTeamResult(existingTeam.result, match.teamResult)
      addForAgainst(existingTeam.forAgainst, match.forAgainst)
    }
  }

  for (const rosterPlayer of activeRoster) {
    const existing = players.get(rosterPlayer.playerId)
    if (existing) {
      existing.displayName = rosterPlayer.displayName
      existing.number = rosterPlayer.number
      if (!existing.teamIds.includes(rosterPlayer.teamId)) {
        existing.teamIds.push(rosterPlayer.teamId)
      }
      continue
    }
    const stats = emptySoccerAggregateStats()
    players.set(rosterPlayer.playerId, {
      playerId: rosterPlayer.playerId,
      displayName: rosterPlayer.displayName,
      number: rosterPlayer.number,
      teamIds: [rosterPlayer.teamId],
      matchIds: [],
      stats,
      rates: soccerAggregateRates(stats),
    })
  }

  const unresolved = exclusions.filter(item => item.kind === 'unresolved_participant')
  const malformed = exclusions.filter(item =>
    item.kind === 'malformed_publication' || item.kind === 'duplicate_publication'
  )
  const hasPartialExclusion = exclusions.some(item => item.kind !== 'abandoned_match')
  const dates = included.map(match => match.game.date).sort()
  return {
    scope,
    quality: hasPartialExclusion ? 'partial' : 'complete',
    includedMatchCount: included.length,
    newestMatchDate: dates[dates.length - 1] ?? null,
    oldestMatchDate: dates[0] ?? null,
    players: [...players.values()]
      .map(player => ({
        ...player,
        teamIds: [...player.teamIds].sort(),
        matchIds: [...player.matchIds],
        rates: soccerAggregateRates(player.stats),
      }))
      .sort(compareSoccerAggregatePlayerRows),
    teams: [...teams.values()].sort((left, right) =>
      left.teamName.localeCompare(right.teamName) || left.teamId.localeCompare(right.teamId)
    ),
    games: included.map(match => matchGameRow(match, scope)),
    exclusions,
    metrics: {
      sourceCount,
      includedMatchCount: included.length,
      eventCount: included.reduce((sum, match) => sum + match.eventCount, 0),
      unresolvedParticipantCount: unresolved.length,
      excludedContributionCount: unresolved.reduce(
        (sum, item) => sum + (item.contributionCount ?? 0),
        0
      ),
      malformedPublicationCount: malformed.length,
    },
  }
}

function aggregateBaseState(source: SoccerCanonicalAggregateSource): GameState {
  const initial = createInitialState()
  const soccer = sports.find(sport => sport.id === 'soccer')
  if (!soccer) throw new Error('Soccer configuration is unavailable.')
  return {
    ...initial,
    sport: soccer,
    gameInfo: {
      teamName: source.game.trackedTeamName,
      opponentName: source.game.opponentName,
      tournamentName: '',
      tournamentId: source.game.tournamentId,
      date: source.game.date,
    },
    players: snapshotPlayers(source.canonicalSnapshot),
  }
}

function snapshotPlayers(snapshot: SoccerCanonicalSnapshot): Player[] {
  const players = new Map<string, Player>()
  const add = (id: unknown, name: unknown, number: unknown) => {
    if (typeof id !== 'string' || players.has(id)) return
    players.set(id, {
      id,
      name: typeof name === 'string' && name.trim() ? name : 'Soccer player',
      number: typeof number === 'string' ? number : '',
      stats: {},
    })
  }
  for (const participant of snapshot.sportGameState.setup.participants) {
    add(participant.playerId, participant.displayName, participant.number)
  }
  for (const value of snapshot.eventStream.events) {
    if (!isPlainObject(value)) continue
    if (Array.isArray(value.actors)) {
      for (const actor of value.actors) {
        if (!isPlainObject(actor)) continue
        add(actor.playerId, actor.label, null)
      }
    }
    if (value.eventType === 'soccer.participant_resolved' && isPlainObject(value.payload)) {
      add(value.payload.playerId, value.payload.displayName, value.payload.number)
    }
  }
  return [...players.values()]
}

function aggregateRecorder(snapshot: SoccerCanonicalSnapshot): SoccerRecorderSummary {
  return {
    recorderId: snapshot.primaryRecorderId,
    displayName: 'Canonical recorder',
    eventCount: snapshot.eventStream.events.length,
    checkpointEventCount: snapshot.eventStream.events.length,
    checkpointSyncedAt: null,
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: true,
    primarySource: 'selected',
    canSelectPrimary: false,
  }
}

function statsFromReviewRow(row: SoccerPlayerReviewRow): SoccerAggregateStats {
  return {
    ...soccerCanonicalStatsFromTotals(row.stats, {
      appearances: row.appearances,
      started: row.lineupStatus === 'starter',
      activeSeconds: Math.floor(row.minutesMs / 1_000),
    }),
    soc_cs:
      row.cleanSheet.status === 'credited' ||
      row.cleanSheet.status === 'shared'
        ? 1
        : 0,
  }
}

function stablePlayerId(
  participantId: string,
  localPlayerId: string | null,
  sourceMap: Record<string, string>
): { playerId: string | null; reason: SoccerAggregateUnresolvedParticipant['reason'] } {
  const byParticipant = sourceMap[participantId] || null
  const byPlayer = localPlayerId ? sourceMap[localPlayerId] || null : null
  if (byParticipant && byPlayer && byParticipant !== byPlayer) {
    return { playerId: null, reason: 'conflicting_mapping' }
  }
  return {
    playerId: byParticipant ?? byPlayer,
    reason: 'missing_mapping',
  }
}

function mergeMatchPlayers(
  left: SoccerAggregateMatchPlayer,
  right: SoccerAggregateMatchPlayer
): SoccerAggregateMatchPlayer {
  const stats = structuredClone(left.stats)
  const appearances = Math.max(stats.soc_app, right.stats.soc_app)
  const starts = Math.max(stats.soc_start, right.stats.soc_start)
  const cleanSheets = Math.max(stats.soc_cs, right.stats.soc_cs)
  // A merge preserves every historical participant contribution. Appearance/start/clean-sheet
  // credit is match-scoped, while time and event totals retain all recorded stints.
  addSoccerAggregateStatsInPlace(stats, right.stats)
  stats.soc_app = appearances
  stats.soc_start = starts
  stats.soc_cs = cleanSheets
  return {
    ...left,
    participantIds: [...new Set([...left.participantIds, ...right.participantIds])].sort(),
    stats,
  }
}

function matchTeamResult(
  trackedScore: number,
  opponentScore: number
): SoccerAggregateTeamResult {
  return {
    matches: 1,
    wins: trackedScore > opponentScore ? 1 : 0,
    draws: trackedScore === opponentScore ? 1 : 0,
    losses: trackedScore < opponentScore ? 1 : 0,
    goalsFor: trackedScore,
    goalsAgainst: opponentScore,
    goalDifference: trackedScore - opponentScore,
    cleanSheets: opponentScore === 0 ? 1 : 0,
  }
}

function matchForAgainst(
  tracked: SoccerSideAttackingTotals,
  opponent: SoccerSideAttackingTotals
): SoccerAggregateForAgainst {
  return {
    tracked: sideForAgainst(tracked),
    opponent: sideForAgainst(opponent),
  }
}

function sideForAgainst(side: SoccerSideAttackingTotals): SoccerAggregateForAgainstSide {
  return {
    goals: side.score,
    shots: side.shots,
    shotsOnTarget: side.shotsOnTarget,
    corners: side.corners,
    offsides: side.offsides,
    fouls: side.foulsCommitted,
    yellowCards: side.yellowCards,
    redCards: side.redCards,
  }
}

function sourceExclusion(
  source: SoccerCanonicalAggregateSource,
  kind: Exclude<SoccerAggregateExclusionKind, 'unresolved_participant'>,
  message: string
): SoccerAggregateExclusion {
  return {
    kind,
    publicationId: source.publicationId,
    gameId: source.game.id,
    gameDate: source.game.date,
    message,
    canManage: source.canManage,
  }
}

function nonZeroContributionCount(stats: SoccerAggregateStats): number {
  return Object.values(stats).filter(value => value !== 0).length
}

function compareMatches(
  left: EligibleSoccerAggregateMatch,
  right: EligibleSoccerAggregateMatch
): number {
  return right.game.date.localeCompare(left.game.date) ||
    right.finalizedAt.localeCompare(left.finalizedAt) ||
    left.publicationId.localeCompare(right.publicationId)
}

function matchGameRow(
  match: EligibleSoccerAggregateMatch,
  scope: SoccerAggregateScope
): SoccerAggregateGame {
  const trackedScore = match.teamResult.goalsFor
  const opponentScore = match.teamResult.goalsAgainst
  const playerId =
    (scope.type === 'player' || scope.type === 'career') ? scope.id : null
  const player = playerId
    ? match.players.find(candidate => candidate.playerId === playerId)
    : null
  return {
    publicationId: match.publicationId,
    gameId: match.game.id,
    teamId: match.game.teamId,
    seasonId: match.game.seasonId,
    tournamentId: match.game.tournamentId,
    date: match.game.date,
    trackedTeamName: match.game.trackedTeamName,
    opponentName: match.game.opponentName,
    trackedScore,
    opponentScore,
    result: trackedScore > opponentScore ? 'win' : trackedScore < opponentScore ? 'loss' : 'draw',
    ...(playerId && player
      ? { playerStats: { [playerId]: structuredClone(player.stats) } }
      : {}),
  }
}

function isEligibleAggregateMatch(
  match: SoccerAggregateMatch
): match is EligibleSoccerAggregateMatch {
  return (
    match.game.status === 'final' &&
    match.game.cloudScope === 'team' &&
    typeof match.game.teamId === 'string' &&
    match.game.teamId.length > 0 &&
    isIsoDate(match.game.date)
  )
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function addTeamResult(
  target: SoccerAggregateTeamResult,
  source: SoccerAggregateTeamResult
): void {
  target.matches += source.matches
  target.wins += source.wins
  target.draws += source.draws
  target.losses += source.losses
  target.goalsFor += source.goalsFor
  target.goalsAgainst += source.goalsAgainst
  target.goalDifference = target.goalsFor - target.goalsAgainst
  target.cleanSheets += source.cleanSheets
}

function addForAgainst(
  target: SoccerAggregateForAgainst,
  source: SoccerAggregateForAgainst
): void {
  addForAgainstSide(target.tracked, source.tracked)
  addForAgainstSide(target.opponent, source.opponent)
}

function addForAgainstSide(
  target: SoccerAggregateForAgainstSide,
  source: SoccerAggregateForAgainstSide
): void {
  for (const key of Object.keys(target) as Array<keyof SoccerAggregateForAgainstSide>) {
    target[key] += source[key]
  }
}
