import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type { GameEvent } from '../gameEvents/types'
import { createInitialState } from '../gameReducer'
import { basketballPeriodScoring } from './summary'
import {
  BASKETBALL_CANONICAL_STAT_IDS,
  basketballCanonicalStatsFromTotals,
  hasBasketballBaseContribution,
  mergeBasketballMatchStats,
  type BasketballAggregateStats,
  type BasketballCanonicalStatId,
} from './aggregateStats'
import type { BasketballCanonicalSnapshot } from './finalization'
import { createBasketballSportGameState } from './state'
import type {
  BasketballMatchEvent,
  BasketballMatchProjection,
  BasketballProjectedParticipant,
  BasketballTeamSide,
} from './types'

export type BasketballAggregateScopeType =
  | 'team'
  | 'season'
  | 'tournament'
  | 'player'
  | 'career'

export interface BasketballAggregateScope {
  type: BasketballAggregateScopeType
  id: string | null
}

export interface BasketballAggregateSourceGame {
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

export interface BasketballCanonicalAggregateSource {
  authority: 'canonical'
  publicationId: string
  publicationNumber: number
  snapshotFingerprint: string
  finalizedAt: string
  active: boolean
  game: BasketballAggregateSourceGame
  canonicalSnapshot: BasketballCanonicalSnapshot
  participantSourceMap: Record<string, string>
  canManage: boolean
}

export interface BasketballAggregatePeriodScore {
  periodId: string
  label: string
  order: number
  kind: 'regulation' | 'overtime'
  tracked: number
  opponent: number
}

export interface BasketballAggregateMatchPlayer {
  playerId: string
  participantIds: string[]
  displayName: string
  number: string | null
  stats: BasketballAggregateStats
}

export interface BasketballAggregateUnresolvedParticipant {
  participantId: string
  localPlayerId: string | null
  displayName: string
  number: string | null
  reason: 'missing_mapping' | 'conflicting_mapping'
  stats: BasketballAggregateStats
  contributionCount: number
}

export interface BasketballAggregateMatch {
  authority: 'canonical' | 'legacy'
  sourceId: string
  sourceFingerprint: string
  sourceTimestamp: string
  canManage: boolean
  game: BasketballAggregateSourceGame
  eventCount: number
  players: BasketballAggregateMatchPlayer[]
  unresolvedParticipants: BasketballAggregateUnresolvedParticipant[]
  teamStats: {
    tracked: BasketballAggregateStats
    opponent: BasketballAggregateStats
  }
  score: { tracked: number; opponent: number }
  result: 'win' | 'draw' | 'loss'
  periods: BasketballAggregatePeriodScore[]
  availableMetricIds: BasketballCanonicalStatId[]
}

export type BasketballAggregateExclusionKind =
  | 'unresolved_participant'
  | 'malformed_source'
  | 'abandoned_game'
  | 'ineligible_source'
  | 'duplicate_source'
  | 'authority_collision'

export interface BasketballAggregateExclusion {
  kind: BasketballAggregateExclusionKind
  authority: 'canonical' | 'legacy'
  sourceId: string
  gameId: string
  gameDate: string
  message: string
  participantId?: string
  contributionCount?: number
  canManage: boolean
}

export type BasketballAggregateSourceProjection =
  | { ok: true; match: BasketballAggregateMatch }
  | { ok: false; exclusion: BasketballAggregateExclusion }

export function projectBasketballCanonicalAggregateSource(
  source: BasketballCanonicalAggregateSource
): BasketballAggregateSourceProjection {
  const exclude = (
    kind: Exclude<BasketballAggregateExclusionKind, 'unresolved_participant'>,
    message: string
  ): BasketballAggregateSourceProjection => ({
    ok: false,
    exclusion: sourceExclusion(source, kind, message),
  })

  if (
    !source.active ||
    source.game.status !== 'final' ||
    !isIsoDate(source.game.date) ||
    !isTimestamp(source.finalizedAt)
  ) {
    return exclude(
      'ineligible_source',
      'Only active final Basketball publications with valid dates can aggregate.'
    )
  }
  if (source.canonicalSnapshot.gameId !== source.game.id) {
    return exclude('malformed_source', 'Canonical snapshot game identity does not match.')
  }
  if (source.canonicalSnapshot.primaryRecorderId.trim().length === 0) {
    return exclude('malformed_source', 'Canonical snapshot recorder identity is invalid.')
  }

  try {
    const rebuilt = rebuildCanonicalSnapshot(source)
    const sportState = rebuilt.state.sportGameState
    if (!rebuilt.inspection.complete || sportState?.sportId !== 'basketball') {
      return exclude(
        'malformed_source',
        rebuilt.inspection.diagnostics[0]?.message ??
          'Canonical Basketball publication does not rebuild completely.'
      )
    }
    if (sportState.projection.endReason === 'abandoned') {
      return exclude('abandoned_game', 'Abandoned Basketball games do not enter aggregates.')
    }
    if (
      sportState.projection.status !== 'ended' ||
      sportState.projection.endReason !== 'completed'
    ) {
      return exclude(
        'malformed_source',
        'Canonical Basketball publication does not reproduce a completed game.'
      )
    }

    const players = new Map<string, BasketballAggregateMatchPlayer>()
    const unresolvedParticipants: BasketballAggregateUnresolvedParticipant[] = []
    for (const participant of Object.values(sportState.projection.participants)) {
      if (participant.teamSide !== 'tracked') continue
      const stats = participantAggregateStats(participant)
      const mapping = stablePlayerId(
        participant.participantId,
        participant.playerId,
        source.participantSourceMap
      )
      if (!mapping.playerId) {
        const contributionCount = nonZeroContributionCount(stats)
        if (contributionCount > 0) {
          unresolvedParticipants.push({
            participantId: participant.participantId,
            localPlayerId: participant.playerId,
            displayName: participant.displayName,
            number: participant.number,
            reason: mapping.reason,
            stats,
            contributionCount,
          })
        }
        continue
      }

      const next: BasketballAggregateMatchPlayer = {
        playerId: mapping.playerId,
        participantIds: [participant.participantId],
        displayName: participant.displayName,
        number: participant.number,
        stats,
      }
      const existing = players.get(mapping.playerId)
      players.set(mapping.playerId, existing ? mergeMatchPlayers(existing, next) : next)
    }

    const projection = sportState.projection
    const activeEvents = rebuilt.inspection.activeEvents.filter(
      (event): event is BasketballMatchEvent => event.sportId === 'basketball'
    )
    const scoreByPeriod = new Map(
      basketballPeriodScoring(projection, activeEvents)
        .map(period => [period.periodId, period])
    )
    return {
      ok: true,
      match: {
        authority: 'canonical',
        sourceId: source.publicationId,
        sourceFingerprint: source.snapshotFingerprint,
        sourceTimestamp: source.finalizedAt,
        canManage: source.canManage,
        game: structuredClone(source.game),
        eventCount: source.canonicalSnapshot.eventStream.events.length,
        players: [...players.values()].sort(compareMatchPlayers),
        unresolvedParticipants,
        teamStats: {
          tracked: teamAggregateStats(projection, 'tracked'),
          opponent: teamAggregateStats(projection, 'opponent'),
        },
        score: structuredClone(projection.score),
        result: projection.score.tracked > projection.score.opponent
          ? 'win'
          : projection.score.tracked < projection.score.opponent
            ? 'loss'
            : 'draw',
        periods: projection.periods.map(period => ({
          periodId: period.id,
          label: period.label,
          order: period.order,
          kind: period.kind,
          tracked: scoreByPeriod.get(period.id)?.tracked ?? 0,
          opponent: scoreByPeriod.get(period.id)?.opponent ?? 0,
        })),
        availableMetricIds: [...BASKETBALL_CANONICAL_STAT_IDS],
      },
    }
  } catch (error) {
    return exclude(
      'malformed_source',
      error instanceof Error ? error.message : 'Canonical Basketball publication is invalid.'
    )
  }
}

function rebuildCanonicalSnapshot(source: BasketballCanonicalAggregateSource) {
  const snapshot = source.canonicalSnapshot
  if (
    snapshot.sportId !== 'basketball' ||
    snapshot.version !== 2 ||
    snapshot.canonicalSchemaVersion !== 1 ||
    snapshot.sportGameState.sportId !== 'basketball' ||
    snapshot.sportGameState.version !== 1
  ) {
    throw new Error('Canonical Basketball snapshot version is unsupported.')
  }
  const allEvents = snapshot.eventStream.events as GameEvent[]
  if (allEvents.some(event => (
    event.sportId !== 'basketball' ||
    event.recorderUserId !== snapshot.primaryRecorderId
  ))) {
    throw new Error('Canonical Basketball events do not belong to the primary recorder.')
  }
  const candidate: GameState = {
    ...aggregateBaseState(source),
    gameDataAuthority: 'sport_events',
    eventStream: structuredClone(snapshot.eventStream),
    sportGameState: createBasketballSportGameState(snapshot.sportGameState.setup),
  }
  return rebuildGameEventProjection(candidate, gameEventRegistry, gameEventProjectors)
}

function aggregateBaseState(source: BasketballCanonicalAggregateSource): GameState {
  const initial = createInitialState()
  const basketball = sports.find(sport => sport.id === 'basketball')
  if (!basketball) throw new Error('Basketball configuration is unavailable.')
  return {
    ...initial,
    sport: basketball,
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

function snapshotPlayers(snapshot: BasketballCanonicalSnapshot): Player[] {
  return snapshot.sportGameState.setup.participants
    .filter(participant => participant.playerId !== null)
    .map(participant => ({
      id: participant.playerId as string,
      name: participant.displayName,
      number: participant.number ?? '',
      stats: {},
    }))
}

function participantAggregateStats(
  participant: BasketballProjectedParticipant
): BasketballAggregateStats {
  const qualifiesByActivity =
    hasBasketballBaseContribution(participant.stats) || participant.ejected
  const appeared = participant.openingStatus === 'starter' ||
    (participant.openingStatus === 'bench' && qualifiesByActivity)
  return basketballCanonicalStatsFromTotals(participant.stats, {
    appeared,
    started: participant.openingStatus === 'starter',
    disqualified: participant.disqualified,
    ejected: participant.ejected,
  })
}

function teamAggregateStats(
  projection: BasketballMatchProjection,
  side: BasketballTeamSide
): BasketballAggregateStats {
  const stats = basketballCanonicalStatsFromTotals(projection.sideStats[side], {
    appeared: false,
    started: false,
    disqualified: false,
    ejected: false,
  })
  stats.bk_dq = Object.values(projection.participants).filter(participant =>
    participant.teamSide === side && participant.disqualified
  ).length
  stats.bk_eject = projection.ejections.filter(ejection => ejection.teamSide === side).length
  return stats
}

function stablePlayerId(
  participantId: string,
  localPlayerId: string | null,
  sourceMap: Record<string, string>
): { playerId: string | null; reason: BasketballAggregateUnresolvedParticipant['reason'] } {
  const byParticipant = sourceMap[participantId]?.trim() || null
  const byPlayer = localPlayerId ? sourceMap[localPlayerId]?.trim() || null : null
  if (byParticipant && byPlayer && byParticipant !== byPlayer) {
    return { playerId: null, reason: 'conflicting_mapping' }
  }
  return { playerId: byParticipant ?? byPlayer, reason: 'missing_mapping' }
}

function mergeMatchPlayers(
  left: BasketballAggregateMatchPlayer,
  right: BasketballAggregateMatchPlayer
): BasketballAggregateMatchPlayer {
  const stats = structuredClone(left.stats)
  mergeBasketballMatchStats(stats, right.stats)
  return {
    ...left,
    participantIds: [...new Set([...left.participantIds, ...right.participantIds])].sort(),
    stats,
  }
}

function compareMatchPlayers(
  left: BasketballAggregateMatchPlayer,
  right: BasketballAggregateMatchPlayer
): number {
  return left.displayName.localeCompare(right.displayName) ||
    left.playerId.localeCompare(right.playerId)
}

function sourceExclusion(
  source: BasketballCanonicalAggregateSource,
  kind: Exclude<BasketballAggregateExclusionKind, 'unresolved_participant'>,
  message: string
): BasketballAggregateExclusion {
  return {
    kind,
    authority: 'canonical',
    sourceId: source.publicationId,
    gameId: source.game.id,
    gameDate: source.game.date,
    message,
    canManage: source.canManage,
  }
}

function nonZeroContributionCount(stats: BasketballAggregateStats): number {
  return Object.values(stats).filter(value => value !== 0).length
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isTimestamp(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value))
}
