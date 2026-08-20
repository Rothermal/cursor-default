import { ChevronRight } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import {
  basketballPlayerReview,
  type BasketballPlayerReviewRow,
} from '../../lib/basketball/summaryDetails'
import type { BasketballSummarySource } from '../../lib/basketball/summarySource'
import BasketballPlayerDetail from './BasketballPlayerDetail'

interface Props {
  source: BasketballSummarySource
}

export default function BasketballPlayers({ source }: Props) {
  const review = useMemo(
    () => basketballPlayerReview(source.state, source.inspection),
    [source.inspection, source.state]
  )
  const [side, setSide] = useState<'tracked' | 'opponent'>('tracked')
  const [selected, setSelected] = useState<BasketballPlayerReviewRow | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const rows = review[side]

  const closeDetail = () => {
    setSelected(null)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  return (
    <main className="mx-auto max-w-3xl pb-10">
      <section className="border-b border-slate-200 bg-white px-4 py-4">
        <div className="grid grid-cols-2 rounded-md border border-slate-300 p-0.5">
          {([['tracked', source.state.gameInfo?.teamName ?? 'Tracked'],
            ['opponent', source.state.gameInfo?.opponentName ?? 'Opponent']] as const)
            .map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSide(id)
                  setSelected(null)
                }}
                className={`min-h-10 rounded px-2 text-sm font-bold ${
                  side === id ? 'bg-blue-700 text-white' : 'bg-white text-slate-600'
                }`}
                aria-pressed={side === id}
              >
                <span className="block truncate">{label}</span>
              </button>
            ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Rows represent only recorded match participants. Team and unknown activity remains in Team Stats.
        </p>
      </section>

      {rows.length === 0 ? (
        <section className="bg-white px-4 py-10 text-center">
          <h2 className="font-bold text-slate-900">No opponent players recorded</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
            Opponent team totals remain authoritative. Player rows appear only when an opponent participant was explicitly added.
          </p>
        </section>
      ) : (
        <section className="bg-white">
          <div className="grid grid-cols-[minmax(0,1fr)_3rem_3rem_3rem_1.25rem] items-center gap-1 border-b border-slate-200 bg-slate-100 px-3 py-2 text-[10px] font-bold uppercase text-slate-500">
            <span>Player</span>
            <span className="text-center">PTS</span>
            <span className="text-center">REB</span>
            <span className="text-center">AST</span>
            <span aria-hidden="true" />
          </div>
          <div className="divide-y divide-slate-200">
            {rows.map(player => (
              <button
                key={player.participantId}
                type="button"
                onClick={event => {
                  triggerRef.current = event.currentTarget
                  setSelected(player)
                }}
                className="grid min-h-[4.5rem] w-full grid-cols-[minmax(0,1fr)_3rem_3rem_3rem_1.25rem] items-center gap-1 px-3 text-left hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">
                    <span className="mr-1.5 text-slate-400">{player.number ?? '-'}</span>
                    {player.displayName}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {rosterLabel(player)}
                    {player.position ? ` / ${player.position}` : ''}
                    {player.captain ? ' / Captain' : ''}
                    {player.disqualified ? ' / Disqualified' : ''}
                    {player.ejected ? ' / Ejected' : ''}
                  </p>
                </div>
                <Stat value={player.line.points} />
                <Stat value={player.line.rebounds} />
                <Stat value={player.line.assists} />
                <ChevronRight size={17} className="text-slate-400" />
              </button>
            ))}
          </div>
        </section>
      )}

      {selected && <BasketballPlayerDetail player={selected} onClose={closeDetail} />}
    </main>
  )
}

function Stat({ value }: { value: number }) {
  return <span className="text-center text-sm font-bold tabular-nums text-slate-800">{value}</span>
}

function rosterLabel(player: BasketballPlayerReviewRow): string {
  const label = player.rosterStatus === 'starter'
    ? 'Starter roster'
    : player.rosterStatus === 'bench'
      ? 'Bench roster'
      : 'DNP roster designation'
  return player.lateAdded ? `${label} / Added during game` : label
}
