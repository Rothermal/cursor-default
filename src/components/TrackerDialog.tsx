import { X } from 'lucide-react'
import { useId, useRef, type ReactNode } from 'react'
import { useModalFocus } from '../hooks/useModalFocus'

/** Shared sheet chrome; sport actions and their guards remain with the caller. */
export default function TrackerDialog({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocus({ enabled: true, dialogRef: panelRef, onClose })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/[0.5] sm:items-center" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface pb-[env(safe-area-inset-bottom)] sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <h2 id={titleId} className="min-w-0 flex-1 break-words font-bold text-content">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center text-content-muted" aria-label="Close" title="Close"><X size={20} /></button>
        </header>
        <div className="space-y-2 p-4">{children}</div>
      </div>
    </div>
  )
}
