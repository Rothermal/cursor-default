import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { AGGREGATE_USER } from './aggregateTestFixtures'
import { BASEBALL_PERSONAL_SETTINGS_CAPABILITIES, type BaseballRpcClient } from './featureClient'
import { createBaseballPersonalSettingsAdapter, loadBaseballPersonalSettings, parseBaseballPersonalCloudRecord, saveBaseballPersonalSettings, validBaseballPersonalSettingsCache } from './personalSettingsSync'
import { defaultBaseballPersonalSettings } from './settings'

const record = () => ({ sportId: 'baseball', schemaVersion: 1, revision: 1, settings: defaultBaseballPersonalSettings(), updatedAt: '2026-10-23T00:00:00Z', updatedBy: null })
beforeEach(() => setCurrentAuthUserId(AGGREGATE_USER))
afterEach(resetCurrentAuthUserIdForTests)
const client = (response: unknown) => ({ rpc: vi.fn(async (name: string) => ({ data: name.includes('capabilities') ? BASEBALL_PERSONAL_SETTINGS_CAPABILITIES : response, error: null })) })

describe('Baseball fixed personal-settings transport', () => {
  it('uses only the independent capability and fixed personal read/save RPCs', async () => {
    const reader = client({ status: 'loaded', record: record() })
    expect(await loadBaseballPersonalSettings(AGGREGATE_USER, { client: reader })).toEqual({ status: 'loaded', record: record() })
    expect(reader.rpc.mock.calls.map(([name]) => name)).toEqual(['get_baseball_personal_settings_capabilities', 'get_baseball_personal_settings'])
    const writer = client({ status: 'applied', record: record() })
    expect(await saveBaseballPersonalSettings(AGGREGATE_USER, null, defaultBaseballPersonalSettings(), { client: writer })).toMatchObject({ status: 'applied' })
    expect(reader.rpc).toHaveBeenLastCalledWith('get_baseball_personal_settings', { p_expected_user_id: AGGREGATE_USER })
    expect(writer.rpc).toHaveBeenLastCalledWith('save_baseball_user_settings_revisioned', { p_expected_user_id: AGGREGATE_USER, p_expected_revision: null, p_settings: defaultBaseballPersonalSettings() })
  })
  it('accepts explicit missing and CAS conflict-null, without manufacturing a record', async () => {
    expect(await loadBaseballPersonalSettings(AGGREGATE_USER, { client: client({ status: 'missing' }) })).toEqual({ status: 'missing' })
    expect(await saveBaseballPersonalSettings(AGGREGATE_USER, 1, defaultBaseballPersonalSettings(), { client: client({ status: 'conflict', record: null }) })).toEqual({ status: 'conflict', record: null })
  })
  it.each([
    null, {}, { ...record(), extra: true }, { ...record(), sportId: 'soccer' },
    { ...record(), schemaVersion: 2 }, { ...record(), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...record(), updatedAt: 'not a date' }, { ...record(), updatedBy: AGGREGATE_USER },
    { ...record(), settings: null }, { ...record(), settings: { ...defaultBaseballPersonalSettings(), lineupDefaults: {} } },
  ])('rejects malformed cloud record %j', value => {
    expect(() => parseBaseballPersonalCloudRecord(value)).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })
  it.each([{ status: 'missing', extra: true }, { status: 'loaded' }, { status: 'loaded', record: record(), extra: true }])('rejects malformed read envelope %j', async response => {
    await expect(loadBaseballPersonalSettings(AGGREGATE_USER, { client: client(response) })).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it.each([
    { status: 'applied', record: null }, { status: 'applied', record: { ...record(), revision: 3 } },
    { status: 'applied', record: { ...record(), settings: { ...defaultBaseballPersonalSettings(), ruleOverrides: { scheduledInnings: 3 } } } },
    { status: 'conflict', record: record(), extra: true },
    { status: ['applied'], record: record() }, { status: { value: 'applied' }, record: record() },
  ])('rejects invalid or nonmatching save receipts %j', async response => {
    await expect(saveBaseballPersonalSettings(AGGREGATE_USER, null, defaultBaseballPersonalSettings(), { client: client(response) })).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it.each([null, undefined, { ...defaultBaseballPersonalSettings(), extra: true }])('rejects invalid save input before any request %j', async value => {
    const transport = client(null)
    await expect(saveBaseballPersonalSettings(AGGREGATE_USER, null, value as never, { client: transport })).rejects.toMatchObject({ code: 'invalid_response' })
    expect(transport.rpc).not.toHaveBeenCalled()
  })
  it('stops after unavailable capability and retains typed failures', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'Missing RPC' } }))
    await expect(loadBaseballPersonalSettings(AGGREGATE_USER, { client: { rpc } })).rejects.toMatchObject({ code: 'backend_update_required' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects missing saved payloads and unsafe cache revisions without normalizing them to defaults', () => {
    const adapter = createBaseballPersonalSettingsAdapter(AGGREGATE_USER)
    const cache = { version: 1 as const, sportId: 'baseball', schemaVersion: 1, revision: 1, settings: defaultBaseballPersonalSettings(), pending: null, cloudUpdatedAt: null, cachedAt: 'now' }
    expect(validBaseballPersonalSettingsCache(adapter, cache)).not.toBeNull()
    expect(validBaseballPersonalSettingsCache(adapter, { ...cache, settings: null })).toBeNull()
    expect(validBaseballPersonalSettingsCache(adapter, { ...cache, revision: Number.MAX_SAFE_INTEGER + 1 })).toBeNull()
    expect(validBaseballPersonalSettingsCache(adapter, { ...cache, pending: { baseRevision: Number.MAX_SAFE_INTEGER + 1, savedAt: 'now' } })).toBeNull()
  })
  it('cancels A -> B -> A between capability and read, and invalidates old adapters', async () => {
    let resolve!: (value: { data: unknown; error: null }) => void
    const transport: BaseballRpcClient = { rpc: vi.fn(() => new Promise<{ data: unknown; error: null }>(r => { resolve = r })) }
    const adapter = createBaseballPersonalSettingsAdapter(AGGREGATE_USER, { client: transport })
    const pending = loadBaseballPersonalSettings(AGGREGATE_USER, { client: transport })
    setCurrentAuthUserId('other'); setCurrentAuthUserId(AGGREGATE_USER)
    resolve({ data: BASEBALL_PERSONAL_SETTINGS_CAPABILITIES, error: null })
    await expect(pending).rejects.toMatchObject({ code: 'stale_account' })
    await expect(adapter.save(null, defaultBaseballPersonalSettings())).rejects.toMatchObject({ code: 'stale_account' })
    expect(transport.rpc).toHaveBeenCalledTimes(1)
  })
})
