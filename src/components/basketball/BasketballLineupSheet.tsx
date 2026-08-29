import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Check, UserMinus, UserPlus, X } from 'lucide-react'
import type { GameState } from '../../types'
import {
  basketballLineupInitialSelection,
  buildBasketballLineupSheetModel,
  type BasketballLineupSheetRow,
} from '../../lib/basketball/lineupSheetModel'
import {
  basketballEqualPlayViolationLabel,
  buildBasketballBoundarySideReview,
} from '../../lib/basketball/boundaryReviewModel'
import { BASKETBALL_SUBSTITUTION_REASON_OPTIONS } from '../../lib/basketball/lineupTransitions'
import type {
  BasketballSubstitutionReasonCode,
  BasketballTeamSide,
} from '../../lib/basketball/types'

export interface BasketballLineupSheetCommit {
  teamSide: BasketballTeamSide
  participantIds: string[]
  reasonCode: BasketballSubstitutionReasonCode | null
  reasonNote: string | null
  overrideReason: string | null
}

export default function BasketballLineupSheet({
  state,
  initialSide,
  errorMessage,
  purpose = 'substitution',
  canOverrideEqualPlay = false,
  allowedSides,
  onCommit,
  onClose,
}: {
  state: GameState
  initialSide: BasketballTeamSide
  errorMessage: string | null
  purpose?: 'substitution' | 'boundary'
  canOverrideEqualPlay?: boolean
  allowedSides?: BasketballTeamSide[]
  onCommit: (input: BasketballLineupSheetCommit) => void
  onClose: () => void
}) {
  const projection = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState.projection
    : null
  const availableSides = (['tracked', 'opponent'] as BasketballTeamSide[]).filter(
    side => Boolean(projection?.lineup?.sides[side]) &&
      (!allowedSides || allowedSides.includes(side))
  )
  const startingSide = availableSides.includes(initialSide)
    ? initialSide
    : availableSides[0] ?? 'tracked'
  const [teamSide, setTeamSide] = useState<BasketballTeamSide>(startingSide)
  const [participantIds, setParticipantIds] = useState<string[]>(() =>
    projection ? basketballLineupInitialSelection(projection, startingSide) : []
  )
  const [reasonCode, setReasonCode] = useState<BasketballSubstitutionReasonCode | null>(null)
  const [reasonNote, setReasonNote] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const model = useMemo(() => projection
    ? buildBasketballLineupSheetModel(
        projection,
        teamSide,
        participantIds,
        reasonCode,
        reasonNote,
        {
          allowUnchanged: purpose === 'boundary',
          substitutionMode: purpose === 'boundary' ? 'boundary' : undefined,
        }
      )
    : null, [participantIds, projection, purpose, reasonCode, reasonNote, teamSide])
  const boundaryReview = useMemo(() => (
    purpose === 'boundary' && state.sportGameState?.sportId === 'basketball'
      ? buildBasketballBoundarySideReview(state.sportGameState, teamSide, participantIds)
      : null
  ), [participantIds, purpose, state.sportGameState, teamSide])
  const enforcedOverrideRequired = boundaryReview?.equalPlayMode === 'enforced' &&
    boundaryReview.violations.length > 0
  const validOverride = !enforcedOverrideRequired || (
    canOverrideEqualPlay && overrideReason.trim().length > 0 && overrideReason.trim().length <= 240
  )

  useEffect(() => {
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled])'
      ))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  if (!projection || !model || availableSides.length === 0) return null

  const sideName = (side: BasketballTeamSide) => side === 'tracked'
    ? state.gameInfo?.teamName || 'Tracked'
    : state.gameInfo?.opponentName || 'Opponent'

  const changeSide = (side: BasketballTeamSide) => {
    setTeamSide(side)
    setParticipantIds(basketballLineupInitialSelection(projection, side))
    setReasonCode(null)
    setReasonNote('')
    setOverrideReason('')
  }

  const toggleParticipant = (row: BasketballLineupSheetRow) => {
    if (row.unavailableReason && !row.selected) return
    setParticipantIds(current => row.selected
      ? current.filter(id => id !== row.participantId)
      : [...current, row.participantId]
    )
  }

  const submit = () => {
    if (!model.canCommit || !validOverride) return
    onCommit({
      teamSide,
      participantIds: model.resultingParticipantIds,
      reasonCode,
      reasonNote: reasonNote.trim() || null,
      overrideReason: overrideReason.trim() || null,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-2 sm:items-center sm:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-lineup-sheet-title"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 id="basketball-lineup-sheet-title" className="truncate text-base font-bold text-slate-900">
              {purpose === 'boundary' ? 'Boundary lineup review' : 'Lineup change'}
            </h2>
            <p className="truncate text-xs font-medium text-slate-500">{sideName(teamSide)}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600"
            aria-label="Close lineup change"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        {availableSides.length > 1 && (
          <div className="mx-4 mt-3 grid shrink-0 grid-cols-2 rounded-md bg-slate-100 p-1" role="tablist" aria-label="Lineup side">
            {availableSides.map(side => (
              <button
                key={side}
                type="button"
                role="tab"
                aria-selected={teamSide === side}
                onClick={() => changeSide(side)}
                className={`min-h-10 rounded px-2 text-sm font-semibold ${
                  teamSide === side ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                <span className="line-clamp-2 break-words">{sideName(side)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <LineupGroup
            title="Current"
            rows={model.current}
            emptyLabel="No current lineup"
            onToggle={toggleParticipant}
          />
          <LineupGroup
            title="Bench"
            rows={model.bench}
            emptyLabel="No available bench players"
            onToggle={toggleParticipant}
          />

          {model.unavailable.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-3">
              <h3 className="text-xs font-bold uppercase text-slate-500">Unavailable</h3>
              <div className="mt-2 divide-y divide-slate-100 border-y border-slate-200">
                {model.unavailable.map(row => (
                  <div key={row.participantId} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm text-slate-500">
                    <PlayerName row={row} />
                    <span className="shrink-0 text-xs font-semibold">{row.unavailableReason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase text-slate-500">Result</h3>
              <span className="text-xs font-semibold text-slate-600">
                {model.resultingParticipantIds.length}/5
              </span>
            </div>
            <div className="mt-2 flex min-h-10 flex-wrap items-center gap-1.5" aria-live="polite" aria-atomic="true">
              {model.resulting.length === 0 ? (
                <span className="text-sm text-slate-500">No players selected</span>
              ) : model.resulting.map(row => (
                <span key={row.participantId} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                  {playerLabel(row)}
                </span>
              ))}
            </div>
            {model.changed && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
                {model.outgoingParticipantIds.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-rose-700">
                    <UserMinus size={14} aria-hidden /> {model.outgoingParticipantIds.length} out
                  </span>
                )}
                {model.incomingParticipantIds.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <UserPlus size={14} aria-hidden /> {model.incomingParticipantIds.length} in
                  </span>
                )}
              </div>
            )}
          </div>

          {model.reasonRequired && (
            <div className="mt-4 grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                Reason
                <select
                  value={reasonCode ?? ''}
                  onChange={event => setReasonCode(event.target.value
                    ? event.target.value as BasketballSubstitutionReasonCode
                    : null
                  )}
                  className="input-field mt-1"
                >
                  <option value="">Select reason</option>
                  {BASKETBALL_SUBSTITUTION_REASON_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Note{model.noteRequired ? ' (required)' : ' (optional)'}
                <input
                  value={reasonNote}
                  onChange={event => setReasonNote(event.target.value)}
                  maxLength={240}
                  className="input-field mt-1"
                />
              </label>
            </div>
          )}

          {boundaryReview && boundaryReview.violations.length > 0 && (
            <div className={`mt-4 border-l-4 px-3 py-3 ${
              boundaryReview.equalPlayMode === 'enforced'
                ? 'border-rose-500 bg-rose-50'
                : 'border-amber-500 bg-amber-50'
            }`}>
              <p className="text-sm font-bold text-slate-900">
                {boundaryReview.equalPlayMode === 'enforced'
                  ? 'Equal-play override required'
                  : 'Equal-play advisory'}
              </p>
              <ul className="mt-1 space-y-1 text-sm text-slate-700">
                {boundaryReview.violations.map(violation => (
                  <li key={violation.code}>
                    {basketballEqualPlayViolationLabel(violation.code)} ({violation.participantIds.length})
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-600">
                This review follows the match's snapshotted policy; it is not a universal league ruling.
              </p>
              {enforcedOverrideRequired && canOverrideEqualPlay && (
                <label className="mt-3 block text-sm font-semibold text-slate-700">
                  Override reason
                  <input
                    value={overrideReason}
                    onChange={event => setOverrideReason(event.target.value)}
                    maxLength={240}
                    className="input-field mt-1"
                  />
                </label>
              )}
              {enforcedOverrideRequired && !canOverrideEqualPlay && (
                <p className="mt-2 text-sm font-semibold text-rose-700">
                  Your current role cannot record this override.
                </p>
              )}
            </div>
          )}

          {(model.validationMessage || errorMessage) && (
            <p
              role={errorMessage ? 'alert' : 'status'}
              className={`mt-3 flex items-start gap-2 text-sm font-semibold ${
                errorMessage ? 'text-rose-700' : 'text-slate-600'
              }`}
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              {errorMessage ?? model.validationMessage}
            </p>
          )}
        </div>

        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <button type="button" className="btn-secondary min-h-11 rounded-md px-3 py-2 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm"
            disabled={!model.canCommit || !validOverride}
            onClick={submit}
          >
            <Check size={17} aria-hidden /> {purpose === 'boundary' ? 'Confirm lineup' : 'Commit lineup'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function LineupGroup({
  title,
  rows,
  emptyLabel,
  onToggle,
}: {
  title: string
  rows: BasketballLineupSheetRow[]
  emptyLabel: string
  onToggle: (row: BasketballLineupSheetRow) => void
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="text-xs font-bold uppercase text-slate-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 border-y border-slate-200 py-3 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <div className="mt-2 divide-y divide-slate-100 border-y border-slate-200">
          {rows.map(row => {
            const disabled = Boolean(row.unavailableReason && !row.selected)
            return (
              <button
                key={row.participantId}
                type="button"
                onClick={() => onToggle(row)}
                disabled={disabled}
                aria-pressed={row.selected}
                className={`flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left ${
                  row.leaving
                    ? 'text-rose-800'
                    : row.entering
                      ? 'text-emerald-800'
                      : disabled
                        ? 'text-slate-400'
                        : 'text-slate-800'
                }`}
              >
                <PlayerName row={row} />
                <span className={`flex h-8 min-w-20 shrink-0 items-center justify-center gap-1 rounded border px-2 text-xs font-bold ${
                  row.leaving
                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : row.entering
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : row.selected
                        ? 'border-slate-300 bg-slate-100 text-slate-700'
                        : 'border-blue-200 bg-blue-50 text-blue-700'
                }`}>
                  {row.leaving ? <UserMinus size={14} aria-hidden /> : row.entering ? <UserPlus size={14} aria-hidden /> : <ArrowRightLeft size={14} aria-hidden />}
                  {row.leaving ? 'Leaving' : row.entering ? 'Entering' : row.selected ? 'On court' : 'Add'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PlayerName({ row }: { row: BasketballLineupSheetRow }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold">{playerLabel(row)}</span>
      {(row.replacementRequired || row.unavailableReason) && (
        <span className="block text-xs font-semibold text-rose-600">
          {row.replacementRequired ? 'Replacement required' : row.unavailableReason}
        </span>
      )}
    </span>
  )
}

function playerLabel(row: BasketballLineupSheetRow): string {
  return `${row.number ? `#${row.number} ` : ''}${row.displayName}`
}
