import type { SoccerMatchLeader } from '../../lib/soccer/summary'

interface SoccerMatchLeadersProps {
  leaders: SoccerMatchLeader[]
}

export default function SoccerMatchLeaders({
  leaders,
}: SoccerMatchLeadersProps) {
  if (leaders.length === 0) return null

  return (
    <section className="border-t border-line bg-canvas px-4 py-5">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-sm font-bold text-content">Match Leaders</h2>
        <div className="mt-3 grid gap-px border border-line bg-control sm:grid-cols-2">
          {leaders.map((category, index) => (
            <div
              key={category.id}
              className={`min-w-0 bg-surface px-3 py-3 ${
                leaders.length % 2 === 1 && index === leaders.length - 1
                  ? 'sm:col-span-2'
                  : ''
              }`}
            >
              <p className="text-xs font-bold text-content-muted">{category.label}</p>
              <div className="mt-2 space-y-1.5">
                {category.leaders.map(leader => (
                  <div
                    key={leader.participantId}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">
                      {leader.number ? `#${leader.number} ` : ''}
                      {leader.displayName}
                    </span>
                    <span className="shrink-0 text-lg font-bold tabular-nums text-success-content">
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
