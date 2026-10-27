import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventRecorderNeedsAttention, loadEventGameRecorders } from './recorders'

const mock = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mock.rpc(...args) } }))
beforeEach(() => mock.rpc.mockReset())

const pending = {
  recorder_user_id: 'recorder-1', display_name: 'Recorder', event_count: 1,
  checkpoint_event_count: null, checkpoint_synced_at: null, checkpoint_current: false,
  unresolved_conflict_count: 0, is_primary: false, primary_source: null, can_select_primary: true,
}
const sports = ['soccer', 'basketball', 'hockey', 'baseball'] as const
const rpcs = (sport: string) => ({ label: sport, recorders: `get_${sport}_game_recorders`,
  primaryHistory: `get_${sport}_primary_recorder_history`, setPrimary: `set_${sport}_primary_recorder` })

describe('shared pending recorder contract', () => {
  it.each(sports)('shows a valid pending %s stream without inventing a primary', async sport => {
    mock.rpc.mockResolvedValue({ data: [pending], error: null })
    const rows = await loadEventGameRecorders(rpcs(sport), 'game-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ isPrimary: false, primarySource: null, canSelectPrimary: true,
      checkpointCurrent: false, checkpointEventCount: null })
    expect(eventRecorderNeedsAttention(rows[0])).toBe(true)
    expect(mock.rpc).toHaveBeenCalledWith(`get_${sport}_game_recorders`, { p_game_id: 'game-1' })
  })

  it.each(sports)('still rejects an invalid nullable %s primary flag', async sport => {
    mock.rpc.mockResolvedValue({ data: [{ ...pending, is_primary: null }], error: null })
    await expect(loadEventGameRecorders(rpcs(sport), 'game-1')).rejects.toThrow('Invalid primary status.')
  })

  it('does not infer primary-selection permission from stream ownership', async () => {
    mock.rpc.mockResolvedValue({ data: [{ ...pending, can_select_primary: false }], error: null })
    expect((await loadEventGameRecorders(rpcs('basketball'), 'game-1'))[0].canSelectPrimary).toBe(false)
  })
})
