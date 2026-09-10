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
        <h2 className="font-semibold text-content">Stats</h2>
        <p className="text-xs text-content-muted">Existing stat views</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          to={teamLeaderboardPath(teamId, seasonId, true)}
          className="rounded-xl border border-line bg-surface px-3 py-3 text-sm font-semibold text-content hover:border-info-line"
        >
          Season Stats
        </Link>
        <Link
          to={teamStatsPath(teamId)}
          className="rounded-xl border border-line bg-surface px-3 py-3 text-sm font-semibold text-content hover:border-info-line"
        >
          Team Stats
        </Link>
        {firstTournamentId && (
          <Link
            to={`/tournament-stats?tournamentId=${encodeURIComponent(firstTournamentId)}&teamId=${encodeURIComponent(teamId)}`}
            className="rounded-xl border border-line bg-surface px-3 py-3 text-sm font-semibold text-content hover:border-info-line sm:col-span-2"
          >
            Tournament Stats
          </Link>
        )}
      </div>
    </section>
  )
}
