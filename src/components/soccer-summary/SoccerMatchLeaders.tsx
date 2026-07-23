import type { SoccerMatchLeader } from '../../lib/soccer/summary'

interface SoccerMatchLeadersProps {
  leaders: SoccerMatchLeader[]
}

export default function SoccerMatchLeaders({
  leaders,
}: SoccerMatchLeadersProps) {
  if (leaders.length === 0) return null

  return (
    <section className="border-t border-slate-200 bg-slate-50 px-4 py-5">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-sm font-bold text-slate-900">Match Leaders</h2>
        <div className="mt-3 grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2">
          {leaders.map((category, index) => (
            <div
              key={category.id}
              className={`min-w-0 bg-white px-3 py-3 ${
                leaders.length % 2 === 1 && index === leaders.length - 1
                  ? 'sm:col-span-2'
                  : ''
              }`}
            >
              <p className="text-xs font-bold text-slate-500">{category.label}</p>
              <div className="mt-2 space-y-1.5">
                {category.leaders.map(leader => (
                  <div
                    key={leader.participantId}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                      {leader.number ? `#${leader.number} ` : ''}
                      {leader.displayName}
                    </span>
                    <span className="shrink-0 text-lg font-bold tabular-nums text-emerald-800">
                      {leader.value}
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
