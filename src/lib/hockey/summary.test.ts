import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { routeForResumedGame } from '../sportNavigation'
import { recordHockeyFaceoff, recordHockeyPenalties, recordHockeyPlay, recordHockeyShot } from './captureCommands'
import type { HockeyCanonicalPublication } from './finalization'
import { endHockeyMatch, endHockeyPeriod, interruptHockeyMatch, pauseHockeyClock, startHockeyClock, startHockeyGame, startNextHockeyPeriod } from './live'
import type { HockeyRecorderSummary } from './recorders'
import {
  hockeyGoalieRows,
  hockeyPenaltyRows,
  hockeyPeriodRows,
  hockeyScoringRows,
  hockeySkaterRows,
  hockeySummaryBackPath,
  hockeySummaryPath,
  hockeySummaryResult,
  hockeyTeamStatRows,
  isHockeySummaryRoute,
  parseHockeySummaryQuery,
} from './summary'
import {
  hockeySummaryFromState,
  loadHockeySummarySource,
  type HockeySummarySource,
  type HockeySummarySourceDependencies,
} from './summarySource'
import { CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame } from './testFixtures'

const NAMES = { tracked: 'Blades', opponent: 'Rivals' }

function clocklessGame(): GameState {
  return expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
}

function endRegulation(state: GameState, seconds = 500): GameState {
  let next = state
  for (let period = 1; period <= 3; period++) {
    if (period > 1) next = expectOk(startNextHockeyPeriod(next, ctx(seconds++)))
    next = expectOk(endHockeyPeriod(next, {}, ctx(seconds++)))
  }
  return expectOk(endHockeyMatch(next, {}, ctx(seconds)))
}

/** A clockless 2-1 win with a penalty, a faceoff and a hit. */
function playedGame(): GameState {
  let state = clocklessGame()
  state = expectOk(recordHockeyShot(state, {
    side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' }, assists: [{ participantId: 'p3' }, { participantId: 'p5' }],
  }, ctx(1)))
  state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(2)))
  state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'blocked', blocker: { participantId: 'p6' } }, ctx(3)))
  state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'goal', shooter: { label: '#12' } }, ctx(4)))
  state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p4' } }, ctx(5)))
  state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked', takerParticipantId: 'p2', opponentTakerLabel: null }, ctx(6)))
  state = expectOk(recordHockeyPlay(state, { kind: 'hit', side: 'tracked', player: { participantId: 'p5' } }, ctx(7)))
  state = expectOk(recordHockeyPenalties(state, {
    penalties: [{ side: 'tracked', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { participantId: 'p3' } }],
  }, ctx(8)))
  return endRegulation(state)
}

function healthy(state: GameState): HockeySummarySource {
  const source = hockeySummaryFromState('local', state, null, null)
  if (!source.healthy || !source.sport || !source.lines) throw new Error(`Unhealthy: ${source.diagnostic}`)
  return source
}

const PRIMARY: HockeyRecorderSummary = {
  recorderId: 'recorder-1',
  displayName: 'Mark',
  eventCount: 3,
  checkpointEventCount: 3,
  checkpointSyncedAt: null,
  checkpointCurrent: true,
  unresolvedConflictCount: 0,
  isPrimary: true,
  primarySource: 'default',
  canSelectPrimary: true,
}

function cloudShell(state: GameState, status: 'final' | 'in_progress'): GameState {
  return {
    ...state,
    eventStream: null,
    cloudSync: { ...state.cloudSync, gameId: 'game-1', gameStatus: status, eventCloudPolicy: 'automatic' },
  }
}

function publication(state: GameState): HockeyCanonicalPublication {
  const sport = state.sportGameState as { setup: unknown }
  return {
    publicationId: 'pub-1',
    publicationNumber: 1,
    primaryRecorderId: 'recorder-1',
    primaryDisplayName: 'Mark',
    snapshot: {
      version: 2,
      canonicalSchemaVersion: 1,
      sportId: 'hockey',
      gameId: 'game-1',
      primaryRecorderId: 'recorder-1',
      eventStream: structuredClone(state.eventStream!),
      sportGameState: { sportId: 'hockey', version: 1, setup: structuredClone(sport.setup) },
    } as HockeyCanonicalPublication['snapshot'],
    snapshotFingerprint: 'fp',
    finalizedBy: 'recorder-1',
    finalizedByDisplayName: 'Mark',
    finalizedAt: '2026-10-06T00:00:00Z',
  }
}

function deps(state: GameState, status: 'final' | 'in_progress', overrides: Partial<HockeySummarySourceDependencies> = {}): HockeySummarySourceDependencies {
  return {
    loadCloudState: async () => cloudShell(state, status),
    loadRecorders: async () => [PRIMARY],
    loadRecorder: async (_gameId, recorder) => {
      const source = hockeySummaryFromState('cloud_primary', state, null, null)
      return { recorder, state: source.state, eventStream: state.eventStream!, inspection: source.inspection }
    },
    loadCanonical: async () => publication(state),
    ...overrides,
  }
}

describe('Hockey Summary routing (HKY-6A1)', () => {
  it('opens local event games and cloud games named by gameId and sport', () => {
    const local = clocklessGame()
    expect(isHockeySummaryRoute(local, new URLSearchParams())).toBe(true)
    expect(isHockeySummaryRoute(local, new URLSearchParams('gameId=g&sport=basketball'))).toBe(false)
    expect(isHockeySummaryRoute({ ...local, sportGameState: null, gameDataAuthority: undefined }, new URLSearchParams())).toBe(false)
    const empty = { gameDataAuthority: undefined, sport: null, sportGameState: null } as unknown as GameState
    expect(isHockeySummaryRoute(empty, new URLSearchParams('gameId=g&sport=hockey'))).toBe(true)
  })

  it('round-trips the query and goes back where it came from', () => {
    const path = hockeySummaryPath({ gameId: 'g 1', tab: 'goalies', from: 'game-info', teamId: 't' })
    const query = parseHockeySummaryQuery(new URLSearchParams(path.split('?')[1]))
    expect(query).toEqual({ gameId: 'g 1', tab: 'goalies', from: 'game-info', teamId: 't' })
    expect(hockeySummaryBackPath(query)).toBe('/game-info?gameId=g+1&teamId=t')
    expect(parseHockeySummaryQuery(new URLSearchParams('tab=nope')).tab).toBe('overview')
    expect(hockeySummaryBackPath({ ...query, from: 'tracker' })).toBe('/game')
  })

  it('resumes ended and abandoned games on the Summary, and the rest on the tracker', () => {
    const ended = playedGame()
    expect(routeForResumedGame(ended)).toBe('/summary?sport=hockey&tab=overview&from=tracker')
    const running = clocklessGame()
    expect(routeForResumedGame(running)).toBe('/game')
    const abandoned = expectOk(interruptHockeyMatch(running, { kind: 'abandoned', reason: 'Lights out' }, ctx(9)))
    expect(routeForResumedGame(abandoned)).toBe('/summary?sport=hockey&tab=overview&from=tracker')
    const suspended = expectOk(interruptHockeyMatch(running, { kind: 'suspended', reason: 'Rain' }, ctx(9)))
    expect(routeForResumedGame(suspended)).toBe('/game')
  })
})

describe('Hockey Summary source (HKY-6A1)', () => {
  it('reads this device\'s game without cloud calls', async () => {
    const fail = async () => { throw new Error('no cloud') }
    const source = await loadHockeySummarySource(playedGame(), null, { loadCloudState: fail, loadRecorders: fail, loadRecorder: fail, loadCanonical: fail })
    expect(source).toMatchObject({ kind: 'local', healthy: true, diagnostic: null })
  })

  it('reads a final cloud game from its publication and a live one from the primary stream', async () => {
    const state = playedGame()
    const final = await loadHockeySummarySource(state, 'game-1', deps(state, 'final'))
    expect(final).toMatchObject({ kind: 'canonical', healthy: true, recorderName: 'Mark' })
    expect(final.sport?.projection.score).toEqual({ tracked: 2, opponent: 1 })
    const live = await loadHockeySummarySource(state, 'game-1', deps(state, 'in_progress'))
    expect(live).toMatchObject({ kind: 'cloud_primary', healthy: true, recorderName: 'Mark' })
    // A local copy of a final game reads the publication.
    const boundFinal = { ...state, cloudSync: { ...state.cloudSync, gameId: 'game-1', gameStatus: 'final' as const } }
    expect((await loadHockeySummarySource(boundFinal, null, deps(state, 'final'))).kind).toBe('canonical')
  })

  it('names the problem when the publication or primary is missing, or access fails', async () => {
    const state = playedGame()
    await expect(loadHockeySummarySource(state, 'game-1', deps(state, 'final', { loadCanonical: async () => null })))
      .rejects.toMatchObject({ authority: 'canonical', message: expect.stringMatching(/no published result/) })
    await expect(loadHockeySummarySource(state, 'game-1', deps(state, 'in_progress', { loadRecorders: async () => [] })))
      .rejects.toMatchObject({ authority: 'cloud_primary', message: expect.stringMatching(/primary Hockey recorder/) })
    await expect(loadHockeySummarySource(state, 'game-1', deps(state, 'in_progress', { loadCloudState: async () => { throw new Error('permission denied') } })))
      .rejects.toMatchObject({ message: 'permission denied' })
  })

  it('shows no totals for a publication that has not ended, or an unreadable stream', async () => {
    const running = clocklessGame()
    const unended = await loadHockeySummarySource(running, 'game-1', deps(running, 'final'))
    expect(unended).toMatchObject({ kind: 'canonical', healthy: false, lines: null, diagnostic: 'The published Hockey result has not ended.' })

    const state = playedGame()
    const events = state.eventStream!.events
    const broken = { ...state, eventStream: { ...state.eventStream!, events: events.slice(1) } }
    const source = hockeySummaryFromState('local', broken, null, null)
    expect(source.healthy).toBe(false)
    expect(source.lines).toBeNull()
    expect(source.sport?.setup.opponentName).toBe('Rivals')
    expect(source.diagnostic).toBeTruthy()
  })
})

describe('Hockey Summary views (HKY-6A1)', () => {
  it('builds the result, periods, team stats, scoring and penalties', () => {
    const source = healthy(playedGame())
    const sport = source.sport!
    expect(hockeySummaryResult(sport.projection)).toEqual({ scoreText: '2-1', label: 'Win', reason: null })
    const periods = hockeyPeriodRows(sport.projection)
    expect(periods.periods.map(row => row.label)).toEqual(['Period 1', 'Period 2', 'Period 3'])
    expect(periods.periods[0]).toMatchObject({ goals: { tracked: 2, opponent: 1 }, shotsOnGoal: { tracked: 2, opponent: 2 } })
    expect(periods.total.goals).toEqual({ tracked: 2, opponent: 1 })

    const team = Object.fromEntries(hockeyTeamStatRows(sport, source.inspection.activeEvents).map(row => [row.label, row.values]))
    expect(team['Power-play goals']).toEqual({ tracked: '0', opponent: '0' })
    expect(team['Penalty kill']).toBeUndefined()
    expect(team.Faceoffs).toEqual({ tracked: '1-0 (100%)', opponent: '0-1 (0%)' })
    expect(team['Blocked shots']).toEqual({ tracked: '1', opponent: '0' })
    expect(team['Penalty minutes']).toEqual({ tracked: '2', opponent: '0' })

    const scoring = hockeyScoringRows(sport, source.lines!, NAMES)
    expect(scoring.map(row => [row.scorer, row.assists, row.score, row.gameWinning])).toEqual([
      ['#2 Player 2', ['#3 Player 3', '#5 Player 5'], '1-0', false],
      ['#12', [], '1-1', false],
      ['#4 Player 4', [], '2-1', true],
    ])
    expect(scoring[0]).toMatchObject({ period: 'Period 1', time: null, strength: 'EV' })
    expect(hockeyPenaltyRows(sport, NAMES)).toEqual([expect.objectContaining({
      player: '#3 Player 3', team: 'Blades', penalty: 'minor, tripping (2 min)', time: null,
    })])
  })

  it('lists skaters in roster order and goalies with decisions, opponent goalies as context', () => {
    const source = healthy(playedGame())
    const skaters = hockeySkaterRows(source.sport!, source.lines!)
    expect(skaters.map(row => row.participantId)).toEqual(['p2', 'p3', 'p4', 'p5', 'p6'])
    expect(skaters[0]).toMatchObject({ goals: 1, points: 1, faceoffs: '1-0', faceoffPercent: '100%', shotAttempts: 1 })
    expect(skaters[1]).toMatchObject({ assists: 1, pim: '2' })
    expect(skaters[2]).toMatchObject({ gameWinningGoals: 1 })
    expect(skaters[4]).toMatchObject({ blocks: 1 })

    const goalies = hockeyGoalieRows(source.sport!, source.lines!, source.inspection.activeEvents)
    expect(goalies.map(row => [row.side, row.name, row.played, row.shotsAgainst, row.saves, row.goalsAgainst, row.savePercent, row.decision, row.timeInNet])).toEqual([
      ['tracked', '#1 Player 1', true, 2, 1, 1, '.500', 'W', null],
      ['tracked', '#30 Player 30', false, 0, 0, 0, null, null, null],
      ['opponent', '#35', true, 2, 0, 2, '.000', null, null],
    ])
  })

  it('shows the suspended status with its reason, and power plays with a clock', () => {
    const suspended = expectOk(interruptHockeyMatch(clocklessGame(), { kind: 'suspended', reason: 'Rain' }, ctx(9)))
    expect(hockeySummaryResult(healthy(suspended).sport!.projection)).toEqual({ scoreText: '0-0', label: 'Suspended', reason: 'Rain' })

    // Anchored: a tracked minor at 1:00 gives the opponent one power play.
    let anchored = expectOk(startHockeyClock(expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0))), ctx(1)))
    anchored = expectOk(recordHockeyPenalties(anchored, {
      penalties: [{ side: 'tracked', class: 'minor', infraction: 'hooking', offenderKind: 'player', offender: { participantId: 'p4' } }],
    }, ctx(61)))
    anchored = expectOk(pauseHockeyClock(anchored, ctx(62)))
    const source = healthy(anchored)
    const team = Object.fromEntries(hockeyTeamStatRows(source.sport!, source.inspection.activeEvents).map(row => [row.label, row.values]))
    expect(team['Power play']).toEqual({ tracked: '0/0', opponent: '0/1' })
    expect(team['Penalty kill']).toEqual({ tracked: '1/1', opponent: '0/0' })
    expect(hockeyPenaltyRows(source.sport!, NAMES)[0].time).toBe('1:00')
  })

  it('keeps confirmed power-play goals but drops the ratio when they exceed the recorded chances', () => {
    const anchored = () => expectOk(startHockeyClock(expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0))), ctx(1)))
    const teamStats = (state: GameState) => {
      const source = healthy(state)
      return Object.fromEntries(hockeyTeamStatRows(source.sport!, source.inspection.activeEvents).map(row => [row.label, row]))
    }

    // A confirmed PP goal whose penalty was never recorded.
    let missed = expectOk(recordHockeyShot(anchored(), { side: 'tracked', outcome: 'goal', strength: 'pp' }, ctx(61)))
    missed = expectOk(pauseHockeyClock(missed, ctx(62)))
    let team = teamStats(missed)
    expect(team['Power play'].values).toEqual({ tracked: '1 PPG', opponent: '0/0' })
    expect(team['Penalty kill'].values).toEqual({ tracked: '0/0', opponent: '–' })
    expect(team['Power play'].note).toMatch(/chances are incomplete/)

    // Two confirmed PP goals on one recorded opponent minor.
    let over = expectOk(recordHockeyPenalties(anchored(), {
      penalties: [{ side: 'opponent', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { label: '#8' } }],
    }, ctx(61)))
    over = expectOk(recordHockeyShot(over, { side: 'tracked', outcome: 'goal', strength: 'pp' }, ctx(91)))
    over = expectOk(recordHockeyShot(over, { side: 'tracked', outcome: 'goal', strength: 'pp' }, ctx(121)))
    over = expectOk(pauseHockeyClock(over, ctx(122)))
    team = teamStats(over)
    expect(team['Power play'].values).toEqual({ tracked: '2 PPG', opponent: '0/0' })
    expect(team['Penalty kill'].values).toEqual({ tracked: '0/0', opponent: '–' })

    // One goal on that one chance keeps the ratio and no note.
    let within = expectOk(recordHockeyPenalties(anchored(), {
      penalties: [{ side: 'opponent', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { label: '#8' } }],
    }, ctx(61)))
    within = expectOk(recordHockeyShot(within, { side: 'tracked', outcome: 'goal', strength: 'pp' }, ctx(91)))
    within = expectOk(pauseHockeyClock(within, ctx(92)))
    team = teamStats(within)
    expect(team['Power play'].values).toEqual({ tracked: '1/1', opponent: '0/0' })
    expect(team['Penalty kill'].values).toEqual({ tracked: '0/0', opponent: '0/1' })
    expect(team['Power play'].note).toBeUndefined()
  })
})
