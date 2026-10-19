import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))

const {
  baseballRecorderNeedsAttention,
  loadBaseballGameRecorders,
  loadBaseballPrimaryRecorderHistory,
  selectBaseballPrimaryRecorder,
} = await import('./recorders')

function recorderRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    recorder_user_id: id,
    display_name: `Recorder ${id}`,
    event_count: 12,
    checkpoint_event_count: 12,
    checkpoint_synced_at: '2026-10-04T12:00:00.000Z',
    checkpoint_current: true,
    unresolved_conflict_count: 0,
    is_primary: false,
    primary_source: null,
    can_select_primary: true,
    ...overrides,
  }
}

beforeEach(() => rpc.mockReset())

describe('BSB-6B2 Baseball recorder streams', () => {
  it('reads recorders and primary history through the fixed Baseball wrappers', async () => {
    rpc.mockResolvedValueOnce({
      data: [recorderRow('a', { is_primary: true, primary_source: 'default' }), recorderRow('b', { checkpoint_current: false })],
      error: null,
    })
    const recorders = await loadBaseballGameRecorders('game-1')
    expect(rpc).toHaveBeenLastCalledWith('get_baseball_game_recorders', { p_game_id: 'game-1' })
    expect(recorders.map(recorder => [recorder.recorderId, recorder.isPrimary, baseballRecorderNeedsAttention(recorder)]))
      .toEqual([['a', true, false], ['b', false, true]])

    rpc.mockResolvedValueOnce({ data: [], error: null })
    await loadBaseballPrimaryRecorderHistory('game-1')
    expect(rpc).toHaveBeenLastCalledWith('get_baseball_primary_recorder_history', { p_game_id: 'game-1' })
  })

  it('rejects two primaries and checks the selected recorder comes back', async () => {
    rpc.mockResolvedValueOnce({
      data: [recorderRow('a', { is_primary: true }), recorderRow('b', { is_primary: true })],
      error: null,
    })
    await expect(loadBaseballGameRecorders('game-1')).rejects.toThrow('Baseball recorder response contains multiple primary recorders.')

    rpc.mockResolvedValueOnce({ data: 'b', error: null })
    await selectBaseballPrimaryRecorder('game-1', 'b')
    expect(rpc).toHaveBeenLastCalledWith('set_baseball_primary_recorder', { p_game_id: 'game-1', p_recorded_by: 'b' })
    rpc.mockResolvedValueOnce({ data: 'a', error: null })
    await expect(selectBaseballPrimaryRecorder('game-1', 'b')).rejects.toThrow('Baseball primary recorder update returned an invalid response.')
  })
})
