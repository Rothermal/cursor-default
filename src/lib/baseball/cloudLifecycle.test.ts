import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadBaseballCloudGameStatus } from './cloudLifecycle'

const h = vi.hoisted(() => ({ read: vi.fn(), select: vi.fn(), eq: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: () => ({ select: (columns: string) => {
  h.select(columns)
  return { eq: (column: string, value: string) => {
    h.eq(column, value)
    return { maybeSingle: () => h.read() }
  } }
} }) } }))
beforeEach(() => { h.read.mockReset(); h.select.mockClear(); h.eq.mockClear() })
describe('Baseball status-only cloud read', () => {
  it.each(['scheduled', 'in_progress', 'final'])('reads exact %s status without recorder data', async status => {
    h.read.mockResolvedValue({ data: { id: 'cloud-a', sport_id: 'baseball', status }, error: null })
    expect(await loadBaseballCloudGameStatus('cloud-a')).toBe(status)
    expect(h.select).toHaveBeenCalledWith('id,sport_id,status')
    expect(h.eq).toHaveBeenCalledWith('id', 'cloud-a')
  })
  it.each([null, { id: 'other', sport_id: 'baseball', status: 'final' },
    { id: 'cloud-a', sport_id: 'basketball', status: 'final' },
    { id: 'cloud-a', sport_id: 'baseball', status: 'unknown' }])('rejects absent or malformed status %j', async data => {
    h.read.mockResolvedValue({ data, error: null })
    await expect(loadBaseballCloudGameStatus('cloud-a')).rejects.toThrow('unavailable')
  })
  it('surfaces an inaccessible cloud row without manufacturing an open status', async () => {
    h.read.mockResolvedValue({ data: null, error: { message: 'Access denied' } })
    await expect(loadBaseballCloudGameStatus('cloud-a')).rejects.toThrow('Access denied')
  })
})
