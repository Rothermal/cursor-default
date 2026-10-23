import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { AGGREGATE_USER } from './aggregateTestFixtures'
import { BASEBALL_AGGREGATE_CAPABILITIES, BASEBALL_PERSONAL_LINK_CAPABILITIES, BASEBALL_PERSONAL_SETTINGS_CAPABILITIES,
  createBaseballFeatureClient, parseBaseballFeatureCapabilities } from './featureClient'

beforeEach(() => setCurrentAuthUserId(AGGREGATE_USER))
afterEach(resetCurrentAuthUserIdForTests)

describe('independent exact Baseball feature capabilities', () => {
  it.each(['aggregate', 'personal_links', 'personal_settings'] as const)('accepts the exact %s response only', feature => {
    const value = feature === 'aggregate' ? BASEBALL_AGGREGATE_CAPABILITIES : feature === 'personal_links' ? BASEBALL_PERSONAL_LINK_CAPABILITIES : BASEBALL_PERSONAL_SETTINGS_CAPABILITIES
    expect(() => parseBaseballFeatureCapabilities(value, feature)).not.toThrow()
    expect(() => parseBaseballFeatureCapabilities({ ...value, extra: 1 }, feature)).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseBaseballFeatureCapabilities({ contractVersion: 0 }, feature)).toThrow(expect.objectContaining({ code: 'backend_update_required' }))
    expect(() => parseBaseballFeatureCapabilities({ ...value, contractVersion: 2 }, feature)).toThrow(expect.objectContaining({ code: 'client_update_required' }))
    expect(() => parseBaseballFeatureCapabilities({ ...value, migration: -1 }, feature)).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseBaseballFeatureCapabilities({ ...value, migration: value.migration + 1 }, feature)).toThrow(expect.objectContaining({ code: 'client_update_required' }))
    expect(() => parseBaseballFeatureCapabilities({ ...value, migration: value.migration - 1 }, feature)).toThrow(expect.objectContaining({ code: 'backend_update_required' }))
  })
  it.each([null, [], {}, { contractVersion: 0, extra: true }, { contractVersion: -1 }, { contractVersion: '1' }])('rejects malformed capability %j', value => {
    expect(() => parseBaseballFeatureCapabilities(value, 'aggregate')).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })
  it('does not cache completed success across requests/clients/epochs or call the release RPC', async () => {
    const rpc = vi.fn(async () => ({ data: BASEBALL_AGGREGATE_CAPABILITIES, error: null }))
    const client = createBaseballFeatureClient(AGGREGATE_USER, { client: { rpc } })
    await client.require('aggregate'); await client.require('aggregate')
    expect(rpc.mock.calls).toHaveLength(2)
    expect(rpc).toHaveBeenCalledWith('get_baseball_aggregate_capabilities', undefined)
    const other = vi.fn(async () => ({ data: { contractVersion: 0 }, error: null }))
    await expect(createBaseballFeatureClient(AGGREGATE_USER, { client: { rpc: other } }).require('aggregate')).rejects.toMatchObject({ code: 'backend_update_required' })
  })
  it('rejects A -> B -> A after await and before another request', async () => {
    let resolve!: (value: { data: unknown; error: null }) => void
    const rpc = vi.fn(() => new Promise<{ data: unknown; error: null }>(r => { resolve = r }))
    const client = createBaseballFeatureClient(AGGREGATE_USER, { client: { rpc } })
    const pending = client.require('aggregate')
    setCurrentAuthUserId('other'); setCurrentAuthUserId(AGGREGATE_USER)
    resolve({ data: BASEBALL_AGGREGATE_CAPABILITIES, error: null })
    await expect(pending).rejects.toMatchObject({ code: 'stale_account' })
    await expect(client.request('never')).rejects.toMatchObject({ code: 'stale_account' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each([['PGRST202', 'backend_update_required'], ['42501', 'access_denied'], ['PGRST301', 'access_denied'], ['', 'transport']])('classifies RPC failure %s', async (code, expected) => {
    const client = createBaseballFeatureClient(AGGREGATE_USER, { client: { rpc: async () => ({ data: null, error: { code, message: 'failed' } }) } })
    await expect(client.require('aggregate')).rejects.toMatchObject({ code: expected })
  })
})
