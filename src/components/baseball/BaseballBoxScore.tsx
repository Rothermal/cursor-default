import type { ReactNode } from 'react'
import type {
  BaseballBoxBatting,
  BaseballBoxFielding,
  BaseballBoxNote,
  BaseballBoxPitching,
  BaseballBoxScore as BaseballBoxScoreModel,
  BaseballTeamNames,
} from '../../lib/baseball'

/** Read-only box score tables for the Baseball Summary (BSB-5A). */
export default function BaseballBoxScore({
  box,
  names,
  onOpenPlayer,
}: {
  box: BaseballBoxScoreModel
  names: BaseballTeamNames
  onOpenPlayer: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      <BattingTable title={`${names.tracked} batting`} batting={box.batting.tracked} onOpenPlayer={onOpenPlayer} />
      <BattingTable title={`${names.opponent} batting`} batting={box.batting.opponent} />
      <PitchingTable title={`${names.tracked} pitching`} pitching={box.pitching.tracked} onOpenPlayer={onOpenPlayer} />
      <PitchingTable title={`${names.opponent} pitching`} pitching={box.pitching.opponent} />
      <FieldingTable title={`${names.tracked} fielding`} fielding={box.fielding} onOpenPlayer={onOpenPlayer} />
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-surface p-3" aria-label={title}>
      <h2 className="mb-2 font-bold text-content">{title}</h2>
      {children}
    </section>
  )
}

function Notes({ notes, extra }: { notes: BaseballBoxNote[]; extra?: string | null }) {
  if (notes.length === 0 && !extra) return null
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-content-muted">
      {notes.map(note => (
        <li key={note.label}>
          <span className="font-semibold text-content">{note.label}:</span> {note.text}
        </li>
      ))}
      {extra && <li>{extra}</li>}
    </ul>
  )
}

function PlayerCell({
  name,
  position,
  indent = false,
  onOpen,
}: {
  name: string
  position: string
  indent?: boolean
  onOpen?: () => void
}) {
  const label = (
    <>
      <span className="truncate">{name}</span>
      {position && <span className="shrink-0 text-xs font-normal text-content-muted">{position}</span>}
    </>
  )
  return (
    <th scope="row" className={`py-1 pr-2 text-left font-semibold ${indent ? 'pl-4' : 'pl-0'}`}>
      {onOpen ? (
        <button type="button" className="flex min-h-8 w-full max-w-[7.5rem] items-center gap-1.5 text-left text-content underline-offset-2 hover:underline" onClick={onOpen}>
          {label}
        </button>
      ) : (
        <span className="flex min-h-8 max-w-[7.5rem] items-center gap-1.5 text-content">{label}</span>
      )}
    </th>
  )
}

function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-max text-right text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-xs text-content-muted">
            {head.map((label, index) => (
              <th key={label} scope="col" className={`whitespace-nowrap px-1.5 font-semibold ${index === 0 ? 'pl-0 text-left' : 'w-8'}`}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function BattingTable({ title, batting, onOpenPlayer }: { title: string; batting: BaseballBoxBatting; onOpenPlayer?: (id: string) => void }) {
  return (
    <Card title={title}>
      <Table caption={title} head={['Batter', 'AB', 'R', 'H', 'RBI', 'BB', 'K']}>
        {batting.rows.map(row => (
          <tr key={row.id} className="border-t border-line">
            <PlayerCell
              name={row.name}
              position={row.position}
              indent={row.substitute}
              onOpen={row.tracked && onOpenPlayer ? () => onOpenPlayer(row.id) : undefined}
            />
            <td className="px-1.5">{row.line.ab}</td>
            <td className="px-1.5">{row.line.r}</td>
            <td className="px-1.5">{row.line.h}</td>
            <td className="px-1.5">{row.line.rbi}</td>
            <td className="px-1.5">{row.line.bb}</td>
            <td className="px-1.5">{row.line.k}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-line-strong font-bold text-content">
          <th scope="row" className="py-1 pl-0 text-left">Totals</th>
          <td className="px-1.5">{batting.totals.ab}</td>
          <td className="px-1.5">{batting.totals.r}</td>
          <td className="px-1.5">{batting.totals.h}</td>
          <td className="px-1.5">{batting.totals.rbi}</td>
          <td className="px-1.5">{batting.totals.bb}</td>
          <td className="px-1.5">{batting.totals.k}</td>
        </tr>
      </Table>
      <Notes notes={batting.notes} extra={`LOB: ${batting.leftOnBase}`} />
    </Card>
  )
}

function PitchingTable({ title, pitching, onOpenPlayer }: { title: string; pitching: BaseballBoxPitching; onOpenPlayer?: (id: string) => void }) {
  const pitches = (count: number, strikes: number, lowerBound: boolean) => `${lowerBound ? '≥' : ''}${count}-${strikes}`
  return (
    <Card title={title}>
      <Table caption={title} head={['Pitcher', 'IP', 'H', 'R', 'ER', 'BB', 'K', 'PC-ST']}>
        {pitching.rows.map(row => (
          <tr key={row.id} className="border-t border-line">
            <PlayerCell
              name={row.name}
              position=""
              onOpen={row.tracked && onOpenPlayer ? () => onOpenPlayer(row.id) : undefined}
            />
            <td className="px-1">{row.ip}</td>
            <td className="px-1">{row.line.h}</td>
            <td className="px-1">{row.line.r}</td>
            <td className="px-1">{row.line.er}</td>
            <td className="px-1">{row.line.bb}</td>
            <td className="px-1">{row.line.k}</td>
            <td className="px-1 whitespace-nowrap">{pitches(row.line.pitches, row.line.strikes, row.pitchesLowerBound)}</td>
          </tr>
        ))}
        {pitching.rows.length > 1 && (
          <tr className="border-t-2 border-line-strong font-bold text-content">
            <th scope="row" className="py-1 pl-0 text-left">Totals</th>
            <td className="px-1">{pitching.totals.ip}</td>
            <td className="px-1">{pitching.totals.h}</td>
            <td className="px-1">{pitching.totals.r}</td>
            <td className="px-1">{pitching.totals.er}</td>
            <td className="px-1">{pitching.totals.bb}</td>
            <td className="px-1">{pitching.totals.k}</td>
            <td className="px-1 whitespace-nowrap">{pitches(pitching.totals.pitches, pitching.totals.strikes, pitching.pitchesLowerBound)}</td>
          </tr>
        )}
      </Table>
      <Notes notes={pitching.notes} />
      {pitching.pitchesLowerBound && (
        <p className="mt-2 text-xs text-content-muted">
          ≥ Some plate appearances were recorded without every pitch, so the pitch count is at least this.
        </p>
      )}
    </Card>
  )
}

function FieldingTable({ title, fielding, onOpenPlayer }: { title: string; fielding: BaseballBoxFielding; onOpenPlayer: (id: string) => void }) {
  return (
    <Card title={title}>
      <Table caption={title} head={['Fielder', 'PO', 'A', 'E']}>
        {fielding.rows.map(row => (
          <tr key={row.id} className="border-t border-line">
            <PlayerCell name={row.name} position={row.position} onOpen={() => onOpenPlayer(row.id)} />
            <td className="px-1.5">{row.line.po}</td>
            <td className="px-1.5">{row.line.a}</td>
            <td className="px-1.5">{row.line.e}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-line-strong font-bold text-content">
          <th scope="row" className="py-1 pl-0 text-left">Totals</th>
          <td className="px-1.5">{fielding.totals.po}</td>
          <td className="px-1.5">{fielding.totals.a}</td>
          <td className="px-1.5">{fielding.totals.e}</td>
        </tr>
      </Table>
      <Notes notes={fielding.notes} />
    </Card>
  )
}
