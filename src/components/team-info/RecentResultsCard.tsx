import ResultBadge from './ResultBadge'
import type { TeamGameResult } from '../../lib/teamInfo'

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
}

export default function RecentResultsCard({ games }: RecentResultsCardProps) {
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold text-slate-800">Recent Results</h2>
        <p className="text-xs text-slate-500">{games.length} recent finals</p>
      </div>

      {games.length === 0 ? (
        <p className="text-sm text-slate-500">No finalized games yet.</p>
      ) : (
        <div className="space-y-2">
          {games.map(game => (
            <div key={game.id} className="rounded-xl border border-slate-100 bg-white px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate">vs {game.opponent_name}</p>
                  <p className="text-xs text-slate-500">{game.game_date}</p>
                </div>
                <ResultBadge result={game.result} scoreLine={game.scoreLine} />
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
