import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

interface GuardianRow {
  user_id: string
  display_name: string
  relationship: string
  created_at: string
  is_creator: boolean
  is_current_user: boolean
  can_remove: boolean
}

interface PlayerGuardiansDialogProps {
  open: boolean
  playerId: string
  playerName: string
  teamId: string
  onClose: () => void
  onCurrentUserRemoved: () => void
}

export default function PlayerGuardiansDialog({
  open,
  playerId,
  playerName,
  teamId,
  onClose,
  onCurrentUserRemoved,
}: PlayerGuardiansDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [guardians, setGuardians] = useState<GuardianRow[]>([])
  const [loading, setLoading] = useState(false)
  const [removingUserId, setRemovingUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !supabase) return
    const client = supabase
    let cancelled = false

    const loadGuardians = async () => {
      setLoading(true)
      setError(null)
      const { data, error: rpcError } = await client.rpc('get_player_guardians', {
        p_player_id: playerId,
        p_team_id: teamId,
      })
      if (cancelled) return
      if (rpcError) {
        setGuardians([])
        setError(rpcError.message)
      } else {
        setGuardians((data ?? []) as GuardianRow[])
      }
      setLoading(false)
      closeRef.current?.focus()
    }

    void loadGuardians()
    return () => {
      cancelled = true
    }
  }, [open, playerId, teamId])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  const handleRemove = async (guardian: GuardianRow) => {
    if (!supabase || !guardian.can_remove) return
    const label = guardian.is_current_user ? 'your own guardianship' : `${guardian.display_name}'s guardianship`
    if (!window.confirm(`Remove ${label} from ${playerName}?`)) return

    setRemovingUserId(guardian.user_id)
    setError(null)
    const { error: rpcError } = await supabase.rpc('remove_player_guardian', {
      p_player_id: playerId,
      p_guardian_user_id: guardian.user_id,
      p_team_id: teamId,
    })
    setRemovingUserId(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setGuardians(current => current.filter(row => row.user_id !== guardian.user_id))
    if (guardian.is_current_user) {
      onCurrentUserRemoved()
      onClose()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 px-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-guardians-title"
        className="w-full max-w-sm bg-surface-elevated rounded-lg shadow-xl p-5 space-y-4"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="player-guardians-title" className="text-lg font-bold text-content">
              Player guardians
            </h2>
            <p className="text-sm text-content-muted">{playerName}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-content-muted hover:text-content p-1"
            title="Close"
            aria-label="Close guardian list"
          >
            X
          </button>
        </div>

        {error && (
          <p className="rounded-lg border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-content-muted animate-pulse">Loading guardians...</p>
        ) : guardians.length === 0 ? (
          <p className="text-sm text-content-muted">No guardian relationships are recorded.</p>
        ) : (
          <div className="divide-y divide-line border-y border-line">
            {guardians.map(guardian => (
              <div key={guardian.user_id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-content truncate">
                    {guardian.display_name}
                    {guardian.is_current_user && (
                      <span className="text-xs font-normal text-content-subtle ml-1">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-content-muted">
                    {guardian.is_creator ? 'Player creator' : 'Guardian'}
                  </p>
                </div>
                {guardian.can_remove && (
                  <button
                    type="button"
                    onClick={() => { void handleRemove(guardian) }}
                    disabled={removingUserId === guardian.user_id}
                    className="text-xs font-semibold text-danger-content disabled:opacity-100 disabled:bg-control-disabled disabled:text-content-disabled"
                  >
                    {removingUserId === guardian.user_id ? 'Removing...' : 'Remove'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <button type="button" onClick={onClose} className="btn-secondary w-full">
          Done
        </button>
      </section>
    </div>
  )
}
