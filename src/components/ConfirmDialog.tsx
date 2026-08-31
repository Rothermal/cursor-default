import { useId, useRef } from 'react'
import { useModalFocus } from '../hooks/useModalFocus'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  destructive = true,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()

  useModalFocus({
    enabled: open,
    dialogRef,
    initialFocusRef: destructive ? cancelRef : confirmRef,
    onClose: onCancel,
  })

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 safe-bottom sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-1rem)] w-full max-w-sm space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-lg font-bold text-slate-800">{title}</h3>
        <p id={messageId} className="text-sm text-slate-600">{message}</p>
        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-3 pt-1">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600
                       active:scale-95 transition-transform"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white
                        active:scale-95 transition-transform
                        ${destructive ? 'bg-red-600 active:bg-red-700' : 'bg-blue-600 active:bg-blue-700'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
