import type { KeyboardEvent } from 'react'
import {
  BASEBALL_BATTED_BALL_OPTIONS,
  type BaseballSprayChart as BaseballSprayChartModel,
  type BaseballSprayFilter,
  type BaseballSprayPoint,
  type BaseballTeamNames,
} from '../../lib/baseball'
import { BaseballFieldShapes } from './BaseballDiamond'

interface BaseballSprayChartProps {
  chart: BaseballSprayChartModel
  filter: BaseballSprayFilter
  names: BaseballTeamNames
  onFilter: (filter: BaseballSprayFilter) => void
  /** Opens the read-only play details for a point's capture unit. */
  onOpenPlay: (playId: string) => void
}

const S = 100
const RESULT_LABELS = { hit: 'Hit', out: 'Out', error: 'Error' } as const

/**
 * The Summary's spray chart (BSB-5B): located balls in play on the fixed diamond. Shape shows
 * the result (filled hit, open out, square error) and color the batting team.
 */
export default function BaseballSprayChart({ chart, filter, names, onFilter, onOpenPlay }: BaseballSprayChartProps) {
  const set = (patch: Partial<BaseballSprayFilter>) => onFilter({ ...filter, ...patch })
  const total = chart.points.length + chart.unlocated
  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-2 rounded-md border border-line bg-surface p-3" aria-label="Spray chart filters">
        <Select
          label="Team"
          value={filter.side}
          onChange={side => set({ side: side as BaseballSprayFilter['side'], batterId: 'all' })}
          options={[['all', 'Both teams'], ['tracked', names.tracked], ['opponent', names.opponent]]}
        />
        <Select
          label="Batter"
          value={filter.batterId}
          onChange={batterId => set({ batterId })}
          options={[['all', 'All batters'], ...chart.batters.map(batter => [batter.id, batter.name] as [string, string])]}
        />
        <Select
          label="Result"
          value={filter.result}
          onChange={result => set({ result: result as BaseballSprayFilter['result'] })}
          options={[['all', 'All results'], ['hit', 'Hits'], ['out', 'Outs'], ['error', 'Errors']]}
        />
        <Select
          label="Type"
          value={filter.battedBallType}
          onChange={type => set({ battedBallType: type as BaseballSprayFilter['battedBallType'] })}
          options={[['all', 'All types'], ...BASEBALL_BATTED_BALL_OPTIONS.map(option => [option.type, option.label] as [string, string])]}
        />
      </section>

      <div className="relative mx-auto aspect-square w-full max-w-[22rem]">
        <svg
          viewBox={`0 0 ${S} ${S}`}
          className="block h-full w-full rounded-md"
          role="group"
          aria-label={`Spray chart, ${chart.points.length} located ${chart.points.length === 1 ? 'ball' : 'balls'} in play`}
        >
          <BaseballFieldShapes />
          {chart.points.map(point => (
            <Point key={point.eventId} point={point} names={names} onOpen={() => onOpenPlay(point.playId)} />
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-content-muted" aria-hidden="true">
        <LegendSwatch color="rgb(var(--diamond-tracked))" label={names.tracked} />
        <LegendSwatch color="rgb(var(--diamond-opponent))" label={names.opponent} />
        <span className="flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="currentColor" /></svg>Hit</span>
        <span className="flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>Out</span>
        <span className="flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor" /></svg>Error</span>
      </div>

      <p className="text-center text-sm text-content-muted">
        {total === 0
          ? 'No balls in play match these filters.'
          : chart.unlocated > 0
            ? `${chart.unlocated} ${chart.unlocated === 1 ? 'ball in play has' : 'balls in play have'} no location and ${chart.unlocated === 1 ? 'is' : 'are'} not shown.`
            : 'Tap a mark to see the play.'}
      </p>
    </div>
  )
}

function Point({ point, names, onOpen }: { point: BaseballSprayPoint; names: BaseballTeamNames; onOpen: () => void }) {
  const color = point.side === 'tracked' ? 'rgb(var(--diamond-tracked))' : 'rgb(var(--diamond-opponent))'
  const x = point.x * S
  const y = point.y * S
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${names[point.side]}, ${point.label}. ${RESULT_LABELS[point.result]}.`}
      className="cursor-pointer outline-none focus-visible:[&>.ring]:stroke-[rgb(var(--diamond-line))]"
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      {/* A larger invisible target for fingers. */}
      <circle cx={x} cy={y} r="3.6" fill="transparent" />
      <circle className="ring" cx={x} cy={y} r="2.6" fill="none" stroke="transparent" strokeWidth="0.6" />
      {point.result === 'hit' && <circle cx={x} cy={y} r="1.6" fill={color} stroke="rgb(var(--diamond-ink))" strokeWidth="0.3" />}
      {point.result === 'out' && <circle cx={x} cy={y} r="1.4" fill="rgb(var(--diamond-ink))" fillOpacity="0.35" stroke={color} strokeWidth="0.7" />}
      {point.result === 'error' && <rect x={x - 1.4} y={y - 1.4} width="2.8" height="2.8" fill={color} stroke="rgb(var(--diamond-ink))" strokeWidth="0.3" />}
    </g>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex max-w-[9rem] items-center gap-1">
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </span>
  )
}

function Select({ label, value, options, onChange }: {
  label: string
  value: string
  options: ReadonlyArray<readonly [string, string]>
  onChange: (value: string) => void
}) {
  return (
    <label className="min-w-0 text-xs font-semibold text-content-muted">
      {label}
      <select className="input-field mt-1 min-h-11 w-full min-w-0 px-2 py-2 text-sm" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  )
}
