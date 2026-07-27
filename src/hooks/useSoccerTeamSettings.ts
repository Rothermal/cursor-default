import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  loadTeamSportSettings,
  saveTeamSportSettings,
} from '../lib/sportSettingsCloud'
import {
  loadSportSettingsCache,
  saveSportSettingsCache,
} from '../lib/sportSettingsStorage'
import {
  SOCCER_SETTINGS_SCHEMA_VERSION,
  parseSoccerTeamSettings,
  type SoccerTeamSettings,
} from '../lib/soccer/settings'
import {
  EMPTY_SOCCER_TEAM_SETTINGS,
  createSoccerTeamSettingsCacheRecord,
  parseCloudSoccerTeamSettings,
  soccerTeamSettingsCacheScope,
  validSoccerTeamSettingsCache,
} from '../lib/soccer/teamSettingsSync'
import {
  isCurrentSoccerSettingsRequest,
  shouldBeginSoccerSettingsWrite,
} from './useSoccerPersonalSettings'

export type SoccerTeamSettingsStatus =
  | 'idle'
  | 'loading'
  | 'synced'
  | 'cached'
  | 'missing'
  | 'saving'
  | 'conflict'
  | 'backend_update_required'
  | 'error'

export interface SoccerTeamSettingsController {
  scopeTeamId: string | null
  settings: SoccerTeamSettings
  status: SoccerTeamSettingsStatus
  revision: number | null
  lastSyncedAt: string | null
  error: string | null
  conflict: SoccerTeamSettings | null
  refresh: () => Promise<void>
  save: (settings: SoccerTeamSettings, expectedRevision: number | null) => Promise<boolean>
  useCloud: () => void
}

export function useSoccerTeamSettings(
  teamId: string | null,
  active = true
): SoccerTeamSettingsController {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const [scopeTeamId, setScopeTeamId] = useState<string | null>(null)
  const [settings, setSettings] = useState<SoccerTeamSettings>(
    structuredClone(EMPTY_SOCCER_TEAM_SETTINGS)
  )
  const [status, setStatus] = useState<SoccerTeamSettingsStatus>('idle')
  const [revision, setRevision] = useState<number | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<SoccerTeamSettings | null>(null)
  const requestRef = useRef(0)
  const loadingRef = useRef(false)
  const writingRef = useRef(false)
  const cloudConflictRef = useRef<{
    settings: SoccerTeamSettings
    revision: number
    updatedAt: string
  } | null>(null)

  const refresh = useCallback(async () => {
    if (!shouldStartSoccerTeamSettingsRefresh(
      active && Boolean(teamId && userId && isConfigured),
      loadingRef.current,
      writingRef.current
    )) return
    if (!teamId || !userId) return
    loadingRef.current = true
    const requestId = ++requestRef.current
    const scope = soccerTeamSettingsCacheScope(userId, teamId)
    const cached = validSoccerTeamSettingsCache(
      loadSportSettingsCache(scope, 'soccer')
    )
    setScopeTeamId(teamId)
    if (cached) {
      setSettings(cached.settings)
      setRevision(cached.revision)
      setLastSyncedAt(cached.cloudUpdatedAt)
      setStatus('cached')
    } else {
      setSettings(structuredClone(EMPTY_SOCCER_TEAM_SETTINGS))
      setRevision(null)
      setLastSyncedAt(null)
      setStatus('loading')
    }
    setError(null)
    setConflict(null)
    cloudConflictRef.current = null

    try {
      const loaded = await loadTeamSportSettings(teamId, 'soccer')
      if (!isCurrentSoccerSettingsRequest(requestId, requestRef.current)) return
      if (loaded.status === 'loaded') {
        const parsed = parseCloudSoccerTeamSettings(loaded.record)
        if (!parsed) {
          setStatus('error')
          setError('Shared soccer defaults use an unsupported or invalid schema.')
          return
        }
        const cache = createSoccerTeamSettingsCacheRecord(parsed.settings, {
          revision: parsed.revision,
          cloudUpdatedAt: parsed.updatedAt,
        })
        const cacheResult = saveSportSettingsCache(scope, cache)
        setSettings(parsed.settings)
        setRevision(parsed.revision)
        setLastSyncedAt(parsed.updatedAt)
        setError(cacheResult.ok ? null : cacheResult.error)
        setStatus('synced')
        return
      }
      if (loaded.status === 'missing') {
        const empty = structuredClone(EMPTY_SOCCER_TEAM_SETTINGS)
        const cacheResult = saveSportSettingsCache(
          scope,
          createSoccerTeamSettingsCacheRecord(empty, {
            revision: null,
            cloudUpdatedAt: null,
          })
        )
        setSettings(empty)
        setRevision(null)
        setLastSyncedAt(null)
        setError(cacheResult.ok ? null : cacheResult.error)
        setStatus('missing')
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
      if (!isCurrentSoccerSettingsRequest(requestId, requestRef.current)) return
      setStatus(cached ? 'cached' : 'error')
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Shared team settings could not be reached.'
      )
    } finally {
      loadingRef.current = false
    }
  }, [active, isConfigured, teamId, userId])

  useEffect(() => {
    requestRef.current += 1
    loadingRef.current = false
    if (!active || !teamId || !userId) {
      setScopeTeamId(null)
      setSettings(structuredClone(EMPTY_SOCCER_TEAM_SETTINGS))
      setStatus('idle')
      setRevision(null)
      setLastSyncedAt(null)
      setError(null)
      setConflict(null)
      return
    }
    void refresh()
  }, [active, refresh, teamId, userId])

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
    next: SoccerTeamSettings,
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
    const parsed = parseSoccerTeamSettings(next)
    if (!parsed.ok) {
      setError(parsed.error)
      return false
    }
    if (!shouldBeginSoccerSettingsWrite(writingRef.current)) return false
    writingRef.current = true
    const requestId = ++requestRef.current
    setStatus('saving')
    setError(null)
    try {
      let result
      try {
        result = await saveTeamSportSettings(
          teamId,
          'soccer',
          SOCCER_SETTINGS_SCHEMA_VERSION,
          expectedRevision,
          parsed.value
        )
      } catch (saveError) {
        if (!isCurrentSoccerSettingsRequest(requestId, requestRef.current)) return false
        setStatus('error')
        setError(
          saveError instanceof Error
            ? saveError.message
            : 'Shared team settings could not be saved.'
        )
        return false
      }
      if (!isCurrentSoccerSettingsRequest(requestId, requestRef.current)) return false
      if (result.status === 'applied' && result.record) {
        const saved = parseCloudSoccerTeamSettings(result.record)
        if (!saved) {
          setStatus('error')
          setError('Shared soccer defaults returned invalid saved data.')
          return false
        }
        const scope = soccerTeamSettingsCacheScope(userId, teamId)
        const cacheResult = saveSportSettingsCache(
          scope,
          createSoccerTeamSettingsCacheRecord(saved.settings, {
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
          ? parseCloudSoccerTeamSettings(result.record)
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
  }, [active, isConfigured, teamId, userId])

  const useCloud = useCallback(() => {
    const current = cloudConflictRef.current
    if (!current || !teamId || !userId) return
    const scope = soccerTeamSettingsCacheScope(userId, teamId)
    const cacheResult = saveSportSettingsCache(
      scope,
      createSoccerTeamSettingsCacheRecord(current.settings, {
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
  }, [teamId, userId])

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

export function shouldStartSoccerTeamSettingsRefresh(
  cloudEnabled: boolean,
  loading: boolean,
  writing: boolean
): boolean {
  return cloudEnabled && !loading && !writing
}
