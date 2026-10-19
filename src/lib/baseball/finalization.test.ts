import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../types'
import { sports } from '../../config/sports'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { gameEventRegistry } from '../gameEvents/runtime'
import { inspectGameEventStream } from '../gameEvents/stream'
import { baseballEmptyDecisions, baseballDecisionsView } from './decisions'
import { endBaseballGame, recordBaseballPitch, reopenBaseballGame, setBaseballPitcherDecisions, startBaseballGame } from './commands'
import { BASEBALL_FINAL_CLOUD_GAME_MESSAGE } from './cloudPolicy'
import { previewBaseballRemoval, removeBaseballPlay, previewBaseballRestore } from './corrections'
import { canUndoBaseballPlay, canRestoreBaseballPlay, undoBaseballPlay, restoreBaseballPlay } from './recentPlays'
import { applyBaseballReopenHandoff, type BaseballReopenHandoff } from './reopenHandoff'
import { createBaseballEventGameState } from './setupBuilder'
import { baseballSetup, expectOk, projection } from './testFixtures'

const cloud = vi.hoisted(() => ({ rpc: vi.fn(), recorders: vi.fn(), projection: vi.fn(),
  row: { data: { home_team_score: 3, opponent_score: 2 } as unknown, error: null as unknown } }))
vi.mock('../supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => cloud.rpc(...args),
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(cloud.row) }) }) }),
} }))
vi.mock('./recorders', () => ({
  loadBaseballGameRecorders: (...args: unknown[]) => cloud.recorders(...args),
  loadBaseballRecorderProjection: (...args: unknown[]) => cloud.projection(...args),
}))
const { baseballFinalizationEndReason, baseballPublishedScore, createBaseballCanonicalSnapshot,
  parseBaseballCanonicalSnapshot, prepareBaseballFinalization, finalizeBaseballGame, reopenBaseballCloudGame,
  loadBaseballCanonicalPublicationHistory } = await import('./finalization')

const USER = 'recorder-a', GAME = 'game-1'
const at = (second: number) => new Date(Date.UTC(2026, 9, 18, 12, 0, second)).toISOString()
const rc = (second: number) => ({ recorderUserId: USER, occurredAt: at(second) })
function live(): GameState {
  const created = createBaseballEventGameState({ sport: sports.find(s => s.id === 'baseball')!,
    setup: baseballSetup(), teamName: 'Falcons', date: '2026-10-18' })
  if (!created.ok) throw new Error(created.message)
  return expectOk(recordBaseballPitch(expectOk(startBaseballGame(created.state, rc(0))), { result: 'ball' }, rc(1)))
}
function ended(): GameState { return expectOk(endBaseballGame(live(), 'time_limit', rc(20))) }
function bound(state: GameState, gameStatus: GameState['cloudSync']['gameStatus'] = 'in_progress'): GameState {
  return { ...state, cloudSync: { ...state.cloudSync, gameId: GAME, gameStatus, eventCloudPolicy: 'automatic' } }
}
const names = { tracked: 'Falcons', opponent: 'Visitors' }
const recorder = { recorderId: USER, displayName: 'Mark', eventCount: 3, checkpointEventCount: 3,
  checkpointSyncedAt: at(30), checkpointCurrent: true, unresolvedConflictCount: 0,
  isPrimary: true, primarySource: 'default' as const, canSelectPrimary: true }
function primary(state: GameState) { return { recorder, state, eventStream: state.eventStream!,
  inspection: inspectGameEventStream(state.eventStream!, gameEventRegistry) } }
function ready(extra: Record<string, unknown> = {}) { return [{ game_status: 'in_progress', can_finalize: true,
  can_reopen: false, primary_recorded_by: USER, primary_display_name: 'Mark', primary_ended: true,
  primary_checkpoint_current: true, primary_conflict_count: 0, primary_locked: false,
  active_publication_id: null, finalized_at: null, non_primary_attention_count: 0, ...extra }] }
function mockReady() {
  cloud.rpc.mockImplementation((name: string) => Promise.resolve({ error: null, data:
    name === 'get_baseball_finalization_readiness' ? ready() : name === 'finalize_baseball_event_game'
      ? { publication_id: 'pub-1', publication_number: 1, primary_recorded_by: USER, finalized_at: at(60) }
      : at(50) }))
}
beforeEach(() => {
  cloud.rpc.mockReset(); cloud.recorders.mockReset(); cloud.projection.mockReset()
  cloud.row = { data: { home_team_score: 3, opponent_score: 2 }, error: null }
  cloud.recorders.mockResolvedValue([recorder]); resetCurrentAuthUserIdForTests()
})

describe('BSB-6B2 finalization', () => {
  it('accepts every terminal outcome except suspension and reads replayed runs', () => {
    const p = projection(ended())
    for (const outcome of ['completed', 'run_rule', 'time_limit', 'forfeit', 'abandoned'] as const) {
      expect(baseballFinalizationEndReason({ ...p, status: outcome === 'abandoned' ? 'abandoned' : 'final',
        result: { ...p.result!, outcome } })).toBe(outcome)
    }
    const suspended = expectOk(endBaseballGame(live(), 'suspended', rc(20), { note: 'Rain' }))
    expect(baseballFinalizationEndReason(projection(suspended))).toBeNull()
    expect(baseballFinalizationEndReason(projection(live()))).toBeNull()
    expect(baseballPublishedScore({ ...p, score: { tracked: 2, opponent: 1 } })).toEqual({ tracked: 2, opponent: 1 })
  })
  it('makes a clone-safe setup-only schema-1 canonical payload and rejects mixed authority', () => {
    const state = ended(), snapshot = createBaseballCanonicalSnapshot(GAME, USER, state)
    expect(snapshot).toMatchObject({ version: 2, canonicalSchemaVersion: 1, sportId: 'baseball' })
    expect(Object.keys(snapshot.sportGameState).sort()).toEqual(['setup', 'sportId', 'version'])
    expect(parseBaseballCanonicalSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
    snapshot.sportGameState.setup.opponentName = 'Changed clone'
    expect(state.sportGameState?.sportId === 'baseball' && state.sportGameState.setup.opponentName).toBe('Visitors')
    expect(() => createBaseballCanonicalSnapshot(GAME, 'another-recorder', state)).toThrow(/primary recorder/)
    expect(() => parseBaseballCanonicalSnapshot({ ...snapshot, canonicalSchemaVersion: 2 })).toThrow(/invalid/)
    expect(() => parseBaseballCanonicalSnapshot({ ...snapshot, sportGameState: { ...snapshot.sportGameState, projection: {} } })).toThrow(/invalid/)
  })
  it('confirms exact revisions and rechecks readiness; optional decisions do not block', async () => {
    const state = bound(ended()); cloud.projection.mockResolvedValue(primary(state)); mockReady()
    const preview = await prepareBaseballFinalization(GAME)
    expect(preview).toMatchObject({ endReason: 'time_limit', score: { tracked: 0, opponent: 0 }, pitcherDecisionsMissing: true })
    expect(cloud.rpc.mock.calls.map(call => call[0])).toEqual(['get_baseball_finalization_readiness',
      'confirm_baseball_primary_checkpoint_for_finalization', 'get_baseball_finalization_readiness'])
    expect(cloud.rpc.mock.calls[1][1]).toMatchObject({ p_event_count: state.eventStream!.events.length,
      p_event_revisions: state.eventStream!.events.map(raw => ({ id: (raw as { id: string }).id, revision: 1 })).sort((a, b) => a.id.localeCompare(b.id)) })
    const result = await finalizeBaseballGame(preview)
    expect(result).toMatchObject({ score: { tracked: 3, opponent: 2 }, previewScore: { tracked: 0, opponent: 0 }, serverScoreConfirmed: true })
    expect(cloud.rpc).toHaveBeenLastCalledWith('finalize_baseball_event_game', expect.objectContaining({
      p_canonical_snapshot: expect.objectContaining({ sportId: 'baseball', canonicalSchemaVersion: 1 }) }))
    const decided = expectOk(setBaseballPitcherDecisions(state, baseballEmptyDecisions(), rc(21)))
    cloud.projection.mockResolvedValue(primary(decided))
    expect((await prepareBaseballFinalization(GAME)).pitcherDecisionsMissing).toBe(false)
  })
  it.each([{ can_finalize: false }, { primary_conflict_count: 1 }, { primary_recorded_by: null }])('refuses unready previews %j before checkpoint', async extra => {
    cloud.rpc.mockResolvedValue({ data: ready(extra), error: null })
    await expect(prepareBaseballFinalization(GAME)).rejects.toThrow()
    expect(cloud.rpc).toHaveBeenCalledTimes(1)
  })
  it('refuses suspension and changed readiness', async () => {
    cloud.projection.mockResolvedValue(primary(bound(expectOk(endBaseballGame(live(), 'suspended', rc(20), { note: 'Rain' })))))
    mockReady(); await expect(prepareBaseballFinalization(GAME)).rejects.toThrow(/Suspended/)
    expect(cloud.rpc).toHaveBeenCalledTimes(1)
    cloud.rpc.mockReset(); cloud.projection.mockResolvedValue(primary(bound(ended())))
    cloud.rpc.mockResolvedValueOnce({ data: ready(), error: null }).mockResolvedValueOnce({ data: at(50), error: null })
      .mockResolvedValueOnce({ data: ready({ primary_recorded_by: 'other' }), error: null })
    await expect(prepareBaseballFinalization(GAME)).rejects.toThrow(/changed/)
  })
  it('stops before checkpoint if auth changes during primary loading', async () => {
    setCurrentAuthUserId(USER); mockReady()
    cloud.projection.mockImplementation(async () => { setCurrentAuthUserId('other'); return primary(bound(ended())) })
    await expect(prepareBaseballFinalization(GAME, USER)).rejects.toThrow(/account changed/)
    expect(cloud.rpc.mock.calls.map(call => call[0])).toEqual(['get_baseball_finalization_readiness'])
  })
  it('requires a trimmed reopen reason and preserves invalidated publication history', async () => {
    await expect(reopenBaseballCloudGame(GAME, ' x ')).rejects.toThrow(/reason is required/)
    cloud.rpc.mockResolvedValueOnce({ data: { game_id: GAME, publication_id: 'pub-1', reopened_at: at(70) }, error: null })
    expect(await reopenBaseballCloudGame(GAME, '  Correct runner  ')).toMatchObject({ reason: 'Correct runner', gameId: GAME })
    expect(cloud.rpc).toHaveBeenLastCalledWith('reopen_baseball_event_game', { p_game_id: GAME, p_reason: 'Correct runner' })
    cloud.rpc.mockResolvedValueOnce({ data: [{ publication_id: 'pub-1', publication_number: 1, primary_recorded_by: USER,
      primary_display_name: 'Mark', finalized_by: USER, finalized_by_display_name: 'Mark', finalized_at: at(60),
      invalidated_by: USER, invalidated_by_display_name: 'Mark', invalidated_at: at(70), invalidation_reason: 'Correct runner', is_active: false }], error: null })
    expect(await loadBaseballCanonicalPublicationHistory(GAME)).toEqual([expect.objectContaining({ isActive: false, invalidationReason: 'Correct runner' })])
  })
})

describe('BSB-6B2 finalized cloud games and reopen handoff', () => {
  const handoff: BaseballReopenHandoff = { sportId: 'baseball', publicationId: 'pub-1', primaryRecorderId: USER,
    reason: 'Correct runner', reopenedAt: at(70) }
  it('rejects capture, lifecycle, corrections, Undo/Restore and decisions without changing facts', () => {
    const state = live(), id = (state.eventStream!.events[state.eventStream!.events.length - 1] as { id: string }).id
    const preview = previewBaseballRemoval(state, id, names)
    if (!preview.ok) throw new Error(preview.message)
    const final = bound(state, 'final')
    const mutations = [recordBaseballPitch(final, { result: 'ball' }, rc(2)), endBaseballGame(final, 'time_limit', rc(2)),
      reopenBaseballGame(final, 'Correct runner', rc(2)), undoBaseballPlay(final, at(2)), restoreBaseballPlay(final, at(2)),
      removeBaseballPlay(final, preview.preview, names, { now: at(2), confirmed: true })]
    for (const result of mutations) { expect(result).toMatchObject({ ok: false, message: BASEBALL_FINAL_CLOUD_GAME_MESSAGE }); expect(result.state).toBe(final) }
    expect(canUndoBaseballPlay(final)).toBe(false); expect(canRestoreBaseballPlay(final)).toBe(false)
    expect(previewBaseballRestore(final, { kind: 'restore_unit', unitId: id }, names).ok).toBe(false)
    const terminal = bound(ended(), 'final')
    expect(setBaseballPitcherDecisions(terminal, baseballEmptyDecisions(), rc(21))).toMatchObject({ ok: false, message: BASEBALL_FINAL_CLOUD_GAME_MESSAGE })
  })
  it('appends one primary-owned reopen, never before the last event; repeated application changes nothing', () => {
    const state = bound(ended(), 'final')
    const first = applyBaseballReopenHandoff(state, USER, GAME, { ...handoff, reopenedAt: at(5) })
    if (!first.ok) throw new Error(first.reason)
    expect(first.state.eventStream!.events[first.state.eventStream!.events.length - 1]).toMatchObject({ eventType: 'baseball.game_reopened',
      recorderUserId: USER, occurredAt: at(20), payload: { reason: handoff.reason } })
    expect(projection(first.state).status).toBe('in_progress')
    const again = applyBaseballReopenHandoff(first.state, USER, GAME, handoff)
    expect(again).toMatchObject({ ok: true, changed: false })
    expect(again.state.eventStream).toBe(first.state.eventStream)
  })
  it('a different manager only reopens the binding; recorder confirms locally and decisions lose the old epoch', () => {
    const decided = expectOk(setBaseballPitcherDecisions(ended(), baseballEmptyDecisions(), rc(21)))
    const state = bound(decided, 'final'), other = applyBaseballReopenHandoff(state, 'manager-b', GAME, handoff)
    if (!other.ok) throw new Error(other.reason)
    expect(other.state.eventStream).toBe(state.eventStream)
    expect(other.state.cloudSync.gameStatus).toBe('in_progress')
    const reopened = expectOk(reopenBaseballGame(other.state, 'Recorder confirms correction', rc(70)))
    const sport = reopened.sportGameState
    if (sport?.sportId !== 'baseball') throw new Error('sport')
    expect(baseballDecisionsView(sport, inspectGameEventStream(reopened.eventStream!, gameEventRegistry).activeEvents).current).toBeNull()
    expect(recordBaseballPitch(reopened, { result: 'ball' }, rc(71)).ok).toBe(true)
    expect(applyBaseballReopenHandoff(state, USER, 'wrong-game', handoff).ok).toBe(false)
    expect(applyBaseballReopenHandoff(state, USER, GAME, { ...handoff, reopenedAt: 'invalid' }).ok).toBe(false)
  })
  it('does not replay an old publication handoff after the recording ends and is finalized again', () => {
    const first = applyBaseballReopenHandoff(bound(ended(), 'final'), USER, GAME, handoff)
    if (!first.ok) throw new Error(first.reason)
    const finalizedAgain = bound(expectOk(endBaseballGame(first.state, 'time_limit', rc(80))), 'final')
    const again = applyBaseballReopenHandoff(finalizedAgain, USER, GAME, handoff)
    expect(again).toEqual({ ok: true, state: finalizedAgain, changed: false })
  })
  it('never appends this account to a foreign recorder stream', () => {
    const state = bound(ended(), 'final')
    const result = applyBaseballReopenHandoff(state, 'foreign-account', GAME, { ...handoff, primaryRecorderId: 'foreign-account' })
    expect(result).toMatchObject({ ok: false })
    expect(result.state).toBe(state)
    const refreshed = { ...state, cloudSync: { ...state.cloudSync, gameStatus: 'in_progress' } }
    expect(reopenBaseballGame(refreshed, 'Recorder confirms correction', { ...rc(70), recorderUserId: 'foreign-account' }))
      .toMatchObject({ ok: false, state: refreshed, message: 'Only this recording\'s recorder can reopen its local history.' })
  })
})
