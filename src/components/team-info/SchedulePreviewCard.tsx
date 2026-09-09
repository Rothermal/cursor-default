import { Link } from 'react-router-dom'
import { teamSchedulePath } from '../../lib/teamInfo'
import GameCard, { type TeamInfoGameCardGame } from './GameCard'

export type TeamInfoScheduleGame = TeamInfoGameCardGame & {
  tournament_id: string | null
}

interface SchedulePreviewCardProps {
  games: TeamInfoScheduleGame[]
  teamId?: string
  title?: string
  emptyText?: string
}

export default function SchedulePreviewCard({
  games,
  teamId,
  title = 'Schedule',
  emptyText = 'No upcoming games.',
}: SchedulePreviewCardProps) {
  return (
    <section className="card min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-content">{title}</h2>
          <p className="text-xs text-content-muted">{games.length} games ahead</p>
        </div>
        <Link
          to={teamId ? teamSchedulePath(teamId) : '/games'}
          className="text-xs font-semibold text-accent"
        >
          {teamId ? 'View schedule' : 'Cloud Games'}
        </Link>
      </div>

      {games.length === 0 ? (
        <p className="text-sm text-content-muted">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {games.map(game => (
            <GameCard key={game.id} game={game} teamId={teamId} />
          ))}
        </div>
      )}
    </section>
  )
}
