import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { aggregateUuid, AGGREGATE_USER } from './aggregateTestFixtures'
import { createBaseballMyPlayer } from './personalLinkReview'

const id = aggregateUuid(900)
const row = { id, first_name: 'New player', last_name: null, nickname: null }
function fixture() {
  const responses = [{ data: row, error: null }] as Array<{ data: typeof row | null; error: { code?: string; message: string } | null }>
  const writes = vi.fn(), filters = vi.fn()
  let hold: Promise<void> | null = null
  const client = { from: vi.fn(() => ({
    insert: (value: unknown) => { writes(value); return { select: () => ({ single: async () => { if (hold) await hold; return responses.shift()! } }) } },
    select: () => { const query = { eq: (key: string, value: string) => { filters(key, value); return query }, single: async () => responses.shift()! }; return query },
  })) } as unknown as SupabaseClient
  return { client, responses, writes, filters, pause: () => { let release!: () => void; hold = new Promise<void>(resolve => { release = resolve }); return release } }
}
beforeEach(() => setCurrentAuthUserId(AGGREGATE_USER))
afterEach(resetCurrentAuthUserIdForTests)
describe('Explicit Baseball My Player creation', () => {
  it('creates exactly the requested player under the current creator account', async () => {
    const f = fixture()
    expect(await createBaseballMyPlayer(AGGREGATE_USER, id, ' New player ', () => {}, f.client)).toEqual({ id, displayName: 'New player' })
    expect(f.writes).toHaveBeenCalledWith({ id, created_by: AGGREGATE_USER, first_name: 'New player', last_name: null })
  })
  it('resolves a duplicate-id retry only through a creator-scoped read', async () => {
    const f = fixture(); f.responses.unshift({ data: null, error: { code: '23505', message: 'Duplicate' } })
    expect((await createBaseballMyPlayer(AGGREGATE_USER, id, row.first_name, () => {}, f.client)).id).toBe(id)
    expect(f.filters.mock.calls).toEqual([['id', id], ['created_by', AGGREGATE_USER]])
  })
  it('does not accept an unrelated returned identity or a duplicate inaccessible player', async () => {
    const f = fixture(); f.responses[0] = { data: { ...row, id: aggregateUuid(901) }, error: null }
    await expect(createBaseballMyPlayer(AGGREGATE_USER, id, row.first_name, () => {}, f.client)).rejects.toThrow('could not be created')
    f.responses.push({ data: null, error: { code: '23505', message: 'Duplicate' } }, { data: null, error: null })
    await expect(createBaseballMyPlayer(AGGREGATE_USER, id, row.first_name, () => {}, f.client)).rejects.toThrow('Duplicate')
  })
  it('refuses an old account before inserting', async () => {
    const f = fixture(); setCurrentAuthUserId(aggregateUuid(2))
    await expect(createBaseballMyPlayer(AGGREGATE_USER, id, row.first_name, () => {}, f.client)).rejects.toThrow('account changed')
    expect(f.writes).not.toHaveBeenCalled()
  })
  it('does not settle a held creation after A -> B -> A or setup cancellation', async () => {
    const f = fixture(), release = f.pause()
    const pending = createBaseballMyPlayer(AGGREGATE_USER, id, row.first_name, () => {}, f.client)
    setCurrentAuthUserId(aggregateUuid(2)); setCurrentAuthUserId(AGGREGATE_USER); release()
    await expect(pending).rejects.toThrow('account changed')
    await expect(createBaseballMyPlayer(AGGREGATE_USER, id, row.first_name, () => { throw Error('Setup cancelled') }, f.client)).rejects.toThrow('Setup cancelled')
    expect(f.writes).toHaveBeenCalledTimes(1)
  })
  it('rejects empty names and unconfigured clients without side effects', async () => {
    const f = fixture()
    await expect(createBaseballMyPlayer(AGGREGATE_USER, id, ' ', () => {}, f.client)).rejects.toThrow('required')
    await expect(createBaseballMyPlayer(AGGREGATE_USER, id, 'Player', () => {}, null)).rejects.toThrow('required')
    expect(f.writes).not.toHaveBeenCalled()
  })
})
