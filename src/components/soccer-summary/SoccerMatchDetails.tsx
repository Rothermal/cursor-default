import type { SoccerSummarySource } from '../../lib/soccer/summarySource'
import { formatSoccerMatchFormat } from '../../lib/soccer/summary'

interface SoccerMatchDetailsProps {
  source: SoccerSummarySource
}

export default function SoccerMatchDetails({
  source,
}: SoccerMatchDetailsProps) {
  const soccerState = source.state.sportGameState?.sportId === 'soccer'
    ? source.state.sportGameState
    : null
  if (!soccerState) return null

  const details = [
    ['Date', source.state.gameInfo?.date || 'Not recorded'],
    ['Competition', source.state.gameInfo?.tournamentName || 'Not recorded'],
    ['Match format', formatSoccerMatchFormat(soccerState.setup.rulesSnapshot)],
    [
      'Tie resolution',
      soccerState.setup.rulesSnapshot.tieResolution === 'draw_allowed'
        ? 'Draw allowed'
        : soccerState.setup.rulesSnapshot.tieResolution === 'direct_to_shootout'
          ? 'Direct to shootout'
          : 'Extra time, then shootout',
    ],
    [
      'Primary recorder',
      source.recorder?.displayName ?? (source.kind === 'local' ? 'This device' : 'Unavailable'),
    ],
  ]

  return (
    <section className="border-t border-slate-200 bg-white px-4 py-5">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-sm font-bold text-slate-900">Match Details</h2>
        <dl className="mt-3 divide-y divide-slate-100 border-y border-slate-200">
          {details.map(([label, value]) => (
            <div key={label} className="grid min-h-10 grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 py-2 text-sm">
              <dt className="text-slate-500">{label}</dt>
              <dd className="min-w-0 break-words text-right font-semibold text-slate-800">
                {value}
              </dd>
            </div>
          ))}
          {source.publication && (
            <>
              <div className="grid min-h-10 grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 py-2 text-sm">
                <dt className="text-slate-500">Publication</dt>
                <dd className="text-right font-semibold text-slate-800">
                  #{source.publication.publicationNumber}
                </dd>
              </div>
              <div className="grid min-h-10 grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 py-2 text-sm">
                <dt className="text-slate-500">Finalized by</dt>
                <dd className="min-w-0 break-words text-right font-semibold text-slate-800">
                  {source.publication.finalizedByDisplayName}
                </dd>
              </div>
              <div className="grid min-h-10 grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 py-2 text-sm">
                <dt className="text-slate-500">Finalized</dt>
                <dd className="text-right font-semibold text-slate-800">
                  {new Date(source.publication.finalizedAt).toLocaleString()}
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>
    </section>
  )
}
