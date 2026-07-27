import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  loadUserSportSettings,
  saveUserSportSettings,
  type SportSettingsCloudRecord,
} from '../lib/sportSettingsCloud'
import {
  loadSportSettingsCache,
  saveSportSettingsCache,
  type SportSettingsCacheRecord,
  type SportSettingsCacheScope,
} from '../lib/sportSettingsStorage'
import {
  createSoccerSettingsCacheRecord,
  reconcileSoccerPersonalSettings,
  soccerSettingsCacheScope,
  validSoccerSettingsCache,
} from '../lib/soccer/personalSettingsSync'
import {
  DEFAULT_SOCCER_PERSONAL_SETTINGS,
  SOCCER_SETTINGS_SCHEMA_VERSION,
  parseSoccerPersonalSettings,
  type SoccerPersonalSettings,
} from '../lib/soccer/settings'

export type SoccerSettingsSyncStatus =
  | 'local'
  | 'checking'
  | 'synced'
  | 'saving'
  | 'pending'
  | 'conflict'
  | 'backend_update_required'
  | 'error'

export interface SoccerSettingsConflict {
  device: SoccerPersonalSettings
  cloud: SoccerPersonalSettings
  cloudRevision: number | null
  cloudUpdatedAt: string
}

export interface SoccerSettingsSyncState {
  status: SoccerSettingsSyncStatus
  revision: number | null
  error: string | null
  lastSyncedAt: string | null
  conflict: SoccerSettingsConflict | null
}

export interface SoccerPersonalSettingsController {
  settings: SoccerPersonalSettings
  sync: SoccerSettingsSyncState
  save: (
    settings: SoccerPersonalSettings,
    expectedRevision?: number | null
  ) => Promise<boolean>
  refresh: () => Promise<void>
  useCloud: () => void
  keepDevice: () => Promise<void>
}

export function shouldStartSoccerSettingsRefresh(
  cloudEnabled: boolean,
  refreshing: boolean,
  writing: boolean
): boolean {
  return cloudEnabled && !refreshing && !writing
}

interface ControllerState {
  settings: SoccerPersonalSettings
  sync: SoccerSettingsSyncState
  cache: SportSettingsCacheRecord<SoccerPersonalSettings> | null
}

export function useSoccerPersonalSettings(
  cloudEnabled = false
): SoccerPersonalSettingsController {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const scope = soccerSettingsCacheScope(userId)
  const scopeKey = cacheScopeKey(scope)
  const [state, setState] = useState<ControllerState>(() =>
    initialState(scope, Boolean(cloudEnabled && userId && isConfigured))
  )
  const stateRef = useRef(state)
  const requestRef = useRef(0)
  const refreshingRef = useRef(false)
  const writingRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const commit = useCallback((next: ControllerState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const cacheAndCommit = useCallback((
    next: ControllerState,
    targetScope: SportSettingsCacheScope
  ): boolean => {
    const cacheResult = next.cache
      ? saveSportSettingsCache(targetScope, next.cache)
      : { ok: true as const }
    commit(cacheResult.ok
      ? next
      : {
          ...next,
          sync: {
            ...next.sync,
            error: cacheResult.error,
          },
        })
    return cacheResult.ok
  }, [commit])

  const applyCloudWrite = useCallback(async (
    settings: SoccerPersonalSettings,
    expectedRevision: number | null,
    targetScope: SportSettingsCacheScope,
    requestId: number
  ): Promise<boolean> => {
    if (writingRef.current) return false
    writingRef.current = true
    try {
    const result = await saveUserSportSettings(
      'soccer',
      SOCCER_SETTINGS_SCHEMA_VERSION,
      expectedRevision,
      settings
    )
    if (requestId !== requestRef.current) return false

    if (result.status === 'applied' && result.record) {
      const parsed = parseCloudSoccerRecord(result.record)
      if (!parsed) {
        commit({
          ...stateRef.current,
          sync: {
            ...stateRef.current.sync,
            status: 'error',
            error: 'Cloud soccer settings returned invalid saved data.',
          },
        })
        return false
      }
      const cache = createSoccerSettingsCacheRecord(parsed.settings, {
        revision: parsed.revision,
        pending: null,
        cloudUpdatedAt: parsed.updatedAt,
      })
      cacheAndCommit({
        settings: parsed.settings,
        cache,
        sync: {
          status: 'synced',
          revision: parsed.revision,
          error: null,
          lastSyncedAt: parsed.updatedAt,
          conflict: null,
        },
      }, targetScope)
      return true
    }

    if (result.status === 'conflict') {
      const cloud = result.record ? parseCloudSoccerRecord(result.record) : null
      if (cloud) {
        commit({
          ...stateRef.current,
          sync: {
            ...stateRef.current.sync,
            status: 'conflict',
            error: null,
            conflict: {
              device: structuredClone(settings),
              cloud: cloud.settings,
              cloudRevision: cloud.revision,
              cloudUpdatedAt: cloud.updatedAt,
            },
          },
        })
      } else {
        commit({
          ...stateRef.current,
          sync: {
            ...stateRef.current.sync,
            status: 'pending',
            error: 'Cloud settings changed. Refresh to compare versions.',
          },
        })
      }
      return false
    }

    const status = result.status === 'backend_update_required'
      ? 'backend_update_required'
      : 'pending'
    const error = result.status === 'backend_update_required' ||
      result.status === 'error'
      ? result.error
      : result.status === 'not_configured'
        ? null
        : 'Cloud sport settings did not return a saved record.'
    commit({
      ...stateRef.current,
      sync: {
        ...stateRef.current.sync,
        status,
        error,
      },
    })
    return false
    } finally {
      writingRef.current = false
    }
  }, [cacheAndCommit, commit])

  const refresh = useCallback(async () => {
    if (!shouldStartSoccerSettingsRefresh(
      cloudEnabled,
      refreshingRef.current,
      writingRef.current
    )) return
    refreshingRef.current = true
    try {
    const requestId = ++requestRef.current
    const targetScope = soccerSettingsCacheScope(userId)
    const accountCache = validSoccerSettingsCache(
      loadSportSettingsCache(targetScope, 'soccer')
    )
    const anonymousCache = userId
      ? validSoccerSettingsCache(
          loadSportSettingsCache({ kind: 'anonymous' }, 'soccer')
        )
      : null
    const bootstrap = anonymousCache?.settings ??
      structuredClone(DEFAULT_SOCCER_PERSONAL_SETTINGS)
    const immediateSettings = accountCache?.settings ?? bootstrap

    if (!cloudEnabled || !userId || !isConfigured) {
      cacheAndCommit({
        settings: immediateSettings,
        cache: accountCache,
        sync: {
          status: 'local',
          revision: null,
          error: null,
          lastSyncedAt: null,
          conflict: null,
        },
      }, targetScope)
      return
    }

    commit({
      settings: immediateSettings,
      cache: accountCache,
      sync: {
        status: 'checking',
        revision: accountCache?.revision ?? null,
        error: null,
        lastSyncedAt: accountCache?.cloudUpdatedAt ?? null,
        conflict: null,
      },
    })

    const loaded = await loadUserSportSettings('soccer')
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
      commit({
        ...stateRef.current,
        sync: { ...stateRef.current.sync, status: 'local' },
      })
      return
    }

    const reconciliationCache = loaded.status === 'missing' && !accountCache && anonymousCache
      ? createSoccerSettingsCacheRecord(anonymousCache.settings, {
          revision: null,
          pending: { baseRevision: null },
          cloudUpdatedAt: null,
        })
      : accountCache
    const decision = reconcileSoccerPersonalSettings(
      reconciliationCache,
      loaded.status === 'loaded' ? loaded.record : null,
      bootstrap
    )
    if (decision.action === 'use_cloud') {
      cacheAndCommit({
        settings: decision.settings,
        cache: decision.record,
        sync: {
          status: 'synced',
          revision: decision.record.revision,
          error: null,
          lastSyncedAt: decision.record.cloudUpdatedAt,
          conflict: null,
        },
      }, targetScope)
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
        sync: {
          status: 'error',
          revision: decision.revision,
          error: decision.error,
          lastSyncedAt: null,
          conflict: null,
        },
      })
      return
    }
    if (decision.action === 'use_local') {
      commit({
        settings: decision.settings,
        cache: null,
        sync: {
          status: 'local',
          revision: null,
          error: null,
          lastSyncedAt: null,
          conflict: null,
        },
      })
      return
    }

    const pendingCache = createSoccerSettingsCacheRecord(decision.settings, {
      revision: decision.expectedRevision,
      pending: { baseRevision: decision.expectedRevision },
      cloudUpdatedAt: accountCache?.cloudUpdatedAt ?? null,
    })
    cacheAndCommit({
      settings: decision.settings,
      cache: pendingCache,
      sync: {
        status: 'saving',
        revision: decision.expectedRevision,
        error: null,
        lastSyncedAt: accountCache?.cloudUpdatedAt ?? null,
        conflict: null,
      },
    }, targetScope)
    await applyCloudWrite(
      decision.settings,
      decision.expectedRevision,
      targetScope,
      requestId
    )
    } finally {
      refreshingRef.current = false
    }
  }, [applyCloudWrite, cacheAndCommit, cloudEnabled, commit, isConfigured, userId])

  useEffect(() => {
    if (cloudEnabled) {
      void refresh()
      return
    }
    const local = initialState(soccerSettingsCacheScope(userId), false)
    commit(local)
  }, [cloudEnabled, commit, refresh, scopeKey, userId])

  useEffect(() => {
    if (!cloudEnabled || !userId || !isConfigured || typeof window === 'undefined') return
    const retry = () => void refresh()
    window.addEventListener('focus', retry)
    window.addEventListener('online', retry)
    return () => {
      window.removeEventListener('focus', retry)
      window.removeEventListener('online', retry)
    }
  }, [cloudEnabled, isConfigured, refresh, userId])

  const save = useCallback(async (
    settings: SoccerPersonalSettings,
    expectedRevision = stateRef.current.sync.revision
  ) => {
    const parsed = parseSoccerPersonalSettings(settings)
    if (!parsed.ok) {
      commit({
        ...stateRef.current,
        sync: {
          ...stateRef.current.sync,
          status: 'error',
          error: parsed.error,
        },
      })
      return false
    }

    const requestId = ++requestRef.current
    const targetScope = soccerSettingsCacheScope(userId)
    if (!userId || !isConfigured) {
      const cache = createSoccerSettingsCacheRecord(parsed.value, {
        revision: null,
        pending: null,
        cloudUpdatedAt: null,
      })
      return cacheAndCommit({
        settings: parsed.value,
        cache,
        sync: {
          status: 'local',
          revision: null,
          error: null,
          lastSyncedAt: null,
          conflict: null,
        },
      }, targetScope)
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
            cloudUpdatedAt: stateRef.current.sync.lastSyncedAt ??
              new Date().toISOString(),
          },
        },
      })
      return false
    }

    const baseRevision = stateRef.current.sync.revision
    const cache = createSoccerSettingsCacheRecord(parsed.value, {
      revision: baseRevision,
      pending: { baseRevision },
      cloudUpdatedAt: stateRef.current.sync.lastSyncedAt,
    })
    cacheAndCommit({
      settings: parsed.value,
      cache,
      sync: {
        ...stateRef.current.sync,
        status: 'saving',
        error: null,
        conflict: null,
      },
    }, targetScope)
    return applyCloudWrite(parsed.value, baseRevision, targetScope, requestId)
  }, [applyCloudWrite, cacheAndCommit, commit, isConfigured, userId])

  const useCloud = useCallback(() => {
    const conflict = stateRef.current.sync.conflict
    if (!conflict) return
    ++requestRef.current
    const targetScope = soccerSettingsCacheScope(userId)
    const now = new Date().toISOString()
    const cache = createSoccerSettingsCacheRecord(conflict.cloud, {
      revision: conflict.cloudRevision,
      pending: null,
      cloudUpdatedAt: conflict.cloudUpdatedAt,
      now,
    })
    cacheAndCommit({
      settings: conflict.cloud,
      cache,
      sync: {
        status: 'synced',
        revision: conflict.cloudRevision,
        error: null,
        lastSyncedAt: conflict.cloudUpdatedAt,
        conflict: null,
      },
    }, targetScope)
  }, [cacheAndCommit, userId])

  const keepDevice = useCallback(async () => {
    const conflict = stateRef.current.sync.conflict
    if (!conflict || !userId || !isConfigured) return
    const requestId = ++requestRef.current
    const targetScope = soccerSettingsCacheScope(userId)
    const cache = createSoccerSettingsCacheRecord(conflict.device, {
      revision: conflict.cloudRevision,
      pending: { baseRevision: conflict.cloudRevision },
      cloudUpdatedAt: stateRef.current.sync.lastSyncedAt,
    })
    cacheAndCommit({
      settings: conflict.device,
      cache,
      sync: {
        ...stateRef.current.sync,
        status: 'saving',
        revision: conflict.cloudRevision,
        error: null,
        conflict: null,
      },
    }, targetScope)
    await applyCloudWrite(
      conflict.device,
      conflict.cloudRevision,
      targetScope,
      requestId
    )
  }, [applyCloudWrite, cacheAndCommit, isConfigured, userId])

  return {
    settings: state.settings,
    sync: state.sync,
    save,
    refresh,
    useCloud,
    keepDevice,
  }
}

function initialState(
  scope: SportSettingsCacheScope,
  checkingCloud: boolean
): ControllerState {
  const cache = validSoccerSettingsCache(
    loadSportSettingsCache(scope, 'soccer')
  )
  return {
    settings: cache?.settings ??
      structuredClone(DEFAULT_SOCCER_PERSONAL_SETTINGS),
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

function parseCloudSoccerRecord(
  record: SportSettingsCloudRecord
): SportSettingsCloudRecord<SoccerPersonalSettings> | null {
  if (record.schemaVersion !== SOCCER_SETTINGS_SCHEMA_VERSION) return null
  const parsed = parseSoccerPersonalSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

function cacheScopeKey(scope: SportSettingsCacheScope): string {
  return scope.kind === 'anonymous' ? 'anonymous' : `user:${scope.userId}`
}
