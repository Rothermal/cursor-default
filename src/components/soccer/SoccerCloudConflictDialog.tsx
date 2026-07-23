import { Cloud, Download, Laptop, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { GameEventSyncConflict } from '../../types'
import type { GameEvent } from '../../lib/gameEvents/types'
import { formatSoccerDuration } from '../../lib/soccer'

interface SoccerCloudConflictDialogProps {
  conflicts: GameEventSyncConflict[]
  busy: boolean
  onResolve: (eventId: string, resolution: 'local' | 'remote') => void
  onExport: () => void
  onClose: () => void
}

export default function SoccerCloudConflictDialog({
  conflicts,
  busy,
  onResolve,
  onExport,
  onClose,
}: SoccerCloudConflictDialogProps) {
  const conflict = conflicts[0]
  if (!conflict) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soccer-conflict-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-lg bg-white sm:max-w-2xl sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="min-w-0 flex-1">
            <h2 id="soccer-conflict-title" className="font-bold text-slate-900">Event Conflict</h2>
            <p className="text-xs text-slate-500">
              {conflicts.length} {conflicts.length === 1 ? 'event needs' : 'events need'} review
            </p>
          </div>
          <button type="button" onClick={onExport} className="grid h-9 w-9 place-items-center text-slate-500" aria-label="Export recovery file" title="Export recovery file">
            <Download size={19} />
          </button>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-slate-500" aria-label="Close" title="Close">
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
    <section className="min-w-0 border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 font-bold text-slate-800">{icon}{title}</div>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Type</dt><dd className="truncate font-semibold text-slate-800">{event.eventType.replace('soccer.', '').replace(/_/g, ' ')}</dd>
        <dt className="text-slate-500">Revision</dt><dd className="font-semibold text-slate-800">{event.revision}</dd>
        <dt className="text-slate-500">Side</dt><dd className="capitalize text-slate-700">{event.teamSide}</dd>
        <dt className="text-slate-500">Time</dt><dd className="text-slate-700">{event.period.id} {event.elapsedMs === null ? '' : formatSoccerDuration(event.elapsedMs)}</dd>
        <dt className="text-slate-500">State</dt><dd className="text-slate-700">{event.deletedAt ? 'Removed' : 'Active'}</dd>
        <dt className="text-slate-500">Updated</dt><dd className="truncate text-slate-700">{new Date(event.updatedAt).toLocaleString()}</dd>
      </dl>
      <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 pt-3 text-[11px] text-slate-600">
        {JSON.stringify(event.payload, null, 2)}
      </pre>
      <button
        type="button"
        onClick={onChoose}
        disabled={disabled}
        className={`mt-3 min-h-11 w-full rounded-md px-3 text-sm font-bold text-white disabled:opacity-50 ${tone === 'local' ? 'bg-emerald-700' : 'bg-slate-800'}`}
      >
        {action}
      </button>
    </section>
  )
}
