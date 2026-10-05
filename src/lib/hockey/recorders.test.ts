import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))

const {
  hockeyRecorderNeedsAttention,
  loadHockeyGameRecorders,
  loadHockeyPrimaryRecorderHistory,
  selectHockeyPrimaryRecorder,
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

describe('HKY-5B2 Hockey recorder streams', () => {
  it('reads recorders and primary history through the fixed Hockey wrappers', async () => {
    rpc.mockResolvedValueOnce({
      data: [recorderRow('a', { is_primary: true, primary_source: 'default' }), recorderRow('b', { checkpoint_current: false })],
      error: null,
    })
    const recorders = await loadHockeyGameRecorders('game-1')
    expect(rpc).toHaveBeenLastCalledWith('get_hockey_game_recorders', { p_game_id: 'game-1' })
    expect(recorders.map(recorder => [recorder.recorderId, recorder.isPrimary, hockeyRecorderNeedsAttention(recorder)]))
      .toEqual([['a', true, false], ['b', false, true]])

    rpc.mockResolvedValueOnce({ data: [], error: null })
    await loadHockeyPrimaryRecorderHistory('game-1')
    expect(rpc).toHaveBeenLastCalledWith('get_hockey_primary_recorder_history', { p_game_id: 'game-1' })
  })

  it('rejects two primaries and checks the selected recorder comes back', async () => {
    rpc.mockResolvedValueOnce({
      data: [recorderRow('a', { is_primary: true }), recorderRow('b', { is_primary: true })],
      error: null,
    })
    await expect(loadHockeyGameRecorders('game-1')).rejects.toThrow('Hockey recorder response contains multiple primary recorders.')

    rpc.mockResolvedValueOnce({ data: 'b', error: null })
    await selectHockeyPrimaryRecorder('game-1', 'b')
    expect(rpc).toHaveBeenLastCalledWith('set_hockey_primary_recorder', { p_game_id: 'game-1', p_recorded_by: 'b' })
    rpc.mockResolvedValueOnce({ data: 'a', error: null })
    await expect(selectHockeyPrimaryRecorder('game-1', 'b')).rejects.toThrow('Hockey primary recorder update returned an invalid response.')
  })
})
