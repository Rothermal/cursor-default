import { Link } from 'react-router-dom'

export interface TeamInfoTournament {
  id: string
  name: string
  placement: number | null
  url: string | null
}

interface TournamentCardProps {
  teamId: string
  tournaments: TeamInfoTournament[]
  error?: string | null
}

export default function TournamentCard({ teamId, tournaments, error }: TournamentCardProps) {
  return (
    <section className="card min-w-0 space-y-3">
      <div>
        <h2 className="font-semibold text-content">Tournaments</h2>
        <p className="text-xs text-content-muted">{tournaments.length} linked tournaments</p>
      </div>

      {error ? (
        <p className="text-sm text-content-muted">{error}</p>
      ) : tournaments.length === 0 ? (
        <p className="text-sm text-content-muted">No tournaments linked yet.</p>
      ) : (
        <div className="space-y-2">
          {tournaments.slice(0, 3).map(tournament => (
            <Link
              key={tournament.id}
              to={`/tournament-stats?tournamentId=${encodeURIComponent(tournament.id)}&teamId=${encodeURIComponent(teamId)}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 hover:border-info-line"
            >
              <span className="font-medium text-content truncate">{tournament.name}</span>
              {tournament.placement != null && (
                <span className="shrink-0 text-xs font-semibold text-content-muted">
                  Place {tournament.placement}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
