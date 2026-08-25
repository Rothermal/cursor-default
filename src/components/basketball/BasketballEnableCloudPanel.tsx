import { CloudUpload } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GameState } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import { canOfferBasketballEventCloudEnable } from '../../lib/basketball/enableCloudSync'
import ConfirmDialog from '../ConfirmDialog'

export default function BasketballEnableCloudPanel({ state }: { state: GameState }) {
  const { user } = useAuth()
  const { enableBasketballCloudSync } = useGame()
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const userId = user?.id ?? null
  const available = useMemo(
    () => canOfferBasketballEventCloudEnable(state, userId),
    [state, userId]
  )

  if (!available) return null

  const enable = async () => {
    setConfirmOpen(false)
    setError(null)
    setBusy(true)
    const result = await enableBasketballCloudSync()
    setBusy(false)
    if (!result.ok) setError(result.reason)
  }

  return (
    <>
      <div className="mt-3 border border-blue-200 bg-blue-50 px-3 py-3 text-blue-900">
        <div className="flex items-center gap-3">
          <CloudUpload size={20} className="shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-xs font-semibold">Local-only game</p>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="min-h-9 rounded-md bg-blue-700 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Enabling...' : 'Enable Cloud Sync'}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 border-t border-blue-200 pt-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Enable cloud sync?"
        message="This uploads the complete local recorder stream and permanently binds this game to its cloud record."
        confirmLabel="Enable Cloud Sync"
        cancelLabel="Keep Local Only"
        destructive={false}
        onConfirm={() => { void enable() }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
