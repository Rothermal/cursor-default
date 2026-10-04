import { BadgeAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import { useTeamRole } from '../../hooks/useTeamRole'
import { eventCloudPolicyForState } from '../../lib/eventCloudPolicy'
import { canOfferDeletedSourcePlayerRecovery, deletedSourceRecoveryTeamId } from '../../lib/gameEvents/deletedSourceRecovery'
import { hockeyCloudEnableAvailability } from '../../lib/hockey/enableCloudSync'
import type { GameState } from '../../types'
import ConfirmDialog from '../ConfirmDialog'
import EventCloudConflictDialog from '../game-events/EventCloudConflictDialog'

function exportHockeyRecovery(state: GameState): void {
  const blob = new Blob([
    JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), kind: 'hockey-game-recovery', gameState: state }, null, 2),
  ], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `statkeeper-hockey-recovery-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

/** One line for the Game menu: where this game is saved. */
function hockeyCloudStatusLine(state: GameState): string {
  if (eventCloudPolicyForState(state) === 'local_only') return 'Saved on this device only.'
  if (state.cloudSync.gameStatus === 'final') return 'Finalized in the cloud.'
  switch (state.cloudSync.status) {
    case 'syncing': return 'Syncing to the cloud…'
    case 'offline': return 'Offline. Events sync when you reconnect.'
    case 'error': return state.cloudSync.lastError ?? 'Cloud sync needs attention.'
    case 'synced': return 'Synced to the cloud.'
    default: return state.cloudSync.gameId ? 'Synced to the cloud.' : 'Waiting to sync.'
  }
}

/** Game menu section: sync status, and Enable cloud sync for a device game (HKY-5B, plan §7 Q4). */
export function HockeyCloudMenuSection({ state, onDone }: { state: GameState; onDone: () => void }) {
  const { user } = useAuth()
  const { enableEventCloudSync } = useGame()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const availability = useMemo(() => hockeyCloudEnableAvailability(state, user?.id ?? null), [state, user])

  const enable = async () => {
    setConfirmOpen(false)
    setBusy(true)
    setError(null)
    const result = await enableEventCloudSync()
    setBusy(false)
    if (result.ok) onDone()
    else setError(result.reason)
  }

  return (
    <section className="space-y-2 border-t border-line pt-3" aria-label="Cloud sync">
      <p className="text-sm text-content-muted">{hockeyCloudStatusLine(state)}</p>
      {availability.offer ? (
        <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => setConfirmOpen(true)}>
          {busy ? 'Enabling cloud sync…' : 'Enable cloud sync'}
        </button>
      ) : availability.reason ? (
        <p className="text-sm text-content-muted">{availability.reason}</p>
      ) : null}
      {error && <p role="alert" className="text-sm text-danger-content">{error}</p>}
      <ConfirmDialog
        open={confirmOpen}
        title="Enable cloud sync?"
        message="This uploads every event recorded so far and links this game to its cloud record for good."
        confirmLabel="Enable cloud sync"
        cancelLabel="Keep on this device"
        destructive={false}
        onConfirm={() => { void enable() }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  )
}

/** Sync problems shown on the tracker: conflicts to review, or an error with Retry and Export. */
export function HockeyCloudSyncAlerts({ state }: { state: GameState }) {
  const { flushCloudSync, resolveEventConflict, recoverDeletedEventParticipantSources } = useGame()
  const teamAccess = useTeamRole(deletedSourceRecoveryTeamId(state))
  const [conflictOpen, setConflictOpen] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const conflicts = state.cloudSync.eventConflicts ?? []

  useEffect(() => {
    if (conflicts.length > 0) setConflictOpen(true)
  }, [conflicts.length])

  const retry = async () => {
    setBusy(true)
    const result = await flushCloudSync()
    setBusy(false)
    setError(result.ok ? null : result.reason)
  }

  const preserveHistory = async () => {
    setRecoveryOpen(false)
    setBusy(true)
    const result = await recoverDeletedEventParticipantSources()
    setBusy(false)
    setError(result.ok ? null : result.reason)
  }

  const resolve = (eventId: string, resolution: 'local' | 'remote') => {
    const result = resolveEventConflict(eventId, resolution)
    if (!result.ok) {
      setError(result.reason)
      return
    }
    setError(null)
    if (conflicts.length === 1) setConflictOpen(false)
  }

  const canPreserve = canOfferDeletedSourcePlayerRecovery(state.cloudSync.lastError, teamAccess.role)
  const showError = conflicts.length === 0 && state.cloudSync.status === 'error' &&
    eventCloudPolicyForState(state) !== 'local_only'

  return (
    <>
      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
      )}
      {conflicts.length > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-warning-line bg-warning px-3 py-2 text-warning-content">
          <BadgeAlert size={20} className="shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">
            {conflicts.length} {conflicts.length === 1 ? 'event needs' : 'events need'} review before syncing.
          </p>
          <button type="button" className="btn-secondary" onClick={() => setConflictOpen(true)}>Review</button>
        </div>
      )}
      {showError && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-danger-line bg-danger px-3 py-2 text-danger-content">
          <BadgeAlert size={20} className="shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">{state.cloudSync.lastError ?? 'Cloud sync needs attention.'}</p>
          {canPreserve && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setRecoveryOpen(true)}>Preserve history</button>
          )}
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { void retry() }}>
            {busy ? 'Retrying…' : 'Retry'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => exportHockeyRecovery(state)}>Export</button>
        </div>
      )}
      {conflictOpen && conflicts.length > 0 && (
        <EventCloudConflictDialog
          conflicts={conflicts}
          busy={busy}
          onResolve={resolve}
          onExport={() => exportHockeyRecovery(state)}
          onClose={() => setConflictOpen(false)}
        />
      )}
      <ConfirmDialog
        open={recoveryOpen}
        title="Preserve deleted player history?"
        message="A player in this game may have been deleted from the cloud roster. A team owner or admin can keep the frozen name, number and events without linking them to another player. No events or scores change."
        confirmLabel="Preserve and retry"
        cancelLabel="Cancel"
        destructive={false}
        onConfirm={() => { void preserveHistory() }}
        onCancel={() => setRecoveryOpen(false)}
      />
    </>
  )
}
