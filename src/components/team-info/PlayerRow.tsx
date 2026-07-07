import { Link } from 'react-router-dom'
import { playerDisplayName } from '../../lib/display'

export interface TeamInfoRosterPlayer {
  id: string
  first_name: string
  last_name: string | null
  nickname: string | null
  jersey_number: string | null
}

interface PlayerRowProps {
  teamId: string
  player: TeamInfoRosterPlayer
}

export default function PlayerRow({ teamId, player }: PlayerRowProps) {
  return (
    <Link
      to={`/player?playerId=${encodeURIComponent(player.id)}&teamId=${encodeURIComponent(teamId)}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 hover:border-blue-200"
    >
      <div className="min-w-0">
        <p className="font-medium text-slate-800 truncate">{playerDisplayName(player)}</p>
        {player.nickname?.trim() && (
          <p className="text-xs text-slate-500 truncate">
            {[player.first_name, player.last_name].filter(Boolean).join(' ')}
          </p>
        )}
      </div>
      <span className="shrink-0 text-sm font-semibold text-slate-500">
        #{player.jersey_number || '-'}
      </span>
    </Link>
  )
}
