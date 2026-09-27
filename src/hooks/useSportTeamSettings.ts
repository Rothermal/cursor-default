import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { loadTeamSportSettings } from '../lib/sportSettingsCloud'
import { loadSportSettingsCache, saveSportSettingsCache } from '../lib/sportSettingsStorage'
import { createSportTeamSettingsCacheRecord, type SportTeamSettingsAdapter } from '../lib/sportTeamSettings'

/**
 * Sport-neutral version of `useBasketballTeamSettings`: cache-first load of one team's
 * `team_sport_settings` row, online-only compare-and-swap saves, and explicit conflict
 * resolution. The sport adapter owns parsing and the save RPC.
 */
export type SportTeamSettingsStatus =
  | 'idle'
  | 'loading'
  | 'synced'
  | 'cached'
  | 'missing'
  | 'saving'
  | 'conflict'
  | 'backend_update_required'
  | 'error'

export interface SportTeamSettingsController<TSettings> {
  scopeTeamId: string | null
  settings: TSettings
  status: SportTeamSettingsStatus
  revision: number | null
  lastSyncedAt: string | null
  error: string | null
  conflict: TSettings | null
  refresh: () => Promise<void>
  save: (
    settings: TSettings,
    expectedRevision: number | null
  ) => Promise<boolean>
  useCloud: () => void
}

export function useSportTeamSettings<TSettings>(
  adapter: SportTeamSettingsAdapter<TSettings>,
  teamId: string | null,
  active = true
): SportTeamSettingsController<TSettings> {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const [scopeTeamId, setScopeTeamId] = useState<string | null>(null)
  const [settings, setSettings] = useState<TSettings>(
    adapter.defaults
  )
  const [status, setStatus] = useState<SportTeamSettingsStatus>('idle')
  const [revision, setRevision] = useState<number | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<TSettings | null>(null)
  const requestRef = useRef(0)
  const loadingRef = useRef(false)
  const writingRef = useRef(false)
  const cloudConflictRef = useRef<{
    settings: TSettings
    revision: number
    updatedAt: string
  } | null>(null)

  const refresh = useCallback(async () => {
    if (!shouldStartSportTeamSettingsRefresh(
      active && Boolean(teamId && userId && isConfigured),
      loadingRef.current,
      writingRef.current
    )) return
    if (!teamId || !userId) return
    loadingRef.current = true
    const requestId = ++requestRef.current
    const scope = teamScope(userId, teamId)
    const cached = adapter.validCache(
      loadSportSettingsCache(scope, adapter.sportId)
    )
    setScopeTeamId(teamId)
    if (cached) {
      setSettings(cached.settings)
      setRevision(cached.revision)
      setLastSyncedAt(cached.cloudUpdatedAt)
      setStatus('cached')
    } else {
      setSettings(adapter.defaults())
      setRevision(null)
      setLastSyncedAt(null)
      setStatus('loading')
    }
    setError(null)
    setConflict(null)
    cloudConflictRef.current = null

    try {
      const loaded = await loadTeamSportSettings(teamId, adapter.sportId)
      if (requestId !== requestRef.current) return
      if (loaded.status === 'loaded' || loaded.status === 'missing') {
        const resolved = resolveCloudRecord(adapter, 
          loaded.status === 'loaded' ? loaded.record : null
        )
        if (resolved.status === 'invalid') {
          setStatus('error')
          setError(`Shared ${adapter.label} defaults use an unsupported or invalid schema.`)
          return
        }
        if (resolved.status === 'missing') {
          const cacheResult = saveSportSettingsCache(
            scope,
            createSportTeamSettingsCacheRecord(adapter, resolved.settings, {
              revision: null,
              cloudUpdatedAt: null,
            })
          )
          setSettings(resolved.settings)
          setRevision(null)
          setLastSyncedAt(null)
          setError(cacheResult.ok ? null : cacheResult.error)
          setStatus('missing')
          return
        }
        const cacheResult = saveSportSettingsCache(
          scope,
          createSportTeamSettingsCacheRecord(adapter, resolved.record.settings, {
            revision: resolved.record.revision,
            cloudUpdatedAt: resolved.record.updatedAt,
          })
        )
        setSettings(resolved.record.settings)
        setRevision(resolved.record.revision)
        setLastSyncedAt(resolved.record.updatedAt)
        setError(cacheResult.ok ? null : cacheResult.error)
        setStatus('synced')
        return
      }
      if (loaded.status === 'not_configured') {
        setStatus(cached ? 'cached' : 'error')
        setError(cached ? null : 'Shared team settings are unavailable.')
        return
      }
      setStatus(
        loaded.status === 'backend_update_required'
          ? 'backend_update_required'
          : cached
            ? 'cached'
            : 'error'
      )
      setError(loaded.error)
    } catch (loadError) {
      if (requestId !== requestRef.current) return
      setStatus(cached ? 'cached' : 'error')
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Shared team settings could not be reached.'
      )
    } finally {
      loadingRef.current = false
    }
  }, [active, adapter, isConfigured, teamId, userId])

  useEffect(() => {
    requestRef.current += 1
    loadingRef.current = false
    if (!active || !teamId || !userId) {
      setScopeTeamId(null)
      setSettings(adapter.defaults())
      setStatus('idle')
      setRevision(null)
      setLastSyncedAt(null)
      setError(null)
      setConflict(null)
      cloudConflictRef.current = null
      return
    }
    void refresh()
  }, [active, adapter, refresh, teamId, userId])

  useEffect(() => {
    if (!active || !teamId || !userId) return
    const retry = () => { void refresh() }
    const markOffline = () => {
      setStatus(current => current === 'idle' ? current : 'cached')
      setError('Reconnect to refresh or edit shared team defaults.')
    }
    window.addEventListener('focus', retry)
    window.addEventListener('online', retry)
    window.addEventListener('offline', markOffline)
    return () => {
      window.removeEventListener('focus', retry)
      window.removeEventListener('online', retry)
      window.removeEventListener('offline', markOffline)
    }
  }, [active, refresh, teamId, userId])

  const save = useCallback(async (
    next: TSettings,
    expectedRevision: number | null
  ): Promise<boolean> => {
    if (!active || !teamId || !userId || !isConfigured) {
      setError('Shared team settings require an online signed-in session.')
      return false
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('cached')
      setError('Reconnect before saving shared team defaults.')
      return false
    }
    const parsed = adapter.parse(next)
    if (!parsed.ok) {
      setError(parsed.error)
      return false
    }
    if (writingRef.current) return false
    writingRef.current = true
    const requestId = ++requestRef.current
    setStatus('saving')
    setError(null)
    try {
      let result
      try {
        result = await adapter.save(
          teamId,
          expectedRevision,
          parsed.value
        )
      } catch (saveError) {
        if (requestId !== requestRef.current) return false
        setStatus('error')
        setError(
          saveError instanceof Error
            ? saveError.message
            : 'Shared team settings could not be saved.'
        )
        return false
      }
      if (requestId !== requestRef.current) return false
      if (result.status === 'applied' && result.record) {
        const saved = adapter.parseCloud(result.record)
        if (!saved) {
          setStatus('error')
          setError(`Shared ${adapter.label} defaults returned invalid saved data.`)
          return false
        }
        const scope = teamScope(userId, teamId)
        const cacheResult = saveSportSettingsCache(
          scope,
          createSportTeamSettingsCacheRecord(adapter, saved.settings, {
            revision: saved.revision,
            cloudUpdatedAt: saved.updatedAt,
          })
        )
        setSettings(saved.settings)
        setRevision(saved.revision)
        setLastSyncedAt(saved.updatedAt)
        setConflict(null)
        cloudConflictRef.current = null
        setError(cacheResult.ok ? null : cacheResult.error)
        setStatus('synced')
        return true
      }
      if (result.status === 'conflict') {
        const current = result.record
          ? adapter.parseCloud(result.record)
          : null
        if (current) {
          cloudConflictRef.current = {
            settings: current.settings,
            revision: current.revision,
            updatedAt: current.updatedAt,
          }
          setConflict(current.settings)
        }
        setStatus('conflict')
        setError(
          current
            ? null
            : 'Shared defaults changed. Refresh before saving again.'
        )
        return false
      }
      setStatus(
        result.status === 'backend_update_required'
          ? 'backend_update_required'
          : 'error'
      )
      setError(
        result.status === 'backend_update_required' || result.status === 'error'
          ? result.error
          : 'Shared team settings are unavailable.'
      )
      return false
    } finally {
      writingRef.current = false
    }
  }, [active, adapter, isConfigured, teamId, userId])

  const useCloud = useCallback(() => {
    const current = cloudConflictRef.current
    if (!current || !teamId || !userId) return
    const scope = teamScope(userId, teamId)
    const cacheResult = saveSportSettingsCache(
      scope,
      createSportTeamSettingsCacheRecord(adapter, current.settings, {
        revision: current.revision,
        cloudUpdatedAt: current.updatedAt,
      })
    )
    setSettings(current.settings)
    setRevision(current.revision)
    setLastSyncedAt(current.updatedAt)
    setConflict(null)
    cloudConflictRef.current = null
    setError(cacheResult.ok ? null : cacheResult.error)
    setStatus('synced')
  }, [adapter, teamId, userId])

  return {
    scopeTeamId,
    settings,
    status,
    revision,
    lastSyncedAt,
    error,
    conflict,
    refresh,
    save,
    useCloud,
  }
}

export function shouldStartSportTeamSettingsRefresh(
  cloudEnabled: boolean,
  loading: boolean,
  writing: boolean
): boolean {
  return cloudEnabled && !loading && !writing
}

function teamScope(userId: string, teamId: string) {
  return { kind: 'team' as const, userId, teamId }
}

function resolveCloudRecord<TSettings>(
  adapter: SportTeamSettingsAdapter<TSettings>,
  record: Parameters<SportTeamSettingsAdapter<TSettings>['parseCloud']>[0] | null
) {
  if (!record) return { status: 'missing' as const, settings: adapter.defaults() }
  const parsed = adapter.parseCloud(record)
  return parsed ? { status: 'loaded' as const, record: parsed } : { status: 'invalid' as const }
}
