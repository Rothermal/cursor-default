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
          ? 'border-amber-300 bg-amber-50 text-amber-950'
          : 'border-slate-200 bg-white text-slate-700'
      }`}>
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase text-slate-500">
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
              className="flex min-h-9 shrink-0 items-center gap-1.5 border border-amber-400 bg-white px-2.5 text-xs font-bold text-amber-900 disabled:opacity-50"
            >
              <ChevronLeft size={15} /> Primary
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={busy || others.length === 0}
            className="flex min-h-9 shrink-0 items-center gap-1.5 border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 disabled:opacity-50"
          >
            <Users size={15} /> Other recordings
          </button>
        </div>
      </section>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="other-recordings-title"
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-lg bg-white sm:max-w-md sm:rounded-lg"
            onClick={event => event.stopPropagation()}
          >
            <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
              <Users size={19} className="text-emerald-700" />
              <div className="min-w-0 flex-1">
                <h2 id="other-recordings-title" className="font-bold text-slate-900">
                  Other recordings
                </h2>
                <p className="text-xs text-slate-500">
                  Review one stream at a time.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 place-items-center text-slate-500"
                aria-label="Close"
                title="Close"
              >
                <X size={20} />
              </button>
            </header>

            <div className="divide-y divide-slate-200">
              {primary && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onPrimary()
                  }}
                  disabled={busy}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {primary.displayName}
                    </p>
                    <p className="text-xs text-slate-500">Primary recording</p>
                  </div>
                  {!viewingOther && <Check size={18} className="text-emerald-700" />}
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
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {recorder.displayName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {recorder.eventCount} events
                      {recorder.checkpointCurrent ? ' - current' : ' - needs attention'}
                    </p>
                  </div>
                  {viewingOther &&
                    source.recorder.recorderId === recorder.recorderId && (
                      <Check size={18} className="text-emerald-700" />
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
