import { useEffect, useState } from 'react'
import { CloudOff, Download, RefreshCw, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useGame } from '../context/GameContext'
import { APP_BUILD_LABEL } from '../lib/buildInfo'

export default function PwaStatus() {
  const { prepareActiveGameMutation } = useGame()
  const [online, setOnline] = useState(() => navigator.onLine)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisterError: () => {
      setUpdateError('App update checks are unavailable in this browser session.')
    },
  })

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const applyUpdate = async () => {
    if (!prepareActiveGameMutation('reload_commit')) return
    setUpdating(true)
    setUpdateError(null)
    try {
      await updateServiceWorker(true)
    } catch {
      setUpdating(false)
      setUpdateError('The update could not be applied. Stay online and try again.')
    }
  }

  if (!needRefresh && !offlineReady && online && !updateError) return null

  const dismiss = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
    setUpdateError(null)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] px-3 safe-bottom sm:px-4">
      <section
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-auto mx-auto flex max-w-lg items-start gap-3 rounded-md border border-slate-300 bg-white p-3 shadow-xl"
      >
        {needRefresh ? (
          <Download className="mt-0.5 shrink-0 text-blue-700" size={20} aria-hidden />
        ) : !online ? (
          <CloudOff className="mt-0.5 shrink-0 text-amber-700" size={20} aria-hidden />
        ) : (
          <RefreshCw className="mt-0.5 shrink-0 text-emerald-700" size={20} aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-900">
            {needRefresh
              ? 'App update ready'
              : !online
                ? 'You are offline'
                : updateError
                  ? 'Update check needs attention'
                  : 'Offline use is ready'}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            {needRefresh
              ? `Build ${APP_BUILD_LABEL} stays active until you choose Update. Existing games remain saved.`
              : !online
                ? `Build ${APP_BUILD_LABEL} is still active. Local-only work remains available; cloud actions wait for a connection.`
                : updateError ?? `Build ${APP_BUILD_LABEL} can reopen without a connection.`}
          </p>
          {needRefresh && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary min-h-10 px-4 py-2 text-sm"
                disabled={updating}
                onClick={() => { void applyUpdate() }}
              >
                {updating ? 'Updating...' : 'Update now'}
              </button>
              <button
                type="button"
                className="btn-secondary min-h-10 px-4 py-2 text-sm"
                disabled={updating}
                onClick={() => setNeedRefresh(false)}
              >
                Later
              </button>
            </div>
          )}
        </div>
        {!updating && (
          <button
            type="button"
            onClick={dismiss}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Dismiss app status"
          >
            <X size={18} aria-hidden />
          </button>
        )}
      </section>
    </div>
  )
}
