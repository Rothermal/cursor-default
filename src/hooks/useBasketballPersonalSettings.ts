import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  loadUserSportSettings,
  saveBasketballUserSettings,
  type SportSettingsCloudRecord,
} from '../lib/sportSettingsCloud'
import {
  loadSportSettingsCache,
  saveSportSettingsCache,
  type SportSettingsCacheRecord,
  type SportSettingsCacheScope,
} from '../lib/sportSettingsStorage'
import {
  basketballSettingsBootstrap,
  basketballSettingsCacheScope,
  createBasketballSettingsCacheRecord,
  reconcileBasketballPersonalSettings,
  validBasketballSettingsCache,
} from '../lib/basketball/personalSettingsSync'
import {
  BASKETBALL_SETTINGS_SCHEMA_VERSION,
  parseBasketballPersonalSettings,
  type BasketballPersonalSettingsV1,
} from '../lib/basketball/settings'

export type BasketballSettingsSyncStatus =
  | 'local'
  | 'checking'
  | 'synced'
  | 'saving'
  | 'pending'
  | 'conflict'
  | 'backend_update_required'
  | 'error'

export interface BasketballSettingsConflict {
  device: BasketballPersonalSettingsV1
  cloud: BasketballPersonalSettingsV1
  cloudRevision: number | null
  cloudUpdatedAt: string
}

export interface BasketballSettingsSyncState {
  status: BasketballSettingsSyncStatus
  revision: number | null
  error: string | null
  lastSyncedAt: string | null
  conflict: BasketballSettingsConflict | null
}

export interface BasketballPersonalSettingsController {
  settings: BasketballPersonalSettingsV1
  sync: BasketballSettingsSyncState
  save: (
    settings: BasketballPersonalSettingsV1,
    expectedRevision?: number | null
  ) => Promise<boolean>
  refresh: () => Promise<void>
  useCloud: () => void
  keepDevice: () => Promise<void>
}

interface ControllerState {
  settings: BasketballPersonalSettingsV1
  sync: BasketballSettingsSyncState
  cache: SportSettingsCacheRecord<BasketballPersonalSettingsV1> | null
}

export function shouldStartBasketballSettingsRefresh(
  cloudEnabled: boolean,
  refreshing: boolean,
  writing: boolean
): boolean {
  return cloudEnabled && !refreshing && !writing
}

export function useBasketballPersonalSettings(
  legacyReboundPromptAfterMiss: boolean,
  cloudEnabled = false
): BasketballPersonalSettingsController {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const scope = basketballSettingsCacheScope(userId)
  const scopeKey = cacheScopeKey(scope)
  const bootstrap = basketballSettingsBootstrap(legacyReboundPromptAfterMiss)
  const [state, setState] = useState<ControllerState>(() =>
    initialState(scope, Boolean(cloudEnabled && userId && isConfigured), bootstrap)
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
  ): void => {
    const cacheResult = next.cache
      ? saveSportSettingsCache(targetScope, next.cache)
      : { ok: true as const }
    commit(cacheResult.ok
      ? next
      : {
          ...next,
          sync: { ...next.sync, error: cacheResult.error },
        })
  }, [commit])

  const applyCloudWrite = useCallback(async (
    settings: BasketballPersonalSettingsV1,
    expectedRevision: number | null,
    targetScope: SportSettingsCacheScope,
    requestId: number
  ): Promise<boolean> => {
    if (writingRef.current) return false
    writingRef.current = true
    try {
      const result = await saveBasketballUserSettings(expectedRevision, settings)
      if (requestId !== requestRef.current) return false

      if (result.status === 'applied' && result.record) {
        const parsed = parseCloudBasketballRecord(result.record)
        if (!parsed) {
          commit({
            ...stateRef.current,
            sync: {
              ...stateRef.current.sync,
              status: 'error',
              error: 'Cloud Basketball settings returned invalid saved data.',
            },
          })
          return false
        }
        const cache = createBasketballSettingsCacheRecord(parsed.settings, {
          revision: parsed.revision,
          pending: null,
          cloudUpdatedAt: parsed.updatedAt,
        })
        cacheAndCommit({
          settings: parsed.settings,
          cache,
          sync: syncedState(parsed.revision, parsed.updatedAt),
        }, targetScope)
        return true
      }

      if (result.status === 'conflict') {
        const cloud = result.record ? parseCloudBasketballRecord(result.record) : null
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
            : {
                ...stateRef.current.sync,
                status: 'pending',
                error: 'Cloud settings changed. Refresh to compare versions.',
              },
        })
        return false
      }

      commit({
        ...stateRef.current,
        sync: {
          ...stateRef.current.sync,
          status: result.status === 'backend_update_required'
            ? 'backend_update_required'
            : 'pending',
          error: result.status === 'backend_update_required' || result.status === 'error'
            ? result.error
            : result.status === 'not_configured'
              ? null
              : 'Cloud Basketball settings did not return a saved record.',
        },
      })
      return false
    } finally {
      writingRef.current = false
    }
  }, [cacheAndCommit, commit])

  const refresh = useCallback(async () => {
    if (!shouldStartBasketballSettingsRefresh(
      cloudEnabled,
      refreshingRef.current,
      writingRef.current
    )) return
    refreshingRef.current = true
    try {
      const requestId = ++requestRef.current
      const targetScope = basketballSettingsCacheScope(userId)
      const accountCache = validBasketballSettingsCache(
        loadSportSettingsCache(targetScope, 'basketball')
      )
      const anonymousCache = userId
        ? validBasketballSettingsCache(
            loadSportSettingsCache({ kind: 'anonymous' }, 'basketball')
          )
        : null
      const currentBootstrap = anonymousCache?.settings ??
        basketballSettingsBootstrap(legacyReboundPromptAfterMiss)
      const immediateSettings = accountCache?.settings ?? currentBootstrap

      if (!cloudEnabled || !userId || !isConfigured) {
        cacheAndCommit({
          settings: immediateSettings,
          cache: accountCache,
          sync: localState(),
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

      const loaded = await loadUserSportSettings('basketball')
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

      const reconciliationCache = loaded.status === 'missing' && !accountCache && anonymousCache
        ? createBasketballSettingsCacheRecord(anonymousCache.settings, {
            revision: null,
            pending: { baseRevision: null },
            cloudUpdatedAt: null,
          })
        : accountCache
      const decision = reconcileBasketballPersonalSettings(
        reconciliationCache,
        loaded.status === 'loaded' ? loaded.record : null,
        currentBootstrap
      )

      if (decision.action === 'use_cloud') {
        cacheAndCommit({
          settings: decision.settings,
          cache: decision.record,
          sync: syncedState(decision.record.revision, decision.record.cloudUpdatedAt),
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

      const pendingCache = createBasketballSettingsCacheRecord(decision.settings, {
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
  }, [
    applyCloudWrite,
    cacheAndCommit,
    cloudEnabled,
    commit,
    isConfigured,
    legacyReboundPromptAfterMiss,
    userId,
  ])

  useEffect(() => {
    if (cloudEnabled) {
      void refresh()
      return
    }
    commit(initialState(
      basketballSettingsCacheScope(userId),
      false,
      basketballSettingsBootstrap(legacyReboundPromptAfterMiss)
    ))
  }, [cloudEnabled, commit, legacyReboundPromptAfterMiss, refresh, scopeKey, userId])

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
    settings: BasketballPersonalSettingsV1,
    expectedRevision = stateRef.current.sync.revision
  ) => {
    const parsed = parseBasketballPersonalSettings(settings)
    if (!parsed.ok) {
      commit({
        ...stateRef.current,
        sync: { ...stateRef.current.sync, status: 'error', error: parsed.error },
      })
      return false
    }

    const requestId = ++requestRef.current
    const targetScope = basketballSettingsCacheScope(userId)
    if (!userId || !isConfigured) {
      const cache = createBasketballSettingsCacheRecord(parsed.value, {
        revision: null,
        pending: null,
        cloudUpdatedAt: null,
      })
      cacheAndCommit({
        settings: parsed.value,
        cache,
        sync: localState(),
      }, targetScope)
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
    const cache = createBasketballSettingsCacheRecord(parsed.value, {
      revision: baseRevision,
      pending: { baseRevision },
      cloudUpdatedAt: stateRef.current.sync.lastSyncedAt,
    })
    cacheAndCommit({
      settings: parsed.value,
      cache,
      sync: { ...stateRef.current.sync, status: 'saving', error: null, conflict: null },
    }, targetScope)
    return applyCloudWrite(parsed.value, baseRevision, targetScope, requestId)
  }, [applyCloudWrite, cacheAndCommit, commit, isConfigured, userId])

  const useCloud = useCallback(() => {
    const conflict = stateRef.current.sync.conflict
    if (!conflict) return
    ++requestRef.current
    const targetScope = basketballSettingsCacheScope(userId)
    const cache = createBasketballSettingsCacheRecord(conflict.cloud, {
      revision: conflict.cloudRevision,
      pending: null,
      cloudUpdatedAt: conflict.cloudUpdatedAt,
    })
    cacheAndCommit({
      settings: conflict.cloud,
      cache,
      sync: syncedState(conflict.cloudRevision, conflict.cloudUpdatedAt),
    }, targetScope)
  }, [cacheAndCommit, userId])

  const keepDevice = useCallback(async () => {
    const conflict = stateRef.current.sync.conflict
    if (!conflict || !userId || !isConfigured) return
    const requestId = ++requestRef.current
    const targetScope = basketballSettingsCacheScope(userId)
    const cache = createBasketballSettingsCacheRecord(conflict.device, {
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
    await applyCloudWrite(conflict.device, conflict.cloudRevision, targetScope, requestId)
  }, [applyCloudWrite, cacheAndCommit, isConfigured, userId])

  return { settings: state.settings, sync: state.sync, save, refresh, useCloud, keepDevice }
}

function initialState(
  scope: SportSettingsCacheScope,
  checkingCloud: boolean,
  bootstrap: BasketballPersonalSettingsV1
): ControllerState {
  const cache = validBasketballSettingsCache(
    loadSportSettingsCache(scope, 'basketball')
  )
  return {
    settings: cache?.settings ?? structuredClone(bootstrap),
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

function parseCloudBasketballRecord(
  record: SportSettingsCloudRecord
): SportSettingsCloudRecord<BasketballPersonalSettingsV1> | null {
  if (
    record.sportId !== 'basketball' ||
    record.schemaVersion !== BASKETBALL_SETTINGS_SCHEMA_VERSION
  ) return null
  const parsed = parseBasketballPersonalSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

function localState(): BasketballSettingsSyncState {
  return {
    status: 'local',
    revision: null,
    error: null,
    lastSyncedAt: null,
    conflict: null,
  }
}

function syncedState(
  revision: number | null,
  updatedAt: string | null
): BasketballSettingsSyncState {
  return {
    status: 'synced',
    revision,
    error: null,
    lastSyncedAt: updatedAt,
    conflict: null,
  }
}

function cacheScopeKey(scope: SportSettingsCacheScope): string {
  return scope.kind === 'anonymous'
    ? 'anonymous'
    : scope.kind === 'user'
      ? `user:${scope.userId}`
      : `team:${scope.userId}:${scope.teamId}`
}
