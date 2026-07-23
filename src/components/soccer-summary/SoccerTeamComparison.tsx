import type { SoccerComparisonSection } from '../../lib/soccer/summary'

interface SoccerTeamComparisonProps {
  sections: SoccerComparisonSection[]
  trackedName: string
  opponentName: string
}

export default function SoccerTeamComparison({
  sections,
  trackedName,
  opponentName,
}: SoccerTeamComparisonProps) {
  return (
    <section className="border-t border-slate-200 bg-white px-4 py-5">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-sm font-bold text-slate-900">Team Comparison</h2>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)] gap-2 text-center text-[11px] font-semibold text-slate-500">
          <span className="truncate" title={trackedName}>{trackedName}</span>
          <span aria-hidden="true" />
          <span className="truncate" title={opponentName}>{opponentName}</span>
        </div>
        <div className="mt-3 space-y-5">
          {sections.map(section => (
            <div key={section.id}>
              <h3 className="mb-1 text-xs font-bold uppercase text-slate-500">
                {section.label}
              </h3>
              <div className="divide-y divide-slate-100 border-y border-slate-200">
                {section.rows.map(row => (
                  <div
                    key={row.id}
                    className="grid min-h-10 grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)] items-center gap-2 text-center"
                  >
                    <span className="text-sm font-bold tabular-nums text-emerald-800">
                      {row.tracked}
                    </span>
                    <span className="text-xs text-slate-600">{row.label}</span>
                    <span className="text-sm font-bold tabular-nums text-indigo-800">
                      {row.opponent}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
