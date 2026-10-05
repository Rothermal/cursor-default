import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../types'
import { recordHockeyShootoutAttempt, recordHockeyShot, startHockeyShootout } from './captureCommands'
import { HOCKEY_FINAL_CLOUD_GAME_MESSAGE } from './cloudPolicy'
import { removeHockeyEvents } from './corrections'
import {
  endHockeyMatch,
  endHockeyPeriod,
  interruptHockeyMatch,
  startHockeyGame,
  startNextHockeyPeriod,
  type HockeyCommandContext,
} from './live'
import { undoHockeyCapture } from './recentEvents'
import { applyHockeyReopenHandoff, type HockeyReopenHandoff } from './reopenHandoff'
import { at, CLOCKLESS, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyProfileId } from './types'

const cloudMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  gameRow: { data: { home_team_score: 3, opponent_score: 2 } as unknown, error: null as unknown },
  recorders: vi.fn(),
  projection: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => cloudMock.rpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(cloudMock.gameRow) }) }),
    }),
  },
}))

vi.mock('./recorders', () => ({
  loadHockeyGameRecorders: (...args: unknown[]) => cloudMock.recorders(...args),
  loadHockeyRecorderProjection: (...args: unknown[]) => cloudMock.projection(...args),
}))

const {
  createHockeyCanonicalSnapshot,
  finalizeHockeyGame,
  hockeyFinalizationEndReason,
  hockeyPublishedScore,
  loadHockeyCanonicalPublicationHistory,
  parseHockeyCanonicalSnapshot,
  prepareHockeyFinalization,
  reopenHockeyCloudGame,
} = await import('./finalization')

const USER = 'user-1'
const GAME = 'cloud-game-1'

function rc(seconds: number): HockeyCommandContext {
  return { recorderUserId: USER, occurredAt: at(seconds) }
}

/** A clockless game played through regulation by USER, with a tracked goal in period 1. */
function played(profile: HockeyProfileId = 'usa_hockey_youth', overtimes = 0, goal = true): GameState {
  let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ profile, rules: CLOCKLESS })), rc(0)))
  if (goal) state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal' }, rc(1)))
  let second = 2
  for (let period = 1; period <= 3 + overtimes; period++) {
    if (period > 1) state = expectOk(startNextHockeyPeriod(state, rc(second++)))
    state = expectOk(endHockeyPeriod(state, {}, rc(second++)))
  }
  return state
}

function lastEvent(state: GameState) {
  const events = state.eventStream!.events
  return events[events.length - 1] as { id: string; occurredAt: string }
}

function ended(): GameState {
  return expectOk(endHockeyMatch(played(), {}, rc(20)))
}

function bound(state: GameState, gameStatus: GameState['cloudSync']['gameStatus'] = 'in_progress'): GameState {
  return { ...state, cloudSync: { ...state.cloudSync, gameId: GAME, gameStatus, eventCloudPolicy: 'automatic' } }
}

function readinessRow(overrides: Record<string, unknown> = {}) {
  return [{
    game_status: 'in_progress',
    can_finalize: true,
    can_reopen: false,
    primary_recorded_by: USER,
    primary_display_name: 'Mark',
    primary_ended: true,
    primary_checkpoint_current: true,
    primary_conflict_count: 0,
    primary_locked: false,
    active_publication_id: null,
    finalized_at: null,
    non_primary_attention_count: 0,
    ...overrides,
  }]
}

const RECORDER = {
  recorderId: USER,
  displayName: 'Mark',
  eventCount: 10,
  checkpointEventCount: 10,
  checkpointSyncedAt: at(30),
  checkpointCurrent: true,
  unresolvedConflictCount: 0,
  isPrimary: true,
  primarySource: 'default' as const,
  canSelectPrimary: true,
}

function primaryProjection(state: GameState) {
  return {
    recorder: RECORDER,
    state,
    eventStream: state.eventStream!,
    inspection: { complete: true, activeEvents: [], deletedEvents: [], diagnostics: [] },
  }
}

beforeEach(() => {
  cloudMock.rpc.mockReset()
  cloudMock.recorders.mockReset()
  cloudMock.projection.mockReset()
  cloudMock.gameRow = { data: { home_team_score: 3, opponent_score: 2 }, error: null }
  cloudMock.recorders.mockResolvedValue([RECORDER])
})

describe('HKY-5B2 published score and end reason', () => {
  it('reads the score the server publishes: goals plus adjustments, and one goal for a decided shootout', () => {
    expect(hockeyPublishedScore(projection(ended()))).toEqual({ tracked: 1, opponent: 0 })

    let shootout = expectOk(startHockeyShootout(played('nhl_regular', 1, false), { firstSide: 'tracked' }, rc(30)))
    for (const [index, outcome] of (['goal', 'missed', 'goal', 'saved'] as const).entries()) {
      shootout = expectOk(recordHockeyShootoutAttempt(shootout, { outcome }, rc(31 + index)))
    }
    expect(projection(shootout).shootout?.winner).toBe('tracked')
    // Abandoned after a decided shootout: no result, but the server still adds the shootout goal.
    const abandoned = expectOk(interruptHockeyMatch(shootout, { kind: 'abandoned', reason: 'Rink closed' }, rc(40)))
    expect(projection(abandoned).result).toBeNull()
    expect(hockeyPublishedScore(projection(abandoned))).toEqual({ tracked: 1, opponent: 0 })
    expect(hockeyFinalizationEndReason(projection(abandoned))).toBe('abandoned')

    const finished = expectOk(endHockeyMatch(shootout, {}, rc(40)))
    expect(hockeyPublishedScore(projection(finished))).toEqual({ tracked: 1, opponent: 0 })
    expect(hockeyFinalizationEndReason(projection(finished))).toBe('completed')
  })

  it('does not publish a suspended or running game', () => {
    const suspended = expectOk(interruptHockeyMatch(played(), { kind: 'suspended', reason: 'Lights out' }, rc(20)))
    expect(hockeyFinalizationEndReason(projection(suspended))).toBeNull()
    expect(hockeyFinalizationEndReason(projection(played()))).toBeNull()
  })
})

describe('HKY-5B2 canonical snapshot', () => {
  it('sends setup only, in the version 2 envelope with payload schema 1, and parses back', () => {
    const state = ended()
    const snapshot = createHockeyCanonicalSnapshot(GAME, USER, state)
    expect(Object.keys(snapshot).sort()).toEqual([
      'canonicalSchemaVersion', 'eventStream', 'gameId', 'primaryRecorderId', 'sportGameState', 'sportId', 'version',
    ])
    expect(snapshot).toMatchObject({ version: 2, canonicalSchemaVersion: 1, sportId: 'hockey', gameId: GAME, primaryRecorderId: USER })
    expect(Object.keys(snapshot.sportGameState).sort()).toEqual(['setup', 'sportId', 'version'])
    expect(snapshot.sportGameState.setup).toEqual(hockeySetup({ rules: CLOCKLESS }))
    expect(snapshot.eventStream).toEqual(state.eventStream)
    expect(parseHockeyCanonicalSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('rejects another recorder, a cached projection or another payload schema', () => {
    const state = ended()
    expect(() => createHockeyCanonicalSnapshot(GAME, 'someone-else', state)).toThrow(/do not belong to the primary recorder/)
    const snapshot = createHockeyCanonicalSnapshot(GAME, USER, state)
    expect(() => parseHockeyCanonicalSnapshot({ ...snapshot, canonicalSchemaVersion: 2 })).toThrow(/invalid/)
    expect(() => parseHockeyCanonicalSnapshot({
      ...snapshot,
      sportGameState: { ...snapshot.sportGameState, projection: projection(state) },
    })).toThrow(/invalid/)
  })
})

describe('HKY-5B2 finalize and reopen calls', () => {
  it('confirms the exact primary checkpoint, rechecks readiness and finalizes with the Hockey wrappers', async () => {
    const state = bound(ended())
    cloudMock.projection.mockResolvedValue(primaryProjection(state))
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'get_hockey_finalization_readiness'
        ? { data: readinessRow(), error: null }
        : name === 'finalize_hockey_event_game'
          ? {
              data: { publication_id: 'pub-1', publication_number: 1, primary_recorded_by: USER, finalized_at: at(60) },
              error: null,
            }
          : { data: at(50), error: null }
    ))

    const preview = await prepareHockeyFinalization(GAME)
    expect(preview).toMatchObject({ endReason: 'completed', score: { tracked: 1, opponent: 0 } })
    expect(cloudMock.rpc.mock.calls.map(call => call[0])).toEqual([
      'get_hockey_finalization_readiness',
      'confirm_hockey_primary_checkpoint_for_finalization',
      'get_hockey_finalization_readiness',
    ])
    expect(cloudMock.rpc.mock.calls[1][1]).toMatchObject({
      p_game_id: GAME,
      p_primary_recorded_by: USER,
      p_stream_version: state.eventStream!.version,
      p_event_count: state.eventStream!.events.length,
    })

    // The server counted 3-2 (say, a correction landed): its score wins.
    const result = await finalizeHockeyGame(preview)
    expect(cloudMock.rpc).toHaveBeenLastCalledWith('finalize_hockey_event_game', expect.objectContaining({
      p_game_id: GAME,
      p_primary_recorded_by: USER,
      p_canonical_snapshot: expect.objectContaining({ canonicalSchemaVersion: 1, sportId: 'hockey' }),
    }))
    expect(result).toMatchObject({
      publicationId: 'pub-1',
      score: { tracked: 3, opponent: 2 },
      serverScoreConfirmed: true,
      previewScore: { tracked: 1, opponent: 0 },
      endReason: 'completed',
    })

    cloudMock.gameRow = { data: null, error: { message: 'offline' } }
    expect(await finalizeHockeyGame(preview)).toMatchObject({
      score: { tracked: 1, opponent: 0 },
      serverScoreConfirmed: false,
    })
  })

  it('refuses a suspended primary before confirming anything', async () => {
    const suspended = bound(expectOk(interruptHockeyMatch(played(), { kind: 'suspended', reason: 'Lights out' }, rc(20))))
    cloudMock.projection.mockResolvedValue(primaryProjection(suspended))
    cloudMock.rpc.mockResolvedValue({ data: readinessRow({ primary_ended: false }), error: null })
    await expect(prepareHockeyFinalization(GAME)).rejects.toThrow('End or abandon the primary Hockey game before finalizing.')
    expect(cloudMock.rpc).toHaveBeenCalledTimes(1)
  })

  it('reopens with a trimmed reason and reads the mode-less history', async () => {
    await expect(reopenHockeyCloudGame(GAME, ' x ')).rejects.toThrow('A reopen reason is required.')
    cloudMock.rpc.mockResolvedValueOnce({
      data: { game_id: GAME, publication_id: 'pub-1', reopened_at: at(70) },
      error: null,
    })
    expect(await reopenHockeyCloudGame(GAME, '  Wrong goal scorer ')).toEqual({
      gameId: GAME,
      publicationId: 'pub-1',
      reason: 'Wrong goal scorer',
      reopenedAt: at(70),
    })
    expect(cloudMock.rpc).toHaveBeenLastCalledWith('reopen_hockey_event_game', { p_game_id: GAME, p_reason: 'Wrong goal scorer' })

    cloudMock.rpc.mockResolvedValueOnce({
      data: [{
        publication_id: 'pub-1',
        publication_number: 1,
        primary_recorded_by: USER,
        primary_display_name: 'Mark',
        finalized_by: USER,
        finalized_by_display_name: 'Mark',
        finalized_at: at(60),
        invalidated_by: USER,
        invalidated_by_display_name: 'Mark',
        invalidated_at: at(70),
        invalidation_reason: 'Wrong goal scorer',
        is_active: false,
      }],
      error: null,
    })
    const history = await loadHockeyCanonicalPublicationHistory(GAME)
    expect(cloudMock.rpc).toHaveBeenLastCalledWith('get_hockey_canonical_publication_history', { p_game_id: GAME })
    expect(history).toEqual([expect.objectContaining({ publicationNumber: 1, isActive: false, invalidationReason: 'Wrong goal scorer' })])
    expect(history[0]).not.toHaveProperty('reopenMode')
  })
})

describe('HKY-5B2 a finalized cloud game is read-only', () => {
  it('refuses capture, corrections, additions and Undo with one message', () => {
    const live = bound(expectOk(recordHockeyShot(expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), rc(0))), { side: 'tracked', outcome: 'goal' }, rc(1))), 'final')

    const capture = recordHockeyShot(live, { side: 'opponent', outcome: 'saved' }, rc(2))
    expect(capture).toMatchObject({ ok: false, code: 'cloud_final', message: HOCKEY_FINAL_CLOUD_GAME_MESSAGE })
    expect(capture.state).toBe(live)

    const goalId = lastEvent(live).id
    const edit = recordHockeyShot(live, { side: 'tracked', outcome: 'saved' }, { ...rc(1), replaceEventIds: [goalId] })
    expect(edit).toMatchObject({ ok: false, code: 'cloud_final' })

    expect(undoHockeyCapture(live, at(3))).toMatchObject({ ok: false, message: HOCKEY_FINAL_CLOUD_GAME_MESSAGE })

    expect(removeHockeyEvents(live, [goalId], at(3))).toMatchObject({ ok: false, message: HOCKEY_FINAL_CLOUD_GAME_MESSAGE })

    const reopenedBinding = { ...live, cloudSync: { ...live.cloudSync, gameStatus: 'in_progress' as const } }
    expect(recordHockeyShot(reopenedBinding, { side: 'opponent', outcome: 'saved' }, rc(2)).ok).toBe(true)
  })
})

describe('HKY-5B2 reopen handoff', () => {
  const handoff: HockeyReopenHandoff = {
    sportId: 'hockey',
    publicationId: 'pub-1',
    primaryRecorderId: USER,
    reason: 'Wrong goal scorer',
    reopenedAt: at(70),
  }

  it('reopens the primary recorder\'s ended stream with the manager\'s reason, once', () => {
    const finalized = bound(ended(), 'final')
    const first = applyHockeyReopenHandoff(finalized, USER, GAME, handoff)
    if (!first.ok) throw new Error(first.reason)
    expect(first.changed).toBe(true)
    expect(first.state.cloudSync).toMatchObject({ gameStatus: 'in_progress', status: 'idle', lastError: null })
    expect(projection(first.state).status).toBe('in_progress')
    const reopened = lastEvent(first.state)
    expect(reopened).toMatchObject({
      eventType: 'hockey.match_reopened',
      recorderUserId: USER,
      occurredAt: at(70),
      payload: { captureCommandId: null, reason: 'Wrong goal scorer' },
    })

    const again = applyHockeyReopenHandoff(first.state, USER, GAME, handoff)
    expect(again).toMatchObject({ ok: true, changed: false })
    if (again.ok) expect(again.state.eventStream!.events).toHaveLength(first.state.eventStream!.events.length)
  })

  it('never moves the stream back in time, and only flips the binding for anyone else', () => {
    const finalized = bound(ended(), 'final')
    const early = applyHockeyReopenHandoff(finalized, USER, GAME, { ...handoff, reopenedAt: at(5) })
    if (!early.ok) throw new Error(early.reason)
    expect(lastEvent(early.state).occurredAt).toBe(at(20))

    const other = applyHockeyReopenHandoff(finalized, 'user-2', GAME, handoff)
    if (!other.ok) throw new Error(other.reason)
    expect(other.state.eventStream).toBe(finalized.eventStream)
    expect(other.state.cloudSync.gameStatus).toBe('in_progress')

    expect(applyHockeyReopenHandoff(finalized, USER, 'another-game', handoff)).toMatchObject({ ok: false })
  })
})
