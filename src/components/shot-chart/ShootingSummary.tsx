import { useMemo } from 'react'
import type { ShotRecord, ShotZone } from '../../types'

interface ShootingSummaryProps {
  shots: ShotRecord[]
  className?: string
  /** Copy when `shots` is empty (view-specific empty states, F2 §3.4). */
  emptyMessage?: string
}

const ROW1_ZONES: { zone: ShotZone; shortLabel: string }[] = [
  { zone: 'restricted', shortLabel: 'Restrict' },
  { zone: 'paint', shortLabel: 'Paint' },
  { zone: 'mid_range', shortLabel: 'Mid' },
]

function pct(made: number, att: number): string {
  if (att === 0) return '—'
  return `${Math.round((made / att) * 100)}%`
}

function ZoneCell({
  label,
  made,
  attempts,
}: {
  label: string
  made: number
  attempts: number
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 truncate">{label}</p>
      <p className="text-sm font-bold text-slate-800 mt-0.5">
        {made}/{attempts}
      </p>
      <p className="text-xs text-slate-600">{pct(made, attempts)}</p>
    </div>
  )
}

export default function ShootingSummary({
  shots,
  className,
  emptyMessage = 'No chart shots recorded.',
}: ShootingSummaryProps) {
  const byZone = useMemo(() => {
    const counts: Record<ShotZone, { made: number; att: number }> = {
      restricted: { made: 0, att: 0 },
      paint: { made: 0, att: 0 },
      mid_range: { made: 0, att: 0 },
      three: { made: 0, att: 0 },
    }
    let totalMade = 0
    let totalAtt = 0
    for (const s of shots) {
      const z = s.zone
      if (counts[z]) {
        counts[z].att += 1
        if (s.made) counts[z].made += 1
      }
      totalAtt += 1
      if (s.made) totalMade += 1
    }
    return { counts, totalMade, totalAtt }
  }, [shots])

  if (shots.length === 0) {
    return (
      <p className={`text-sm text-slate-500 ${className ?? ''}`.trim()}>{emptyMessage}</p>
    )
  }

  const { counts, totalMade, totalAtt } = byZone

  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-slate-600 mb-2">Shooting by zone</h3>
      <div className="grid grid-cols-3 gap-2 mb-2">
        {ROW1_ZONES.map(({ zone, shortLabel }) => (
          <ZoneCell
            key={zone}
            label={shortLabel}
            made={counts[zone].made}
            attempts={counts[zone].att}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ZoneCell label="3-Point" made={counts.three.made} attempts={counts.three.att} />
        <ZoneCell label="Total" made={totalMade} attempts={totalAtt} />
      </div>
    </div>
  )
}
