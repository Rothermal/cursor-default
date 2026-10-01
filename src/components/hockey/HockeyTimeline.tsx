import { X } from 'lucide-react'
import { useId, useState } from 'react'
import {
  activeHockeyTimelineFilterCount,
  DEFAULT_HOCKEY_TIMELINE_FILTERS,
  filterHockeyTimelineRows,
  formatHockeyClock,
  groupHockeyTimelineByPeriod,
  hockeyTimelinePeriods,
  HOCKEY_TIMELINE_FAMILIES,
  canRemoveHockeyEvents,
  hockeyCorrectionInput,
  hockeyParticipantLabel,
  hockeyTimelineEventFields,
  type HockeyMatchParticipant,
  type HockeyTimelineNames,
  type HockeySide,
  type HockeyTimelineFamily,
  type HockeyTimelineFilters,
  type HockeyTimelineRow,
} from '../../lib/hockey'
import type { GameEvent } from '../../lib/gameEvents/types'
import type { HockeyTimelineAction } from './HockeyTimelineEditor'

interface HockeyTimelineProps {
  rows: HockeyTimelineRow[]
  historyMessage: string | null
  participants: HockeyMatchParticipant[]
  /** Participant and opponent goalie names by id, from `hockeyTimeline`. */
  names: HockeyTimelineNames
  sideLabel: (side: HockeySide) => string
  /**
   * Corrections (HKY-4B): null while the game cannot be corrected (suspended or abandoned),
   * with the reason shown in the detail sheet instead of the actions.
   */
  correctionBlocked?: string | null
  onCorrect?: (row: HockeyTimelineRow, action: HockeyTimelineAction) => void
}

/**
 * The Timeline tab (HKY-4A): the whole game oldest first by period, with collapsed filters
 * and a detail sheet per row. The sheet offers Edit, Remove and Restore (HKY-4B).
 */
export default function HockeyTimeline({
  rows,
  historyMessage,
  names,
  participants,
  sideLabel,
  correctionBlocked = null,
  onCorrect,
}: HockeyTimelineProps) {
  const [filters, setFilters] = useState<HockeyTimelineFilters>(DEFAULT_HOCKEY_TIMELINE_FILTERS)
  const [detail, setDetail] = useState<HockeyTimelineRow | null>(null)
  const visible = filterHockeyTimelineRows(rows, filters)
  const groups = groupHockeyTimelineByPeriod(visible)
  const periods = hockeyTimelinePeriods(rows)
  const filterCount = activeHockeyTimelineFilterCount(filters)
  const update = (changes: Partial<HockeyTimelineFilters>) => setFilters(current => ({ ...current, ...changes }))
  const toggleFamily = (family: HockeyTimelineFamily) => update({
    families: filters.families.includes(family)
      ? filters.families.filter(entry => entry !== family)
      : [...filters.families, family],
  })
  const namedParticipants = participants.filter(participant => rows.some(row => row.participantIds.includes(participant.id)))

  return (
    <section className="space-y-3" aria-label="Timeline">
      <details className="rounded-md border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-semibold text-content">
          <span>Filters</span>
          <span className="text-xs font-normal text-content-muted">
            {filterCount === 0 ? 'All events' : `${filterCount} on`} · {visible.length} shown
          </span>
        </summary>
        <div className="space-y-3 border-t border-line p-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Event types">
            {HOCKEY_TIMELINE_FAMILIES.map(family => {
              const pressed = filters.families.includes(family.id)
              return (
                <button
                  key={family.id}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => toggleFamily(family.id)}
                  className={`min-h-9 rounded-full border px-3 text-sm ${pressed ? 'border-accent bg-accent text-accent-content' : 'border-line-strong text-content'}`}
                >
                  {family.label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-control p-1" role="group" aria-label="Team">
            {(['all', 'tracked', 'opponent'] as const).map(side => (
              <button
                key={side}
                type="button"
                aria-pressed={filters.side === side}
                onClick={() => update({ side })}
                className={`min-h-9 truncate rounded px-2 text-sm font-semibold ${filters.side === side ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
              >
                {side === 'all' ? 'Both' : sideLabel(side)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs font-semibold text-content-muted">
              <span>Period</span>
              <select
                className="input-field w-full"
                value={filters.periodId ?? ''}
                onChange={event => update({ periodId: event.target.value || null })}
              >
                <option value="">All periods</option>
                {periods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-content-muted">
              <span>Player</span>
              <select
                className="input-field w-full"
                value={filters.participantId ?? ''}
                onChange={event => update({ participantId: event.target.value || null })}
              >
                <option value="">All players</option>
                {namedParticipants.map(participant => (
                  <option key={participant.id} value={participant.id}>{hockeyParticipantLabel(participant)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex min-h-9 items-center gap-2 text-sm text-content">
              <input
                type="checkbox"
                checked={filters.showRemoved}
                onChange={event => update({ showRemoved: event.target.checked })}
              />
              Show removed
            </label>
            {filterCount > 0 && (
              <button type="button" className="btn-secondary px-3 text-sm" onClick={() => setFilters(DEFAULT_HOCKEY_TIMELINE_FILTERS)}>
                Clear
              </button>
            )}
          </div>
        </div>
      </details>

      {historyMessage && (
        <p role="alert" className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
          {historyMessage}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-content-muted">{rows.length === 0 ? 'Nothing recorded yet.' : 'No events match these filters.'}</p>
      ) : groups.map(group => (
        <section key={group.periodId} aria-label={group.label}>
          <h3 className="text-sm font-bold uppercase text-content-muted">{group.label}</h3>
          <ol className="mt-1 divide-y divide-line rounded-md bg-surface text-sm">
            {group.rows.map(row => (
              <li key={row.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-start gap-3 px-3 py-2 text-left"
                  onClick={() => setDetail(row)}
                >
                  <span className="w-11 shrink-0 tabular-nums text-xs leading-5 text-content-muted">
                    {row.displayMs !== null ? formatHockeyClock(row.displayMs) : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block ${row.removed ? 'text-content-muted line-through' : row.capture ? 'text-content' : 'text-content-muted'}`}>
                      {row.label}
                    </span>
                    {(row.strength === 'pp' || row.strength === 'sh' || row.removed || row.revised || row.recordedLater) && (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {row.strength === 'pp' && <Badge>PP</Badge>}
                        {row.strength === 'sh' && <Badge>SH</Badge>}
                        {row.removed && <Badge>Removed</Badge>}
                        {row.revised && !row.removed && <Badge>Revised</Badge>}
                        {row.recordedLater && <Badge>Recorded later</Badge>}
                      </span>
                    )}
                    {row.diagnostic && (
                      <span className="mt-1 block text-xs font-semibold text-danger-content">Stops the replay: {row.diagnostic}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {detail && (
        <HockeyTimelineDetail
          row={detail}
          names={names}
          sideLabel={sideLabel}
          correctionBlocked={correctionBlocked}
          onCorrect={onCorrect && (action => {
            onCorrect(detail, action)
            setDetail(null)
          })}
          onClose={() => setDetail(null)}
        />
      )}
    </section>
  )
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded border border-line-strong px-1.5 text-[11px] font-semibold uppercase text-content-muted">{children}</span>
  )
}

function HockeyTimelineDetail({
  row,
  names,
  sideLabel,
  correctionBlocked,
  onCorrect,
  onClose,
}: {
  row: HockeyTimelineRow
  names: HockeyTimelineNames
  sideLabel: (side: HockeySide) => string
  correctionBlocked: string | null
  onCorrect?: (action: HockeyTimelineAction) => void
  onClose: () => void
}) {
  const titleId = useId()
  const removable = canRemoveHockeyEvents(row.events)
  const editable = !row.removed && hockeyCorrectionInput(row.events) !== null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/[0.5] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <h2 id={titleId} className="min-w-0 flex-1 truncate font-bold text-content">{row.label}</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-content-muted" aria-label="Close" title="Close">
            <X size={20} />
          </button>
        </header>
        <div className="space-y-4 p-4 text-sm">
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-content-muted">Period</dt>
            <dd>{row.periodLabel}</dd>
            {row.displayMs !== null && (
              <>
                <dt className="text-content-muted">Clock</dt>
                <dd className="tabular-nums">{formatHockeyClock(row.displayMs)}</dd>
              </>
            )}
            {row.sides.length > 0 && (
              <>
                <dt className="text-content-muted">Team</dt>
                <dd>{row.sides.map(sideLabel).join(', ')}</dd>
              </>
            )}
          </dl>
          {row.diagnostic && (
            <p className="rounded-md border border-danger-line bg-danger px-3 py-2 text-danger-content">
              The saved game stops replaying here: {row.diagnostic}
            </p>
          )}
          {row.events.map(event => (
            <EventDetail key={event.id} event={event} names={names} sideLabel={sideLabel} multiple={row.events.length > 1} />
          ))}
          {!onCorrect ? null : !removable ? (
            <p className="text-xs text-content-muted">Game flow and clock rows cannot be changed here. Use Set clock or the Game menu.</p>
          ) : correctionBlocked ? (
            <p className="text-xs text-content-muted">{correctionBlocked}</p>
          ) : row.removed ? (
            <button type="button" className="btn-secondary w-full" onClick={() => onCorrect('restore')}>Restore</button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {editable && <button type="button" className="btn-primary" onClick={() => onCorrect('edit')}>Edit</button>}
              <button type="button" className={`btn-secondary ${editable ? '' : 'col-span-2'}`} onClick={() => onCorrect('remove')}>Remove</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EventDetail({
  event,
  names,
  sideLabel,
  multiple,
}: {
  event: GameEvent
  names: HockeyTimelineNames
  sideLabel: (side: HockeySide) => string
  multiple: boolean
}) {
  const fields = hockeyTimelineEventFields(event, names)
  return (
    <section className="space-y-1 rounded-md border border-line p-3">
      {multiple && (
        <h3 className="font-semibold text-content">
          {event.teamSide === 'tracked' || event.teamSide === 'opponent' ? `${sideLabel(event.teamSide)} ` : ''}
          {humanize(event.eventType.replace('hockey.', ''))}
        </h3>
      )}
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1">
        {fields.map((field, index) => <FieldRow key={`${field.label}-${index}`} label={field.label} value={field.value} />)}
        {event.location && <FieldRow label="Location" value="On the rink" />}
        <FieldRow label="Recorded" value={new Date(event.occurredAt).toLocaleTimeString()} />
        {event.revision > 1 && <FieldRow label="Revision" value={String(event.revision)} />}
        {event.deletedAt && <FieldRow label="Removed" value={new Date(event.deletedAt).toLocaleTimeString()} />}
      </dl>
    </section>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-content-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  )
}


function humanize(key: string): string {
  const words = key
    .replace(/Ms$/, '')
    .replace(/Id$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

