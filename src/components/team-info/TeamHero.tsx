import type { TeamRecord } from '../../lib/teamInfo'
import RecordBadge from './RecordBadge'

interface TeamHeroProps {
  teamName: string
  legalName?: string | null
  seasonName: string
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
  sportName,
  sportIcon,
  record,
  rosterCount,
  gameCount,
}: TeamHeroProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">
            {sportIcon ? `${sportIcon} ` : ''}{sportName}{seasonName ? ` / ${seasonName}` : ''}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 break-words">{teamName}</h1>
          {legalName && legalName !== teamName && (
            <p className="mt-1 text-sm text-slate-500 break-words">{legalName}</p>
          )}
        </div>
        <RecordBadge record={record} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Roster</p>
          <p className="text-lg font-bold text-slate-800">{rosterCount}</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Games</p>
          <p className="text-lg font-bold text-slate-800">{gameCount}</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Finals</p>
          <p className="text-lg font-bold text-slate-800">{record.gamesPlayed}</p>
        </div>
      </div>
    </section>
  )
}
