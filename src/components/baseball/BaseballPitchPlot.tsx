import { X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  BASEBALL_PITCH_KINDS,
  type BaseballPitchFilter,
  type BaseballPitchKind,
  type BaseballPitchPlot as BaseballPitchPlotModel,
  type BaseballPitchPlotCluster,
  type BaseballTeamNames,
} from '../../lib/baseball'
import { BaseballZoneShapes } from './BaseballPitchPad'

interface BaseballPitchPlotProps {
  plot: BaseballPitchPlotModel
  filter: BaseballPitchFilter
  names: BaseballTeamNames
  onFilter: (filter: BaseballPitchFilter) => void
  /** Opens the read-only play details for a pitch's capture unit. */
  onOpenPlay: (playId: string) => void
}

const V = 100

const KIND_COLORS: Record<BaseballPitchKind, string> = {
  ball: 'rgb(var(--zone-ball))',
  called_strike: 'rgb(var(--zone-called))',
  swinging_strike: 'rgb(var(--zone-swinging))',
  foul: 'rgb(var(--zone-foul))',
  in_play: 'rgb(var(--zone-in-play))',
  hit_by_pitch: 'rgb(var(--zone-hbp))',
}

/**
 * The Summary's pitch plot (BSB-5C): located pitches on the pad's catcher's-view zone.
 * Each kind has its own color and shape, so the plot reads without color too. Pitches at
 * one spot share a numbered mark that opens a chooser, so every pitch stays reachable.
 */
export default function BaseballPitchPlot({ plot, filter, names, onFilter, onOpenPlay }: BaseballPitchPlotProps) {
  const set = (patch: Partial<BaseballPitchFilter>) => onFilter({ ...filter, ...patch })
  const total = plot.points.length + plot.unlocated
  const [chooserId, setChooserId] = useState<string | null>(null)
  // A filter change can regroup the marks; a chooser whose group is gone closes.
  const chooser = plot.clusters.find(cluster => cluster.id === chooserId && cluster.points.length > 1) ?? null
  const openCluster = (cluster: BaseballPitchPlotCluster) => {
    if (cluster.points.length === 1) onOpenPlay(cluster.points[0].playId)
    else setChooserId(cluster.id)
  }
  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-2 rounded-md border border-line bg-surface p-3" aria-label="Pitch plot filters">
        <Select
          label="Pitcher"
          value={filter.pitcherId}
          onChange={pitcherId => set({ pitcherId })}
          options={[
            ['all', 'All pitchers'],
            ...plot.pitchers.map(pitcher => [pitcher.id, `${pitcher.name} (${names[pitcher.side]})`] as [string, string]),
          ]}
        />
        <Select
          label="Result"
          value={filter.kind}
          onChange={kind => set({ kind: kind as BaseballPitchFilter['kind'] })}
          options={[['all', 'All results'], ...BASEBALL_PITCH_KINDS.map(entry => [entry.kind, entry.label] as [string, string])]}
        />
        <Select
          label="Batter hand"
          value={filter.batterHand}
          onChange={hand => set({ batterHand: hand as BaseballPitchFilter['batterHand'] })}
          options={[['all', 'Any hand'], ['R', 'Bats R'], ['L', 'Bats L'], ['S', 'Bats S'], ['unknown', 'Not recorded']]}
        />
        <Select
          label="Count"
          value={filter.count}
          onChange={count => set({ count })}
          options={[['all', 'Any count'], ...plot.counts.map(count => [count, count] as [string, string])]}
        />
      </section>

      <div className="mx-auto w-full max-w-[18rem]">
        <svg
          viewBox={`0 0 ${V} ${V}`}
          className="block aspect-square w-full rounded-md bg-surface-muted"
          role="group"
          aria-label={`Pitch plot, catcher's view, ${plot.points.length} located ${plot.points.length === 1 ? 'pitch' : 'pitches'}`}
        >
          <BaseballZoneShapes />
          {plot.clusters.map(cluster => (
            <Mark key={cluster.id} cluster={cluster} selected={cluster.id === chooser?.id} onOpen={() => openCluster(cluster)} />
          ))}
        </svg>
        <p className="mt-1 text-center text-xs text-content-muted">Catcher's view</p>
      </div>

      {chooser && (
        <Chooser cluster={chooser} onClose={() => setChooserId(null)} onOpenPlay={onOpenPlay} />
      )}

      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-content-muted" aria-label="Legend">
        {BASEBALL_PITCH_KINDS.map(entry => (
          <li key={entry.kind} className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">
              <Shape kind={entry.kind} size={4.2} />
            </svg>
            {entry.label}
          </li>
        ))}
      </ul>

      <p className="text-center text-sm text-content-muted">
        {total === 0
          ? 'No recorded pitches match these filters.'
          : plot.unlocated > 0
            ? `${plot.unlocated} recorded ${plot.unlocated === 1 ? 'pitch has' : 'pitches have'} no location and ${plot.unlocated === 1 ? 'is' : 'are'} not shown.`
            : 'Tap a mark to see the play. A numbered mark holds pitches at the same spot.'}
      </p>
    </div>
  )
}

/** Ball: open ring; called: filled circle; swinging: square; foul: triangle; in play: diamond; HBP: cross. */
function Shape({ kind, size }: { kind: BaseballPitchKind; size: number }) {
  const color = KIND_COLORS[kind]
  const s = size
  switch (kind) {
    case 'ball':
      return <circle r={s * 0.8} fill="none" stroke={color} strokeWidth={s * 0.35} />
    case 'called_strike':
      return <circle r={s} fill={color} />
    case 'swinging_strike':
      return <rect x={-s * 0.85} y={-s * 0.85} width={s * 1.7} height={s * 1.7} fill={color} />
    case 'foul':
      return <path d={`M 0 ${-s} L ${s} ${s * 0.8} L ${-s} ${s * 0.8} Z`} fill={color} />
    case 'in_play':
      return <path d={`M 0 ${-s} L ${s} 0 L 0 ${s} L ${-s} 0 Z`} fill={color} />
    case 'hit_by_pitch':
      return (
        <g stroke={color} strokeWidth={s * 0.4} strokeLinecap="round">
          <line x1={-s * 0.8} y1={-s * 0.8} x2={s * 0.8} y2={s * 0.8} />
          <line x1={-s * 0.8} y1={s * 0.8} x2={s * 0.8} y2={-s * 0.8} />
        </g>
      )
  }
}

function Mark({ cluster, selected, onOpen }: { cluster: BaseballPitchPlotCluster; selected: boolean; onOpen: () => void }) {
  const top = cluster.points[cluster.points.length - 1]
  const many = cluster.points.length > 1
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={many ? `${cluster.points.length} pitches at this spot. Choose one.` : top.label}
      aria-expanded={many ? selected : undefined}
      transform={`translate(${cluster.x * V} ${cluster.y * V})`}
      className="cursor-pointer outline-none focus-visible:[&>.ring]:stroke-[rgb(var(--focus))]"
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      {/* A larger invisible target for fingers. */}
      <circle r="5" fill="transparent" />
      <circle className="ring" r="4.2" fill="none" stroke={selected ? 'rgb(var(--content))' : 'transparent'} strokeWidth="0.8" />
      <Shape kind={top.kind} size={2.4} />
      {many && (
        <g transform="translate(3.4 -3.4)" aria-hidden="true">
          <circle r="2.6" fill="rgb(var(--content))" />
          <text textAnchor="middle" dominantBaseline="central" fontSize="3.2" fontWeight="700" fill="rgb(var(--surface))">
            {cluster.points.length > 9 ? '9+' : cluster.points.length}
          </text>
        </g>
      )}
    </g>
  )
}

/** Lists the pitches at one spot in game order; each opens its play. */
function Chooser({ cluster, onClose, onOpenPlay }: {
  cluster: BaseballPitchPlotCluster
  onClose: () => void
  onOpenPlay: (playId: string) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [cluster.id])
  return (
    <section className="rounded-md border border-line bg-surface p-3" aria-label="Pitches at this spot">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 ref={headingRef} tabIndex={-1} className="text-sm font-bold text-content outline-none">
          {cluster.points.length} pitches at this spot
        </h3>
        <button type="button" className="btn-secondary min-h-11 min-w-11 px-2" aria-label="Close pitch list" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <ul className="space-y-1">
        {cluster.points.map(point => (
          <li key={point.eventId}>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 rounded border border-line px-2 py-1.5 text-left text-sm text-content hover:bg-surface-muted"
              onClick={() => onOpenPlay(point.playId)}
            >
              <svg width="14" height="14" viewBox="-6 -6 12 12" className="shrink-0" aria-hidden="true">
                <Shape kind={point.kind} size={4.2} />
              </svg>
              <span className="min-w-0">
                <span className="block font-semibold">{point.context}</span>
                <span className="block truncate text-xs text-content-muted">{point.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
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
