interface StatCorrectionModalProps {
  playerName: string
  statLabel: string
  currentValue: number
  correctValue: string
  correctReason: string
  correctError: string | null
  savingCorrection: boolean
  onCorrectValueChange: (value: string) => void
  onCorrectReasonChange: (value: string) => void
  onSave: () => void
  onClose: () => void
}

export default function StatCorrectionModal({
  playerName,
  statLabel,
  currentValue,
  correctValue,
  correctReason,
  correctError,
  savingCorrection,
  onCorrectValueChange,
  onCorrectReasonChange,
  onSave,
  onClose,
}: StatCorrectionModalProps) {
  return (
    <div
      className="fixed inset-0 bg-overlay/[0.5] flex items-center justify-center p-4 z-10"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="correct-stat-title"
    >
      <div
        className="card max-w-sm w-full"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="correct-stat-title" className="font-semibold text-content mb-3">
          Correct stat
        </h3>
        <p className="text-sm text-content-muted mb-2">
          {playerName} — {statLabel}
        </p>
        <p className="text-xs text-content-subtle mb-3">
          Current value: {currentValue}
        </p>
        {correctError && (
          <div className="mb-3 text-sm text-danger-content">{correctError}</div>
        )}
        <input
          type="number"
          min={0}
          value={correctValue}
          onChange={e => onCorrectValueChange(e.target.value)}
          className="bg-surface input-field mb-3"
          placeholder="New value"
        />
        <input
          type="text"
          value={correctReason}
          onChange={e => onCorrectReasonChange(e.target.value)}
          className="bg-surface input-field mb-4"
          placeholder="Reason (optional)"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={savingCorrection}
            className="btn-primary flex-1"
          >
            {savingCorrection ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
