import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { createSoccerCanonicalSnapshot } from './finalization'
import { prepareSoccerKickoff } from './kickoff'
import {
  endSoccerPeriod,
  endSoccerMatch,
  inspectSoccerHistory,
  recordSoccerScoreAdjustment,
  recordSoccerShot,
  recordSoccerShootoutKick,
  recordSoccerSubstitution,
  startSoccerShootout,
} from './live'
import type {
  SoccerRecorderProjection,
  SoccerRecorderSummary,
} from './recorders'
import { resolveSoccerMatchRules } from './rules'
import { createSoccerSportGameState } from './state'
import type { SoccerMatchSetup } from './types'
import {
  aggregateSoccerCanonicalSources,
  aggregateSoccerMatches,
  projectSoccerCanonicalAggregateSource,
  type SoccerCanonicalAggregateSource,
} from './aggregateProjection'

const kickoffAt = Date.parse('2026-07-20T12:00:00.000Z')
const recorderId = 'recorder-1'

function setup(): SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSnapshot: resolveSoccerMatchRules({
      gameOverrides: {
        maxOnFieldPlayers: 2,
        regulationSegments: [{
          id: 'regulation-1',
          label: 'Test Period',
          kind: 'regulation',
          order: 1,
          durationMs: 60_000,
        }],
        extraTimeSegments: [],
      },
    }),
    participants: [
      participant('keeper-a', 'keeper-local-a', 'Alex Keeper', '1', 'starter', 'goalkeeper'),
      participant('striker', 'striker-local', 'Sam Striker', '9', 'starter', 'forward'),
      participant('keeper-b', 'keeper-local-b', 'Blake Keeper', '12', 'bench', 'goalkeeper'),
      participant('unused', 'unused-local', 'Casey Reserve', '18', 'bench', 'forward'),
    ],
  }
}

function participant(
  id: string,
  playerId: string,
  displayName: string,
  number: string,
  initialStatus: 'starter' | 'bench',
  role: 'goalkeeper' | 'forward'
) {
  return {
    id,
    kind: 'player' as const,
    playerId,
    displayName,
    number,
    initialStatus,
    initialRole: { group: role, label: null },
  }
}

function initialState(matchSetup = setup()): GameState {
  return {
    ...createInitialState(),
    sport: sports.find(sport => sport.id === 'soccer')!,
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: 'tournament-1',
      date: '2026-07-20',
    },
    players: matchSetup.participants.map(item => ({
      id: item.playerId!,
      name: item.displayName,
      number: item.number ?? '',
      stats: {},
    })),
    sportGameState: createSoccerSportGameState(matchSetup),
  }
}

function endedProjection(reason: 'completed' | 'abandoned' = 'completed'): SoccerRecorderProjection {
  const matchSetup = setup()
  const kickoff = prepareSoccerKickoff(initialState(), matchSetup, {
    recorderUserId: recorderId,
    occurredAt: new Date(kickoffAt).toISOString(),
    eventIds: [uuid(1), uuid(2), uuid(3)],
  })
  if (!kickoff.ok) throw new Error(kickoff.message)

  const goal = recordSoccerShot(kickoff.state, {
    teamSide: 'tracked',
    outcome: 'goal',
    situation: 'open_play',
    location: null,
    shooter: { kind: 'participant', participantId: 'striker' },
    primaryCreator: { kind: 'participant', participantId: 'keeper-a' },
  }, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 10_000,
    eventIds: [uuid(4)],
  })
  if (!goal.ok) throw new Error(goal.message)

  const saved = recordSoccerShot(goal.state, {
    teamSide: 'opponent',
    outcome: 'saved',
    situation: 'open_play',
    location: null,
    shooter: { kind: 'unknown', label: 'Opponent' },
    goalkeeper: { kind: 'participant', participantId: 'keeper-a' },
  }, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 20_000,
    eventIds: [uuid(5)],
  })
  if (!saved.ok) throw new Error(saved.message)

  const adjusted = recordSoccerScoreAdjustment(saved.state, {
    teamSide: 'tracked',
    delta: 1,
    reason: 'Official score correction',
  }, {
    period: { id: 'regulation-1', order: 1 },
    elapsedMs: 25_000,
  }, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 25_000,
    eventIds: [uuid(6)],
  })
  if (!adjusted.ok) throw new Error(adjusted.message)

  const substituted = recordSoccerSubstitution(adjusted.state, [{
    playerOutParticipantId: 'keeper-a',
    playerInParticipantId: 'keeper-b',
    playerInRole: { group: 'goalkeeper', label: null },
  }], false, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 30_000,
    eventIds: [uuid(7)],
  })
  if (!substituted.ok) throw new Error(substituted.message)

  const readyToEnd = reason === 'completed'
    ? endSoccerPeriod(substituted.state, {
        recorderUserId: recorderId,
        nowMs: kickoffAt + 60_000,
        eventIds: [uuid(8), uuid(9)],
      })
    : { ok: true as const, state: substituted.state }
  if (!readyToEnd.ok) throw new Error(readyToEnd.message)

  const ended = endSoccerMatch(readyToEnd.state, reason, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 60_000,
    eventIds: reason === 'completed' ? [uuid(10)] : [uuid(8), uuid(9)],
  })
  if (!ended.ok) throw new Error(ended.message)
  return recorderProjection(ended.state)
}

function shootoutProjection(): SoccerRecorderProjection {
  const matchSetup = setup()
  matchSetup.rulesSnapshot = resolveSoccerMatchRules({
    gameOverrides: {
      maxOnFieldPlayers: 2,
      regulationSegments: [{
        id: 'regulation-1',
        label: 'Test Period',
        kind: 'regulation',
        order: 1,
        durationMs: 60_000,
      }],
      extraTimeSegments: [],
      tieResolution: 'direct_to_shootout',
      shootoutInitialKicksPerSide: 1,
    },
  })
  const kickoff = prepareSoccerKickoff(initialState(matchSetup), matchSetup, {
    recorderUserId: recorderId,
    occurredAt: new Date(kickoffAt).toISOString(),
    eventIds: [uuid(20), uuid(21), uuid(22)],
  })
  if (!kickoff.ok) throw new Error(kickoff.message)
  const periodEnded = endSoccerPeriod(kickoff.state, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 60_000,
    eventIds: [uuid(23), uuid(24)],
  })
  if (!periodEnded.ok) throw new Error(periodEnded.message)
  const shootout = startSoccerShootout(periodEnded.state, {
    firstKickingSide: 'tracked',
    trackedEligibleParticipantIds: ['keeper-a', 'striker'],
    trackedExcludedParticipantIds: [],
    opponentEligibleCount: 2,
    trackedGoalkeeperParticipantId: 'keeper-a',
    opponentGoalkeeperLabel: 'Opponent Keeper',
  }, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 70_000,
    eventIds: [uuid(25)],
  })
  if (!shootout.ok) throw new Error(shootout.message)
  const trackedKick = recordSoccerShootoutKick(shootout.state, {
    outcome: 'scored',
    kicker: { kind: 'participant', participantId: 'striker' },
    goalkeeper: { kind: 'unknown', label: 'Opponent Keeper' },
    anonymousKickerSlot: null,
  }, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 80_000,
    eventIds: [uuid(26)],
  })
  if (!trackedKick.ok) throw new Error(trackedKick.message)
  const opponentKick = recordSoccerShootoutKick(trackedKick.state, {
    outcome: 'missed',
    kicker: { kind: 'unknown', label: 'Unknown' },
    goalkeeper: { kind: 'participant', participantId: 'keeper-a' },
    anonymousKickerSlot: 1,
  }, {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 90_000,
    eventIds: [uuid(27)],
  })
  if (!opponentKick.ok) throw new Error(opponentKick.message)
  const ended = endSoccerMatch(opponentKick.state, 'completed', {
    recorderUserId: recorderId,
    nowMs: kickoffAt + 100_000,
    eventIds: [uuid(28)],
  })
  if (!ended.ok) throw new Error(ended.message)
  return recorderProjection(ended.state)
}

function recorderProjection(state: GameState): SoccerRecorderProjection {
  const recorder: SoccerRecorderSummary = {
    recorderId,
    displayName: 'Recorder',
    eventCount: state.eventStream!.events.length,
    checkpointEventCount: state.eventStream!.events.length,
    checkpointSyncedAt: '2026-07-20T12:01:00.000Z',
    checkpointCurrent: true,
    unresolvedConflictCount: 0,
    isPrimary: true,
    primarySource: 'selected',
    canSelectPrimary: true,
  }
  return {
    recorder,
    state,
    eventStream: state.eventStream!,
    inspection: inspectSoccerHistory(state),
  }
}

function source(
  publicationId = 'publication-1',
  gameId = 'game-1',
  reason: 'completed' | 'abandoned' = 'completed',
  projection = endedProjection(reason)
): SoccerCanonicalAggregateSource {
  return {
    publicationId,
    publicationNumber: 1,
    snapshotFingerprint: `fingerprint-${publicationId}`,
    finalizedAt: '2026-07-20T12:02:00.000Z',
    game: {
      id: gameId,
      date: '2026-07-20',
      status: 'final',
      cloudScope: 'team',
      teamId: 'team-1',
      seasonId: 'season-1',
      tournamentId: 'tournament-1',
      trackedTeamName: 'Aces',
      opponentName: 'Bears',
    },
    canonicalSnapshot: createSoccerCanonicalSnapshot(
      gameId,
      recorderId,
      projection
    ),
    participantSourceMap: {
      'keeper-a': 'cloud-keeper-a',
      'keeper-b': 'cloud-keeper-b',
      striker: 'cloud-striker',
      unused: 'cloud-unused-match',
    },
    canManage: true,
  }
}

describe('soccer canonical aggregate projection', () => {
  it('rebuilds a completed source and derives adjusted results and shared clean sheets', () => {
    const fixture = endedProjection()
    const result = projectSoccerCanonicalAggregateSource(
      source('publication-1', 'game-1', 'completed', fixture)
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.match.teamResult).toEqual({
      matches: 1,
      wins: 1,
      draws: 0,
      losses: 0,
      goalsFor: 2,
      goalsAgainst: 0,
      goalDifference: 2,
      cleanSheets: 1,
    })
    const striker = result.match.players.find(player => player.playerId === 'cloud-striker')!
    expect(striker.stats).toMatchObject({
      soc_app: 1,
      soc_start: 1,
      soc_goal: 1,
      soc_shot: 1,
      soc_sot: 1,
    })
    const projectedStriker = fixture.state.players
      .find(player => player.id === 'striker-local')?.stats
    expect(withoutCleanSheet(striker.stats)).toEqual(projectedStriker)
    expect(projectedStriker).not.toHaveProperty('soc_cs')
    expect(
      result.match.players.reduce((sum, player) => sum + player.stats.soc_goal, 0)
    ).toBe(1)
    const keeper = result.match.players
      .find(player => player.playerId === 'cloud-keeper-a')!
    expect(keeper.stats).toMatchObject({
        soc_ast: 1,
        soc_ast_primary: 1,
        soc_gk_save: 1,
        soc_cs: 1,
        soc_min_sec: 30,
      })
    const projectedKeeper = fixture.state.players
      .find(player => player.id === 'keeper-local-a')?.stats
    expect(withoutCleanSheet(keeper.stats)).toEqual(projectedKeeper)
    expect(projectedKeeper).not.toHaveProperty('soc_cs')
    expect(result.match.players.find(player => player.playerId === 'cloud-keeper-b')?.stats)
      .toMatchObject({
        soc_app: 1,
        soc_start: 0,
        soc_cs: 1,
        soc_min_sec: 30,
      })
    expect(result.match.players.find(player => player.playerId === 'cloud-unused-match')?.stats)
      .toMatchObject({
        soc_app: 0,
        soc_start: 0,
        soc_min_sec: 0,
      })
  })

  it('excludes abandoned sources and marks malformed canonical snapshots', () => {
    const abandoned = projectSoccerCanonicalAggregateSource(
      source('publication-abandoned', 'game-abandoned', 'abandoned')
    )
    expect(abandoned).toMatchObject({
      ok: false,
      exclusion: { kind: 'abandoned_match' },
    })

    const malformed = source('publication-bad', 'game-bad')
    const ended = malformed.canonicalSnapshot.eventStream.events.find(event =>
      typeof event === 'object' &&
      event !== null &&
      'eventType' in event &&
      event.eventType === 'soccer.match_ended'
    )
    if (!ended || typeof ended !== 'object' || !('payload' in ended)) {
      throw new Error('Missing match end')
    }
    ended.payload = { reason: 'suspended' }
    expect(projectSoccerCanonicalAggregateSource(malformed)).toMatchObject({
      ok: false,
      exclusion: { kind: 'malformed_publication' },
    })
  })

  it('combines raw totals before rates and follows current merged-player identity', () => {
    const first = source('publication-1', 'game-1')
    const second = source('publication-2', 'game-2')
    second.game.date = '2026-07-21'
    second.canonicalSnapshot.gameId = 'game-2'
    second.participantSourceMap.striker = 'cloud-striker'

    const result = aggregateSoccerCanonicalSources(
      { type: 'season', id: 'season-1' },
      [first, second],
      [{
        playerId: 'cloud-unused',
        displayName: 'Unused Player',
        number: '22',
        teamId: 'team-1',
      }]
    )

    const striker = result.players.find(player => player.playerId === 'cloud-striker')!
    expect(striker.stats).toMatchObject({
      soc_app: 2,
      soc_goal: 2,
      soc_shot: 2,
      soc_sot: 2,
    })
    expect(striker.rates.shot_accuracy).toMatchObject({
      numerator: 2,
      denominator: 2,
      value: 1,
    })
    expect(result.players.find(player => player.playerId === 'cloud-unused')?.stats.soc_app)
      .toBe(0)
    expect(result.teams[0].result).toMatchObject({
      matches: 2,
      wins: 2,
      goalsFor: 4,
      goalsAgainst: 0,
      cleanSheets: 2,
    })
    expect(result.games.map(game => game.gameId)).toEqual(['game-2', 'game-1'])
    expect(result.games[0]).not.toHaveProperty('playerStats')

    const playerResult = aggregateSoccerCanonicalSources(
      { type: 'career', id: 'cloud-striker' },
      [first, second]
    )
    expect(playerResult.games[0]).toMatchObject({
      seasonId: 'season-1',
      tournamentId: 'tournament-1',
      playerStats: {
        'cloud-striker': {
          soc_app: 1,
          soc_goal: 1,
        },
      },
    })
    expect(Object.keys(playerResult.games[0].playerStats ?? {}))
      .toEqual(['cloud-striker'])
    expect(result.quality).toBe('complete')
  })

  it('keeps unresolved participant instances separate and reports partial quality', () => {
    const first = source('publication-1', 'game-1')
    const second = source('publication-2', 'game-2')
    second.game.date = '2026-07-21'
    second.canonicalSnapshot.gameId = 'game-2'
    delete first.participantSourceMap.striker
    delete second.participantSourceMap.striker

    const result = aggregateSoccerCanonicalSources(
      { type: 'season', id: 'season-1' },
      [first, second]
    )

    expect(result.players.some(player => player.displayName === 'Sam Striker')).toBe(false)
    expect(result.exclusions.filter(item =>
      item.kind === 'unresolved_participant' &&
      item.participantId === 'striker'
    )).toHaveLength(2)
    expect(result.metrics.unresolvedParticipantCount).toBe(2)
    expect(result.metrics.excludedContributionCount).toBeGreaterThan(0)
    expect(result.quality).toBe('partial')
  })

  it('keeps shootout attempts out of normal player and team stat totals', () => {
    const shootout = source('publication-shootout', 'game-shootout')
    const projection = shootoutProjection()
    shootout.canonicalSnapshot = createSoccerCanonicalSnapshot(
      shootout.game.id,
      recorderId,
      projection
    )

    const result = projectSoccerCanonicalAggregateSource(shootout)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.match.teamResult).toMatchObject({
      matches: 1,
      draws: 1,
      goalsFor: 0,
      goalsAgainst: 0,
    })
    expect(result.match.players.find(player => player.playerId === 'cloud-striker')?.stats)
      .toMatchObject({
        soc_goal: 0,
        soc_shot: 0,
        soc_sot: 0,
      })
    expect(result.match.players.find(player => player.playerId === 'cloud-keeper-a')?.stats)
      .toMatchObject({
        soc_gk_save: 0,
        soc_gk_pen_faced: 0,
        soc_gk_pen_save: 0,
      })
  })

  it('fails visibly for ineligible source metadata at both engine entry points', () => {
    const invalidSource = source('publication-ineligible', 'game-ineligible')
    invalidSource.game.date = '2026-02-30'
    const sourceResult = aggregateSoccerCanonicalSources(
      { type: 'team', id: 'team-1' },
      [invalidSource]
    )
    expect(sourceResult).toMatchObject({
      quality: 'partial',
      includedMatchCount: 0,
      exclusions: [expect.objectContaining({ kind: 'ineligible_source' })],
    })

    const projected = projectSoccerCanonicalAggregateSource(source())
    expect(projected.ok).toBe(true)
    if (!projected.ok) return
    const directResult = aggregateSoccerMatches(
      { type: 'team', id: 'team-1' },
      [{
        ...projected.match,
        game: { ...projected.match.game, teamId: null },
      }]
    )
    expect(directResult).toMatchObject({
      quality: 'partial',
      includedMatchCount: 0,
      players: [],
      teams: [],
      games: [],
      exclusions: [expect.objectContaining({ kind: 'ineligible_source' })],
    })
    expect(directResult.metrics.eventCount).toBe(0)
  })

  it('deduplicates identical publication ids and fails visibly on conflicting content', () => {
    const first = source('publication-1', 'game-1')
    const duplicate = structuredClone(first)
    const conflict = structuredClone(first)
    conflict.snapshotFingerprint = 'different'

    const duplicateResult = aggregateSoccerCanonicalSources(
      { type: 'team', id: 'team-1' },
      [first, duplicate]
    )
    expect(duplicateResult.includedMatchCount).toBe(1)
    expect(duplicateResult.quality).toBe('complete')

    const conflictResult = aggregateSoccerCanonicalSources(
      { type: 'team', id: 'team-1' },
      [first, conflict]
    )
    expect(conflictResult.includedMatchCount).toBe(0)
    expect(conflictResult.exclusions).toContainEqual(expect.objectContaining({
      kind: 'duplicate_publication',
    }))
    expect(conflictResult.quality).toBe('partial')
  })
})

function uuid(index: number): string {
  return `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function withoutCleanSheet(stats: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(stats).filter(([id]) => id !== 'soc_cs')
  )
}
