import { X } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import type { GameEvent } from '../../lib/gameEvents/types'
import { HOCKEY_FACEOFF_DOTS, HOCKEY_RINK_LENGTH_FT, HOCKEY_RINK_WIDTH_FT } from '../../lib/hockey/rinkGeometry'
import {
  activeHockeyShotMapFilterCount,
  DEFAULT_HOCKEY_FACEOFF_MAP_FILTERS,
  DEFAULT_HOCKEY_SHOT_MAP_FILTERS,
  HOCKEY_FACEOFF_MAP_DOT_ORDER,
  HOCKEY_SHOT_MAP_OUTCOMES,
  HOCKEY_SHOT_MAP_STRENGTHS,
  hockeyFaceoffMap,
  hockeyShotMap,
  hockeyShotMapShots,
  type HockeyFaceoffMapFilters,
  type HockeyFaceoffTally,
  type HockeyShotMapCluster,
  type HockeyShotMapFilters,
  type HockeyShotMapShot,
  type HockeyShotMapStrength,
  type HockeySummaryNames,
} from '../../lib/hockey/summaryRink'
import { HOCKEY_SHOOTOUT_OUTCOME_LABELS, type HockeyShootoutSummary } from '../../lib/hockey/summaryShootout'
import type { HockeyShotOutcome, HockeySportGameState } from '../../lib/hockey/types'
import HockeyRink, { type HockeyRinkMarker } from './HockeyRink'

/**
 * Summary review tabs (HKY-6A2): the shot map, the faceoff map and the shootout. All read
 * only; a mark or row opens the Timeline's read-only detail through `onOpen`.
 */

const OUTCOME_WORDS: Record<HockeyShotOutcome, string> = { goal: 'goal', saved: 'saved shot', missed: 'missed shot', blocked: 'blocked shot' }

export function HockeyShotMapView({ sport, events, names, onOpen }: {
  sport: HockeySportGameState
  events: readonly GameEvent[]
  names: HockeySummaryNames
  onOpen: (eventId: string) => void
}) {
  const [filters, setFilters] = useState<HockeyShotMapFilters>(DEFAULT_HOCKEY_SHOT_MAP_FILTERS)
  const [chooser, setChooser] = useState<HockeyShotMapCluster | null>(null)
  const all = useMemo(() => hockeyShotMapShots(sport.setup, events, names), [sport.setup, events, names])
  const map = hockeyShotMap(sport.setup, all, filters)
  const filterCount = activeHockeyShotMapFilterCount(filters)
  const update = (changes: Partial<HockeyShotMapFilters>) => setFilters(current => ({ ...current, ...changes }))
  const markers: HockeyRinkMarker[] = map.clusters.map(cluster => {
    const first = cluster.shots[0]
    if (cluster.shots.length > 1) {
      return { id: cluster.id, x: cluster.x, y: cluster.y, teamSide: first.side, kind: 'cluster', count: cluster.shots.length, label: `${cluster.shots.length} shots here` }
    }
    return { id: cluster.id, x: cluster.x, y: cluster.y, teamSide: first.side, kind: first.outcome, label: shotLabel(first, names) }
  })

  return (
    <div className="space-y-3">
      <details className="rounded-md border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-semibold text-content">
          <span>Filters</span>
          <span className="text-xs font-normal text-content-muted">
            {filterCount === 0 ? 'All shots' : `${filterCount} on`} · {map.shots.length} shown
          </span>
        </summary>
        <div className="space-y-3 border-t border-line p-3">
          <div className="grid grid-cols-3 gap-1 rounded-md bg-control p-1" role="group" aria-label="Team">
            {(['all', 'tracked', 'opponent'] as const).map(side => (
              <button
                key={side}
                type="button"
                aria-pressed={filters.side === side}
                onClick={() => update({ side, participantId: side === 'opponent' ? null : filters.participantId })}
                className={`min-h-9 truncate rounded px-2 text-sm font-semibold ${filters.side === side ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
              >
                {side === 'all' ? 'Both' : names[side]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Outcomes">
            {HOCKEY_SHOT_MAP_OUTCOMES.map(outcome => {
              const pressed = filters.outcomes.includes(outcome.id)
              return (
                <button
                  key={outcome.id}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => update({
                    outcomes: pressed ? filters.outcomes.filter(entry => entry !== outcome.id) : [...filters.outcomes, outcome.id],
                  })}
                  className={`min-h-9 rounded-full border px-3 text-sm ${pressed ? 'border-accent bg-accent text-accent-content' : 'border-line-strong text-content'}`}
                >
                  {outcome.label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1 text-xs font-semibold text-content-muted">
              <span>Player</span>
              <select
                className="input-field w-full"
                value={filters.participantId ?? ''}
                onChange={event => update({ participantId: event.target.value || null, side: event.target.value ? 'tracked' : filters.side })}
              >
                <option value="">All players</option>
                {map.shooters.map(shooter => <option key={shooter.id} value={shooter.id}>{shooter.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-content-muted">
              <span>Period</span>
              <select className="input-field w-full" value={filters.periodId ?? ''} onChange={event => update({ periodId: event.target.value || null })}>
                <option value="">All periods</option>
                {map.periods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-content-muted">
              <span>Strength</span>
              <select
                className="input-field w-full"
                value={filters.strength}
                onChange={event => update({ strength: event.target.value as HockeyShotMapStrength | 'all' })}
              >
                <option value="all">All</option>
                {HOCKEY_SHOT_MAP_STRENGTHS.map(strength => <option key={strength} value={strength}>{strength}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-content-muted">Strength is recorded on goals only, so a strength filter shows goals.</p>
            {filterCount > 0 && (
              <button type="button" className="btn-secondary shrink-0 px-3 text-sm" onClick={() => setFilters(DEFAULT_HOCKEY_SHOT_MAP_FILTERS)}>Clear</button>
            )}
          </div>
        </div>
      </details>

      <section className="rounded-md border border-line bg-surface p-3" aria-label="Shot map">
        <HockeyRink
          trackedDirection="left_to_right"
          flipped={false}
          trapezoid={sport.setup.rulesSnapshot.trapezoid}
          markers={markers}
          onMarker={id => {
            const cluster = map.clusters.find(entry => entry.id === id)
            if (!cluster) return
            if (cluster.shots.length === 1) onOpen(cluster.shots[0].eventId)
            else setChooser(cluster)
          }}
          trackedLabel={names.tracked}
          opponentLabel={names.opponent}
        />
        <p className="mt-2 text-xs text-content-muted">
          Shots by {names.opponent} are at the left end. Filled circle: goal; ring: saved; cross: missed; square: blocked; a number: shots in one spot.
        </p>
      </section>

      <section className="rounded-md border border-line bg-surface p-3" aria-label="Shots without a location">
        <h2 className="font-bold text-content">Not located: {map.unlocated.length}</h2>
        {map.unlocated.length > 0 && (
          <ul className="mt-2 divide-y divide-line text-sm">
            {map.unlocated.map(shot => (
              <li key={shot.eventId}>
                <ShotButton shot={shot} names={names} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {chooser && (
        <ChooserDialog title={`${chooser.shots.length} shots here`} onClose={() => setChooser(null)}>
          <ul className="divide-y divide-line text-sm">
            {chooser.shots.map(shot => (
              <li key={shot.eventId}>
                <ShotButton shot={shot} names={names} onOpen={id => { setChooser(null); onOpen(id) }} />
              </li>
            ))}
          </ul>
        </ChooserDialog>
      )}
    </div>
  )
}

export function HockeyFaceoffMapView({ sport, events, names }: {
  sport: HockeySportGameState
  events: readonly GameEvent[]
  names: HockeySummaryNames
}) {
  const [filters, setFilters] = useState<HockeyFaceoffMapFilters>(DEFAULT_HOCKEY_FACEOFF_MAP_FILTERS)
  const map = hockeyFaceoffMap(sport.setup, events, filters)
  const overlay = HOCKEY_FACEOFF_MAP_DOT_ORDER.map(({ id }) => {
    const tally = map.dots[id]
    if (tally.won + tally.lost === 0) return null
    const x = HOCKEY_FACEOFF_DOTS[id].x * HOCKEY_RINK_LENGTH_FT
    const y = HOCKEY_FACEOFF_DOTS[id].y * HOCKEY_RINK_WIDTH_FT
    return (
      <g key={id} aria-hidden="true" fontSize="5" fontWeight="700" textAnchor="middle" fill="rgb(var(--rink-ink))"
        stroke="rgb(var(--rink-ice))" strokeWidth="1.4" paintOrder="stroke">
        <text x={x} y={y - 3.2}>{tally.won}-{tally.lost}</text>
        <text x={x} y={y + 7}>{tally.percent}%</text>
      </g>
    )
  })

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs font-semibold text-content-muted">
          <span>Taker</span>
          <select className="input-field w-full" value={filters.participantId ?? ''} onChange={event => setFilters(current => ({ ...current, participantId: event.target.value || null }))}>
            <option value="">Whole team</option>
            {map.takers.map(taker => <option key={taker.id} value={taker.id}>{taker.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-content-muted">
          <span>Period</span>
          <select className="input-field w-full" value={filters.periodId ?? ''} onChange={event => setFilters(current => ({ ...current, periodId: event.target.value || null }))}>
            <option value="">All periods</option>
            {map.periods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}
          </select>
        </label>
      </div>

      <section className="rounded-md border border-line bg-surface p-3" aria-label="Faceoff map">
        <p className="mb-1 text-sm font-semibold text-content">
          {names.tracked}: {tallyText(map.total)}
        </p>
        <HockeyRink
          trackedDirection="left_to_right"
          flipped={false}
          trapezoid={sport.setup.rulesSnapshot.trapezoid}
          trackedLabel={names.tracked}
          opponentLabel={names.opponent}
          overlay={overlay}
        />
        <p className="mt-2 text-xs text-content-muted">Won-lost and % for {names.tracked} at each dot, from every period's end turned to one direction.</p>
      </section>

      <section className="rounded-md border border-line bg-surface p-3" aria-label="Faceoffs by dot">
        <table className="w-full text-sm tabular-nums">
          <caption className="sr-only">Faceoffs won and lost at each dot</caption>
          <thead>
            <tr className="text-xs text-content-muted">
              <th scope="col" className="text-left font-semibold">Dot</th>
              <th scope="col" className="whitespace-nowrap pl-3 text-right font-semibold">Won-lost</th>
              <th scope="col" className="w-14 pl-3 text-right font-semibold">%</th>
            </tr>
          </thead>
          <tbody>
            {HOCKEY_FACEOFF_MAP_DOT_ORDER.map(({ id, label }) => {
              const tally = map.dots[id]
              return (
                <tr key={id} className="border-t border-line text-content">
                  <th scope="row" className="py-1 text-left font-normal">{label}</th>
                  <td className="py-1 pl-3 text-right">{tally.won}-{tally.lost}</td>
                  <td className="py-1 pl-3 text-right">{tally.percent === null ? '–' : `${tally.percent}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}

export function HockeyShootoutView({ summary, names, onOpen }: {
  summary: HockeyShootoutSummary
  names: HockeySummaryNames
  onOpen: (eventId: string) => void
}) {
  return (
    <div className="space-y-3">
      <section className="space-y-1 rounded-md border border-line bg-surface p-3" aria-label="Shootout result">
        <h2 className="text-xl font-bold tabular-nums text-content">
          {names.tracked} {summary.goals.tracked}-{summary.goals.opponent} {names.opponent}
        </h2>
        <p className="text-sm text-content-muted">
          {summary.winner ? `Won by ${names[summary.winner]}` : 'Not decided'} · {names[summary.firstSide]} shot first
          {summary.rounds > 0 ? ` · ${summary.rounds} rounds, then sudden death` : ''}
        </p>
        <p className="text-xs text-content-muted">Shootout attempts are not shots, goals or saves in any other total.</p>
      </section>

      <section className="rounded-md border border-line bg-surface p-3" aria-label="Shootout rounds">
        {summary.roundRows.length === 0 ? (
          <p className="text-sm text-content-muted">No attempts yet.</p>
        ) : (
          <ol className="space-y-3">
            {summary.roundRows.map(row => (
              <li key={row.round}>
                <h3 className="text-xs font-bold uppercase text-content-muted">
                  Round {row.round}{row.suddenDeath ? ' · sudden death' : ''}
                </h3>
                <ul className="mt-1 divide-y divide-line text-sm">
                  {row.attempts.map(attempt => (
                    <li key={attempt.eventId}>
                      <button type="button" className="flex min-h-11 w-full items-center gap-2 py-1 text-left" onClick={() => onOpen(attempt.eventId)}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-content">
                            <span className="font-semibold">{attempt.shooter}</span>
                            <span className="text-xs text-content-muted"> {names[attempt.side]}</span>
                          </span>
                          <span className="block truncate text-xs text-content-muted">On {attempt.goalie}</span>
                        </span>
                        {attempt.deciding && (
                          <span className="rounded border border-line px-1 text-xs font-semibold text-content-muted">Deciding</span>
                        )}
                        <span className={`w-14 text-right font-semibold ${attempt.outcome === 'goal' ? 'text-content' : 'text-content-muted'}`}>
                          {HOCKEY_SHOOTOUT_OUTCOME_LABELS[attempt.outcome]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      {(summary.shooters.length > 0 || summary.goalies.length > 0) && (
        <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label={`${names.tracked} shootout lines`}>
          <h2 className="font-bold text-content">{names.tracked}</h2>
          {summary.shooters.length > 0 && (
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Shooters</caption>
              <thead>
                <tr className="text-xs text-content-muted">
                  <th scope="col" className="text-left font-semibold">Shooter</th>
                  <th scope="col" className="text-right font-semibold">Att</th>
                  <th scope="col" className="text-right font-semibold">G</th>
                </tr>
              </thead>
              <tbody>
                {summary.shooters.map(line => (
                  <tr key={line.participantId} className="border-t border-line text-content">
                    <th scope="row" className="py-1 text-left font-semibold">{line.name}</th>
                    <td className="py-1 text-right">{line.attempts}</td>
                    <td className="py-1 text-right">{line.goals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {summary.goalies.length > 0 && (
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Goalies</caption>
              <thead>
                <tr className="text-xs text-content-muted">
                  <th scope="col" className="text-left font-semibold">Goalie</th>
                  <th scope="col" className="text-right font-semibold">SA</th>
                  <th scope="col" className="text-right font-semibold">SV</th>
                </tr>
              </thead>
              <tbody>
                {summary.goalies.map(line => (
                  <tr key={line.participantId} className="border-t border-line text-content">
                    <th scope="row" className="py-1 text-left font-semibold">{line.name}</th>
                    <td className="py-1 text-right">{line.shotsAgainst}</td>
                    <td className="py-1 text-right">{line.saves}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-content-muted">SA counts attempts on goal; a missed attempt is not one.</p>
        </section>
      )}
    </div>
  )
}

function ShotButton({ shot, names, onOpen }: { shot: HockeyShotMapShot; names: HockeySummaryNames; onOpen: (eventId: string) => void }) {
  return (
    <button type="button" className="flex min-h-11 w-full items-center gap-2 py-1 text-left" onClick={() => onOpen(shot.eventId)}>
      <span className="w-20 shrink-0 text-xs text-content-muted">{shot.periodLabel}</span>
      <span className="min-w-0 flex-1 truncate text-content">{shot.shooter}</span>
      <span className="shrink-0 text-xs text-content-muted">
        {names[shot.side]} · {HOCKEY_SHOT_MAP_OUTCOMES.find(entry => entry.id === shot.outcome)?.label}
        {shot.strength && shot.strength !== 'EV' ? ` ${shot.strength}` : ''}
      </span>
    </button>
  )
}

function ChooserDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/[0.5] sm:items-center"
      onClick={onClose}
      onKeyDown={event => { if (event.key === 'Escape') onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-lg bg-surface sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <header className="sticky top-0 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <h2 id={titleId} className="min-w-0 flex-1 truncate font-bold text-content">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-content-muted" aria-label="Close" title="Close" autoFocus>
            <X size={20} />
          </button>
        </header>
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  )
}

function shotLabel(shot: HockeyShotMapShot, names: HockeySummaryNames): string {
  return `${names[shot.side]} ${OUTCOME_WORDS[shot.outcome]} by ${shot.shooter}, ${shot.periodLabel}`
}

function tallyText(tally: HockeyFaceoffTally): string {
  if (tally.won + tally.lost === 0) return 'no faceoffs'
  return `${tally.won}-${tally.lost} (${tally.percent}%)`
}
