import { Link } from 'react-router-dom'
import { teamLeaderboardPath, teamStatsPath } from '../../lib/teamInfo'

interface QuickStatsCardProps {
  teamId: string
  seasonId: string
  firstTournamentId?: string | null
}

export default function QuickStatsCard({ teamId, seasonId, firstTournamentId }: QuickStatsCardProps) {
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold text-slate-800">Stats</h2>
        <p className="text-xs text-slate-500">Existing stat views</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          to={teamLeaderboardPath(teamId, seasonId, true)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:border-blue-300"
        >
          Season Stats
        </Link>
        <Link
          to={teamStatsPath(teamId)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:border-blue-300"
        >
          Team Stats
        </Link>
        {firstTournamentId && (
          <Link
            to={`/tournament-stats?tournamentId=${encodeURIComponent(firstTournamentId)}&teamId=${encodeURIComponent(teamId)}`}
            className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:border-blue-300 sm:col-span-2"
          >
            Tournament Stats
          </Link>
        )}
      </div>
    </section>
  )
}
