import { Link } from 'react-router-dom'
import { playerDisplayName } from '../../lib/display'
import { playerInfoPath } from '../../lib/teamInfo'

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
      to={playerInfoPath(player.id, teamId)}
      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 hover:border-info-line"
    >
      <div className="min-w-0">
        <p className="font-medium text-content truncate">{playerDisplayName(player)}</p>
        {player.nickname?.trim() && (
          <p className="text-xs text-content-muted truncate">
            {[player.first_name, player.last_name].filter(Boolean).join(' ')}
          </p>
        )}
      </div>
      <span className="shrink-0 text-sm font-semibold text-content-muted">
        #{player.jersey_number || '-'}
      </span>
    </Link>
  )
}
