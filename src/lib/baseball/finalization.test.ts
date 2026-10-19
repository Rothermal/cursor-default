import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../types'
import { BASEBALL_FINAL_CLOUD_GAME_MESSAGE } from './cloudPolicy'
import {
  endBaseballGame,
  recordBaseballPitch,
  reopenBaseballGame,
  setBaseballPitcherDecisions,
  withBaseballCloudReopenNotice,
  type BaseballCommandContext,
} from './commands'
import { previewBaseballRemoval } from './corrections'
import { baseballDecisionsView, baseballEmptyDecisions } from './decisions'
import { canRestoreBaseballPlay, canUndoBaseballPlay, undoBaseballPlay } from './recentPlays'
import { applyBaseballReopenHandoff, type BaseballReopenHandoff } from './reopenHandoff'
import { normalizeBaseballSportGameState } from './state'
import { ballInPlay, expectOk, projection, startedGame, threeUpThreeDown } from './testFixtures'
import type { BaseballGameEndOutcome } from './types'
import { baseballActiveEvents } from './units'

const cloudMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  gameRow: { data: { home_team_score: 1, opponent_score: 0 } as unknown, error: null as unknown },
  recorders: vi.fn(),
  projection: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => cloudMock.rpc(...args),
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () => Promise.resolve(cloudMock.gameRow),
      }
      return query
    },
  },
}))

vi.mock('./recorders', () => ({
  loadBaseballGameRecorders: (...args: unknown[]) => cloudMock.recorders(...args),
  loadBaseballRecorderProjection: (...args: unknown[]) => cloudMock.projection(...args),
}))

const {
  baseballDecisionsMissing,
  baseballFinalizationEndReason,
  baseballPublishedScore,
  createBaseballCanonicalSnapshot,
  finalizeBaseballGame,
  loadBaseballCloudGameStatus,
  parseBaseballCanonicalSnapshot,
  prepareBaseballFinalization,
  reopenBaseballCloudGame,
} = await import('./finalization')

const USER = 'user-1'
const GAME = 'cloud-game-1'

let second = 0
function rc(): BaseballCommandContext {
  second += 1
  return { recorderUserId: USER, occurredAt: new Date(Date.UTC(2026, 9, 1, 18, 0, second)).toISOString() }
}

/** Every event belongs to USER, as in a recorder's cloud stream. */
function ownedBy(state: GameState, recorderUserId: string): GameState {
  return {
    ...state,
    eventStream: {
      ...state.eventStream!,
      events: state.eventStream!.events.map(event => ({ ...(event as Record<string, unknown>), recorderUserId })),
    },
  } as GameState
}

/** We are home: three outs in the top, then a home run in the bottom of the 1st (1-0). */
function leading(): GameState {
  return ownedBy(ballInPlay(threeUpThreeDown(startedGame()), 'home_run', { battedBallType: 'fly' }), USER)
}

function ended(outcome: BaseballGameEndOutcome = 'time_limit', state = leading()): GameState {
  return expectOk(endBaseballGame(state, outcome, rc(), {
    forfeitWinner: outcome === 'forfeit' ? 'opponent' : null,
    note: outcome === 'suspended' || outcome === 'abandoned' ? 'Rain' : null,
  }))
}

function bound(state: GameState, gameStatus: GameState['cloudSync']['gameStatus'] = 'in_progress'): GameState {
  return { ...state, cloudSync: { ...state.cloudSync, gameId: GAME, gameStatus, eventCloudPolicy: 'automatic' } }
}

function lastEvent(state: GameState) {
  const events = state.eventStream!.events
  return events[events.length - 1] as { id: string; eventType: string; occurredAt: string; recorderUserId: string; payload: unknown }
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
  checkpointSyncedAt: '2026-10-01T18:05:00.000Z',
  checkpointCurrent: true,
  unresolvedConflictCount: 0,
  isPrimary: true,
  primarySource: 'default' as const,
  canSelectPrimary: true,
}

function primaryProjection(state: GameState) {
  const activeEvents = baseballActiveEvents(state)
  return {
    recorder: RECORDER,
    state,
    eventStream: state.eventStream!,
    inspection: { complete: true, activeEvents, deletedEvents: [], diagnostics: [] },
  }
}

beforeEach(() => {
  cloudMock.rpc.mockReset()
  cloudMock.recorders.mockReset()
  cloudMock.projection.mockReset()
  cloudMock.gameRow = { data: { home_team_score: 1, opponent_score: 0 }, error: null }
  cloudMock.recorders.mockResolvedValue([RECORDER])
})

describe('BSB-6B2 published runs and end reason', () => {
  it('publishes the recorded runs for every ending the server accepts, a forfeit included', () => {
    for (const outcome of ['time_limit', 'forfeit', 'abandoned'] as const) {
      const state = ended(outcome)
      expect(baseballFinalizationEndReason(projection(state))).toBe(outcome)
      expect(baseballPublishedScore(projection(state))).toEqual({ tracked: 1, opponent: 0 })
    }
  })

  it('does not publish a suspended or running game', () => {
    expect(baseballFinalizationEndReason(projection(ended('suspended')))).toBeNull()
    expect(baseballFinalizationEndReason(projection(leading()))).toBeNull()
  })

  it('notes missing decisions only when the game has a winner who can carry them', () => {
    const final = ended()
    expect(baseballDecisionsMissing(primaryProjection(final))).toBe(true)
    const decided = expectOk(setBaseballPitcherDecisions(final, {
      ...baseballEmptyDecisions(),
      tracked: { win: 't1', loss: null, save: null, holds: [] },
      opponent: { win: null, loss: 'opp-p1', save: null, holds: [] },
    }, rc()))
    expect(baseballDecisionsMissing(primaryProjection(decided))).toBe(false)
    expect(baseballDecisionsMissing(primaryProjection(ended('forfeit')))).toBe(false)
    expect(baseballDecisionsMissing(primaryProjection(ended('abandoned')))).toBe(false)
  })
})

describe('BSB-6B2 canonical snapshot', () => {
  it('sends setup only, in the version 2 envelope with payload schema 1, and parses back', () => {
    const snapshot = createBaseballCanonicalSnapshot(GAME, USER, ended())
    expect(snapshot).toMatchObject({ version: 2, canonicalSchemaVersion: 1, sportId: 'baseball', gameId: GAME, primaryRecorderId: USER })
    expect(Object.keys(snapshot.sportGameState)).toEqual(['sportId', 'version', 'setup'])
    expect(parseBaseballCanonicalSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('rejects another recorder, a cached projection or another payload schema', () => {
    const state = ended()
    expect(() => createBaseballCanonicalSnapshot(GAME, 'user-2', state)).toThrow('do not belong to the primary recorder')
    const snapshot = JSON.parse(JSON.stringify(createBaseballCanonicalSnapshot(GAME, USER, state)))
    expect(() => parseBaseballCanonicalSnapshot({ ...snapshot, canonicalSchemaVersion: 2 })).toThrow('invalid')
    expect(() => parseBaseballCanonicalSnapshot({
      ...snapshot,
      sportGameState: { ...snapshot.sportGameState, projection: {} },
    })).toThrow('invalid')
  })
})

describe('BSB-6B2 finalize and reopen calls', () => {
  it('confirms the exact primary checkpoint, rechecks readiness and finalizes with the Baseball wrappers', async () => {
    const state = bound(ended())
    cloudMock.projection.mockResolvedValue(primaryProjection(state))
    cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'get_baseball_finalization_readiness'
        ? { data: readinessRow(), error: null }
        : name === 'finalize_baseball_event_game'
          ? {
              data: { publication_id: 'pub-1', publication_number: 1, primary_recorded_by: USER, finalized_at: '2026-10-01T18:10:00.000Z' },
              error: null,
            }
          : { data: '2026-10-01T18:09:00.000Z', error: null }
    ))

    const preview = await prepareBaseballFinalization(GAME)
    expect(preview).toMatchObject({ endReason: 'time_limit', score: { tracked: 1, opponent: 0 }, decisionsMissing: true })
    expect(cloudMock.rpc.mock.calls.map(call => call[0])).toEqual([
      'get_baseball_finalization_readiness',
      'confirm_baseball_primary_checkpoint_for_finalization',
      'get_baseball_finalization_readiness',
    ])

    // The server counted 2-0: its score wins, and the preview's is kept for the note.
    cloudMock.gameRow = { data: { home_team_score: 2, opponent_score: 0 }, error: null }
    const result = await finalizeBaseballGame(preview)
    expect(cloudMock.rpc).toHaveBeenLastCalledWith('finalize_baseball_event_game', expect.objectContaining({
      p_game_id: GAME,
      p_primary_recorded_by: USER,
      p_canonical_snapshot: expect.objectContaining({ canonicalSchemaVersion: 1, sportId: 'baseball' }),
    }))
    expect(result).toMatchObject({
      publicationId: 'pub-1',
      score: { tracked: 2, opponent: 0 },
      serverScoreConfirmed: true,
      previewScore: { tracked: 1, opponent: 0 },
      endReason: 'time_limit',
    })
  })

  it('refuses a suspended primary before confirming anything', async () => {
    cloudMock.projection.mockResolvedValue(primaryProjection(bound(ended('suspended'))))
    cloudMock.rpc.mockResolvedValue({ data: readinessRow({ primary_ended: false }), error: null })
    await expect(prepareBaseballFinalization(GAME)).rejects.toThrow('A suspended game must be reopened and ended first.')
    expect(cloudMock.rpc).toHaveBeenCalledTimes(1)
  })

  it('reopens with a trimmed reason through the Baseball wrapper', async () => {
    cloudMock.rpc.mockResolvedValueOnce({
      data: { game_id: GAME, publication_id: 'pub-1', reopened_at: '2026-10-01T18:20:00.000Z' },
      error: null,
    })
    expect(await reopenBaseballCloudGame(GAME, '  Wrong runner scored ')).toEqual({
      gameId: GAME,
      publicationId: 'pub-1',
      reason: 'Wrong runner scored',
      reopenedAt: '2026-10-01T18:20:00.000Z',
    })
    expect(cloudMock.rpc).toHaveBeenLastCalledWith('reopen_baseball_event_game', { p_game_id: GAME, p_reason: 'Wrong runner scored' })
  })

  it('reads the cloud status a finalized copy uses to learn of a reopen', async () => {
    cloudMock.gameRow = { data: { status: 'in_progress' }, error: null }
    expect(await loadBaseballCloudGameStatus(GAME)).toBe('in_progress')
    cloudMock.gameRow = { data: null, error: { message: 'offline' } }
    expect(await loadBaseballCloudGameStatus(GAME)).toBeNull()
  })
})

describe('BSB-6B2 a finalized cloud game is read-only', () => {
  it('refuses capture, Undo, Timeline corrections, Reopen and decisions with one message', () => {
    const live = bound(leading(), 'final')
    const capture = recordBaseballPitch(live, { result: 'ball' }, rc())
    expect(capture).toMatchObject({ ok: false, code: 'cloud_final', message: BASEBALL_FINAL_CLOUD_GAME_MESSAGE })
    expect(capture.state).toBe(live)
    expect(canUndoBaseballPlay(live)).toBe(false)
    expect(canRestoreBaseballPlay(live)).toBe(false)
    expect(undoBaseballPlay(live, rc().occurredAt)).toMatchObject({ ok: false, message: BASEBALL_FINAL_CLOUD_GAME_MESSAGE })
    const unitId = lastEvent(live).id
    expect(previewBaseballRemoval(live, unitId, { tracked: 'Aces', opponent: 'Visitors' })).toMatchObject({
      ok: false,
      message: BASEBALL_FINAL_CLOUD_GAME_MESSAGE,
    })

    const final = bound(ended(), 'final')
    expect(reopenBaseballGame(final, 'Fix it', rc())).toMatchObject({ ok: false, code: 'cloud_final' })
    expect(setBaseballPitcherDecisions(final, baseballEmptyDecisions(), rc())).toMatchObject({ ok: false, code: 'cloud_final' })

    const reopenedBinding = { ...live, cloudSync: { ...live.cloudSync, gameStatus: 'in_progress' as const } }
    expect(recordBaseballPitch(reopenedBinding, { result: 'ball' }, rc()).ok).toBe(true)
  })
})

describe('BSB-6B2 reopen on the same account and device', () => {
  const handoff: BaseballReopenHandoff = {
    sportId: 'baseball',
    publicationId: 'pub-1',
    primaryRecorderId: USER,
    reason: 'Wrong runner scored',
    reopenedAt: '2026-10-01T19:00:00.000Z',
  }

  it('reopens the primary recorder\'s ended stream with the manager\'s reason, once', () => {
    const finalized = bound(ended(), 'final')
    const first = applyBaseballReopenHandoff(finalized, USER, GAME, handoff)
    if (!first.ok) throw new Error(first.reason)
    expect(first.changed).toBe(true)
    expect(first.state.cloudSync).toMatchObject({ gameStatus: 'in_progress', status: 'idle', lastError: null })
    expect(projection(first.state).status).toBe('in_progress')
    expect(lastEvent(first.state)).toMatchObject({
      eventType: 'baseball.game_reopened',
      recorderUserId: USER,
      occurredAt: handoff.reopenedAt,
      payload: { captureCommandId: null, reason: 'Wrong runner scored' },
    })

    const again = applyBaseballReopenHandoff(first.state, USER, GAME, handoff)
    expect(again).toMatchObject({ ok: true, changed: false })
    if (again.ok) expect(again.state.eventStream!.events).toHaveLength(first.state.eventStream!.events.length)
  })

  it('ends the decisions epoch: decisions from before the reopen stop counting', () => {
    const decided = expectOk(setBaseballPitcherDecisions(ended(), {
      ...baseballEmptyDecisions(),
      tracked: { win: 't1', loss: null, save: null, holds: [] },
    }, rc()))
    const reopened = applyBaseballReopenHandoff(bound(decided, 'final'), USER, GAME, handoff)
    if (!reopened.ok) throw new Error(reopened.reason)
    const endedAgain = bound(ended('time_limit', reopened.state))
    const sport = endedAgain.sportGameState!
    if (sport.sportId !== 'baseball') throw new Error('Not Baseball')
    expect(baseballDecisionsView(sport, baseballActiveEvents(endedAgain)).current).toBeNull()
  })

  it('never moves the stream back in time, and only flips the binding for anyone else', () => {
    const finalized = bound(ended(), 'final')
    const endedAt = lastEvent(finalized).occurredAt
    const early = applyBaseballReopenHandoff(finalized, USER, GAME, { ...handoff, reopenedAt: '2026-01-01T00:00:00.000Z' })
    if (!early.ok) throw new Error(early.reason)
    expect(lastEvent(early.state).occurredAt).toBe(endedAt)

    const other = applyBaseballReopenHandoff(finalized, 'user-2', GAME, handoff)
    if (!other.ok) throw new Error(other.reason)
    expect(other.state.eventStream).toBe(finalized.eventStream)
    expect(other.state.cloudSync.gameStatus).toBe('in_progress')

    expect(applyBaseballReopenHandoff(finalized, USER, 'another-game', handoff)).toMatchObject({ ok: false })
  })
})

describe('BSB-6B2 reopen from another account or device', () => {
  it('keeps the notice outside events until the recorder\'s own Reopen clears it', () => {
    const base = bound(ended())
    const copy = withBaseballCloudReopenNotice(base, { noticedAt: '2026-10-01T19:00:00.000Z' })
    const sport = copy.sportGameState!
    if (sport.sportId !== 'baseball') throw new Error('Not Baseball')
    expect(sport.capturePreferences.cloudReopenNotice).toEqual({ noticedAt: '2026-10-01T19:00:00.000Z' })
    expect(copy.eventStream).toBe(base.eventStream)

    // It survives a reload; a malformed or missing one reads as none.
    const reloaded = normalizeBaseballSportGameState(JSON.parse(JSON.stringify(sport)))
    expect(reloaded?.capturePreferences.cloudReopenNotice).toEqual({ noticedAt: '2026-10-01T19:00:00.000Z' })
    expect(normalizeBaseballSportGameState({
      ...JSON.parse(JSON.stringify(sport)),
      capturePreferences: { ...sport.capturePreferences, cloudReopenNotice: { noticedAt: 'soon' } },
    })?.capturePreferences.cloudReopenNotice).toBeNull()

    const reopened = expectOk(reopenBaseballGame(copy, 'Wrong runner scored', rc()))
    const after = reopened.sportGameState!
    if (after.sportId !== 'baseball') throw new Error('Not Baseball')
    expect(after.capturePreferences.cloudReopenNotice).toBeNull()
    expect(lastEvent(reopened)).toMatchObject({ eventType: 'baseball.game_reopened', recorderUserId: USER })
  })
})
