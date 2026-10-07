import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { createInitialState } from '../gameReducer'
import {
  addHockeyAggregateStats,
  emptyHockeyAggregateStats,
  hockeyAggregateStatsFromLine,
  type HockeyAggregateCoverage,
  type HockeyAggregatePlayerLine,
  type HockeyAggregateRole,
  type HockeyAggregateStats,
} from './aggregateStats'
import { parseHockeyCanonicalSnapshot, type HockeyCanonicalSnapshot } from './finalization'
import { hockeySummaryFromState } from './summarySource'
import { createHockeySportGameState } from './state'
import type { HockeyDecidedIn, HockeyEvent, HockeyMatchProjection, HockeySide } from './types'

/**
 * Hockey season totals (HKY-6B2): each active canonical publication of a completed game is
 * rebuilt from its snapshot, replayed with the Summary's checks, and its tracked players are
 * mapped to stable cloud players through the publication's participant source map.
 */

export type HockeyAggregateScopeType = 'team' | 'season' | 'tournament' | 'player' | 'career'

export interface HockeyAggregateScope {
  type: HockeyAggregateScopeType
  id: string
}

export interface HockeyAggregateSourceGame {
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

/** One item of a 075 page, as the transport parsed it. */
export interface HockeyCanonicalAggregateSource {
  publicationId: string
  publicationNumber: number
  snapshotFingerprint: string
  finalizedAt: string
  game: HockeyAggregateSourceGame
  /** Raw; parsed and replayed by the projection. */
  canonicalSnapshot: unknown
  participantSourceMap: Record<string, string>
  canManage: boolean
}

export type HockeyAggregateOutcome = 'win' | 'loss' | 'otl' | 'tie'

export interface HockeyAggregateTeamTotals {
  goals: number
  shotsOnGoal: number
  powerPlayGoals: number
  shortHandedGoals: number
  faceoffsWon: number
  hits: number
  blockedShots: number
  takeaways: number
  giveaways: number
  penaltyMinutes: number
}

export interface HockeyAggregateMatchPlayer {
  playerId: string
  participantIds: string[]
  displayName: string
  number: string | null
  role: HockeyAggregateRole
  stats: HockeyAggregateStats
  plusMinusComplete: boolean
  /** Null for a skater or a clockless game. */
  timeInNet: { ms: number; complete: boolean; regulationMs: number } | null
}

export interface HockeyAggregateMatch {
  sourceId: string
  sourceFingerprint: string
  finalizedAt: string
  canManage: boolean
  game: HockeyAggregateSourceGame
  eventCount: number
  /** The published score: one goal for a shootout winner. */
  finalScore: { tracked: number; opponent: number }
  outcome: HockeyAggregateOutcome
  decidedIn: HockeyDecidedIn
  /** Every goal had a complete on-ice set, so plus/minus is complete for the game. */
  plusMinusComplete: boolean
  players: HockeyAggregateMatchPlayer[]
  unresolved: Array<{ participantId: string; displayName: string; contributionCount: number }>
  teamTotals: Record<HockeySide, HockeyAggregateTeamTotals>
}

export type HockeyAggregateExclusionKind =
  | 'malformed_source'
  | 'ineligible_source'
  | 'unresolved_participant'
  | 'duplicate_source'

export interface HockeyAggregateExclusion {
  kind: HockeyAggregateExclusionKind
  sourceId: string
  gameId: string
  gameDate: string
  message: string
  participantId?: string
  canManage: boolean
}

export type HockeyAggregateSourceProjection =
  | { ok: true; match: HockeyAggregateMatch }
  | { ok: false; exclusion: HockeyAggregateExclusion }

export function projectHockeyCanonicalAggregateSource(source: HockeyCanonicalAggregateSource): HockeyAggregateSourceProjection {
  const exclude = (kind: Exclude<HockeyAggregateExclusionKind, 'unresolved_participant'>, message: string): HockeyAggregateSourceProjection => ({
    ok: false,
    exclusion: { kind, sourceId: source.publicationId, gameId: source.game.id, gameDate: source.game.date, message, canManage: source.canManage },
  })
  if (source.game.status !== 'final' || !isIsoDate(source.game.date)) {
    return exclude('ineligible_source', 'Only final Hockey games with a valid date count toward season totals.')
  }

  let snapshot: HockeyCanonicalSnapshot
  try {
    snapshot = parseHockeyCanonicalSnapshot(source.canonicalSnapshot)
  } catch (error) {
    return exclude('malformed_source', error instanceof Error ? error.message : 'The published Hockey result is invalid.')
  }
  if (snapshot.gameId !== source.game.id) return exclude('malformed_source', 'The published Hockey result names another game.')
  const events = snapshot.eventStream.events as GameEvent[]
  if (events.some(event => event.sportId !== 'hockey' || event.recorderUserId !== snapshot.primaryRecorderId)) {
    return exclude('malformed_source', 'The published Hockey events do not all belong to its primary recorder.')
  }

  try {
    const summary = hockeySummaryFromState('canonical', aggregateState(source, snapshot), null, null)
    if (!summary.healthy || !summary.sport || !summary.lines) {
      return exclude('malformed_source', summary.diagnostic ?? 'The published Hockey result does not replay.')
    }
    const { setup, projection } = summary.sport
    // The same rule as 075: only a game that ended without an early-end reason counts.
    if (projection.status !== 'ended' || projection.statusReason !== null || !projection.result) {
      return exclude('ineligible_source', 'Only completed Hockey games count toward season totals.')
    }

    const lines = summary.lines
    const regulationMs = setup.rulesSnapshot.regulation.periods * setup.rulesSnapshot.regulation.periodLengthMs
    const players = new Map<string, HockeyAggregateMatchPlayer>()
    const unresolved: HockeyAggregateMatch['unresolved'] = []
    for (const participant of setup.participants) {
      const stats = hockeyAggregateStatsFromLine(lines.participants[participant.id])
      const playerId = stablePlayerId(participant.id, participant.playerId, source.participantSourceMap)
      if (!playerId) {
        const contributionCount = Object.entries(stats).filter(([id, value]) => id !== 'hky_gp' && value !== 0).length
        if (contributionCount > 0) unresolved.push({ participantId: participant.id, displayName: participant.displayName, contributionCount })
        continue
      }
      const time = lines.goalieTime?.[participant.id] ?? null
      const row: HockeyAggregateMatchPlayer = {
        playerId,
        participantIds: [participant.id],
        displayName: participant.displayName,
        number: participant.number,
        role: participant.dressedAs,
        stats,
        plusMinusComplete: lines.coverage.plusMinus === 'complete',
        timeInNet: participant.dressedAs === 'goalie' && lines.goalieTime && stats.hky_gp > 0
          ? { ms: time?.ms ?? 0, complete: time ? time.coverage === 'complete' : true, regulationMs }
          : null,
      }
      const existing = players.get(playerId)
      if (existing) {
        addHockeyAggregateStats(existing.stats, row.stats)
        existing.participantIds.push(participant.id)
      } else {
        players.set(playerId, row)
      }
    }

    const result = projection.result
    return {
      ok: true,
      match: {
        sourceId: source.publicationId,
        sourceFingerprint: source.snapshotFingerprint,
        finalizedAt: source.finalizedAt,
        canManage: source.canManage,
        game: structuredClone(source.game),
        eventCount: events.length,
        finalScore: { ...result.finalScore },
        outcome: result.outcome === 'loss' && result.decidedIn !== 'regulation' ? 'otl' : result.outcome,
        decidedIn: result.decidedIn,
        plusMinusComplete: lines.coverage.plusMinus === 'complete',
        players: [...players.values()].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.playerId.localeCompare(b.playerId)),
        unresolved,
        teamTotals: {
          tracked: teamTotals(projection, summary.inspection.activeEvents, 'tracked'),
          opponent: teamTotals(projection, summary.inspection.activeEvents, 'opponent'),
        },
      },
    }
  } catch (error) {
    return exclude('malformed_source', error instanceof Error ? error.message : 'The published Hockey result is invalid.')
  }
}

function aggregateState(source: HockeyCanonicalAggregateSource, snapshot: HockeyCanonicalSnapshot): GameState {
  const hockey = sports.find(sport => sport.id === 'hockey')
  if (!hockey) throw new Error('Hockey configuration is unavailable.')
  const setup = snapshot.sportGameState.setup
  const initial = createInitialState()
  return {
    ...initial,
    sport: hockey,
    gameInfo: {
      teamName: source.game.trackedTeamName,
      opponentName: source.game.opponentName,
      tournamentName: '',
      tournamentId: source.game.tournamentId,
      date: source.game.date,
    },
    players: setup.participants.map(participant => ({
      id: participant.playerId ?? participant.id,
      name: participant.displayName,
      number: participant.number ?? '',
      stats: {},
    })),
    gameDataAuthority: 'sport_events',
    eventStream: structuredClone(snapshot.eventStream),
    sportGameState: createHockeySportGameState(setup),
    cloudSync: { ...initial.cloudSync, gameId: snapshot.gameId, gameStatus: 'final' },
  }
}

function teamTotals(projection: HockeyMatchProjection, events: readonly GameEvent[], side: HockeySide): HockeyAggregateTeamTotals {
  let blockedShots = 0
  for (const event of events) {
    if (event.eventType !== 'hockey.shot') continue
    const shot = event as HockeyEvent<'hockey.shot'>
    if (shot.payload.outcome === 'blocked' && shot.teamSide !== side) blockedShots += 1
  }
  return {
    goals: projection.score[side],
    shotsOnGoal: projection.shotsOnGoal[side],
    powerPlayGoals: projection.goalsByStrength[side].pp,
    shortHandedGoals: projection.goalsByStrength[side].sh,
    faceoffsWon: side === 'tracked' ? projection.faceoffs.won : projection.faceoffs.lost,
    hits: projection.hits[side],
    blockedShots,
    takeaways: projection.takeaways[side],
    giveaways: projection.giveaways[side],
    penaltyMinutes: projection.penaltyTotals[side].pimMs / 60_000,
  }
}

function stablePlayerId(participantId: string, localPlayerId: string | null, map: Record<string, string>): string | null {
  const byParticipant = map[participantId]?.trim() || null
  const byPlayer = localPlayerId ? map[localPlayerId]?.trim() || null : null
  if (byParticipant && byPlayer && byParticipant !== byPlayer) return null
  return byParticipant ?? byPlayer
}

// ---------------------------------------------------------------------------
// Composition

export interface HockeyAggregateRosterPlayer {
  playerId: string
  displayName: string
  number: string | null
  teamId: string
  seasonId?: string | null
  tournamentId?: string | null
}

export interface HockeyAggregatePlayer extends HockeyAggregatePlayerLine {
  teamIds: string[]
  gameIds: string[]
}

export interface HockeyAggregateTeamRecord {
  games: number
  wins: number
  losses: number
  overtimeLosses: number
  ties: number
  goalsFor: number
  goalsAgainst: number
}

export interface HockeyAggregateTeam {
  teamId: string
  teamName: string
  record: HockeyAggregateTeamRecord
  totals: Record<HockeySide, HockeyAggregateTeamTotals>
}

export interface HockeyAggregateGame {
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
  outcome: HockeyAggregateOutcome
  decidedIn: HockeyDecidedIn
  /** The scoped player's line in this game (player and career scopes). */
  player: HockeyAggregateMatchPlayer | null
}

export interface HockeyAggregateResult {
  scope: HockeyAggregateScope
  quality: 'complete' | 'partial'
  includedGameCount: number
  players: HockeyAggregatePlayer[]
  teams: HockeyAggregateTeam[]
  games: HockeyAggregateGame[]
  exclusions: HockeyAggregateExclusion[]
  /** Games in scope whose every goal had a complete on-ice set. */
  plusMinus: HockeyAggregateCoverage
  metrics: {
    sourceCount: number
    eventCount: number
    unresolvedParticipantCount: number
    malformedSourceCount: number
  }
}

export function aggregateHockeyMatches(
  scope: HockeyAggregateScope,
  matches: readonly HockeyAggregateMatch[],
  initialExclusions: readonly HockeyAggregateExclusion[] = [],
  activeRoster: readonly HockeyAggregateRosterPlayer[] = [],
  sourceCount = matches.length + initialExclusions.length
): HockeyAggregateResult {
  const exclusions = [...initialExclusions]
  const byGame = new Map<string, HockeyAggregateMatch[]>()
  for (const match of matches) {
    if (!matchesScope(match, scope)) {
      exclusions.push(matchExclusion(match, 'ineligible_source', 'This Hockey game is not part of the requested scope.'))
      continue
    }
    byGame.set(match.game.id, [...(byGame.get(match.game.id) ?? []), match])
  }
  const included: HockeyAggregateMatch[] = []
  for (const group of byGame.values()) {
    if (group.every(match => match.sourceId === group[0].sourceId && match.sourceFingerprint === group[0].sourceFingerprint)) {
      included.push(group[0])
    } else {
      exclusions.push(matchExclusion(group[0], 'duplicate_source', 'Two published results disagree for the same Hockey game.'))
    }
  }
  included.sort((a, b) => b.game.date.localeCompare(a.game.date) || b.finalizedAt.localeCompare(a.finalizedAt) || a.sourceId.localeCompare(b.sourceId))

  const playerScope = scope.type === 'player' || scope.type === 'career'
  const players = new Map<string, HockeyAggregatePlayer>()
  const teams = new Map<string, HockeyAggregateTeam>()
  let plusMinusComplete = 0
  for (const match of included) {
    for (const entry of match.unresolved) {
      exclusions.push({
        ...matchExclusion(match, 'unresolved_participant', `${entry.displayName} has no stable cloud player identity.`),
        participantId: entry.participantId,
      })
    }
    if (match.plusMinusComplete) plusMinusComplete += 1
    for (const row of match.players) {
      if (playerScope && row.playerId !== scope.id) continue
      const player = players.get(row.playerId) ?? emptyHockeyAggregatePlayer(row.playerId, row.displayName, row.number)
      addHockeyMatchPlayer(player, row, match.game.id, match.game.teamId)
      players.set(row.playerId, player)
    }
    if (match.game.cloudScope === 'team' && match.game.teamId) {
      const team = teams.get(match.game.teamId) ?? emptyTeam(match.game.teamId, match.game.trackedTeamName)
      addTeamMatch(team, match)
      teams.set(match.game.teamId, team)
    }
  }

  for (const rosterPlayer of activeRoster) {
    if (!rosterInScope(rosterPlayer, scope)) continue
    const existing = players.get(rosterPlayer.playerId)
    if (existing) {
      existing.displayName = rosterPlayer.displayName
      existing.number = rosterPlayer.number
      if (!existing.teamIds.includes(rosterPlayer.teamId)) existing.teamIds.push(rosterPlayer.teamId)
      continue
    }
    const player = emptyHockeyAggregatePlayer(rosterPlayer.playerId, rosterPlayer.displayName, rosterPlayer.number)
    player.teamIds.push(rosterPlayer.teamId)
    players.set(rosterPlayer.playerId, player)
  }
  for (const player of players.values()) player.teamIds.sort()

  const harmful = exclusions.filter(exclusion => exclusion.kind !== 'ineligible_source')
  return {
    scope,
    quality: harmful.length > 0 ? 'partial' : 'complete',
    includedGameCount: included.length,
    players: [...players.values()].sort((a, b) =>
      (b.stats.hky_pts ?? 0) - (a.stats.hky_pts ?? 0) || a.displayName.localeCompare(b.displayName) || a.playerId.localeCompare(b.playerId)
    ),
    teams: [...teams.values()].sort((a, b) => a.teamName.localeCompare(b.teamName) || a.teamId.localeCompare(b.teamId)),
    games: included.map(match => gameRow(match, playerScope ? scope.id : null)),
    exclusions,
    plusMinus: { included: plusMinusComplete, total: included.length },
    metrics: {
      sourceCount,
      eventCount: included.reduce((sum, match) => sum + match.eventCount, 0),
      unresolvedParticipantCount: exclusions.filter(exclusion => exclusion.kind === 'unresolved_participant').length,
      malformedSourceCount: exclusions.filter(exclusion => exclusion.kind === 'malformed_source').length,
    },
  }
}

function matchesScope(match: HockeyAggregateMatch, scope: HockeyAggregateScope): boolean {
  if (match.game.status !== 'final' || !isIsoDate(match.game.date)) return false
  const team = match.game.cloudScope === 'team'
  switch (scope.type) {
    case 'team':
      return team && match.game.teamId === scope.id
    case 'season':
      return team && match.game.seasonId === scope.id
    case 'tournament':
      return team && match.game.tournamentId === scope.id
    default:
      return match.players.some(player => player.playerId === scope.id)
  }
}

function rosterInScope(player: HockeyAggregateRosterPlayer, scope: HockeyAggregateScope): boolean {
  if (scope.type === 'team') return player.teamId === scope.id
  if (scope.type === 'season') return player.seasonId === scope.id
  if (scope.type === 'tournament') return player.tournamentId === scope.id
  return false
}

/** Adds one game's line to a player's totals and coverage. */
export function addHockeyMatchPlayer(
  player: HockeyAggregatePlayer,
  row: HockeyAggregateMatchPlayer,
  gameId: string,
  teamId: string | null
): void {
  addHockeyAggregateStats(player.stats, row.stats)
  if (row.role === 'goalie') {
    if (row.stats.hky_gp > 0) {
      player.goalieGames += 1
      // A clockless game records no time in net, so it counts against GAA coverage.
      player.timeInNet.total += 1
      if (row.timeInNet?.complete) player.timeInNet.included += 1
      if (row.timeInNet && row.timeInNet.regulationMs > 0) player.regulationGamesInNet += row.timeInNet.ms / row.timeInNet.regulationMs
    }
  } else {
    player.skaterGames += 1
    player.plusMinus.total += 1
    if (row.plusMinusComplete) player.plusMinus.included += 1
  }
  // A dressed backup who never played and recorded nothing is not in the game's history.
  const played = row.role === 'skater' || Object.values(row.stats).some(value => value !== 0)
  if (played && !player.gameIds.includes(gameId)) player.gameIds.push(gameId)
  if (teamId && !player.teamIds.includes(teamId)) player.teamIds.push(teamId)
}

export function emptyHockeyAggregatePlayer(playerId: string, displayName: string, number: string | null): HockeyAggregatePlayer {
  return {
    playerId,
    displayName,
    number,
    teamIds: [],
    gameIds: [],
    skaterGames: 0,
    goalieGames: 0,
    stats: emptyHockeyAggregateStats(),
    plusMinus: { included: 0, total: 0 },
    timeInNet: { included: 0, total: 0 },
    regulationGamesInNet: 0,
  }
}

function emptyTotals(): HockeyAggregateTeamTotals {
  return { goals: 0, shotsOnGoal: 0, powerPlayGoals: 0, shortHandedGoals: 0, faceoffsWon: 0, hits: 0, blockedShots: 0, takeaways: 0, giveaways: 0, penaltyMinutes: 0 }
}

function emptyTeam(teamId: string, teamName: string): HockeyAggregateTeam {
  return {
    teamId,
    teamName,
    record: { games: 0, wins: 0, losses: 0, overtimeLosses: 0, ties: 0, goalsFor: 0, goalsAgainst: 0 },
    totals: { tracked: emptyTotals(), opponent: emptyTotals() },
  }
}

function addTeamMatch(team: HockeyAggregateTeam, match: HockeyAggregateMatch): void {
  const record = team.record
  record.games += 1
  if (match.outcome === 'win') record.wins += 1
  else if (match.outcome === 'loss') record.losses += 1
  else if (match.outcome === 'otl') record.overtimeLosses += 1
  else record.ties += 1
  record.goalsFor += match.finalScore.tracked
  record.goalsAgainst += match.finalScore.opponent
  for (const side of ['tracked', 'opponent'] as const) {
    const target = team.totals[side]
    const source = match.teamTotals[side]
    for (const key of Object.keys(target) as Array<keyof HockeyAggregateTeamTotals>) target[key] += source[key]
  }
}

function gameRow(match: HockeyAggregateMatch, playerId: string | null): HockeyAggregateGame {
  return {
    sourceId: match.sourceId,
    gameId: match.game.id,
    cloudScope: match.game.cloudScope,
    teamId: match.game.teamId,
    seasonId: match.game.seasonId,
    tournamentId: match.game.tournamentId,
    date: match.game.date,
    trackedTeamName: match.game.trackedTeamName,
    opponentName: match.game.opponentName,
    trackedScore: match.finalScore.tracked,
    opponentScore: match.finalScore.opponent,
    outcome: match.outcome,
    decidedIn: match.decidedIn,
    player: playerId ? structuredClone(match.players.find(player => player.playerId === playerId) ?? null) : null,
  }
}

function matchExclusion(match: HockeyAggregateMatch, kind: HockeyAggregateExclusionKind, message: string): HockeyAggregateExclusion {
  return { kind, sourceId: match.sourceId, gameId: match.game.id, gameDate: match.game.date, message, canManage: match.canManage }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
