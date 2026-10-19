import { describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { endBaseballGame } from './commands'
import { createBaseballCanonicalSnapshot, type BaseballCanonicalPublication } from './finalization'
import type { BaseballRecorderSummary } from './recorders'
import { baseballSummarySource } from './summary'
import { loadBaseballSummarySource, projectBaseballCanonicalPublication, type BaseballSummarySourceDependencies } from './summarySource'
import { ballInPlay, ctx, expectOk, startedGame } from './testFixtures'

const PRIMARY: BaseballRecorderSummary = {
  recorderId: 'recorder-a', displayName: 'Primary', eventCount: null, checkpointEventCount: null,
  checkpointSyncedAt: null, checkpointCurrent: false, unresolvedConflictCount: null,
  isPrimary: true, primarySource: 'default', canSelectPrimary: false,
}

function owned(state: GameState): GameState {
  return { ...state, gameInfo: { teamName: 'Cloud Falcons', opponentName: 'Visitors', tournamentName: '', date: '2026-10-19' },
    eventStream: { ...state.eventStream!, events: state.eventStream!.events.map(event => ({ ...(event as object), recorderUserId: PRIMARY.recorderId })) },
    cloudSync: { ...state.cloudSync, gameId: 'cloud-a', gameStatus: 'in_progress' } }
}
function played() { return owned(ballInPlay(startedGame(), 'home_run')) }
function ended() { return owned(expectOk(endBaseballGame(played(), 'time_limit', { ...ctx(), recorderUserId: PRIMARY.recorderId }))) }
function shell(state: GameState, status = 'in_progress'): GameState {
  return { ...state, eventStream: null, cloudSync: { ...state.cloudSync, gameStatus: status } }
}
function publication(state: GameState): BaseballCanonicalPublication {
  return { publicationId: 'pub-1', publicationNumber: 1, primaryRecorderId: PRIMARY.recorderId,
    primaryDisplayName: 'Primary', snapshot: createBaseballCanonicalSnapshot('cloud-a', PRIMARY.recorderId, state),
    snapshotFingerprint: 'fp', finalizedBy: 'manager', finalizedByDisplayName: 'Manager', finalizedAt: '2026-10-19T12:00:00Z' }
}
function deps(state: GameState, status = 'in_progress'): BaseballSummarySourceDependencies {
  return { loadCloudState: vi.fn(async () => shell(state, status)), loadRecorders: vi.fn(async () => [PRIMARY]),
    loadRecorder: vi.fn(async (_id, recorder) => ({ recorder, state, eventStream: state.eventStream!, inspection: baseballSummarySource(state).inspection })),
    loadCanonical: vi.fn(async () => publication(state)) }
}

describe('BSB-6C Summary source authority', () => {
  it('keeps local and resumed/parked snapshots synchronous without cloud calls', async () => {
    const state = ended(), d = deps(state)
    state.cloudSync.gameId = null
    const before = structuredClone(state)
    expect((await loadBaseballSummarySource(state, null, d)).kind).toBe('local')
    expect(baseballSummarySource(state).healthy).toBe(true)
    expect(d.loadCloudState).not.toHaveBeenCalled()
    expect(state).toEqual(before)
  })
  it('reads one effective primary, even for a compact viewer with no checkpoint eligibility', async () => {
    const state = played(), d = deps(state)
    d.loadRecorders = vi.fn(async () => [{ ...PRIMARY, recorderId: 'other', isPrimary: false }, PRIMARY])
    const source = await loadBaseballSummarySource(createInitialState(), 'cloud-a', d)
    expect(source).toMatchObject({ kind: 'cloud_primary', healthy: true, recorderName: 'Primary' })
    expect(source.sport?.projection.score).toEqual({ tracked: 0, opponent: 1 })
    expect(d.loadRecorder).toHaveBeenCalledTimes(1)
    expect(d.loadRecorder).toHaveBeenCalledWith('cloud-a', PRIMARY, expect.any(Function))
    expect(d.loadCanonical).not.toHaveBeenCalled()
  })
  it('always reads canonical for a final cloud binding, ignoring its local or primary history', async () => {
    const state = ended(), d = deps(state, 'final')
    const local = { ...played(), cloudSync: { ...state.cloudSync, gameStatus: 'final' } }
    const before = structuredClone(local)
    const source = await loadBaseballSummarySource(local, null, d)
    expect(source).toMatchObject({ kind: 'canonical', healthy: true })
    expect(source.sport?.projection.status).toBe('final')
    expect(d.loadRecorder).not.toHaveBeenCalled()
    expect(local).toEqual(before)
  })
  it('replays primary events, ignoring tampered state projection, state events and inspection totals', async () => {
    const state = played(), d = deps(state)
    const wrong = ended()
    if (wrong.sportGameState?.sportId !== 'baseball') throw Error('Missing Baseball setup')
    wrong.sportGameState.projection.score = { tracked: 987, opponent: 654 }
    d.loadRecorder = vi.fn(async () => ({ recorder: PRIMARY, state: wrong, eventStream: state.eventStream!, inspection: baseballSummarySource(state).inspection }))
    const source = await loadBaseballSummarySource(createInitialState(), 'cloud-a', d)
    expect(source.healthy).toBe(true)
    expect(source.sport?.projection.status).toBe('in_progress')
    expect(source.sport?.projection.score).toEqual({ tracked: 0, opponent: 1 })
  })
  it.each(['missing', 'corrupt'])('never falls back from a %s final publication', async mode => {
    const state = ended(), d = deps(state, 'final')
    d.loadCanonical = vi.fn(async () => { if (mode === 'corrupt') throw Error('corrupt publication'); return null })
    const source = await loadBaseballSummarySource(played(), 'cloud-a', d)
    expect(source).toMatchObject({ kind: 'canonical', healthy: false })
    expect(source.state.gameInfo?.teamName).toBe('Cloud Falcons')
    expect(source.sport?.setup.opponentName).toBe('Visitors')
    expect(d.loadRecorders).not.toHaveBeenCalled()
    expect(d.loadRecorder).not.toHaveBeenCalled()
  })
  it.each(['absent', 'multiple', 'quarantined', 'invalid events', 'mixed ownership', 'wrong setup', 'wrong binding'])('withholds %s primary data', async mode => {
    const state = played(), d = deps(state)
    if (mode === 'absent') d.loadRecorders = async () => []
    if (mode === 'multiple') d.loadRecorders = async () => [PRIMARY, { ...PRIMARY, recorderId: 'other' }]
    const loaded = await d.loadRecorder('cloud-a', PRIMARY, () => {})
    if (mode === 'quarantined') loaded.inspection = { ...loaded.inspection, complete: false }
    if (mode === 'invalid events') loaded.eventStream = { version: 1, events: [{ invalid: true }] }
    if (mode === 'mixed ownership') loaded.eventStream = { ...loaded.eventStream, events: loaded.eventStream.events.map(event => ({ ...(event as object), recorderUserId: 'other' })) }
    if (mode === 'wrong setup') loaded.state = { ...state, sportGameState: { ...state.sportGameState!, setup: { ...state.sportGameState!.setup, sourceTeamId: 'other' } } } as GameState
    if (mode === 'wrong binding') loaded.state = { ...state, cloudSync: { ...state.cloudSync, gameId: 'other' } }
    d.loadRecorder = async () => loaded
    const source = await loadBaseballSummarySource(createInitialState(), 'cloud-a', d)
    expect(source.healthy).toBe(false)
    expect(source.diagnostic).toBeTruthy()
  })
  it.each(['game', 'primary', 'owner', 'team', 'season', 'participant', 'envelope', 'cached projection', 'not ended', 'suspended'])('rejects canonical %s mismatch', mode => {
    const state = ended(), pub = publication(state)
    if (mode === 'game') pub.snapshot.gameId = 'other'
    if (mode === 'primary') pub.primaryRecorderId = 'other'
    if (mode === 'owner') pub.snapshot.eventStream.events = pub.snapshot.eventStream.events.map(event => ({ ...(event as object), recorderUserId: 'other' }))
    if (mode === 'team') pub.snapshot.sportGameState.setup.sourceTeamId = 'other'
    if (mode === 'season') pub.snapshot.sportGameState.setup.sourceSeasonId = 'other'
    if (mode === 'participant') pub.snapshot.sportGameState.setup.participants[0].displayName = 'Other identity'
    if (mode === 'envelope') Object.assign(pub.snapshot, { version: 99 })
    if (mode === 'cached projection') Object.assign(pub.snapshot.sportGameState, { projection: { score: { tracked: 99, opponent: 0 } } })
    if (mode === 'not ended') pub.snapshot = publication(played()).snapshot
    if (mode === 'suspended') pub.snapshot = publication(owned(expectOk(endBaseballGame(played(), 'suspended', { ...ctx(), recorderUserId: PRIMARY.recorderId }, { note: 'Rain' })))).snapshot
    const source = projectBaseballCanonicalPublication(shell(state, 'final'), pub)
    expect(source.healthy).toBe(false)
    expect(source.sport?.setup).toEqual(state.sportGameState!.setup)
  })
  it('retries once when primary changes during loading, without blending the first result', async () => {
    const state = played(), d = deps(state)
    const second = { ...PRIMARY, recorderId: 'recorder-b', displayName: 'Second' }
    let reads = 0
    d.loadRecorders = async () => ++reads === 1 ? [PRIMARY] : [second]
    d.loadRecorder = vi.fn(async (_id, recorder) => ({ recorder, state,
      eventStream: { ...state.eventStream!, events: state.eventStream!.events.map(event => ({ ...(event as object), recorderUserId: recorder.recorderId })) },
      inspection: baseballSummarySource(state).inspection }))
    const source = await loadBaseballSummarySource(createInitialState(), 'cloud-a', d)
    expect(source).toMatchObject({ healthy: true, recorderName: 'Second' })
    expect(d.loadRecorder).toHaveBeenCalledTimes(2)
  })
  it('retries a transition to final and reads only the active publication', async () => {
    const state = ended(), d = deps(state)
    let reads = 0
    d.loadCloudState = async () => shell(state, ++reads === 1 ? 'in_progress' : 'final')
    const source = await loadBaseballSummarySource(createInitialState(), 'cloud-a', d)
    expect(source).toMatchObject({ healthy: true, kind: 'canonical' })
    expect(d.loadRecorder).toHaveBeenCalledTimes(1)
  })
  it('retries a changed publication and refuses ongoing authority churn', async () => {
    const state = ended(), d = deps(state, 'final')
    let reads = 0
    d.loadCanonical = async () => ({ ...publication(state), publicationId: `pub-${++reads}` })
    await expect(loadBaseballSummarySource(createInitialState(), 'cloud-a', d)).rejects.toThrow(/changed during review/)
    expect(reads).toBe(4)
  })
  it.each(['shell', 'recorders', 'recorder', 'canonical', 'confirmation'])('checks account/request lifetime after %s before further reads', async step => {
    const state = ended(), d = deps(state, step === 'canonical' ? 'final' : 'in_progress')
    let active = true, shellReads = 0
    const guard = () => { if (!active) throw Error('cancelled') }
    const wrap = <T>(value: T) => { active = false; return value }
    const originalShell = d.loadCloudState
    d.loadCloudState = vi.fn(async id => {
      const value = await originalShell(id)
      return step === 'shell' || (step === 'confirmation' && ++shellReads === 2) ? wrap(value) : value
    })
    if (step === 'recorders') d.loadRecorders = vi.fn(async () => wrap([PRIMARY]))
    if (step === 'recorder') { const original = d.loadRecorder; d.loadRecorder = vi.fn(async (id, recorder, current) => wrap(await original(id, recorder, current))) }
    if (step === 'canonical') d.loadCanonical = vi.fn(async () => wrap(publication(state)))
    await expect(loadBaseballSummarySource(createInitialState(), 'cloud-a', d, guard)).rejects.toThrow('cancelled')
    if (step === 'shell') expect(d.loadRecorders).not.toHaveBeenCalled()
    if (step === 'recorders' || step === 'canonical') expect(d.loadRecorder).not.toHaveBeenCalled()
  })
})
