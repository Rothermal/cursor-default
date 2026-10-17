import { useGame } from '../context/GameContext'
import { isEventGameLocalOnly } from '../lib/eventCloudPolicy'

export default function GameSyncStatus() {
  const { state } = useGame()
  const { cloudSync } = state
  const label = (() => {
    if (isEventGameLocalOnly(state) && cloudSync.status !== 'error') return 'Cloud Sync: local only'
    switch (cloudSync.status) {
      case 'offline': return 'Cloud Sync: offline'
      case 'syncing': return 'Cloud Sync: syncing...'
      case 'synced': return cloudSync.lastSyncedAt ? 'Cloud Sync: saved' : 'Cloud Sync: connected'
      case 'error':
        if (cloudSync.lastError?.includes("Could not find the table 'public.")) return 'Cloud Sync: run migrations'
        if (cloudSync.lastError?.includes('infinite recursion detected in policy')) return 'Cloud Sync: apply 005 migration'
        return 'Cloud Sync: error'
      default: return null
    }
  })()

  return label ? <p role="status" className="mt-1 text-center text-[11px] text-content-muted">{label}</p> : null
}
