import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { BaseballLineScoreView, BaseballScoreboardView } from '../../lib/baseball'

interface BaseballScoreboardProps {
  view: BaseballScoreboardView
  lineScore: BaseballLineScoreView
  /** Rendered on the left of the top row (the back link). */
  leading?: ReactNode
  /** Rendered on the right of the top row (the Game menu). */
  trailing?: ReactNode
}

/**
 * The sticky Baseball scoreboard strip (BSB-3A): runs, the half and inning, the count and
 * outs as dots, and the pitcher's pitch count. Tapping the score opens the line score.
 */
export default function BaseballScoreboard({ view, lineScore, leading, trailing }: BaseballScoreboardProps) {
  const [open, setOpen] = useState(false)
  return (
    <section
      className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-line bg-canvas/95 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur"
      aria-label="Scoreboard"
    >
      <div className="flex min-h-10 items-center gap-2">
        {leading}
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-content-muted">{view.halfLabel}</p>
        {trailing}
      </div>

      <button
        type="button"
        className="grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-md text-left"
        aria-expanded={open}
        aria-label={`${view.away.name} ${view.away.runs}, ${view.home.name} ${view.home.runs}. ${open ? 'Hide' : 'Show'} line score`}
        onClick={() => setOpen(value => !value)}
      >
        <div className="min-w-0 space-y-0.5" aria-live="polite">
          {[view.away, view.home].map(side => (
            <div key={side.side} className="flex items-baseline gap-2">
              <span
                className={`min-w-0 flex-1 truncate text-sm font-bold uppercase ${side.side === 'tracked' ? 'text-content' : 'text-content-muted'}`}
              >
                {side.name}
              </span>
              <span className="text-2xl font-bold tabular-nums leading-none">{side.runs}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className={`space-y-1 text-xs font-semibold text-content-muted ${view.showCount ? '' : 'invisible'}`}>
            <Dots label="B" count={view.balls} total={view.ballDots} tone="bg-success-content" />
            <Dots label="S" count={view.strikes} total={view.strikeDots} tone="bg-danger-content" />
            <Dots label="O" count={view.outs} total={view.outDots} tone="bg-warning-content" />
          </div>
          {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </div>
      </button>

      {view.pitcher && (
        <p className="flex min-w-0 items-center gap-2 text-xs text-content-muted">
          <span className="min-w-0 truncate">Pitching: {view.pitcher.label}</span>
          <span className="shrink-0 font-semibold tabular-nums text-content">{view.pitcher.pitches} pitches</span>
          {view.pitcher.alert && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${view.pitcher.alert.kind === 'limit' ? 'bg-danger text-danger-content' : 'bg-warning text-warning-content'}`}
            >
              {view.pitcher.alert.kind === 'limit'
                ? `Limit ${view.pitcher.alert.threshold}`
                : `Past ${view.pitcher.alert.threshold}`}
            </span>
          )}
        </p>
      )}

      {open && <LineScore view={lineScore} />}
    </section>
  )
}

function Dots({ label, count, total, tone }: { label: string; count: number; total: number; tone: string }) {
  const name = label === 'B' ? 'Balls' : label === 'S' ? 'Strikes' : 'Outs'
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`${name} ${count}`}>
      <span className="w-3" aria-hidden="true">{label}</span>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full border border-line-strong ${index < count ? tone : ''}`}
        />
      ))}
    </div>
  )
}

function LineScore({ view }: { view: BaseballLineScoreView }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-max text-center text-sm tabular-nums">
        <caption className="sr-only">Line score</caption>
        <thead>
          <tr className="text-xs text-content-muted">
            <th scope="col" className="px-1 text-left font-semibold">Team</th>
            {view.innings.map(inning => (
              <th key={inning} scope="col" className="w-6 px-1 font-semibold">{inning}</th>
            ))}
            <th scope="col" className="w-7 px-1 font-bold text-content">R</th>
            <th scope="col" className="w-7 px-1 font-semibold">H</th>
            <th scope="col" className="w-7 px-1 font-semibold">E</th>
          </tr>
        </thead>
        <tbody>
          {[view.away, view.home].map(row => (
            <tr key={row.side} className="border-t border-line">
              <th scope="row" className="max-w-[7rem] truncate px-1 text-left font-semibold">{row.name}</th>
              {row.innings.map((runs, index) => (
                <td key={index} className="px-1">{runs ?? ''}</td>
              ))}
              <td className="px-1 font-bold">{row.runs}</td>
              <td className="px-1">{row.hits}</td>
              <td className="px-1">{row.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
