import type { TeamGameResult } from '../../lib/teamInfo'

interface ResultBadgeProps {
  result: TeamGameResult | null
  scoreLine: string | null
}

export default function ResultBadge({ result, scoreLine }: ResultBadgeProps) {
  const color =
    result === 'W'
      ? 'bg-success text-success-content border-success-line'
      : result === 'L'
        ? 'bg-danger text-danger-content border-danger-line'
        : result === 'T'
          ? 'bg-surface-muted text-content border-line'
          : 'bg-surface-muted text-content-muted border-line'

  return (
    <span className={`inline-flex shrink-0 whitespace-nowrap items-center rounded-lg border px-2 py-1 text-xs font-bold tabular-nums ${color}`}>
      {result && scoreLine ? `${result} ${scoreLine}` : scoreLine ?? 'TBD'}
    </span>
  )
}
