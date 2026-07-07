import { Link } from 'react-router-dom'

export interface TeamInfoScheduleGame {
  id: string
  game_date: string
  opponent_name: string
  status: string
  tournament_name: string | null
  tournament_id: string | null
}

interface SchedulePreviewCardProps {
  games: TeamInfoScheduleGame[]
  title?: string
  emptyText?: string
}

function statusLabel(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'Live'
    case 'scheduled':
      return 'Scheduled'
    default:
      return status
  }
}

export default function SchedulePreviewCard({
  games,
  title = 'Schedule',
  emptyText = 'No upcoming games.',
}: SchedulePreviewCardProps) {
  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <p className="text-xs text-slate-500">{games.length} games ahead</p>
        </div>
        <Link to="/games" className="text-xs font-semibold text-blue-600">
          Cloud Games
        </Link>
      </div>

      {games.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {games.map(game => (
            <div key={game.id} className="rounded-xl border border-slate-100 bg-white px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate">vs {game.opponent_name}</p>
                  <p className="text-xs text-slate-500">{game.game_date}</p>
                </div>
                <span className="shrink-0 rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                  {statusLabel(game.status)}
                </span>
              </div>
              {game.tournament_name && (
                <p className="mt-1 text-xs text-slate-500 truncate">{game.tournament_name}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
