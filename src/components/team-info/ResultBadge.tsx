import type { TeamGameResult } from '../../lib/teamInfo'

interface ResultBadgeProps {
  result: TeamGameResult | null
  scoreLine: string | null
}

export default function ResultBadge({ result, scoreLine }: ResultBadgeProps) {
  const color =
    result === 'W'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : result === 'L'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : result === 'T'
          ? 'bg-slate-100 text-slate-700 border-slate-200'
          : 'bg-slate-50 text-slate-500 border-slate-200'

  return (
    <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-bold tabular-nums ${color}`}>
      {result && scoreLine ? `${result} ${scoreLine}` : scoreLine ?? 'TBD'}
    </span>
  )
}
