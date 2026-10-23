import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from '../authIdentity'
import { sportSettingsCacheKey } from '../sportSettingsStorage'
import { AGGREGATE_USER } from './aggregateTestFixtures'
import { BASEBALL_PERSONAL_SETTINGS_CAPABILITIES } from './featureClient'
import { createBaseballPersonalSettingsController } from './personalSettingsController'
import { defaultBaseballPersonalSettings, type BaseballPersonalSettingsV1 } from './settings'

const settings = (innings = 7): BaseballPersonalSettingsV1 => ({ ...defaultBaseballPersonalSettings(), ruleOverrides: { scheduledInnings: innings } })
const record = (revision = 1, innings = 7) => ({ sportId: 'baseball', schemaVersion: 1, revision, settings: settings(innings), updatedAt: '2026-10-23T00:00:00Z', updatedBy: null })
function fixture() {
  const rows = new Map<string, string>()
  const storage = { getItem: vi.fn((key: string) => rows.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { rows.set(key, value) }) }
  let cloud: ReturnType<typeof record> | null = null
  let offline = false
  let missingCapability = false
  let pause: Promise<void> | null = null
  let pauseName: string | undefined
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (pause && (!pauseName || name === pauseName)) { const held = pause; pause = null; await held }
    if (offline) throw Error('Offline')
    if (name === 'get_baseball_personal_settings_capabilities') return missingCapability
      ? { data: null, error: { code: 'PGRST202', message: 'Migration 080 is required.' } }
      : { data: BASEBALL_PERSONAL_SETTINGS_CAPABILITIES, error: null }
    if (name === 'get_baseball_personal_settings') return { data: cloud ? { status: 'loaded', record: cloud } : { status: 'missing' }, error: null }
    if (name !== 'save_baseball_user_settings_revisioned') throw Error(`Unexpected RPC: ${name}`)
    if (args?.p_expected_revision !== (cloud?.revision ?? null)) return { data: { status: 'conflict', record: cloud }, error: null }
    cloud = { ...record((cloud?.revision ?? 0) + 1), settings: structuredClone(args?.p_settings as BaseballPersonalSettingsV1) }
    return { data: { status: 'applied', record: cloud }, error: null }
  })
  return { storage, rpc, rows, options: { client: { rpc }, storage },
    cloud: (next: ReturnType<typeof record> | null) => { cloud = next },
    offline: (value: boolean) => { offline = value },
    missing: (value: boolean) => { missingCapability = value },
    hold: (name?: string) => { pauseName = name; let release!: () => void; pause = new Promise<void>(resolve => { release = resolve }); return release },
    saves: () => rpc.mock.calls.filter(([name]) => name === 'save_baseball_user_settings_revisioned'),
    cache: (user = AGGREGATE_USER) => JSON.parse(rows.get(sportSettingsCacheKey({ kind: 'user', userId: user }, 'baseball'))!),
  }
}
beforeEach(() => setCurrentAuthUserId(AGGREGATE_USER))
afterEach(resetCurrentAuthUserIdForTests)

describe('Baseball account-scoped personal settings controller', () => {
  it('opening and refreshing missing defaults never creates a row or pending edit', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    expect(f.rpc).not.toHaveBeenCalled()
    expect(await controller.refresh()).toBe(true)
    expect(controller.getState().sync).toMatchObject({ status: 'synced', revision: null })
    expect(f.saves()).toHaveLength(0)
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })
  it('keeps signed-out edits local, never importing or uploading them on sign-in', async () => {
    setCurrentAuthUserId(null)
    const f = fixture(), local = createBaseballPersonalSettingsController(null, f.options)
    expect(await local.save(settings(3))).toBe(true)
    expect(local.getState().sync.status).toBe('local')
    expect(f.rpc).not.toHaveBeenCalled()
    setCurrentAuthUserId(AGGREGATE_USER)
    const account = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    expect(await account.refresh()).toBe(true)
    expect(account.getState().settings).toEqual(defaultBaseballPersonalSettings())
    expect(f.saves()).toHaveLength(0)
    expect(() => local.getState()).toThrow(expect.objectContaining({ code: 'stale_account' }))
  })
  it('saves through CAS and clears pending only after a matching receipt', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    expect(await controller.save(settings(6))).toBe(true)
    expect(f.cache()).toMatchObject({ revision: 1, pending: null, settings: settings(6) })
    expect(await controller.save(settings(9), 1)).toBe(true)
    expect(f.cache()).toMatchObject({ revision: 2, pending: null, settings: settings(9) })
  })
  it('persists offline edits and drains them after reload only at their original revision', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(2, 6)); await controller.refresh(); f.offline(true)
    expect(await controller.save(settings(9), 2)).toBe(false)
    expect(f.cache()).toMatchObject({ revision: 2, pending: { baseRevision: 2 }, settings: settings(9) })
    controller.dispose(); f.offline(false)
    const reloaded = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    expect(await reloaded.refresh()).toBe(true)
    expect(f.saves()).toHaveLength(1)
    expect(f.cache()).toMatchObject({ revision: 3, pending: null, settings: settings(9) })
  })
  it('Use Cloud explicitly drops a conflicting pending edit without issuing a save', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(1, 6)); await controller.refresh(); f.offline(true); await controller.save(settings(9))
    f.offline(false); f.cloud(record(2, 3)); expect(await controller.refresh()).toBe(false)
    expect(controller.getState().sync.status).toBe('conflict')
    expect(await controller.useCloud()).toBe(true)
    expect(f.cache()).toMatchObject({ revision: 2, pending: null, settings: settings(3) })
    expect(f.saves()).toHaveLength(0)
  })
  it('Keep This Device uses the reviewed cloud revision and still rejects another race', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(1, 6)); await controller.refresh(); f.offline(true); await controller.save(settings(9))
    f.offline(false); f.cloud(record(2, 3)); await controller.refresh()
    f.cloud(record(3, 4)); expect(await controller.keepDevice()).toBe(false)
    expect(controller.getState().sync.conflict?.cloudRevision).toBe(3)
    expect(f.saves()[0][1]?.p_expected_revision).toBe(2)
    expect(await controller.keepDevice()).toBe(true)
    expect(f.cache()).toMatchObject({ revision: 4, pending: null, settings: settings(9) })
  })
  it('a stale UI draft becomes an explicit conflict before issuing a save', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(2, 6)); await controller.refresh()
    expect(await controller.save(settings(9), 1)).toBe(false)
    expect(controller.getState().sync.conflict).toMatchObject({ device: settings(9), cloud: settings(6), cloudRevision: 2 })
    expect(f.saves()).toHaveLength(0)
    expect(f.cache()).toMatchObject({ settings: settings(9), pending: { baseRevision: 1 } })
    controller.dispose()
    const reloaded = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    expect(await reloaded.refresh()).toBe(false)
    expect(reloaded.getState().sync.conflict).toMatchObject({ device: settings(9), cloud: settings(6), cloudRevision: 2 })
  })
  it.each([{ revision: 1, innings: 7 }, { revision: 2, innings: 6 }])('compares a stale draft against the real cloud, not a pending device edit ($revision)', async cloud => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(1, 7)); await controller.refresh()
    f.offline(true); await controller.save(settings(9), 1)
    expect(f.cache()).toMatchObject({ settings: settings(9), pending: { baseRevision: 1 } })
    f.cloud(record(cloud.revision, cloud.innings)); f.offline(false)
    expect(await controller.save(settings(4), null)).toBe(false)
    expect(controller.getState().sync.conflict).toMatchObject({ device: settings(4), cloud: settings(cloud.innings), cloudRevision: cloud.revision })
    expect(f.cache()).toMatchObject({ settings: settings(4), pending: { baseRevision: null } })
    expect(await controller.useCloud()).toBe(true)
    expect(controller.getState()).toMatchObject({ settings: settings(cloud.innings), sync: { status: 'synced', revision: cloud.revision } })
    expect(f.cache()).toMatchObject({ settings: settings(cloud.innings), pending: null })
    await controller.refresh()
    expect(controller.getState().settings).toEqual(settings(cloud.innings))
    expect(f.saves()).toHaveLength(0)
  })
  it('keeps a stale offline draft pending without offering an unverified cloud choice', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(1, 7)); await controller.refresh()
    f.offline(true); await controller.save(settings(9), 1)
    expect(await controller.save(settings(4), null)).toBe(false)
    expect(controller.getState()).toMatchObject({ settings: settings(4), sync: { status: 'pending', conflict: null } })
    expect(f.cache()).toMatchObject({ settings: settings(4), pending: { baseRevision: null } })
    expect(await controller.useCloud()).toBe(false)
    controller.dispose(); f.offline(false)
    const reloaded = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    expect(await reloaded.refresh()).toBe(false)
    expect(reloaded.getState().sync.conflict).toMatchObject({ device: settings(4), cloud: settings(7), cloudRevision: 1 })
    expect(f.saves()).toHaveLength(0)
  })
  it('Keep This Device saves the stale draft only against the freshly reviewed cloud revision', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(1, 7)); await controller.refresh()
    f.offline(true); await controller.save(settings(9), 1); f.offline(false)
    f.cloud(record(2, 6)); await controller.save(settings(4), null)
    expect(await controller.keepDevice()).toBe(true)
    expect(f.saves()[0][1]?.p_expected_revision).toBe(2)
    expect(f.cache()).toMatchObject({ settings: settings(4), revision: 3, pending: null })
  })
  it('retains known cloud-row history when an offline stale draft outlives a deleted cloud row', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(1, 7)); await controller.refresh()
    f.offline(true); await controller.save(settings(9), 1); await controller.save(settings(4), null)
    expect(f.cache()).toMatchObject({ revision: 1, settings: settings(4), pending: { baseRevision: null } })
    controller.dispose(); f.cloud(null); f.offline(false)
    const reloaded = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    expect(await reloaded.refresh()).toBe(false)
    expect(reloaded.getState().sync.conflict).toMatchObject({ device: settings(4), cloudRevision: null, cloudUpdatedAt: null })
    expect(f.saves()).toHaveLength(0)
    expect(await reloaded.useCloud()).toBe(true)
    expect(reloaded.getState().sync.lastSyncedAt).toBeNull()
    expect(f.cache()).toMatchObject({ revision: null, pending: null, cloudUpdatedAt: null })
  })
  it('does not settle a stale-draft cloud read after the account changes', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(1, 7)); await controller.refresh()
    const readsBefore = f.rpc.mock.calls.filter(([name]) => name === 'get_baseball_personal_settings').length
    const release = f.hold('get_baseball_personal_settings'), pending = controller.save(settings(4), null)
    await vi.waitFor(() => expect(f.rpc.mock.calls.filter(([name]) => name === 'get_baseball_personal_settings')).toHaveLength(readsBefore + 1))
    const writesBefore = f.storage.setItem.mock.calls.length
    setCurrentAuthUserId('other'); release()
    expect(await pending).toBe(false)
    expect(f.storage.setItem).toHaveBeenCalledTimes(writesBefore)
    expect(f.cache()).toMatchObject({ settings: settings(4), pending: { baseRevision: null } })
  })
  it('a disappeared cloud row requires a choice rather than automatic revision-1 recreation', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.cloud(record(2, 6)); await controller.refresh(); f.cloud(null)
    expect(await controller.refresh()).toBe(false)
    expect(controller.getState().sync.conflict?.cloudRevision).toBeNull()
    expect(controller.getState().sync.conflict?.cloudUpdatedAt).toBeNull()
    expect(f.saves()).toHaveLength(0)
    expect(await controller.useCloud()).toBe(true)
    expect(controller.getState().sync.lastSyncedAt).toBeNull()
    expect(f.cache().cloudUpdatedAt).toBeNull()
    expect(await controller.refresh()).toBe(true)
    expect(f.saves()).toHaveLength(0)
    expect(controller.getState().settings).toEqual(defaultBaseballPersonalSettings())
  })
  it('missing support preserves pending values and retries only after support exists', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.missing(true)
    expect(await controller.save(settings(9))).toBe(false)
    expect(controller.getState().sync.status).toBe('backend_update_required')
    expect(f.cache()).toMatchObject({ pending: { baseRevision: null }, settings: settings(9) })
    expect(f.saves()).toHaveLength(0)
    f.missing(false); expect(await controller.refresh()).toBe(true)
    expect(f.cache()).toMatchObject({ revision: 1, pending: null, settings: settings(9) })
  })
  it('A -> B -> A cancels an old in-flight read before any storage settlement or later RPC', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    const release = f.hold(), pending = controller.refresh()
    setCurrentAuthUserId('other'); setCurrentAuthUserId(AGGREGATE_USER); release()
    expect(await pending).toBe(false)
    expect(f.rpc).toHaveBeenCalledTimes(1)
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(await controller.save(settings(9))).toBe(false)
    expect(f.rpc).toHaveBeenCalledTimes(1)
  })
  it('separates A/B caches and restores A pending edits on a fresh lifetime', async () => {
    const f = fixture(), accountA = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.offline(true); await accountA.save(settings(9)); setCurrentAuthUserId('other')
    const accountB = createBaseballPersonalSettingsController('other', f.options)
    expect(accountB.getState().settings).toEqual(defaultBaseballPersonalSettings())
    await accountB.save(settings(3)); setCurrentAuthUserId(AGGREGATE_USER)
    const returned = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    expect(returned.getState().settings).toEqual(settings(9))
    expect(f.cache('other').settings).toEqual(settings(3))
  })
  it('disposal stops a delayed operation and all later callbacks', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    const release = f.hold(), pending = controller.refresh(); controller.dispose(); release()
    expect(await pending).toBe(false)
    expect(await controller.keepDevice()).toBe(false)
    expect(f.rpc).toHaveBeenCalledTimes(1)
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })
  it('keeps an uncertain old-account write pending without adopting its late receipt', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    const release = f.hold('save_baseball_user_settings_revisioned'), pending = controller.save(settings(9))
    await vi.waitFor(() => expect(f.saves()).toHaveLength(1))
    setCurrentAuthUserId('other'); release()
    expect(await pending).toBe(false)
    expect(f.storage.setItem).toHaveBeenCalledTimes(1)
    expect(f.cache()).toMatchObject({ pending: { baseRevision: null }, settings: settings(9) })
  })
  it('preserves device edits if the cloud settings payload is corrupt', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    f.offline(true); await controller.save(settings(9)); f.offline(false)
    f.cloud({ ...record(1), settings: { ...settings(3), extra: true } as never })
    expect(await controller.refresh()).toBe(false)
    expect(controller.getState().settings).toEqual(settings(9))
    expect(f.cache().pending).not.toBeNull()
    expect(f.saves()).toHaveLength(0)
  })
  it('refuses cloud writes if the pending operation cannot be persisted', async () => {
    const f = fixture(); f.storage.setItem.mockImplementation(() => { throw Error('Quota exceeded') })
    const controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    expect(await controller.save(settings(9))).toBe(false)
    expect(controller.getState().sync.error).toContain('Device storage is unavailable')
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('serializes concurrent operations and returns clone-safe snapshots', async () => {
    const f = fixture(), controller = createBaseballPersonalSettingsController(AGGREGATE_USER, f.options)
    const listener = vi.fn(), unsubscribe = controller.subscribe(listener)
    const release = f.hold(), pending = controller.save(settings(6))
    expect(await controller.save(settings(9))).toBe(false)
    release(); expect(await pending).toBe(true)
    expect(listener).toHaveBeenCalled()
    const read = controller.getState(); read.settings.ruleOverrides.scheduledInnings = 1
    expect(controller.getState().settings).toEqual(settings(6))
    unsubscribe()
  })
})
