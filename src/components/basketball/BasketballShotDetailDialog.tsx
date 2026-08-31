import { useRef } from 'react'
import { CircleAlert, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import type { BasketballShotDetailModel } from '../../lib/basketball/timeline'
import { useModalFocus } from '../../hooks/useModalFocus'

interface BasketballShotDetailDialogProps {
  detail: BasketballShotDetailModel
  onClose: () => void
  onEdit?: () => void
  onRemove?: () => void
  onRestore?: () => void
  showCaptureSequence?: boolean
}

export default function BasketballShotDetailDialog({
  detail,
  onClose,
  onEdit,
  onRemove,
  onRestore,
  showCaptureSequence = false,
}: BasketballShotDetailDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useModalFocus({
    enabled: true,
    dialogRef,
    initialFocusRef: closeRef,
    onClose,
  })

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-center bg-black/45 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-shot-detail-title"
        tabIndex={-1}
        className="flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[88vh] sm:max-w-lg sm:rounded-lg sm:border sm:border-slate-200"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-slate-500">{detail.ordinalLabel}</p>
            <h2 id="basketball-shot-detail-title" className="truncate text-lg font-bold text-slate-900">
              {detail.heading}
            </h2>
            {(detail.revised || detail.removed) && (
              <div className="mt-1 flex items-center gap-1.5">
                {detail.revised && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">Revised</span>
                )}
                {detail.removed && (
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Removed</span>
                )}
              </div>
            )}
            <p className="mt-0.5 text-sm text-slate-600">
              {[
                detail.periodLabel,
                showCaptureSequence ? detail.sequenceLabel : formatRecordedAt(detail.occurredAt),
              ].filter(Boolean).join(' | ')}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 active:scale-95"
            aria-label="Close shot detail"
            title="Close"
          >
            <X size={19} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 border-b border-slate-200">
            <SummaryCell label="Shooter" value={detail.shooterLabel} />
            <SummaryCell label="Team" value={detail.teamLabel} />
            <SummaryCell label="Result" value={detail.resultLabel} emphasized />
            <SummaryCell label="Value" value={detail.valueLabel} emphasized />
          </div>

          <section className="border-b border-slate-200 px-4 py-4" aria-labelledby="shot-location-title">
            <h3 id="shot-location-title" className="text-xs font-semibold uppercase text-slate-500">Court location</h3>
            <p className="mt-1 text-sm font-semibold text-slate-800">{detail.locationLabel}</p>
          </section>

          <section className="border-b border-slate-200 px-4 py-4" aria-labelledby="shot-relationships-title">
            <div className="flex items-center justify-between gap-3">
              <h3 id="shot-relationships-title" className="text-xs font-semibold uppercase text-slate-500">
                Related events
              </h3>
              {detail.relationships.length > 0 && (
                <span className="text-xs font-semibold text-slate-500">{detail.relationships.length}</span>
              )}
            </div>
            {detail.relationships.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No linked assist, rebound, or block.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {detail.relationships.map(relationship => (
                  <li key={relationship.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className={relationship.removed ? 'text-slate-400 line-through' : 'font-medium text-slate-800'}>
                      {relationship.label}
                    </span>
                    {relationship.removed && (
                      <span className="text-xs font-semibold text-slate-500">Removed</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detail.warnings.length > 0 && (
            <section className="border-b border-amber-200 bg-amber-50 px-4 py-3" aria-label="Shot diagnostics">
              {detail.warnings.map(warning => (
                <p key={warning} className="flex gap-2 text-sm font-medium text-amber-900">
                  <CircleAlert className="mt-0.5 shrink-0" size={16} aria-hidden />
                  <span>{warning}</span>
                </p>
              ))}
            </section>
          )}

          <details className="px-4 py-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Details</summary>
            <dl className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
              {detail.technical.map(item => (
                <div key={item.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2 text-xs">
                  <dt className="font-semibold text-slate-500">{item.label}</dt>
                  <dd className="break-all text-slate-700">{formatTechnicalValue(item.value)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>

        <footer className="flex gap-2 border-t border-slate-200 bg-white px-4 py-3">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 text-sm font-bold text-blue-800"
            >
              <Pencil size={17} aria-hidden />
              Edit
            </button>
          )}
          {(onRemove || onRestore) && (
            <button
              type="button"
              onClick={onRestore ?? onRemove}
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border text-sm font-bold ${
                onRestore
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}
            >
              {onRestore ? <RotateCcw size={17} aria-hidden /> : <Trash2 size={17} aria-hidden />}
              {onRestore ? 'Restore' : 'Remove'}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-primary min-h-11 flex-1">
            Close
          </button>
        </footer>
      </section>
    </div>
  )
}

function SummaryCell({
  label,
  value,
  emphasized = false,
}: {
  label: string
  value: string
  emphasized?: boolean
}) {
  return (
    <div className="min-w-0 border-b border-r border-slate-100 px-4 py-3 last:border-r-0">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className={`mt-1 break-words text-sm ${emphasized ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
        {value}
      </p>
    </div>
  )
}

function formatRecordedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatTechnicalValue(value: string): string {
  const date = new Date(value)
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(date.getTime())
    ? date.toLocaleString()
    : value
}
