import { Link } from 'react-router-dom'
import { playerDisplayName } from '../../lib/display'
import { teamManagementPath } from '../../lib/teamInfo'

export interface TeamInfoRosterPlayer {
  id: string
  first_name: string
  last_name: string | null
  nickname: string | null
  jersey_number: string | null
}

interface RosterPreviewCardProps {
  teamId: string
  players: TeamInfoRosterPlayer[]
  limit?: number
}

export default function RosterPreviewCard({ teamId, players, limit }: RosterPreviewCardProps) {
  const visiblePlayers = typeof limit === 'number' ? players.slice(0, limit) : players
  const hiddenCount = Math.max(0, players.length - visiblePlayers.length)

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">Roster</h2>
          <p className="text-xs text-slate-500">{players.length} active players</p>
        </div>
        <Link to={teamManagementPath(teamId)} className="text-xs font-semibold text-blue-600">
          Manage
        </Link>
      </div>

      {players.length === 0 ? (
        <p className="text-sm text-slate-500">No active players yet.</p>
      ) : (
        <div className="space-y-2">
          {visiblePlayers.map(player => (
            <Link
              key={player.id}
              to={`/player?playerId=${encodeURIComponent(player.id)}&teamId=${encodeURIComponent(teamId)}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 hover:border-blue-200"
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
          ))}
          {hiddenCount > 0 && (
            <p className="text-xs text-slate-500">+{hiddenCount} more on the active roster</p>
          )}
        </div>
      )}
    </section>
  )
}
