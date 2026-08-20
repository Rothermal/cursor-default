import type { BasketballRecorderSummary } from '../../lib/basketball/recorders'

interface Props {
  recorders: BasketballRecorderSummary[]
  selectedRecorderId: string | null
  disabled: boolean
  onChange: (recorderId: string | null) => void
}

export default function BasketballRecordingSelector({
  recorders,
  selectedRecorderId,
  disabled,
  onChange,
}: Props) {
  const primary = recorders.find(recorder => recorder.isPrimary)
  const alternatives = recorders.filter(recorder => !recorder.isPrimary)
  if (!primary || alternatives.length === 0 || !recorders.some(item => item.canSelectPrimary)) {
    return null
  }

  return (
    <div className="border-b border-slate-200 bg-sky-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor="basketball-recording" className="text-sm font-semibold text-slate-700">
          Recording source
        </label>
        <select
          id="basketball-recording"
          value={selectedRecorderId ?? primary.recorderId}
          disabled={disabled}
          onChange={event => {
            onChange(event.target.value === primary.recorderId ? null : event.target.value)
          }}
          className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 sm:w-72"
        >
          <option value={primary.recorderId}>Primary: {primary.displayName}</option>
          {alternatives.map(recorder => (
            <option key={recorder.recorderId} value={recorder.recorderId}>
              Other: {recorder.displayName}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
