import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { loadUserSportSettings } from '../lib/sportSettingsCloud'
import {
  createSportPersonalSettingsCacheRecord,
  parseSportPersonalCloudRecord,
  reconcileSportPersonalSettings,
  sportPersonalSettingsCacheScope,
  validSportPersonalSettingsCache,
  type SportPersonalSettingsAdapter,
} from '../lib/sportPersonalSettings'
import {
  loadSportSettingsCache,
  saveSportSettingsCache,
  type SportSettingsCacheRecord,
  type SportSettingsCacheScope,
} from '../lib/sportSettingsStorage'

/**
 * Sport-neutral version of `useBasketballPersonalSettings` (HKY-5C): an account-scoped
 * device cache, compare-and-swap cloud saves, offline edits kept pending until a later
 * focus, online or Refresh reconciles them, and explicit Use Cloud / Keep This Device
 * choices on a conflict. Signed out, settings stay on the device.
 */
export type SportPersonalSettingsStatus =
  | 'local'
  | 'checking'
  | 'synced'
  | 'saving'
  | 'pending'
  | 'conflict'
  | 'backend_update_required'
  | 'error'

export interface SportPersonalSettingsConflict<TSettings> {
  device: TSettings
  cloud: TSettings
  cloudRevision: number | null
  cloudUpdatedAt: string
}

export interface SportPersonalSettingsSyncState<TSettings> {
  status: SportPersonalSettingsStatus
  revision: number | null
  error: string | null
  lastSyncedAt: string | null
  conflict: SportPersonalSettingsConflict<TSettings> | null
}

export interface SportPersonalSettingsController<TSettings> {
  settings: TSettings
  sync: SportPersonalSettingsSyncState<TSettings>
  save: (settings: TSettings, expectedRevision?: number | null) => Promise<boolean>
  refresh: () => Promise<void>
  useCloud: () => void
  keepDevice: () => Promise<void>
}

interface ControllerState<TSettings> {
  settings: TSettings
  sync: SportPersonalSettingsSyncState<TSettings>
  cache: SportSettingsCacheRecord<TSettings> | null
}

export function useSportPersonalSettings<TSettings>(
  adapter: SportPersonalSettingsAdapter<TSettings>,
  active = true
): SportPersonalSettingsController<TSettings> {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const cloudEnabled = Boolean(active && userId && isConfigured)
  const [state, setState] = useState<ControllerState<TSettings>>(() =>
    initialState(adapter, sportPersonalSettingsCacheScope(userId), cloudEnabled)
  )
  const stateRef = useRef(state)
  const requestRef = useRef(0)
  const refreshingRef = useRef(false)
  const writingRef = useRef(false)

  const commit = useCallback((next: ControllerState<TSettings>) => {
    stateRef.current = next
    setState(next)
  }, [])

  const cacheAndCommit = useCallback((next: ControllerState<TSettings>, scope: SportSettingsCacheScope) => {
    const cacheResult = next.cache ? saveSportSettingsCache(scope, next.cache) : { ok: true as const }
    commit(cacheResult.ok ? next : { ...next, sync: { ...next.sync, error: cacheResult.error } })
  }, [commit])

  const applyCloudWrite = useCallback(async (
    settings: TSettings,
    expectedRevision: number | null,
    scope: SportSettingsCacheScope,
    requestId: number
  ): Promise<boolean> => {
    if (writingRef.current) return false
    writingRef.current = true
    try {
      const result = await adapter.save(expectedRevision, settings)
      if (requestId !== requestRef.current) return false
      if (result.status === 'applied' && result.record) {
        const parsed = parseSportPersonalCloudRecord(adapter, result.record)
        if (!parsed) {
          commit({
            ...stateRef.current,
            sync: { ...stateRef.current.sync, status: 'error', error: `Cloud ${adapter.label} settings returned invalid saved data.` },
          })
          return false
        }
        cacheAndCommit({
          settings: parsed.settings,
          cache: createSportPersonalSettingsCacheRecord(adapter, parsed.settings, {
            revision: parsed.revision,
            pending: null,
            cloudUpdatedAt: parsed.updatedAt,
          }),
          sync: syncedState(parsed.revision, parsed.updatedAt),
        }, scope)
        return true
      }
      if (result.status === 'conflict') {
        const cloud = result.record ? parseSportPersonalCloudRecord(adapter, result.record) : null
        commit({
          ...stateRef.current,
          sync: cloud
            ? {
                ...stateRef.current.sync,
                status: 'conflict',
                error: null,
                conflict: {
                  device: structuredClone(settings),
                  cloud: cloud.settings,
                  cloudRevision: cloud.revision,
                  cloudUpdatedAt: cloud.updatedAt,
                },
              }
            : { ...stateRef.current.sync, status: 'pending', error: 'Cloud settings changed. Refresh to compare versions.' },
        })
        return false
      }
      commit({
        ...stateRef.current,
        sync: {
          ...stateRef.current.sync,
          status: result.status === 'backend_update_required' ? 'backend_update_required' : 'pending',
          error: result.status === 'backend_update_required' || result.status === 'error'
            ? result.error
            : result.status === 'not_configured'
              ? null
              : `Cloud ${adapter.label} settings did not return a saved record.`,
        },
      })
      return false
    } finally {
      writingRef.current = false
    }
  }, [adapter, cacheAndCommit, commit])

  const refresh = useCallback(async () => {
    if (!cloudEnabled || refreshingRef.current || writingRef.current) return
    refreshingRef.current = true
    try {
      const requestId = ++requestRef.current
      const scope = sportPersonalSettingsCacheScope(userId)
      const accountCache = validSportPersonalSettingsCache(adapter, loadSportSettingsCache(scope, adapter.sportId))
      const anonymousCache = validSportPersonalSettingsCache(
        adapter,
        loadSportSettingsCache({ kind: 'anonymous' }, adapter.sportId)
      )
      const bootstrap = anonymousCache?.settings ?? adapter.defaults()
      commit({
        settings: accountCache?.settings ?? bootstrap,
        cache: accountCache,
        sync: {
          status: 'checking',
          revision: accountCache?.revision ?? null,
          error: null,
          lastSyncedAt: accountCache?.cloudUpdatedAt ?? null,
          conflict: null,
        },
      })

      const loaded = await loadUserSportSettings(adapter.sportId)
      if (requestId !== requestRef.current) return
      if (loaded.status === 'backend_update_required' || loaded.status === 'error') {
        commit({
          ...stateRef.current,
          sync: {
            ...stateRef.current.sync,
            status: loaded.status === 'backend_update_required'
              ? 'backend_update_required'
              : accountCache?.pending ? 'pending' : 'error',
            error: loaded.error,
          },
        })
        return
      }
      if (loaded.status === 'not_configured') {
        commit({ ...stateRef.current, sync: localState() })
        return
      }

      // Settings saved while signed out on this device become the account's first copy.
      const reconciliationCache = loaded.status === 'missing' && !accountCache && anonymousCache
        ? createSportPersonalSettingsCacheRecord(adapter, anonymousCache.settings, {
            revision: null,
            pending: { baseRevision: null },
            cloudUpdatedAt: null,
          })
        : accountCache
      const decision = reconcileSportPersonalSettings(
        adapter,
        reconciliationCache,
        loaded.status === 'loaded' ? loaded.record : null,
        bootstrap
      )
      if (decision.action === 'use_cloud') {
        cacheAndCommit({
          settings: decision.settings,
          cache: decision.record,
          sync: syncedState(decision.record.revision, decision.record.cloudUpdatedAt),
        }, scope)
        return
      }
      if (decision.action === 'use_defaults') {
        commit({ settings: decision.settings, cache: null, sync: syncedState(null, null) })
        return
      }
      if (decision.action === 'conflict') {
        commit({
          settings: decision.local,
          cache: accountCache,
          sync: {
            status: 'conflict',
            revision: accountCache?.revision ?? null,
            error: null,
            lastSyncedAt: accountCache?.cloudUpdatedAt ?? null,
            conflict: {
              device: decision.local,
              cloud: decision.cloud,
              cloudRevision: decision.cloudRecord.revision,
              cloudUpdatedAt: decision.cloudRecord.updatedAt,
            },
          },
        })
        return
      }
      if (decision.action === 'invalid_cloud') {
        commit({
          settings: decision.settings,
          cache: accountCache,
          sync: { status: 'error', revision: decision.revision, error: decision.error, lastSyncedAt: null, conflict: null },
        })
        return
      }
      cacheAndCommit({
        settings: decision.settings,
        cache: createSportPersonalSettingsCacheRecord(adapter, decision.settings, {
          revision: decision.expectedRevision,
          pending: { baseRevision: decision.expectedRevision },
          cloudUpdatedAt: accountCache?.cloudUpdatedAt ?? null,
        }),
        sync: {
          status: 'saving',
          revision: decision.expectedRevision,
          error: null,
          lastSyncedAt: accountCache?.cloudUpdatedAt ?? null,
          conflict: null,
        },
      }, scope)
      await applyCloudWrite(decision.settings, decision.expectedRevision, scope, requestId)
    } finally {
      refreshingRef.current = false
    }
  }, [adapter, applyCloudWrite, cacheAndCommit, cloudEnabled, commit, userId])

  useEffect(() => {
    requestRef.current += 1
    if (cloudEnabled) {
      void refresh()
      return
    }
    commit(initialState(adapter, sportPersonalSettingsCacheScope(userId), false))
  }, [adapter, cloudEnabled, commit, refresh, userId])

  useEffect(() => {
    if (!cloudEnabled || typeof window === 'undefined') return
    const retry = () => void refresh()
    window.addEventListener('focus', retry)
    window.addEventListener('online', retry)
    return () => {
      window.removeEventListener('focus', retry)
      window.removeEventListener('online', retry)
    }
  }, [cloudEnabled, refresh])

  const save = useCallback(async (settings: TSettings, expectedRevision = stateRef.current.sync.revision) => {
    const parsed = adapter.parse(settings)
    if (!parsed.ok) {
      commit({ ...stateRef.current, sync: { ...stateRef.current.sync, status: 'error', error: parsed.error } })
      return false
    }
    const requestId = ++requestRef.current
    const scope = sportPersonalSettingsCacheScope(userId)
    if (!cloudEnabled) {
      cacheAndCommit({
        settings: parsed.value,
        cache: createSportPersonalSettingsCacheRecord(adapter, parsed.value, { revision: null, pending: null, cloudUpdatedAt: null }),
        sync: localState(),
      }, scope)
      return true
    }
    if (expectedRevision !== stateRef.current.sync.revision) {
      commit({
        ...stateRef.current,
        sync: {
          ...stateRef.current.sync,
          status: 'conflict',
          error: null,
          conflict: {
            device: parsed.value,
            cloud: structuredClone(stateRef.current.settings),
            cloudRevision: stateRef.current.sync.revision,
            cloudUpdatedAt: stateRef.current.sync.lastSyncedAt ?? new Date().toISOString(),
          },
        },
      })
      return false
    }
    const baseRevision = stateRef.current.sync.revision
    cacheAndCommit({
      settings: parsed.value,
      cache: createSportPersonalSettingsCacheRecord(adapter, parsed.value, {
        revision: baseRevision,
        pending: { baseRevision },
        cloudUpdatedAt: stateRef.current.sync.lastSyncedAt,
      }),
      sync: { ...stateRef.current.sync, status: 'saving', error: null, conflict: null },
    }, scope)
    return applyCloudWrite(parsed.value, baseRevision, scope, requestId)
  }, [adapter, applyCloudWrite, cacheAndCommit, cloudEnabled, commit, userId])

  const useCloud = useCallback(() => {
    const conflict = stateRef.current.sync.conflict
    if (!conflict) return
    ++requestRef.current
    cacheAndCommit({
      settings: conflict.cloud,
      cache: createSportPersonalSettingsCacheRecord(adapter, conflict.cloud, {
        revision: conflict.cloudRevision,
        pending: null,
        cloudUpdatedAt: conflict.cloudUpdatedAt,
      }),
      sync: syncedState(conflict.cloudRevision, conflict.cloudUpdatedAt),
    }, sportPersonalSettingsCacheScope(userId))
  }, [adapter, cacheAndCommit, userId])

  const keepDevice = useCallback(async () => {
    const conflict = stateRef.current.sync.conflict
    if (!conflict || !cloudEnabled) return
    const requestId = ++requestRef.current
    const scope = sportPersonalSettingsCacheScope(userId)
    cacheAndCommit({
      settings: conflict.device,
      cache: createSportPersonalSettingsCacheRecord(adapter, conflict.device, {
        revision: conflict.cloudRevision,
        pending: { baseRevision: conflict.cloudRevision },
        cloudUpdatedAt: stateRef.current.sync.lastSyncedAt,
      }),
      sync: { ...stateRef.current.sync, status: 'saving', revision: conflict.cloudRevision, error: null, conflict: null },
    }, scope)
    await applyCloudWrite(conflict.device, conflict.cloudRevision, scope, requestId)
  }, [adapter, applyCloudWrite, cacheAndCommit, cloudEnabled, userId])

  return { settings: state.settings, sync: state.sync, save, refresh, useCloud, keepDevice }
}

function initialState<TSettings>(
  adapter: SportPersonalSettingsAdapter<TSettings>,
  scope: SportSettingsCacheScope,
  checkingCloud: boolean
): ControllerState<TSettings> {
  const cache = validSportPersonalSettingsCache(adapter, loadSportSettingsCacheSafely(scope, adapter.sportId))
  return {
    settings: cache?.settings ?? adapter.defaults(),
    cache,
    sync: {
      status: checkingCloud ? 'checking' : 'local',
      revision: cache?.revision ?? null,
      error: null,
      lastSyncedAt: cache?.cloudUpdatedAt ?? null,
      conflict: null,
    },
  }
}

/** `loadSportSettingsCache` reads `localStorage`, which a server render does not have. */
function loadSportSettingsCacheSafely(scope: SportSettingsCacheScope, sportId: string) {
  return typeof localStorage === 'undefined' ? null : loadSportSettingsCache(scope, sportId)
}

function localState<TSettings>(): SportPersonalSettingsSyncState<TSettings> {
  return { status: 'local', revision: null, error: null, lastSyncedAt: null, conflict: null }
}

function syncedState<TSettings>(revision: number | null, updatedAt: string | null): SportPersonalSettingsSyncState<TSettings> {
  return { status: 'synced', revision, error: null, lastSyncedAt: updatedAt, conflict: null }
}
