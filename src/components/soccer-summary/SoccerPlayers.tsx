import { ChevronRight, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  formatSoccerReviewDuration,
  soccerPlayerReview,
  type SoccerPlayerCategory,
  type SoccerPlayerReviewSide,
  type SoccerPlayerReviewRow,
  type SoccerReviewRate,
} from '../../lib/soccer/summaryPlayers'
import type { SoccerSummarySource } from '../../lib/soccer/summarySource'
import SoccerPlayerDetail from './SoccerPlayerDetail'

interface SoccerPlayersProps {
  source: SoccerSummarySource
  side: SoccerPlayerReviewSide
  category: SoccerPlayerCategory
  onSideChange: (side: SoccerPlayerReviewSide) => void
  onCategoryChange: (category: SoccerPlayerCategory) => void
}

const CATEGORIES: Array<{ id: SoccerPlayerCategory; label: string }> = [
  { id: 'attack', label: 'Attack' },
  { id: 'defense', label: 'Defense' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'goalkeeping', label: 'Goalkeeping' },
]

export default function SoccerPlayers({
  source,
  side,
  category,
  onSideChange,
  onCategoryChange,
}: SoccerPlayersProps) {
  const [selected, setSelected] = useState<SoccerPlayerReviewRow | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const clockRunning =
    source.state.sportGameState?.sportId === 'soccer' &&
    source.state.sportGameState.projection.clock.running

  useEffect(() => {
    if (!clockRunning) return
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [clockRunning])

  const review = useMemo(
    () => soccerPlayerReview(source.state, source.inspection, nowMs),
    [nowMs, source.inspection, source.state]
  )
  const columns = categoryColumns(category)
  const selectedId = selected?.participantId ?? null

  useEffect(() => {
    if (!selectedId) return
    setSelected(
      review.tracked.rows.find(
        player => player.participantId === selectedId
      ) ?? null
    )
  }, [review, selectedId])

  return (
    <main className="mx-auto max-w-2xl pb-10">
      <section className="border-b border-slate-200 bg-white px-4 py-4">
        <div className="grid grid-cols-2 border border-slate-300 p-0.5">
          {([
            ['tracked', source.state.gameInfo?.teamName ?? 'Tracked'],
            ['opponent', source.state.gameInfo?.opponentName ?? 'Opponent'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onSideChange(id)}
              className={`min-h-10 px-2 text-sm font-bold ${
                side === id
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white text-slate-600'
              }`}
              aria-pressed={side === id}
            >
              <span className="block truncate">{label}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <ShieldCheck size={15} className="shrink-0 text-emerald-700" />
          <span>
            {side === 'tracked'
              ? review.tracked.cleanSheet.label
              : review.opponent.cleanSheet.label}
          </span>
        </div>
      </section>

      {side === 'opponent' ? (
        <section className="bg-white px-4 py-10 text-center">
          <h2 className="text-base font-bold text-slate-900">
            Opponent player detail unavailable
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
            This match has team-level opponent statistics but no complete opponent lineup,
            role, or minutes record.
          </p>
        </section>
      ) : (
        <>
          <section className="sticky top-12 z-20 border-b border-slate-200 bg-white px-4">
            <div className="flex h-11 items-stretch overflow-x-auto">
              {CATEGORIES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onCategoryChange(item.id)}
                  className={`shrink-0 border-b-2 px-3 text-xs font-bold ${
                    category === item.id
                      ? 'border-emerald-700 text-emerald-800'
                      : 'border-transparent text-slate-500'
                  }`}
                  aria-pressed={category === item.id}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="bg-white">
            <div
              className="grid min-h-9 items-center gap-1 border-b border-slate-200 bg-slate-50 px-3 text-[10px] font-bold uppercase text-slate-500"
              style={{ gridTemplateColumns: tableColumns(columns.length) }}
            >
              <span>Player</span>
              {columns.map(column => (
                <span key={column.id} className="text-center" title={column.label}>
                  {column.shortLabel}
                </span>
              ))}
              <span aria-hidden="true" />
            </div>

            <div className="divide-y divide-slate-200">
              {review.tracked.rows.map(player => (
                <button
                  key={player.participantId}
                  type="button"
                  onClick={() => setSelected(player)}
                  className="grid min-h-[4.25rem] w-full items-center gap-1 px-3 text-left hover:bg-slate-50"
                  style={{ gridTemplateColumns: tableColumns(columns.length) }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      <span className="mr-1.5 text-slate-400">{player.number ?? '-'}</span>
                      {player.displayName}
                    </p>
                    <p className="truncate text-[11px] capitalize text-slate-500">
                      {lineupLabel(player)}
                      {' - '}
                      {player.role.label ?? player.role.group.replace(/_/g, ' ')}
                      {' - '}
                      {player.lineupStatus === 'dnp'
                        ? 'DNP'
                        : formatSoccerReviewDuration(player.minutesMs)}
                    </p>
                  </div>
                  {columns.map(column => (
                    <StatCell
                      key={column.id}
                      value={column.value(player)}
                    />
                  ))}
                  <ChevronRight size={17} className="text-slate-400" />
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {selected && (
        <SoccerPlayerDetail
          player={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  )
}

interface CategoryColumn {
  id: string
  label: string
  shortLabel: string
  value: (player: SoccerPlayerReviewRow) => number | SoccerReviewRate | null
}

function categoryColumns(category: SoccerPlayerCategory): CategoryColumn[] {
  if (category === 'attack') {
    return [
      { id: 'goals', label: 'Goals', shortLabel: 'G', value: player => player.stats.goals },
      {
        id: 'assists',
        label: 'Assists',
        shortLabel: 'A',
        value: player => player.stats.primaryAssists + player.stats.secondaryAssists,
      },
      { id: 'shots', label: 'Shots', shortLabel: 'Sh', value: player => player.stats.shots },
      {
        id: 'shots-on-target',
        label: 'Shots on target',
        shortLabel: 'SOT',
        value: player => player.stats.shotsOnTarget,
      },
    ]
  }
  if (category === 'defense') {
    return [
      {
        id: 'tackles-won',
        label: 'Tackles won',
        shortLabel: 'TW',
        value: player => player.stats.tacklesWon,
      },
      {
        id: 'tackles-attempted',
        label: 'Tackles attempted',
        shortLabel: 'TA',
        value: player => player.stats.tacklesAttempted,
      },
      {
        id: 'interceptions',
        label: 'Interceptions',
        shortLabel: 'Int',
        value: player => player.stats.interceptions,
      },
      {
        id: 'clearances',
        label: 'Clearances',
        shortLabel: 'Clr',
        value: player => player.stats.clearances,
      },
    ]
  }
  if (category === 'discipline') {
    return [
      {
        id: 'fouls-committed',
        label: 'Fouls committed',
        shortLabel: 'FC',
        value: player => player.stats.foulsCommitted,
      },
      {
        id: 'fouls-drawn',
        label: 'Fouls drawn',
        shortLabel: 'FD',
        value: player => player.stats.foulsDrawn,
      },
      {
        id: 'yellow',
        label: 'Yellow cards',
        shortLabel: 'YC',
        value: player => player.stats.yellowCards,
      },
      {
        id: 'red',
        label: 'Red cards',
        shortLabel: 'RC',
        value: player => player.stats.redCards,
      },
    ]
  }
  return [
    {
      id: 'saves',
      label: 'Saves',
      shortLabel: 'Sv',
      value: player => player.stats.goalkeeperSaves,
    },
    {
      id: 'goals-allowed',
      label: 'Goals allowed',
      shortLabel: 'GA',
      value: player => player.stats.goalkeeperGoalsAllowed,
    },
    {
      id: 'save-percentage',
      label: 'Save percentage',
      shortLabel: 'Save%',
      value: player => player.rates.savePercentage,
    },
  ]
}

function StatCell({ value }: { value: number | SoccerReviewRate | null }) {
  if (typeof value === 'number') {
    return <span className="text-center text-sm font-bold tabular-nums text-slate-800">{value}</span>
  }
  if (!value) return <span className="text-center text-sm text-slate-400">-</span>
  return (
    <span className="text-center tabular-nums">
      <span className="block text-xs font-bold text-slate-800">
        {Math.round(value.value * 100)}%
      </span>
      <span className="block text-[9px] text-slate-500">
        {value.numerator}/{value.denominator}
      </span>
    </span>
  )
}

function tableColumns(statCount: number): string {
  return `minmax(7.5rem, 1fr) repeat(${statCount}, minmax(2.15rem, 2.7rem)) 1.1rem`
}

function lineupLabel(player: SoccerPlayerReviewRow): string {
  if (player.lineupStatus === 'starter') return 'Starter'
  if (player.lineupStatus === 'substitute') return 'Sub'
  return 'Unused'
}
