import { captureAuthIdentity, isCurrentAuthIdentity, isCurrentAuthUser } from '../authIdentity'
import { createSportPersonalSettingsCacheRecord, reconcileSportPersonalSettings, sportPersonalSettingsCacheScope } from '../sportPersonalSettings'
import { loadSportSettingsCache, saveSportSettingsCache } from '../sportSettingsStorage'
import type { SportPersonalSettingsConflict, SportPersonalSettingsSyncState } from '../../hooks/useSportPersonalSettings'
import { BaseballFeatureError, type BaseballFeatureOptions } from './featureClient'
import { createBaseballPersonalSettingsAdapter, loadBaseballPersonalSettings, validBaseballPersonalSettingsCache } from './personalSettingsSync'
import { defaultBaseballPersonalSettings, parseBaseballPersonalSettings, type BaseballPersonalSettingsV1 as Settings } from './settings'

export interface BaseballPersonalSettingsState {
  settings: Settings
  sync: SportPersonalSettingsSyncState<Settings>
}

export interface BaseballPersonalSettingsOptions extends BaseballFeatureOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

/** Account-scoped controller; the UI supplies subscription/lifecycle, not reconciliation policy. */
export function createBaseballPersonalSettingsController(userId: string | null, options: BaseballPersonalSettingsOptions = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal?.aborted) abort()
  const requestOptions = { ...options, signal: controller.signal }
  const identity = userId ? captureAuthIdentity(userId) : null
  const scope = sportPersonalSettingsCacheScope(userId)
  const adapter = createBaseballPersonalSettingsAdapter(userId, requestOptions)
  const storage = options.storage ?? (typeof localStorage === 'undefined' ? {
    getItem: () => null,
    setItem: () => { throw Error('Device storage is unavailable.') },
  } : localStorage)
  let disposed = false
  let busy = false
  const listeners = new Set<() => void>()
  const assertCurrent = () => {
    if (disposed || (userId ? !identity || !isCurrentAuthIdentity(identity) : !isCurrentAuthUser(null))) {
      throw new BaseballFeatureError('stale_account', 'The Baseball settings account changed.')
    }
    if (controller.signal.aborted) throw new BaseballFeatureError('aborted', 'The Baseball settings operation was cancelled.')
  }
  assertCurrent()
  options.signal?.addEventListener('abort', abort, { once: true })
  let cache = validBaseballPersonalSettingsCache(adapter, loadSportSettingsCache(scope, 'baseball', storage))
  let state: BaseballPersonalSettingsState = {
    settings: cache?.settings ?? defaultBaseballPersonalSettings(),
    sync: { status: userId ? cache?.pending ? 'pending' : 'checking' : 'local', revision: cache?.revision ?? null,
      error: null, lastSyncedAt: cache?.cloudUpdatedAt ?? null, conflict: null },
  }
  const commit = (next: BaseballPersonalSettingsState) => {
    assertCurrent()
    state = structuredClone(next)
    for (const listener of listeners) listener()
  }
  const persist = (settings: Settings, revision: number | null, pending: boolean, updatedAt: string | null) => {
    assertCurrent()
    const record = createSportPersonalSettingsCacheRecord(adapter, settings, {
      revision, pending: pending ? { baseRevision: revision } : null, cloudUpdatedAt: updatedAt,
    })
    const saved = saveSportSettingsCache(scope, record, storage)
    if (!saved.ok) throw Error(saved.error)
    cache = record
  }
  const ready = (settings: Settings, revision: number | null, updatedAt: string | null) => commit({
    settings, sync: { status: userId ? 'synced' : 'local', revision, lastSyncedAt: updatedAt, error: null, conflict: null },
  })
  const conflict = (device: Settings, cloud: Settings, revision: number | null, updatedAt: string | null) => commit({
    ...state, settings: device, sync: { ...state.sync, status: 'conflict', error: null,
      conflict: { device, cloud, cloudRevision: revision, cloudUpdatedAt: updatedAt ?? new Date().toISOString() } },
  })
  const run = async (operation: () => Promise<boolean>): Promise<boolean> => {
    if (busy) return false
    busy = true
    try { assertCurrent(); return await operation() } catch (error) {
      try { assertCurrent() } catch { return false }
      commit({ ...state, sync: { ...state.sync,
        status: error instanceof BaseballFeatureError && error.code === 'backend_update_required'
          ? 'backend_update_required' : cache?.pending ? 'pending' : 'error',
        error: error instanceof Error ? error.message : 'Baseball settings could not be saved.' } })
      return false
    } finally { busy = false }
  }
  const write = async (settings: Settings, revision: number | null) => {
    const saved = await adapter.save(revision, settings)
    assertCurrent()
    if (saved.status === 'applied' && saved.record) {
      persist(saved.record.settings, saved.record.revision, false, saved.record.updatedAt)
      ready(saved.record.settings, saved.record.revision, saved.record.updatedAt)
      return true
    }
    if (saved.status === 'conflict') {
      conflict(settings, saved.record?.settings ?? defaultBaseballPersonalSettings(), saved.record?.revision ?? null, saved.record?.updatedAt ?? null)
      return false
    }
    throw Error('Baseball settings did not return a saved record.')
  }
  const savePending = async (settings: Settings, revision: number | null) => {
    persist(settings, revision, Boolean(userId), state.sync.lastSyncedAt)
    commit({ settings, sync: { ...state.sync, revision, status: userId ? 'saving' : 'local', error: null, conflict: null } })
    return userId ? write(settings, revision) : true
  }
  return {
    getState(): BaseballPersonalSettingsState { assertCurrent(); return structuredClone(state) },
    subscribe(listener: () => void) { assertCurrent(); listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { disposed = true; abort(); options.signal?.removeEventListener('abort', abort); listeners.clear() },
    refresh: () => run(async () => {
      if (!userId) return true
      commit({ ...state, sync: { ...state.sync, status: 'checking', error: null } })
      const loaded = await loadBaseballPersonalSettings(userId, requestOptions)
      assertCurrent()
      if (loaded.status !== 'loaded' && loaded.status !== 'missing') throw Error('Baseball settings did not return a valid read.')
      // A disappeared row is not permission to re-create it at revision 1.
      if (loaded.status === 'missing' && cache?.revision !== null && cache?.revision !== undefined) {
        conflict(state.settings, defaultBaseballPersonalSettings(), null, null)
        return false
      }
      const decision = reconcileSportPersonalSettings(adapter, cache?.pending ? cache : null,
        loaded.status === 'loaded' ? loaded.record : null, defaultBaseballPersonalSettings())
      if (decision.action === 'use_cloud') {
        persist(decision.settings, decision.record.revision, false, decision.record.cloudUpdatedAt)
        ready(decision.settings, decision.record.revision, decision.record.cloudUpdatedAt)
      } else if (decision.action === 'use_defaults') {
        cache = null
        ready(decision.settings, null, null)
      } else if (decision.action === 'conflict') {
        conflict(decision.local, decision.cloud, decision.cloudRecord.revision, decision.cloudRecord.updatedAt)
      } else if (decision.action === 'upload_local') {
        return savePending(decision.settings, decision.expectedRevision)
      } else throw Error(decision.error)
      return decision.action !== 'conflict'
    }),
    save: (settings: Settings, expectedRevision: number | null = state.sync.revision) => run(async () => {
      const parsed = parseBaseballPersonalSettings(settings)
      if (settings == null || !parsed.ok) throw Error(parsed.ok ? 'Baseball settings are required.' : parsed.error)
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw Error('Invalid Baseball settings revision.')
      if (expectedRevision !== state.sync.revision) {
        if (!userId) throw Error('Device settings do not use cloud revisions.')
        persist(parsed.value, expectedRevision, true, state.sync.lastSyncedAt)
        conflict(parsed.value, state.settings, state.sync.revision, state.sync.lastSyncedAt)
        return false
      }
      return savePending(parsed.value, expectedRevision)
    }),
    useCloud: () => run(async () => {
      if (!state.sync.conflict) return false
      const cloud = state.sync.conflict
      persist(cloud.cloud, cloud.cloudRevision, false, cloud.cloudUpdatedAt)
      ready(cloud.cloud, cloud.cloudRevision, cloud.cloudUpdatedAt)
      return true
    }),
    keepDevice: () => run(async () => {
      const selected: SportPersonalSettingsConflict<Settings> | null = state.sync.conflict
      return selected ? savePending(selected.device, selected.cloudRevision) : false
    }),
  }
}

export type BaseballPersonalSettingsController = ReturnType<typeof createBaseballPersonalSettingsController>
