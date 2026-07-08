import { Link } from 'react-router-dom'
import { gameInfoPath, type TeamGameResult } from '../../lib/teamInfo'
import ResultBadge from './ResultBadge'

export interface TeamInfoGameCardGame {
  id: string
  team_id?: string
  game_date: string
  opponent_name: string
  status: string
  tournament_name: string | null
  scoreLine?: string | null
  result?: TeamGameResult | null
}

interface GameCardProps {
  game: TeamInfoGameCardGame
  teamId?: string
}

function statusLabel(status: string): string {
  switch (status) {
    case 'final':
      return 'Final'
    case 'in_progress':
      return 'Live'
    case 'scheduled':
      return 'Scheduled'
    default:
      return status
  }
}

export default function GameCard({ game, teamId }: GameCardProps) {
  const resolvedTeamId = teamId ?? game.team_id ?? null

  return (
    <Link
      to={gameInfoPath(game.id, resolvedTeamId)}
      className="block rounded-lg border border-slate-100 bg-white px-3 py-2 hover:border-blue-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-800 truncate">vs {game.opponent_name}</p>
          <p className="text-xs text-slate-500">{game.game_date}</p>
        </div>
        {game.status === 'final' ? (
          <ResultBadge result={game.result ?? null} scoreLine={game.scoreLine ?? null} />
        ) : (
          <span className="shrink-0 rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
            {statusLabel(game.status)}
          </span>
        )}
      </div>
      {game.tournament_name && (
        <p className="mt-1 text-xs text-slate-500 truncate">{game.tournament_name}</p>
      )}
    </Link>
  )
}
