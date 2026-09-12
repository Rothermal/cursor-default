import { Check, ChevronLeft, Users, X } from 'lucide-react'
import { useState } from 'react'
import type { SoccerRecorderSummary } from '../../lib/soccer/recorders'
import type { SoccerSummarySource } from '../../lib/soccer/summarySource'

interface SoccerRecordingSelectorProps {
  source: SoccerSummarySource
  busy: boolean
  onSelect: (recorder: SoccerRecorderSummary) => void
  onPrimary: () => void
}

export default function SoccerRecordingSelector({
  source,
  busy,
  onSelect,
  onPrimary,
}: SoccerRecordingSelectorProps) {
  const [open, setOpen] = useState(false)
  if (
    (source.kind !== 'cloud_primary' && source.kind !== 'cloud_recording') ||
    source.recorders.length < 2
  ) {
    return null
  }

  const primary = source.recorders.find(recorder => recorder.isPrimary) ?? null
  const others = source.recorders.filter(recorder => !recorder.isPrimary)
  const viewingOther = source.kind === 'cloud_recording'

  return (
    <>
      <section className={`border-b px-4 py-2.5 ${
        viewingOther
          ? 'border-warning-line bg-warning text-warning-content'
          : 'border-line bg-surface text-content'
      }`}>
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase text-content-muted">
              Viewing
            </p>
            <p className="truncate text-sm font-semibold">
              {viewingOther
                ? `${source.recorder.displayName}'s recording`
                : `Primary - ${source.recorder.displayName}`}
            </p>
          </div>
          {viewingOther && (
            <button
              type="button"
              onClick={onPrimary}
              disabled={busy}
              className="flex min-h-9 shrink-0 items-center gap-1.5 border border-warning-line bg-surface px-2.5 text-xs font-bold text-warning-content disabled:bg-control-disabled disabled:text-content-disabled"
            >
              <ChevronLeft size={15} /> Primary
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={busy || others.length === 0}
            className="flex min-h-9 shrink-0 items-center gap-1.5 border border-line-strong bg-surface px-2.5 text-xs font-bold text-content disabled:bg-control-disabled disabled:text-content-disabled"
          >
            <Users size={15} /> Other recordings
          </button>
        </div>
      </section>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-overlay/[0.5] sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="other-recordings-title"
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-md sm:rounded-lg"
            onClick={event => event.stopPropagation()}
          >
            <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
              <Users size={19} className="text-success-content" />
              <div className="min-w-0 flex-1">
                <h2 id="other-recordings-title" className="font-bold text-content">
                  Other recordings
                </h2>
                <p className="text-xs text-content-muted">
                  Review one stream at a time.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 place-items-center text-content-muted"
                aria-label="Close"
                title="Close"
              >
                <X size={20} />
              </button>
            </header>

            <div className="divide-y divide-line">
              {primary && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onPrimary()
                  }}
                  disabled={busy}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left disabled:bg-control-disabled disabled:text-content-disabled"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-content">
                      {primary.displayName}
                    </p>
                    <p className="text-xs text-content-muted">Primary recording</p>
                  </div>
                  {!viewingOther && <Check size={18} className="text-success-content" />}
                </button>
              )}
              {others.map(recorder => (
                <button
                  key={recorder.recorderId}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onSelect(recorder)
                  }}
                  disabled={busy}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left disabled:bg-control-disabled disabled:text-content-disabled"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-content">
                      {recorder.displayName}
                    </p>
                    <p className="text-xs text-content-muted">
                      {recorder.eventCount} events
                      {recorder.checkpointCurrent ? ' - current' : ' - needs attention'}
                    </p>
                  </div>
                  {viewingOther &&
                    source.recorder.recorderId === recorder.recorderId && (
                      <Check size={18} className="text-success-content" />
                    )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
