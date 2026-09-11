import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, Users, X } from 'lucide-react'
import type { GameState } from '../../types'
import {
  basketballEqualPlayViolationLabel,
  buildBasketballBoundarySideReview,
} from '../../lib/basketball/boundaryReviewModel'
import type { BasketballTeamSide } from '../../lib/basketball/types'
import BasketballLineupSheet, { type BasketballLineupSheetCommit } from './BasketballLineupSheet'
import { gameSideDisplayName } from '../../lib/display'

export interface BasketballBoundaryReviewCommit extends BasketballLineupSheetCommit {
  expectedCurrentParticipantIds: string[]
}

export default function BasketballBoundaryReviewDialog({
  state,
  pendingSides,
  canOverrideEqualPlay,
  errorMessage,
  onCommit,
  onClose,
}: {
  state: GameState
  pendingSides: BasketballTeamSide[]
  canOverrideEqualPlay: boolean
  errorMessage: string | null
  onCommit: (input: BasketballBoundaryReviewCommit) => void
  onClose: () => void
}) {
  const [editingSide, setEditingSide] = useState<BasketballTeamSide | null>(null)
  const [overrideReasons, setOverrideReasons] = useState<Record<BasketballTeamSide, string>>({
    tracked: '',
    opponent: '',
  })
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const editingSideRef = useRef(editingSide)
  onCloseRef.current = onClose
  editingSideRef.current = editingSide
  const sportState = state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState
    : null

  useEffect(() => {
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKey = (event: KeyboardEvent) => {
      if (editingSideRef.current) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])'
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

  if (!sportState || pendingSides.length === 0) return null

  const sideName = (side: BasketballTeamSide) => side === 'tracked'
    ? gameSideDisplayName(state.gameInfo, 'tracked')
    : gameSideDisplayName(state.gameInfo, 'opponent')

  if (editingSide) {
    const currentParticipantIds = sportState.projection.lineup?.sides[editingSide]
      ?.currentParticipantIds ?? []
    return (
      <BasketballLineupSheet
        state={state}
        initialSide={editingSide}
        errorMessage={errorMessage}
        purpose="boundary"
        canOverrideEqualPlay={canOverrideEqualPlay}
        allowedSides={[editingSide]}
        onCommit={input => {
          setEditingSide(null)
          onCommit({
            ...input,
            expectedCurrentParticipantIds: currentParticipantIds,
          })
        }}
        onClose={() => setEditingSide(null)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/50 p-2 sm:items-center sm:p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="basketball-boundary-title"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="basketball-boundary-title" className="text-base font-bold text-content">
              Review lineup before Start
            </h2>
            <p className="text-xs text-content-muted">Confirm each required side. The clock stays paused.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line text-content-muted"
            aria-label="Close boundary lineup review"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className={`grid gap-3 ${pendingSides.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {pendingSides.map(side => {
              const sideProjection = sportState.projection.lineup?.sides[side]
              if (!sideProjection) return null
              const review = buildBasketballBoundarySideReview(
                sportState,
                side,
                sideProjection.currentParticipantIds
              )
              const enforced = review?.equalPlayMode === 'enforced' &&
                Boolean(review.violations.length)
              const reason = overrideReasons[side].trim()
              const canConfirm = !enforced || (
                canOverrideEqualPlay && reason.length > 0 && reason.length <= 240
              )
              const confirmDisabledReason = enforced && !canOverrideEqualPlay
                ? 'Your current role cannot record this equal-play override.'
                : enforced && !reason
                  ? 'Enter an override reason before confirming.'
                  : null
              return (
                <section key={side} className="min-w-0 border border-line p-3">
                  <div className="flex items-center gap-2">
                    <Users size={17} className="text-content-muted" aria-hidden />
                    <h3 className="min-w-0 truncate text-sm font-bold text-content">{sideName(side)}</h3>
                  </div>
                  <div className="mt-2 flex min-h-16 flex-wrap content-start gap-1.5">
                    {sideProjection.currentParticipantIds.map(participantId => {
                      const participant = sportState.projection.participants[participantId]
                      return (
                        <span key={participantId} className="max-w-full break-words rounded border border-line bg-surface-muted px-2 py-1 text-xs font-semibold text-content">
                          {participant?.number ? `#${participant.number} ` : ''}{participant?.displayName ?? 'Unknown'}
                        </span>
                      )
                    })}
                  </div>

                  {review && review.violations.length > 0 && (
                    <div className={`mt-3 border-l-4 px-2 py-2 text-xs ${
                      enforced ? 'border-danger-line bg-danger' : 'border-warning-line bg-warning'
                    }`}>
                      <p className="font-bold text-content">
                        {enforced ? 'Override required' : 'Equal-play advisory'}
                      </p>
                      {review.violations.map(violation => (
                        <p key={violation.code} className="mt-1 text-content">
                          {basketballEqualPlayViolationLabel(violation.code)} ({violation.participantIds.length})
                        </p>
                      ))}
                      <p className="mt-2 text-content-muted">
                        Based on this match's snapshotted policy, not a universal league ruling.
                      </p>
                    </div>
                  )}

                  {enforced && canOverrideEqualPlay && (
                    <label className="mt-3 block text-xs font-semibold text-content">
                      Override reason
                      <input
                        value={overrideReasons[side]}
                        onChange={event => setOverrideReasons(current => ({
                          ...current,
                          [side]: event.target.value,
                        }))}
                        maxLength={240}
                        className="input-field mt-1"
                      />
                    </label>
                  )}
                  {enforced && !canOverrideEqualPlay && (
                    <p className="mt-3 text-xs font-semibold text-danger-content">
                      Your current role cannot record this equal-play override.
                    </p>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="btn-secondary flex min-h-10 items-center justify-center gap-1.5 text-xs"
                      onClick={() => setEditingSide(side)}
                    >
                      <Pencil size={15} aria-hidden /> Change
                    </button>
                    <button
                      type="button"
                      className="btn-primary flex min-h-10 items-center justify-center gap-1.5 text-xs"
                      disabled={!canConfirm}
                      title={confirmDisabledReason ?? undefined}
                      aria-label={confirmDisabledReason
                        ? `Confirm current five unavailable. ${confirmDisabledReason}`
                        : 'Confirm current five'}
                      onClick={() => onCommit({
                        teamSide: side,
                        participantIds: sideProjection.currentParticipantIds,
                        expectedCurrentParticipantIds: sideProjection.currentParticipantIds,
                        reasonCode: null,
                        reasonNote: null,
                        overrideReason: reason || null,
                      })}
                    >
                      <Check size={15} aria-hidden /> Confirm current five
                    </button>
                  </div>
                </section>
              )
            })}
          </div>
          {errorMessage && <p role="alert" className="mt-3 text-sm font-semibold text-danger-content">{errorMessage}</p>}
        </div>
      </section>
    </div>
  )
}
