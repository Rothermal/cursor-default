import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { startBaseballGame } from './commands'
import { createBaseballEventGameState } from './setupBuilder'
import { baseballSetup, ctx, pitch } from './testFixtures'

const cloudMock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), upsert: vi.fn(), load: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => cloudMock.rpc(...args),
    from: (...args: unknown[]) => cloudMock.from(...args),
  },
}))

vi.mock('../gameEvents/cloud', () => ({
  upsertGameEventForRecorder: (...args: unknown[]) => cloudMock.upsert(...args),
  loadGameEventStreamForRecorder: (...args: unknown[]) => cloudMock.load(...args),
}))

const { syncBaseballEventGameToCloud } = await import('./cloudSync')

const baseball = sports.find(sport => sport.id === 'baseball')!

/** A team cloud game recorded by user-a: the start plus two pitches, never uploaded. */
function teamGame(): GameState {
  const setup = { ...baseballSetup(), sourceTeamId: 'team-1', sourceSeasonId: 'season-1' }
  const created = createBaseballEventGameState({ sport: baseball, setup, teamName: 'Home', date: '2026-10-18', cloudPolicy: 'automatic' })
  if (!created.ok) throw new Error(created.message)
  const started = startBaseballGame(created.state, ctx())
  if (!started.ok) throw new Error(started.message)
  const recorder = (state: GameState) => ({
    ...state,
    eventStream: {
      ...state.eventStream!,
      events: state.eventStream!.events.map(event => ({ ...(event as Record<string, unknown>), recorderUserId: 'user-a' })),
    },
  })
  return recorder(pitch(pitch(started.state, { result: 'ball' }), { result: 'called_strike' }))
}

let signedIn = 'user-a'
const assertCurrent = () => {
  if (signedIn !== 'user-a') throw new Error('The signed-in account changed before Baseball cloud sync.')
}
const rpcNames = () => cloudMock.rpc.mock.calls.map(call => call[0])

beforeEach(() => {
  signedIn = 'user-a'
  cloudMock.rpc.mockReset()
  cloudMock.from.mockReset()
  cloudMock.upsert.mockReset()
  cloudMock.load.mockReset()
  cloudMock.rpc.mockImplementation((name: string) => Promise.resolve(
    name === 'bind_baseball_event_game_v5'
      ? { data: { game_id: 'cloud-game-1', game_status: 'in_progress', participant_id_map: {} }, error: null }
      : { data: '2026-10-18T12:01:00.000Z', error: null }
  ))
  cloudMock.from.mockReturnValue({
    select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
    update: () => ({ eq: () => ({ is: () => Promise.resolve({ data: [], error: null }) }) }),
  })
  cloudMock.upsert.mockResolvedValue({ ok: true, status: 'applied' })
  cloudMock.load.mockResolvedValue({
    ok: true,
    eventStream: { version: 1, events: [] },
    inspection: { complete: true, activeEvents: [], deletedEvents: [], diagnostics: [] },
    quarantinedRows: [],
    error: null,
  })
})

describe('BSB-6B1 review: the upload stops when the recorder account changes', () => {
  it('uploads every event and confirms the checkpoint while the account stays the same', async () => {
    const state = teamGame()
    await syncBaseballEventGameToCloud({ state, userId: 'user-a', localGameId: 'local-1', assertCurrent })
    expect(cloudMock.upsert).toHaveBeenCalledTimes(state.eventStream!.events.length)
    expect(rpcNames()).toContain('confirm_game_event_stream_checkpoint')
  })

  it('writes nothing when the account changes while the remote stream loads', async () => {
    cloudMock.load.mockImplementation(async () => {
      signedIn = 'user-b'
      return {
        ok: true,
        eventStream: { version: 1, events: [] },
        inspection: { complete: true, activeEvents: [], deletedEvents: [], diagnostics: [] },
        quarantinedRows: [],
        error: null,
      }
    })
    await expect(syncBaseballEventGameToCloud({ state: teamGame(), userId: 'user-a', localGameId: 'local-1', assertCurrent }))
      .rejects.toThrow('signed-in account changed')
    expect(cloudMock.upsert).not.toHaveBeenCalled()
    expect(rpcNames()).not.toContain('confirm_game_event_stream_checkpoint')
  })

  it('stops between event writes and never confirms the checkpoint', async () => {
    cloudMock.upsert.mockImplementationOnce(async () => {
      signedIn = 'user-b'
      return { ok: true, status: 'applied' }
    })
    await expect(syncBaseballEventGameToCloud({ state: teamGame(), userId: 'user-a', localGameId: 'local-1', assertCurrent }))
      .rejects.toThrow('signed-in account changed')
    expect(cloudMock.upsert).toHaveBeenCalledTimes(1)
    expect(rpcNames()).not.toContain('confirm_game_event_stream_checkpoint')
  })

  it('does not settle a result when the account changes during the checkpoint', async () => {
    cloudMock.rpc.mockImplementation((name: string) => {
      if (name === 'confirm_game_event_stream_checkpoint') signedIn = 'user-b'
      return Promise.resolve(
        name === 'bind_baseball_event_game_v5'
          ? { data: { game_id: 'cloud-game-1', game_status: 'in_progress', participant_id_map: {} }, error: null }
          : { data: '2026-10-18T12:01:00.000Z', error: null }
      )
    })
    await expect(syncBaseballEventGameToCloud({ state: teamGame(), userId: 'user-a', localGameId: 'local-1', assertCurrent }))
      .rejects.toThrow('signed-in account changed')
  })

  it('does not bind when the account already changed', async () => {
    signedIn = 'user-b'
    await expect(syncBaseballEventGameToCloud({ state: teamGame(), userId: 'user-a', localGameId: 'local-1', assertCurrent }))
      .rejects.toThrow('signed-in account changed')
    expect(cloudMock.rpc).not.toHaveBeenCalled()
  })
})
