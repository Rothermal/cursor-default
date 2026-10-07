import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import {
  aggregateHockeyMatches,
  emptyHockeyAggregatePlayer,
  projectHockeyCanonicalAggregateSource,
  type HockeyAggregateMatch,
  type HockeyCanonicalAggregateSource,
} from './aggregateProjection'
import {
  HOCKEY_AGGREGATE_CATEGORIES,
  formatHockeyAggregateMetric,
  hockeyAggregateMetricValue,
  hockeyAggregateRankingMetrics,
  rankHockeyAggregatePlayers,
} from './aggregateStats'
import { loadHockeyAggregates, type HockeyAggregateRpcClient } from './aggregateTransport'
import {
  hockeyPlayerCareerSegments,
  hockeyPlayerProfileBreakdown,
  selectHockeyAggregatePlayer,
  visibleHockeyPlayerCategories,
} from './aggregatePlayerDestinations'
import { hockeyAggregateErrorCopy, hockeyAggregateOutcomeLabel, hockeyAggregateQualityMessage, hockeyGameLineText } from './aggregateDestinations'
import { changeHockeyGoalie, recordHockeyFaceoff, recordHockeyPenalties, recordHockeyShot, startHockeyShootout, recordHockeyShootoutAttempt } from './captureCommands'
import { endHockeyMatch, endHockeyPeriod, pauseHockeyClock, startHockeyClock, startHockeyGame, startNextHockeyPeriod } from './live'
import { CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyMatchSetup } from './types'

const RECORDER = 'recorder-1'
const TEAM = 'team-1'
const SEASON = 'season-1'
/** Setup participant p<n> plays as cloud player sp<n>. */
const SOURCE_MAP = Object.fromEntries([1, 2, 3, 4, 5, 6, 30].map(n => [`p${n}`, `sp${n}`]))

function clockless(): GameState {
  return expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
}

function finishClockless(state: GameState, reason: string | null = null, seconds = 500): GameState {
  let next = state
  for (let period = 1; period <= 3; period++) {
    if (period > 1) next = expectOk(startNextHockeyPeriod(next, ctx(seconds++)))
    next = expectOk(endHockeyPeriod(next, {}, ctx(seconds++)))
  }
  return expectOk(endHockeyMatch(next, { reason }, ctx(seconds)))
}

function shot(state: GameState, input: Parameters<typeof recordHockeyShot>[1], seconds: number): GameState {
  return expectOk(recordHockeyShot(state, input, ctx(seconds)))
}

/** 2-1 win: p2 scores twice (p3 assists the first), p1 in net; the opponent scores on p1. */
function winGame(): GameState {
  let state = clockless()
  state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' }, assists: [{ participantId: 'p3' }] }, 1)
  state = shot(state, { side: 'opponent', outcome: 'saved' }, 2)
  state = shot(state, { side: 'opponent', outcome: 'goal', shooter: { label: '#9' } }, 3)
  state = shot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p4' } }, 4)
  state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' } }, 5)
  state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked', takerParticipantId: 'p2', opponentTakerLabel: null }, ctx(6)))
  state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'opponent', takerParticipantId: 'p2', opponentTakerLabel: null }, ctx(7)))
  state = expectOk(recordHockeyPenalties(state, {
    penalties: [{ side: 'tracked', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { participantId: 'p3' } }],
  }, ctx(8)))
  return finishClockless(state)
}

/** 1-1 after overtime, lost in a shootout; p30 starts in net. */
function shootoutLoss(): GameState {
  const setup = hockeySetup({ profile: 'nhl_regular', rules: CLOCKLESS })
  setup.openingLineup.goalieParticipantId = 'p30'
  let state = expectOk(startHockeyGame(initializedHockeyGame(setup), ctx(0)))
  state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p4' } }, 1)
  state = shot(state, { side: 'opponent', outcome: 'goal', shooter: { label: '#9' } }, 2)
  let seconds = 10
  for (let period = 1; period <= 3; period++) {
    if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(seconds++)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(seconds++)))
  }
  if (projection(state).nextPeriod) {
    state = expectOk(startNextHockeyPeriod(state, ctx(seconds++)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(seconds++)))
  }
  state = expectOk(startHockeyShootout(state, { firstSide: 'tracked' }, ctx(seconds++)))
  const rounds = setup.rulesSnapshot.shootout?.rounds ?? 3
  for (let round = 1; round <= rounds && !projection(state).shootout?.winner; round++) {
    state = expectOk(recordHockeyShootoutAttempt(state, { outcome: 'saved', shooter: round === 1 ? { participantId: 'p2' } : null }, ctx(seconds++)))
    if (projection(state).shootout?.winner) break
    state = expectOk(recordHockeyShootoutAttempt(state, { outcome: 'goal', shooter: { label: '#9' } }, ctx(seconds++)))
  }
  return expectOk(endHockeyMatch(state, {}, ctx(seconds)))
}

/** An anchored game run to full length: p1 for period 1, p30 after; an empty-net minute is nobody's. */
function anchoredGame(): GameState {
  let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0)))
  const setup = (state.sportGameState as { setup: HockeyMatchSetup }).setup
  const length = setup.rulesSnapshot.regulation.periodLengthMs / 1000
  let t = 1
  for (let period = 1; period <= setup.rulesSnapshot.regulation.periods; period++) {
    if (period > 1) state = expectOk(startNextHockeyPeriod(state, ctx(t++)))
    if (period === 2) state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30', reason: 'tactical' }, ctx(t++)))
    state = expectOk(startHockeyClock(state, ctx(t)))
    if (period === 1) state = shot(state, { side: 'opponent', outcome: 'goal', shooter: { label: '#9' } }, t + 30)
    if (period === 3) state = shot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' } }, t + 60)
    t += length
    if (projection(state).clock?.running) state = expectOk(pauseHockeyClock(state, ctx(t)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(++t)))
    t += 1
  }
  if (projection(state).nextPeriod?.kind === 'overtime') {
    state = expectOk(startNextHockeyPeriod(state, ctx(t++)))
    state = expectOk(endHockeyPeriod(state, {}, ctx(t++)))
  }
  return expectOk(endHockeyMatch(state, {}, ctx(t)))
}

function source(state: GameState, gameId: string, overrides: Partial<HockeyCanonicalAggregateSource> = {}, game: Partial<HockeyCanonicalAggregateSource['game']> = {}): HockeyCanonicalAggregateSource {
  const setup = (state.sportGameState as { setup: HockeyMatchSetup }).setup
  return {
    publicationId: `pub-${gameId}`,
    publicationNumber: 1,
    snapshotFingerprint: `fp-${gameId}`,
    finalizedAt: '2026-10-06T00:00:00Z',
    game: {
      id: gameId,
      date: '2026-10-01',
      status: 'final',
      cloudScope: 'team',
      teamId: TEAM,
      seasonId: SEASON,
      tournamentId: null,
      trackedTeamName: 'Blades',
      opponentName: 'Rivals',
      ...game,
    },
    canonicalSnapshot: {
      version: 2,
      canonicalSchemaVersion: 1,
      sportId: 'hockey',
      gameId,
      primaryRecorderId: RECORDER,
      eventStream: {
        ...structuredClone(state.eventStream as NonNullable<GameState['eventStream']>),
        events: state.eventStream!.events.map(event => ({ ...(structuredClone(event) as object), recorderUserId: RECORDER })),
      },
      sportGameState: { sportId: 'hockey', version: 1, setup: structuredClone(setup) },
    },
    participantSourceMap: SOURCE_MAP,
    canManage: false,
    ...overrides,
  }
}

function match(state: GameState, gameId: string, game: Partial<HockeyCanonicalAggregateSource['game']> = {}): HockeyAggregateMatch {
  const projected = projectHockeyCanonicalAggregateSource(source(state, gameId, {}, game))
  if (!projected.ok) throw new Error(projected.exclusion.message)
  return projected.match
}

describe('Hockey aggregate projection (HKY-6B2)', () => {
  it('replays a publication and maps tracked participants to stable players', () => {
    const win = match(winGame(), 'g1')
    expect(win).toMatchObject({ outcome: 'win', decidedIn: 'regulation', finalScore: { tracked: 2, opponent: 1 }, plusMinusComplete: false })
    const p2 = win.players.find(player => player.playerId === 'sp2')!
    expect(p2).toMatchObject({ role: 'skater', participantIds: ['p2'], timeInNet: null })
    expect(p2.stats).toMatchObject({ hky_g: 2, hky_pts: 2, hky_gp: 1, hky_fow: 1, hky_fol: 1, hky_gwg: 1 })
    expect(win.players.find(player => player.playerId === 'sp3')!.stats).toMatchObject({ hky_a: 1, hky_pen: 1, hky_pim: 2 })
    expect(win.players.find(player => player.playerId === 'sp1')!.stats).toMatchObject({ hky_gp: 1, hky_gs: 1, hky_w: 1, hky_sa: 2, hky_sv: 1, hky_ga: 1 })
    expect(win.teamTotals.tracked).toMatchObject({ goals: 2, shotsOnGoal: 3, faceoffsWon: 1, penaltyMinutes: 2 })
    expect(win.teamTotals.opponent).toMatchObject({ goals: 1, shotsOnGoal: 2, faceoffsWon: 1 })
  })

  it('counts a shootout loss as an overtime loss with the published score, and never sums shootout lines', () => {
    const loss = match(shootoutLoss(), 'g2')
    expect(loss).toMatchObject({ outcome: 'otl', decidedIn: 'shootout' })
    expect(loss.finalScore.opponent).toBe(loss.finalScore.tracked + 1)
    const goalie = loss.players.find(player => player.playerId === 'sp30')!
    expect(goalie.stats).toMatchObject({ hky_gs: 1, hky_otl: 1, hky_ga: 1 })
    expect(Object.keys(goalie.stats).some(id => id.startsWith('hky_so_'))).toBe(false)
    expect(loss.players.find(player => player.playerId === 'sp2')!.stats.hky_g).toBe(0)
  })

  it('excludes games ended early, abandoned or not final, and malformed or foreign publications', () => {
    const early = projectHockeyCanonicalAggregateSource(source(finishClockless(clockless(), 'Ice time ran out'), 'g3'))
    expect(early).toMatchObject({ ok: false, exclusion: { kind: 'ineligible_source' } })
    const notFinal = projectHockeyCanonicalAggregateSource(source(winGame(), 'g4', {}, { status: 'in_progress' }))
    expect(notFinal).toMatchObject({ ok: false, exclusion: { kind: 'ineligible_source' } })
    const broken = projectHockeyCanonicalAggregateSource(source(winGame(), 'g5', { canonicalSnapshot: { sportId: 'hockey' } }))
    expect(broken).toMatchObject({ ok: false, exclusion: { kind: 'malformed_source' } })
    const wrongGame = projectHockeyCanonicalAggregateSource(source(winGame(), 'g6', {}, { id: 'other' }))
    expect(wrongGame).toMatchObject({ ok: false, exclusion: { kind: 'malformed_source', message: expect.stringMatching(/another game/) } })
    const foreign = source(winGame(), 'g7')
    ;(foreign.canonicalSnapshot as { eventStream: { events: Array<{ recorderUserId: string }> } }).eventStream.events[1].recorderUserId = 'someone-else'
    expect(projectHockeyCanonicalAggregateSource(foreign)).toMatchObject({ ok: false, exclusion: { kind: 'malformed_source' } })
  })

  it('records time in net with each game\'s regulation length for GAA', () => {
    const game = match(anchoredGame(), 'g8')
    const p1 = game.players.find(player => player.playerId === 'sp1')!
    const p30 = game.players.find(player => player.playerId === 'sp30')!
    expect(p1.timeInNet?.complete).toBe(true)
    expect(p30.timeInNet?.complete).toBe(true)
    expect(p1.timeInNet!.ms + p30.timeInNet!.ms).toBe(p1.timeInNet!.regulationMs)
  })
})

describe('Hockey aggregate composition (HKY-6B2)', () => {
  const scope = { type: 'team' as const, id: TEAM }

  it('sums lines, keeps goalies to their games, and adds the team record', () => {
    const result = aggregateHockeyMatches(scope, [match(winGame(), 'g1'), match(shootoutLoss(), 'g2', { date: '2026-10-02' })])
    expect(result).toMatchObject({ includedGameCount: 2, quality: 'complete', plusMinus: { included: 0, total: 2 } })
    expect(result.games.map(game => game.gameId)).toEqual(['g2', 'g1'])
    expect(result.teams[0].record).toEqual({ games: 2, wins: 1, losses: 0, overtimeLosses: 1, ties: 0, goalsFor: 3, goalsAgainst: 3 })
    const p2 = result.players.find(player => player.playerId === 'sp2')!
    expect(p2).toMatchObject({ skaterGames: 2, goalieGames: 0, gameIds: ['g2', 'g1'] })
    expect(p2.stats.hky_g).toBe(2)
    expect(hockeyAggregateMetricValue(p2, 'points_per_game')).toBe(1)
    expect(formatHockeyAggregateMetric(p2, 'faceoff_pct')).toBe('50.0%')
    const p1 = result.players.find(player => player.playerId === 'sp1')!
    const p30 = result.players.find(player => player.playerId === 'sp30')!
    // p1 sat as the backup in g2: dressed but never in net, so it is not one of p1's games.
    expect(p1).toMatchObject({ goalieGames: 1, gameIds: ['g1'] })
    expect(p30).toMatchObject({ goalieGames: 1, gameIds: ['g2'] })
    expect(formatHockeyAggregateMetric(p1, 'save_pct')).toBe('.500')
    // Clockless games have no time in net, so no GAA.
    expect(hockeyAggregateMetricValue(p1, 'gaa')).toBeNull()

    const goaltending = HOCKEY_AGGREGATE_CATEGORIES.find(category => category.id === 'goaltending')!
    expect(rankHockeyAggregatePlayers(result.players, goaltending, 'save_pct').map(player => player.playerId)).toEqual(['sp1', 'sp30'])
    expect(hockeyAggregateRankingMetrics(result.players, goaltending)).not.toContain('gaa')
    const scoring = HOCKEY_AGGREGATE_CATEGORIES.find(category => category.id === 'scoring')!
    expect(rankHockeyAggregatePlayers(result.players, scoring, 'hky_pts').map(player => player.playerId)).not.toContain('sp1')
  })

  it('derives GAA from time in net across regulation lengths', () => {
    const result = aggregateHockeyMatches(scope, [match(anchoredGame(), 'g8')])
    const p1 = result.players.find(player => player.playerId === 'sp1')!
    expect(p1.timeInNet).toEqual({ included: 1, total: 1 })
    const share = p1.regulationGamesInNet
    expect(share).toBeGreaterThan(0)
    expect(hockeyAggregateMetricValue(p1, 'gaa')).toBeCloseTo(1 / share)
    const goaltending = HOCKEY_AGGREGATE_CATEGORIES.find(category => category.id === 'goaltending')!
    expect(hockeyAggregateRankingMetrics(result.players, goaltending)).toContain('gaa')
  })

  it('adds zero rows for the active roster and keeps other scopes out', () => {
    const result = aggregateHockeyMatches(
      scope,
      [match(winGame(), 'g1'), match(winGame(), 'g9', { teamId: 'team-2' })],
      [],
      [{ playerId: 'new-player', displayName: 'New Player', number: '44', teamId: TEAM }, { playerId: 'sp2', displayName: 'Renamed', number: '2', teamId: TEAM }]
    )
    expect(result.includedGameCount).toBe(1)
    expect(result.exclusions).toMatchObject([{ kind: 'ineligible_source', gameId: 'g9' }])
    expect(result.quality).toBe('complete')
    expect(result.players.find(player => player.playerId === 'new-player')).toMatchObject({ skaterGames: 0, gameIds: [] })
    expect(result.players.find(player => player.playerId === 'sp2')!.displayName).toBe('Renamed')
  })

  it('marks results partial for unresolved participants, disagreeing duplicates and malformed sources', () => {
    const unmapped = projectHockeyCanonicalAggregateSource({ ...source(winGame(), 'g1'), participantSourceMap: {} })
    if (!unmapped.ok) throw new Error('expected a match')
    // The setup's own player ids are not cloud ids, so nobody resolves.
    expect(unmapped.match.players).toEqual([])
    const duplicate = { ...match(winGame(), 'g10'), sourceFingerprint: 'other' }
    const result = aggregateHockeyMatches(scope, [unmapped.match, match(winGame(), 'g10'), duplicate])
    expect(result.quality).toBe('partial')
    expect(result.exclusions.map(exclusion => exclusion.kind)).toEqual(expect.arrayContaining(['unresolved_participant', 'duplicate_source']))
    expect(result.includedGameCount).toBe(1)
  })

  it('counts plus/minus only from games whose every goal had a complete on-ice set', () => {
    let state = clockless()
    state = shot(state, {
      side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' },
      onIce: { status: 'complete', skaterParticipantIds: ['p2', 'p3', 'p4', 'p5', 'p6'], goalie: 'p1' },
    }, 1)
    const complete = match(finishClockless(state), 'g20')
    expect(complete.plusMinusComplete).toBe(true)
    const result = aggregateHockeyMatches({ type: 'team', id: TEAM }, [complete, match(winGame(), 'g21', { date: '2026-09-01' })])
    expect(result.plusMinus).toEqual({ included: 1, total: 2 })
    const two = result.players.find(player => player.playerId === 'sp2')!
    expect(two.plusMinus).toEqual({ included: 1, total: 2 })
    expect(formatHockeyAggregateMetric(two, 'hky_pm')).toBe('+1')
    const noneCounted = aggregateHockeyMatches({ type: 'team', id: TEAM }, [match(winGame(), 'g22')]).players.find(player => player.playerId === 'sp2')!
    expect(hockeyAggregateMetricValue(noneCounted, 'hky_pm')).toBeNull()
    expect(hockeyAggregateRankingMetrics([noneCounted], HOCKEY_AGGREGATE_CATEGORIES.find(category => category.id === 'plus_minus')!)).toEqual(['hky_gp'])
  })

  it('leaves an incomplete game\'s partial plus/minus out of the totals but keeps its other stats', () => {
    const complete = { status: 'complete' as const, skaterParticipantIds: ['p2', 'p3', 'p4', 'p5', 'p6'], goalie: 'p1' }
    const first = shot(clockless(), { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' }, onIce: complete }, 1)
    let second = shot(clockless(), { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' }, onIce: complete }, 1)
    second = shot(second, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' } }, 2)
    const partial = match(finishClockless(second), 'g31', { date: '2026-09-02' })
    expect(partial.plusMinusComplete).toBe(false)
    expect(partial.players.find(row => row.playerId === 'sp2')!.stats.hky_pm).toBe(1)
    const result = aggregateHockeyMatches({ type: 'team', id: TEAM }, [match(finishClockless(first), 'g30'), partial])
    const two = result.players.find(player => player.playerId === 'sp2')!
    expect(two.plusMinus).toEqual({ included: 1, total: 2 })
    expect(formatHockeyAggregateMetric(two, 'hky_pm')).toBe('+1')
    expect(two.stats.hky_g).toBe(3)
    // Career segments rebuild through the same accumulator.
    const career = aggregateHockeyMatches({ type: 'career', id: 'sp2' }, [match(finishClockless(first), 'g30'), partial])
    expect(hockeyPlayerCareerSegments(career, { playerId: 'sp2', displayName: 'Two', number: null })[0].player.stats.hky_pm).toBe(1)
  })

  it('ranks games played by the games in the category\'s role', () => {
    const mixed = emptyHockeyAggregatePlayer('a', 'A', null)
    Object.assign(mixed, { goalieGames: 1, skaterGames: 3 })
    mixed.stats.hky_gp = 4
    const goalie = emptyHockeyAggregatePlayer('b', 'B', null)
    Object.assign(goalie, { goalieGames: 3 })
    goalie.stats.hky_gp = 3
    const skater = emptyHockeyAggregatePlayer('c', 'C', null)
    Object.assign(skater, { skaterGames: 4 })
    skater.stats.hky_gp = 4
    const category = (id: string) => HOCKEY_AGGREGATE_CATEGORIES.find(entry => entry.id === id)!
    expect(rankHockeyAggregatePlayers([mixed, goalie, skater], category('goaltending'), 'hky_gp').map(player => player.playerId)).toEqual(['b', 'a'])
    expect(rankHockeyAggregatePlayers([goalie, mixed, skater], category('scoring'), 'hky_gp').map(player => player.playerId)).toEqual(['c', 'a'])
  })

  it('lists the scoped player\'s line in each game for player scopes', () => {
    const result = aggregateHockeyMatches({ type: 'player', id: 'sp2' }, [
      match(winGame(), 'g1'),
      match(winGame(), 'g11', { cloudScope: 'personal', teamId: null, seasonId: null }),
    ])
    expect(result.players.map(player => player.playerId)).toEqual(['sp2'])
    expect(result.games.map(game => [game.gameId, game.player?.stats.hky_g])).toEqual([['g1', 2], ['g11', 2]])
    // Team records come only from team games.
    expect(result.teams.map(team => team.record.games)).toEqual([1])
  })
})

describe('Hockey player destinations (HKY-6B2)', () => {
  const identity = { playerId: 'sp2', displayName: 'Roster Two', number: '12' }
  const team = (gameId: string, seasonId: string, date: string) =>
    match(winGame(), gameId, { seasonId, date })
  const personal = (gameId: string) =>
    match(winGame(), gameId, { cloudScope: 'personal', teamId: null, seasonId: null, date: '2026-03-01' })

  it('splits a career into team seasons and personal games, newest first', () => {
    const result = aggregateHockeyMatches({ type: 'career', id: 'sp2' }, [
      team('g1', 'season-a', '2025-01-10'),
      team('g2', 'season-b', '2026-01-10'),
      team('g3', 'season-b', '2026-02-10'),
      personal('g4'),
    ])
    const segments = hockeyPlayerCareerSegments(result, identity)
    expect(segments.map(segment => [segment.kind, segment.seasonId, segment.games.length, segment.player.stats.hky_g])).toEqual([
      ['personal', null, 1, 2],
      ['team', 'season-b', 2, 4],
      ['team', 'season-a', 1, 2],
    ])
    expect(segments[1].player.skaterGames).toBe(2)
  })

  it('keeps personal games out of the profile totals', () => {
    const scoped = aggregateHockeyMatches({ type: 'player', id: 'sp2' }, [team('g1', SEASON, '2026-01-10')])
    const all = aggregateHockeyMatches({ type: 'player', id: 'sp2' }, [team('g1', SEASON, '2026-01-10'), personal('g4')])
    const profile = hockeyPlayerProfileBreakdown(scoped, all, identity)
    expect(profile.teamPlayer.stats.hky_g).toBe(2)
    expect(profile.teamPlayer.displayName).toBe('Roster Two')
    expect(profile.teamGames.map(game => game.gameId)).toEqual(['g1'])
    expect(profile.personalSegment?.games.map(game => game.gameId)).toEqual(['g4'])
  })

  it('shows a new player as zeros and a goalie their goaltending', () => {
    const empty = aggregateHockeyMatches({ type: 'player', id: 'sp99' }, [])
    const nobody = selectHockeyAggregatePlayer(empty, { playerId: 'sp99', displayName: 'New', number: null })
    expect(visibleHockeyPlayerCategories(nobody).map(category => category.id)).toEqual(['scoring'])
    const goalie = selectHockeyAggregatePlayer(
      aggregateHockeyMatches({ type: 'player', id: 'sp1' }, [match(winGame(), 'g1')]),
      { playerId: 'sp1', displayName: 'Goalie', number: '1' }
    )
    expect(visibleHockeyPlayerCategories(goalie).map(category => category.id)).toEqual(['goaltending'])
  })

  it('labels outcomes, game lines, quality and each load failure', () => {
    expect(hockeyAggregateOutcomeLabel({ outcome: 'otl', decidedIn: 'shootout' })).toBe('L (SO)')
    expect(hockeyAggregateOutcomeLabel({ outcome: 'win', decidedIn: 'overtime' })).toBe('W (OT)')
    expect(hockeyAggregateOutcomeLabel({ outcome: 'loss', decidedIn: 'regulation' })).toBe('L')
    const result = aggregateHockeyMatches({ type: 'player', id: 'sp2' }, [match(winGame(), 'g1')])
    expect(hockeyGameLineText(result.games[0].player)).toMatch(/^2 G - 0 A - 2 PTS - 2 SOG/)
    expect(hockeyGameLineText(null)).toBe('No line recorded')
    expect(hockeyAggregateQualityMessage(result)).toBeNull()
    expect(hockeyAggregateErrorCopy('backend_update_required')[0]).toBe('Season stats need a backend update')
    expect(hockeyAggregateErrorCopy('client_update_required')[0]).toBe('Update the app')
  })
})

describe('Hockey aggregate transport (HKY-6B2)', () => {
  const ready = { contractVersion: 1, sportId: 'hockey', aggregateContractVersion: 1, migration: 75 }

  function client(pages: unknown[], capabilities: unknown = ready, calls: Array<{ name: string; parameters?: Record<string, unknown> }> = []): HockeyAggregateRpcClient {
    let page = 0
    return {
      rpc: (name, parameters) => {
        calls.push({ name, parameters })
        const data = name === 'get_hockey_aggregate_capabilities' ? capabilities : pages[page++]
        return Promise.resolve({ data, error: null })
      },
    }
  }

  function item(state: GameState, gameId: string) {
    const raw = source(state, gameId)
    return { ...raw, eventCount: 1, payloadBytes: 1 }
  }

  it('checks the aggregate handshake, then drains every page by cursor', async () => {
    const calls: Array<{ name: string; parameters?: Record<string, unknown> }> = []
    const pages = [
      { items: [item(winGame(), 'g1')], nextCursor: { finalizedAt: '2026-10-06T00:00:00Z', publicationId: 'pub-g1' } },
      { items: [item(shootoutLoss(), 'g2'), { publicationId: 'bad', game: { id: 'g3', date: '2026-10-03' } }], nextCursor: null },
    ]
    const loaded = await loadHockeyAggregates({ type: 'team', id: TEAM }, { client: client(pages, ready, calls), yieldControl: async () => {} })
    expect(calls.map(call => call.name)).toEqual([
      'get_hockey_aggregate_capabilities',
      'get_hockey_scope_aggregate_publications',
      'get_hockey_scope_aggregate_publications',
    ])
    expect(calls[2].parameters).toMatchObject({ p_scope_type: 'team', p_scope_id: TEAM, p_before_publication_id: 'pub-g1', p_limit: 20 })
    expect(loaded.pageCount).toBe(2)
    expect(loaded.aggregate.includedGameCount).toBe(2)
    expect(loaded.aggregate.quality).toBe('partial')
    expect(loaded.aggregate.metrics.malformedSourceCount).toBe(1)
  })

  it('asks the player page for player scopes', async () => {
    const calls: Array<{ name: string; parameters?: Record<string, unknown> }> = []
    await loadHockeyAggregates({ type: 'career', playerId: 'sp2' }, { client: client([{ items: [], nextCursor: null }], ready, calls) })
    expect(calls[1]).toEqual({
      name: 'get_hockey_player_aggregate_publications',
      parameters: { p_player_id: 'sp2', p_team_id: null, p_season_id: null, p_before_finalized_at: null, p_before_publication_id: null, p_limit: 20 },
    })
  })

  it('stops at the handshake when the backend or the app is out of date', async () => {
    await expect(loadHockeyAggregates({ type: 'team', id: TEAM }, { client: client([], { contractVersion: 0 }) }))
      .rejects.toMatchObject({ code: 'backend_update_required' })
    await expect(loadHockeyAggregates({ type: 'team', id: TEAM }, { client: client([], { ...ready, contractVersion: 2 }) }))
      .rejects.toMatchObject({ code: 'client_update_required' })
    const missing: HockeyAggregateRpcClient = {
      rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    }
    await expect(loadHockeyAggregates({ type: 'team', id: TEAM }, { client: missing })).rejects.toMatchObject({ code: 'backend_update_required' })
  })

  it('rejects a repeated cursor and shares one load between callers', async () => {
    const cursor = { finalizedAt: '2026-10-06T00:00:00Z', publicationId: 'x' }
    await expect(loadHockeyAggregates({ type: 'team', id: TEAM }, {
      client: client([{ items: [], nextCursor: cursor }, { items: [], nextCursor: cursor }]),
    })).rejects.toMatchObject({ code: 'invalid_payload' })

    const calls: Array<{ name: string; parameters?: Record<string, unknown> }> = []
    const shared = client([{ items: [], nextCursor: null }], ready, calls)
    const [left, right] = await Promise.all([
      loadHockeyAggregates({ type: 'season', id: SEASON }, { client: shared }),
      loadHockeyAggregates({ type: 'season', id: SEASON }, { client: shared }),
    ])
    expect(left).toBe(right)
    expect(calls).toHaveLength(2)
  })

  it('cancels one caller without failing the other', async () => {
    const controller = new AbortController()
    const shared = client([{ items: [], nextCursor: null }])
    const cancelled = loadHockeyAggregates({ type: 'season', id: 'season-2' }, { client: shared, signal: controller.signal })
    const kept = loadHockeyAggregates({ type: 'season', id: 'season-2' }, { client: shared })
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'aborted' })
    await expect(kept).resolves.toMatchObject({ pageCount: 1 })
  })
})
