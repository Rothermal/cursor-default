import type { TeamRecord } from '../../lib/teamInfo'

interface RecordBadgeProps {
  record: TeamRecord
}

export default function RecordBadge({ record }: RecordBadgeProps) {
  const label =
    record.ties > 0
      ? `${record.wins}-${record.losses}-${record.ties}`
      : `${record.wins}-${record.losses}`

  return (
    <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Record</p>
        <p className="text-lg font-bold text-slate-900 leading-tight">{label}</p>
      </div>
    </div>
  )
}
