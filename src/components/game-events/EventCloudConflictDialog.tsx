import { Cloud, Download, Laptop, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { GameEventSyncConflict } from '../../types'
import type { GameEvent } from '../../lib/gameEvents/types'

interface EventCloudConflictDialogProps {
  conflicts: GameEventSyncConflict[]
  busy: boolean
  onResolve: (eventId: string, resolution: 'local' | 'remote') => void
  onExport: () => void
  onClose: () => void
}

export default function EventCloudConflictDialog({
  conflicts,
  busy,
  onResolve,
  onExport,
  onClose,
}: EventCloudConflictDialogProps) {
  const conflict = conflicts[0]
  if (!conflict) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-overlay/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-conflict-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-2xl sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <div className="min-w-0 flex-1">
            <h2 id="event-conflict-title" className="font-bold text-content">Event Conflict</h2>
            <p className="text-xs text-content-muted">
              {conflicts.length} {conflicts.length === 1 ? 'event needs' : 'events need'} review
            </p>
          </div>
          <button type="button" onClick={onExport} className="grid h-9 w-9 shrink-0 place-items-center text-content-muted" aria-label="Export recovery file" title="Export recovery file">
            <Download size={19} />
          </button>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center text-content-muted" aria-label="Close" title="Close">
            <X size={20} />
          </button>
        </header>

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <ConflictChoice
            icon={<Laptop size={18} />}
            title="This Device"
            event={conflict.localEvent}
            action="Keep This Device"
            tone="local"
            disabled={busy}
            onChoose={() => onResolve(conflict.eventId, 'local')}
          />
          <ConflictChoice
            icon={<Cloud size={18} />}
            title="Cloud"
            event={conflict.remoteEvent}
            action="Use Cloud Version"
            tone="remote"
            disabled={busy}
            onChoose={() => onResolve(conflict.eventId, 'remote')}
          />
        </div>
      </div>
    </div>
  )
}

function ConflictChoice({
  icon,
  title,
  event,
  action,
  tone,
  disabled,
  onChoose,
}: {
  icon: ReactNode
  title: string
  event: GameEvent
  action: string
  tone: 'local' | 'remote'
  disabled: boolean
  onChoose: () => void
}) {
  return (
    <section className="min-w-0 border border-line bg-surface-muted p-3">
      <div className="flex items-center gap-2 font-bold text-content">{icon}{title}</div>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-content-muted">Type</dt><dd className="truncate font-semibold text-content">{eventTypeLabel(event)}</dd>
        <dt className="text-content-muted">Revision</dt><dd className="font-semibold text-content">{event.revision}</dd>
        <dt className="text-content-muted">Side</dt><dd className="capitalize text-content">{event.teamSide}</dd>
        <dt className="text-content-muted">Time</dt><dd className="min-w-0 break-words text-content">{event.period.id} {event.elapsedMs === null ? '' : formatElapsed(event.elapsedMs)}</dd>
        <dt className="text-content-muted">State</dt><dd className="text-content">{event.deletedAt ? 'Removed' : 'Active'}</dd>
        <dt className="text-content-muted">Updated</dt><dd className="truncate text-content">{new Date(event.updatedAt).toLocaleString()}</dd>
      </dl>
      <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words border-t border-line pt-3 text-[11px] text-content-muted">
        {JSON.stringify(event.payload, null, 2)}
      </pre>
      <button
        type="button"
        onClick={onChoose}
        disabled={disabled}
        className={`mt-3 min-h-11 w-full rounded-md px-3 text-sm font-bold disabled:bg-control-disabled disabled:text-content-disabled ${tone === 'local' ? 'bg-accent text-accent-content' : 'bg-control text-content'}`}
      >
        {action}
      </button>
    </section>
  )
}

function eventTypeLabel(event: GameEvent): string {
  const prefix = `${event.sportId}.`
  const type = event.eventType.startsWith(prefix)
    ? event.eventType.slice(prefix.length)
    : event.eventType
  return type.replace(/_/g, ' ')
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
