import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { captureAuthIdentity, isCurrentAuthIdentity, isCurrentAuthUser } from '../lib/authIdentity'
import { createBaseballPersonalSettingsController, type BaseballPersonalSettingsController, type BaseballPersonalSettingsState } from '../lib/baseball/personalSettingsController'
import { defaultBaseballPersonalSettings, type BaseballPersonalSettingsV1 } from '../lib/baseball/settings'

export function useBaseballPersonalSettings(active: boolean) {
  const { user, loading, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const identity = userId ? captureAuthIdentity(userId) : null
  const key = JSON.stringify([loading, userId, identity])
  const owner = useRef<{ key: string; controller: BaseballPersonalSettingsController } | null>(null)
  const [snapshot, setSnapshot] = useState<{ key: string; value: BaseballPersonalSettingsState } | null>(null)

  useEffect(() => {
    if (loading || (userId ? !identity || !isCurrentAuthIdentity(identity) : !isCurrentAuthUser(null))) return
    const controller = createBaseballPersonalSettingsController(userId)
    const binding = { key, controller }
    owner.current = binding
    const update = () => {
      if (owner.current === binding) setSnapshot({ key, value: controller.getState() })
    }
    const unsubscribe = controller.subscribe(update)
    update()
    const refresh = () => { if (active && userId && isConfigured) void controller.refresh() }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      unsubscribe()
      controller.dispose()
      if (owner.current === binding) owner.current = null
    }
    // The serialized key includes the synchronous auth generation, including A -> B -> A.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, isConfigured])

  const current = useCallback(() => {
    if (loading || (userId ? !identity || !isCurrentAuthIdentity(identity) : !isCurrentAuthUser(null))) return null
    return owner.current?.key === key ? owner.current.controller : null
  }, [key, loading, userId, identity])
  const save = useCallback((settings: BaseballPersonalSettingsV1, revision?: number | null) => current()?.save(settings, revision) ?? Promise.resolve(false), [current])
  const refresh = useCallback(() => current()?.refresh() ?? Promise.resolve(false), [current])
  const useCloud = useCallback(() => current()?.useCloud() ?? Promise.resolve(false), [current])
  const keepDevice = useCallback(() => current()?.keepDevice() ?? Promise.resolve(false), [current])
  const visible = snapshot?.key === key ? snapshot.value : null
  return {
    settings: visible?.settings ?? defaultBaseballPersonalSettings(),
    sync: visible?.sync ?? { status: 'checking' as const, revision: null, error: null, lastSyncedAt: null, conflict: null },
    save, refresh, useCloud, keepDevice,
    scopeKey: key,
  }
}
