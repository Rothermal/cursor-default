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
  const [sort, setSort] = useState<'roster' | 'name' | 'minutes' | 'points'>('roster')
  const [selected, setSelected] = useState<BasketballPlayerReviewRow | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const rows = useMemo(() => {
    const next = [...review[side]]
    if (sort === 'name') return next.sort((a, b) => a.displayName.localeCompare(b.displayName))
    if (sort === 'minutes') {
      return next.sort((a, b) =>
        b.participation.participationMs - a.participation.participationMs ||
        a.displayName.localeCompare(b.displayName)
      )
    }
    if (sort === 'points') {
      return next.sort((a, b) => b.line.points - a.line.points || a.displayName.localeCompare(b.displayName))
    }
    return next
  }, [review, side, sort])

  const closeDetail = () => {
    setSelected(null)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  return (
    <main className="mx-auto max-w-3xl pb-10">
      <section className="border-b border-line bg-surface px-4 py-4">
        <div className="grid grid-cols-2 rounded-md border border-line-strong p-0.5">
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
                  side === id ? 'bg-info text-content' : 'bg-surface text-content-muted'
                }`}
                aria-pressed={side === id}
              >
                <span className="block truncate">{label}</span>
              </button>
            ))}
        </div>
        <p className="mt-2 text-xs text-content-subtle">
          Rows represent only recorded match participants. Team and unknown activity remains in Team Stats.
        </p>
        <label className="mt-3 flex items-center justify-end gap-2 text-xs font-semibold text-content-muted">
          Sort
          <select
            value={sort}
            onChange={event => setSort(event.target.value as typeof sort)}
            className="min-h-9 rounded border border-line-strong bg-surface px-2 text-sm text-content"
          >
            <option value="roster">Roster order</option>
            <option value="name">Name</option>
            <option value="minutes">Minutes</option>
            <option value="points">Points</option>
          </select>
        </label>
      </section>

      {rows.length === 0 ? (
        <section className="bg-surface px-4 py-10 text-center">
          <h2 className="font-bold text-content">No opponent players recorded</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-content-muted">
            Opponent team totals remain authoritative. Player rows appear only when an opponent participant was explicitly added.
          </p>
        </section>
      ) : (
        <section className="bg-surface">
          <div className="grid grid-cols-[minmax(0,1fr)_3.75rem_3rem_3rem_1.25rem] items-center gap-1 border-b border-line bg-control px-3 py-2 text-[10px] font-bold uppercase text-content-subtle">
            <span>Player</span>
            <span className="text-center">MIN</span>
            <span className="text-center">PTS</span>
            <span className="text-center">+/-</span>
            <span aria-hidden="true" />
          </div>
          <div className="divide-y divide-line">
            {rows.map(player => (
              <button
                key={player.participantId}
                type="button"
                onClick={event => {
                  triggerRef.current = event.currentTarget
                  setSelected(player)
                }}
                className="grid min-h-[4.5rem] w-full grid-cols-[minmax(0,1fr)_3.75rem_3rem_3rem_1.25rem] items-center gap-1 px-3 text-left hover:bg-surface-muted"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-content">
                    <span className="mr-1.5 text-content-subtle">{player.number ?? '-'}</span>
                    {player.displayName}
                  </p>
                  <p className="truncate text-[11px] text-content-subtle">
                    {rosterLabel(player)}
                    {player.participation.basis === 'interval_derived'
                      ? ` / ${player.participation.stintCount} stint${player.participation.stintCount === 1 ? '' : 's'}`
                      : ''}
                    {player.position ? ` / ${player.position}` : ''}
                    {player.captain ? ' / Captain' : ''}
                    {player.disqualified ? ' / Disqualified' : ''}
                    {player.ejected ? ' / Ejected' : ''}
                  </p>
                </div>
                <Stat value={player.participation.displayTime} />
                <Stat value={player.line.points} />
                <Stat value={formatPlusMinus(player.participation.plusMinus)} muted={player.participation.plusMinus === null} />
                <ChevronRight size={17} className="text-content-subtle" />
              </button>
            ))}
          </div>
        </section>
      )}

      {selected && <BasketballPlayerDetail player={selected} onClose={closeDetail} />}
    </main>
  )
}

function Stat({ value, muted = false }: { value: string | number; muted?: boolean }) {
  return (
    <span className={`text-center text-sm font-bold tabular-nums ${muted ? 'text-content-subtle' : 'text-content'}`}>
      {value}
    </span>
  )
}

function rosterLabel(player: BasketballPlayerReviewRow): string {
  const result = player.participation.dnp === true
    ? 'DNP'
    : player.participation.appeared === true
      ? player.participation.started ? 'Starter / played' : 'Bench / played'
      : player.rosterStatus === 'starter'
        ? 'Starter roster'
        : player.rosterStatus === 'bench'
          ? 'Bench roster'
          : 'DNP roster designation'
  const label = player.participation.basis === 'recorded_manual'
    ? `${result} / recorded minutes`
    : result
  return player.lateAdded ? `${label} / Added during game` : label
}

function formatPlusMinus(value: number | null): string {
  if (value === null) return '-'
  return value > 0 ? `+${value}` : String(value)
}
