import { AlertTriangle } from 'lucide-react'
import { Fragment } from 'react'
import type { BaseballPitchCountRow, BaseballPitchCounts as BaseballPitchCountsModel, BaseballTeamNames } from '../../lib/baseball'

interface BaseballPitchCountsProps {
  counts: BaseballPitchCountsModel[]
  names: BaseballTeamNames
}

/**
 * Pitch counts per pitcher (BSB-5C). The totals are the tracker's: recorded pitches plus the
 * Quick PA estimate, marked "≥" when an estimate is included. The line under each pitcher
 * splits that total and flags a reached warning or limit.
 */
export default function BaseballPitchCounts({ counts, names }: BaseballPitchCountsProps) {
  return (
    <section className="space-y-3" aria-label="Pitch counts">
      <h2 className="font-bold text-content">Pitch counts</h2>
      {counts.map(group => (
        <div key={group.side} className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-1 truncate text-sm font-bold text-content">{names[group.side]}</h3>
          {group.rows.length === 0 ? (
            <p className="text-sm text-content-muted">No pitches yet.</p>
          ) : (
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">{names[group.side]} pitch counts</caption>
              <thead>
                <tr className="text-xs text-content-muted">
                  <th scope="col" className="text-left font-semibold">Pitcher</th>
                  <th scope="col" className="w-10 whitespace-nowrap px-1 text-right font-semibold">P</th>
                  <th scope="col" className="w-8 px-1 text-right font-semibold">S</th>
                  <th scope="col" className="w-8 px-1 text-right font-semibold">B</th>
                  <th scope="col" className="w-8 px-1 text-right font-semibold">BF</th>
                  <th scope="col" className="w-11 whitespace-nowrap pl-1 text-right font-semibold">Str%</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(row => (
                  <Fragment key={row.id}>
                    <tr className="border-t border-line text-content">
                      <th scope="row" className="max-w-[7.5rem] truncate pt-1.5 text-left font-semibold">{row.name}</th>
                      <td className="whitespace-nowrap px-1 pt-1.5 text-right font-bold">{row.lowerBound ? '≥' : ''}{row.pitches}</td>
                      <td className="px-1 pt-1.5 text-right">{row.strikes}</td>
                      <td className="px-1 pt-1.5 text-right">{row.balls}</td>
                      <td className="px-1 pt-1.5 text-right">{row.battersFaced}</td>
                      <td className="pl-1 pt-1.5 text-right">{row.strikePercent === null ? '–' : `${row.strikePercent}%`}</td>
                    </tr>
                    <tr>
                      <td colSpan={6} className="pb-1.5 text-xs text-content-muted">
                        <Breakdown row={row} />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      <p className="text-xs text-content-muted">
        Totals match the tracker. "≥" means some plate appearances were entered with Quick PA, so pitches
        that were not recorded one by one are estimated from the final count.
      </p>
    </section>
  )
}

function Breakdown({ row }: { row: BaseballPitchCountRow }) {
  const parts = [
    `Recorded ${row.recorded}`,
    row.estimated > 0 ? `estimated ${row.estimated}` : null,
    row.untrackedPlateAppearances > 0 ? `untracked PA ${row.untrackedPlateAppearances}` : null,
    row.unlocated > 0 ? `${row.unlocated} without location` : null,
  ].filter(Boolean)
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span>{parts.join(' · ')}</span>
      {row.alert && (
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${
            row.alert.kind === 'limit' ? 'bg-danger text-danger-content' : 'bg-warning text-warning-content'
          }`}
        >
          <AlertTriangle size={12} aria-hidden="true" />
          {row.alert.kind === 'limit' ? `Limit ${row.alert.threshold} reached` : `Reached ${row.alert.threshold}`}
        </span>
      )}
    </span>
  )
}
