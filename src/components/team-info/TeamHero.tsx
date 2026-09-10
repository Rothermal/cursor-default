import { Link } from 'react-router-dom'
import type { TeamRecord } from '../../lib/teamInfo'
import RecordBadge from './RecordBadge'

interface TeamHeroProps {
  teamName: string
  legalName?: string | null
  seasonName: string
  seasonHref?: string
  sportName: string
  sportIcon?: string
  record: TeamRecord
  rosterCount: number
  gameCount: number
}

export default function TeamHero({
  teamName,
  legalName,
  seasonName,
  seasonHref,
  sportName,
  sportIcon,
  record,
  rosterCount,
  gameCount,
}: TeamHeroProps) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-content-muted">
            {sportIcon ? `${sportIcon} ` : ''}
            {sportName}
            {seasonName && ' / '}
            {seasonName && seasonHref ? (
              <Link to={seasonHref} className="text-accent hover:text-accent-hover">
                {seasonName}
              </Link>
            ) : (
              seasonName
            )}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-content break-words">{teamName}</h1>
          {legalName && legalName !== teamName && (
            <p className="mt-1 text-sm text-content-muted break-words">{legalName}</p>
          )}
        </div>
        <RecordBadge record={record} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-surface-muted px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">Roster</p>
          <p className="text-lg font-bold text-content">{rosterCount}</p>
        </div>
        <div className="rounded-lg bg-surface-muted px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">Games</p>
          <p className="text-lg font-bold text-content">{gameCount}</p>
        </div>
        <div className="rounded-lg bg-surface-muted px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">Finals</p>
          <p className="text-lg font-bold text-content">{record.gamesPlayed}</p>
        </div>
      </div>
    </section>
  )
}
