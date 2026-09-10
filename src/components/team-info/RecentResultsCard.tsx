import type { TeamGameResult } from '../../lib/teamInfo'
import GameCard from './GameCard'

export interface TeamInfoResultGame {
  id: string
  game_date: string
  opponent_name: string
  tournament_name: string | null
  scoreLine: string | null
  result: TeamGameResult | null
}

interface RecentResultsCardProps {
  games: TeamInfoResultGame[]
  teamId?: string
}

export default function RecentResultsCard({ games, teamId }: RecentResultsCardProps) {
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold text-content">Recent Results</h2>
        <p className="text-xs text-content-muted">{games.length} recent finals</p>
      </div>

      {games.length === 0 ? (
        <p className="text-sm text-content-muted">No finalized games yet.</p>
      ) : (
        <div className="space-y-2">
          {games.map(game => (
            <GameCard key={game.id} game={{ ...game, status: 'final' }} teamId={teamId} />
          ))}
        </div>
      )}
    </section>
  )
}
