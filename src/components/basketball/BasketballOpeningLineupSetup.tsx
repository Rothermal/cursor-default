import { useState } from 'react'
import {
  confirmBasketballSetupOpeningLineup,
  updateBasketballSetupTrackedStatus,
  type BasketballSetupDraftV2,
  type BasketballSetupParticipantStatus,
} from '../../lib/basketball/setupDraft'

const STATUS_OPTIONS: Array<{
  value: BasketballSetupParticipantStatus
  label: string
}> = [
  { value: 'starter', label: 'Starter' },
  { value: 'bench', label: 'Bench' },
  { value: 'dnp', label: 'DNP' },
]

export default function BasketballOpeningLineupSetup({
  draft,
  busy,
  onDraftChange,
  onBackToRoster,
  onStart,
}: {
  draft: BasketballSetupDraftV2
  busy: boolean
  onDraftChange: (draft: BasketballSetupDraftV2) => boolean
  onBackToRoster: () => void
  onStart: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const participants = draft.playerSetup.participants.filter(
    participant => participant.teamSide === 'tracked'
  )
  const starters = participants.filter(participant => participant.initialStatus === 'starter')
  const bench = participants.filter(participant => participant.initialStatus === 'bench')
  const dnp = participants.filter(participant => participant.initialStatus === 'dnp')
  const lineup = draft.playerSetup.openingLineups.tracked

  const updateStatus = (
    participantId: string,
    status: BasketballSetupParticipantStatus
  ) => {
    const result = updateBasketballSetupTrackedStatus(draft, participantId, status)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (onDraftChange(result.draft)) setError(null)
  }

  const updateReason = (value: string) => {
    const next: BasketballSetupDraftV2 = {
      ...draft,
      updatedAt: new Date().toISOString(),
      playerSetup: {
        ...draft.playerSetup,
        openingLineups: {
          ...draft.playerSetup.openingLineups,
          tracked: {
            ...lineup,
            shortHandedReason: value || null,
          },
        },
      },
    }
    if (onDraftChange(next)) setError(null)
  }

  const continueToReview = () => {
    const result = confirmBasketballSetupOpeningLineup(
      draft,
      lineup.shortHandedReason ?? ''
    )
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (onDraftChange(result.draft)) setError(null)
  }

  if (draft.playerSetup.currentStep === 'review') {
    return (
      <section className="space-y-5" aria-labelledby="basketball-lineup-review-title">
        <div className="flex items-start justify-between gap-4 border-y border-slate-200 py-3">
          <div>
            <h2 id="basketball-lineup-review-title" className="text-lg font-semibold text-slate-800">
              Opening Lineup Review
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Period 1 will open paused with this lineup.
            </p>
          </div>
          <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-800">
            {starters.length} / 5
          </span>
        </div>

        <LineupGroup title="Starters" participants={starters} empty="No starters selected" />
        <LineupGroup title="Bench" participants={bench} empty="No bench players" />
        {dnp.length > 0 && (
          <LineupGroup title="DNP" participants={dnp} empty="" />
        )}

        {lineup.shortHandedReason && (
          <div className="border-y border-amber-200 bg-amber-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase text-amber-800">Short-handed reason</p>
            <p className="mt-1 break-words text-sm text-amber-950">{lineup.shortHandedReason}</p>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              const next = {
                ...draft,
                updatedAt: new Date().toISOString(),
                playerSetup: { ...draft.playerSetup, currentStep: 'opening_lineup' as const },
              }
              if (onDraftChange(next)) setError(null)
            }}
          >
            Edit Lineup
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={onStart}>
            {busy ? 'Checking...' : 'Start Game'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-5" aria-labelledby="basketball-opening-lineup-title">
      <div className="flex items-start justify-between gap-4 border-y border-slate-200 py-3">
        <div>
          <h2 id="basketball-opening-lineup-title" className="text-lg font-semibold text-slate-800">
            Opening Lineup
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Assign every player as Starter, Bench, or DNP.
          </p>
        </div>
        <span className={`shrink-0 rounded border px-2 py-1 text-sm font-semibold ${
          starters.length === 5
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`} aria-live="polite">
          {starters.length} / 5
        </span>
      </div>

      <div className="space-y-3">
        {participants.map(participant => (
          <div key={participant.participantId} className="card space-y-3 py-3">
            <div className="min-w-0">
              <p className="break-words font-semibold text-slate-800">{participant.displayName}</p>
              {participant.number && (
                <p className="text-xs text-slate-500">#{participant.number}</p>
              )}
            </div>
            <div
              className="grid grid-cols-3 rounded-md bg-slate-100 p-1"
              role="group"
              aria-label={`${participant.displayName} opening status`}
            >
              {STATUS_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  disabled={busy}
                  aria-pressed={participant.initialStatus === option.value}
                  onClick={() => updateStatus(participant.participantId, option.value)}
                  className={`rounded px-2 py-2 text-xs font-semibold disabled:opacity-50 ${
                    participant.initialStatus === option.value
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {starters.length > 0 && starters.length < 5 && (
        <label className="block text-sm font-medium text-slate-700">
          Short-handed reason
          <textarea
            value={lineup.shortHandedReason ?? ''}
            onChange={event => updateReason(event.target.value)}
            rows={3}
            maxLength={240}
            placeholder="Required to confirm fewer than five starters"
            className="input-field mt-1 resize-none"
          />
        </label>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn-secondary" disabled={busy} onClick={onBackToRoster}>
          Back to Roster
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || starters.length === 0}
          onClick={continueToReview}
        >
          Review Lineup
        </button>
      </div>
    </section>
  )
}

function LineupGroup({
  title,
  participants,
  empty,
}: {
  title: string
  participants: BasketballSetupDraftV2['playerSetup']['participants']
  empty: string
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {participants.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {participants.map(participant => (
            <span
              key={participant.participantId}
              className="max-w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
            >
              <span className="break-words">{participant.displayName}</span>
              {participant.number ? ` #${participant.number}` : ''}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm text-slate-400">{empty}</p>
      )}
    </div>
  )
}
