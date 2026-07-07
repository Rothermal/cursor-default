import { Link } from 'react-router-dom'
import { teamManagementPath, teamRosterPath } from '../../lib/teamInfo'
import PlayerRow, { type TeamInfoRosterPlayer } from './PlayerRow'

export type { TeamInfoRosterPlayer } from './PlayerRow'

interface RosterPreviewCardProps {
  teamId: string
  players: TeamInfoRosterPlayer[]
  limit?: number
}

export default function RosterPreviewCard({ teamId, players, limit }: RosterPreviewCardProps) {
  const visiblePlayers = typeof limit === 'number' ? players.slice(0, limit) : players
  const hiddenCount = Math.max(0, players.length - visiblePlayers.length)
  const isPreview = typeof limit === 'number'

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">Roster</h2>
          <p className="text-xs text-slate-500">{players.length} active players</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {isPreview && (
            <Link to={teamRosterPath(teamId)} className="text-xs font-semibold text-blue-600">
              View roster
            </Link>
          )}
          <Link to={teamManagementPath(teamId)} className="text-xs font-semibold text-blue-600">
            Manage
          </Link>
        </div>
      </div>

      {players.length === 0 ? (
        <p className="text-sm text-slate-500">No active players yet.</p>
      ) : (
        <div className="space-y-2">
          {visiblePlayers.map(player => (
            <PlayerRow key={player.id} teamId={teamId} player={player} />
          ))}
          {hiddenCount > 0 && (
            <p className="text-xs text-slate-500">+{hiddenCount} more on the active roster</p>
          )}
        </div>
      )}
    </section>
  )
}
