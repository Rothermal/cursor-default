import { useEffect, useRef } from 'react'
import { CircleAlert, Pencil, Trash2, X } from 'lucide-react'
import type { BasketballTimelineEventReview } from '../../lib/basketball/timeline'

interface Props {
  review: BasketballTimelineEventReview
  teamLabel: string
  onClose: () => void
  onEdit?: () => void
  onRemove?: () => void
  captureLabel?: string
}

export default function BasketballEventDetailDialog({
  review,
  teamLabel,
  onClose,
  onEdit,
  onRemove,
  captureLabel,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => closeRef.current?.focus(), [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex justify-center bg-black/45 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-event-detail-title"
        className="flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[88vh] sm:max-w-lg sm:rounded-lg sm:border sm:border-slate-200"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-slate-500">{review.periodLabel}</p>
            <h2 id="basketball-event-detail-title" className="text-lg font-bold text-slate-900">{review.title}</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {captureLabel ?? formatRecordedAt(review.event.occurredAt)}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-600" aria-label="Close event detail">
            <X size={19} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 border-b border-slate-200">
            <DetailCell label="Recorded for" value={review.actorLabel} />
            <DetailCell label="Team" value={teamLabel} />
          </div>
          <section className="border-b border-slate-200 px-4 py-4">
            <h3 className="text-xs font-semibold uppercase text-slate-500">{detailHeading(review)}</h3>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {detailValue(review)}
            </p>
          </section>
          {review.warnings.length > 0 && (
            <section className="border-b border-amber-200 bg-amber-50 px-4 py-3">
              {review.warnings.map(warning => (
                <p key={warning} className="flex gap-2 text-sm font-medium text-amber-900">
                  <CircleAlert className="mt-0.5 shrink-0" size={16} aria-hidden />
                  <span>{warning}</span>
                </p>
              ))}
            </section>
          )}
          <dl className="divide-y divide-slate-100 px-4 py-3 text-xs">
            <DetailRow label="Event id" value={review.id} />
            <DetailRow label="Event type" value={review.event.eventType} />
            <DetailRow label="Revision" value={String(review.event.revision)} />
            <DetailRow label="Recorder" value={review.event.recorderUserId ?? 'Local'} />
            <DetailRow label="Captured" value={formatRecordedAt(review.event.createdAt)} />
            <DetailRow label="Updated" value={formatRecordedAt(review.event.updatedAt)} />
            {review.event.deletedAt && (
              <DetailRow label="Removed" value={formatRecordedAt(review.event.deletedAt)} />
            )}
          </dl>
        </div>

        <footer className="flex gap-2 border-t border-slate-200 px-4 py-3">
          {onEdit && <button type="button" onClick={onEdit} className="btn-secondary flex min-h-11 flex-1 items-center justify-center gap-2"><Pencil size={17} aria-hidden />Edit</button>}
          {onRemove && <button type="button" onClick={onRemove} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 text-sm font-bold text-rose-800"><Trash2 size={17} aria-hidden />Remove</button>}
          <button type="button" onClick={onClose} className="btn-primary min-h-11 flex-1">Close</button>
        </footer>
      </section>
    </div>
  )
}

function detailHeading(review: BasketballTimelineEventReview): string {
  if (review.event.eventType === 'basketball.period_started' || review.event.eventType === 'basketball.period_ended') return 'Period control'
  if (review.event.eventType === 'basketball.match_ended' || review.event.eventType === 'basketball.match_reopened') return 'Game control'
  if (review.event.eventType === 'basketball.match_roster_added' || review.event.eventType === 'basketball.participant_resolved') return 'Roster change'
  if (review.event.eventType === 'basketball.foul') return 'Foul ruling'
  if (review.event.eventType === 'basketball.free_throw_trip') return 'Award'
  if (review.event.eventType === 'basketball.score_adjustment') return 'Adjustment'
  if (review.event.eventType === 'basketball.substitution') return 'Lineup transition'
  if (review.event.eventType === 'basketball.role_changed') return 'Role history'
  if (review.event.eventType === 'basketball.minutes_adjustment') return 'Minutes'
  if (review.event.eventType === 'basketball.ejection') return 'Ejection ruling'
  if (review.event.eventType === 'basketball.timeout') return 'Timeout'
  return review.relationshipLabels.length > 0 ? 'Relationship' : 'Event context'
}

function detailValue(review: BasketballTimelineEventReview): string {
  const event = review.event
  if (event.eventType === 'basketball.period_started') return `${review.periodLabel} opened for capture`
  if (event.eventType === 'basketball.period_ended') return `${review.periodLabel} closed for capture`
  if (event.eventType === 'basketball.match_roster_added') {
    const destination = event.payload.destination === 'bench' ? 'bench' : 'DNP list'
    return `${event.payload.participant.displayName} added to the ${destination}`
  }
  if (event.eventType === 'basketball.participant_resolved') {
    return `Identity updated to ${event.payload.displayName}`
  }
  if (event.eventType === 'basketball.match_ended') {
    return event.payload.reason.replace(/_/g, ' ')
  }
  if (event.eventType === 'basketball.match_reopened') return event.payload.reason ?? 'No reason recorded'
  if (event.eventType === 'basketball.foul') {
    const override = event.payload.countingOverride
    const counting = override
      ? `${override.personalFoul ? 'personal, ' : ''}${override.teamFoul ? 'team, ' : ''}${override.technical ? 'technical' : ''}`.replace(/, $/, '')
      : 'Default counting'
    return `${event.payload.class.replace(/_/g, ' ')} | ${event.payload.context.replace(/_/g, ' ')} | ${counting}`
  }
  if (event.eventType === 'basketball.free_throw_trip') {
    return `${event.payload.maximumAttempts} position${event.payload.maximumAttempts === 1 ? '' : 's'}${event.payload.oneAndOne ? ' | one-and-one' : ''}${event.payload.technical ? ' | technical' : ''}${event.payload.possessionRetained ? ' | possession retained' : ''}`
  }
  if (event.eventType === 'basketball.score_adjustment') {
    const reason = event.payload.reason.replace(/_/g, ' ')
    const amount = event.payload.delta > 0 ? `+${event.payload.delta}` : String(event.payload.delta)
    return event.payload.note ? `${amount} | ${reason} | ${event.payload.note}` : `${amount} | ${reason}`
  }
  if (event.eventType === 'basketball.minutes_adjustment') {
    return event.payload.deltaMinutes > 0 ? `+${event.payload.deltaMinutes}` : String(event.payload.deltaMinutes)
  }
  if (event.eventType === 'basketball.ejection') {
    const source = event.payload.source === 'official_ruling' ? 'official ruling' : 'automatic threshold'
    return `${event.payload.reason} | ${source}`
  }
  if (event.eventType === 'basketball.timeout') {
    const owner = event.teamSide === 'neutral' ? 'game administration' : 'charged timeout'
    return `${event.payload.label || event.payload.kind.replace(/_/g, ' ')} | ${owner}`
  }
  if (event.eventType === 'basketball.substitution') {
    const reason = event.payload.reasonCode
      ? ` | ${event.payload.reasonCode.replace(/_/g, ' ')}${event.payload.reasonNote ? `: ${event.payload.reasonNote}` : ''}`
      : ''
    return `${event.payload.mode.replace(/_/g, ' ')} | ${event.payload.participantIds.length} on court${reason}`
  }
  if (event.eventType === 'basketball.role_changed') {
    return event.payload.changes.map(change => {
      const position = change.position ?? 'No position'
      return `${change.participantId}: ${position}${change.captain ? ', Captain' : ''}`
    }).join(' | ')
  }
  return review.relationshipLabels.length > 0 ? review.relationshipLabels.join(' | ') : 'Standalone event'
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-r border-slate-100 px-4 py-3 last:border-r-0"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</p></div>
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 py-2"><dt className="font-semibold text-slate-500">{label}</dt><dd className="break-all text-slate-700">{value}</dd></div>
}

function formatRecordedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
