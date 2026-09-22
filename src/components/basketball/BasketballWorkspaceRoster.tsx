import { Plus, Users } from 'lucide-react'
import type { GameState } from '../../types'
import type { BasketballTeamSide } from '../../lib/basketball/types'
import { isTeamPseudoPlayer } from '../../lib/teamPlayers'
import { formatCompactGameStatLine } from '../../lib/statDisplay'

export default function BasketballWorkspaceRoster({ state, side, canAdd, onAdd, onManage, onOpen }: {
  state: GameState
  side: BasketballTeamSide
  canAdd: boolean
  onAdd: () => void
  onManage: () => void
  onOpen: (playerId: string) => void
}) {
  const projection = state.sportGameState?.sportId === 'basketball' ? state.sportGameState.projection : null
  const lineup = projection?.lineup?.sides[side]
  const manageDisabled = !projection?.clock || projection.clock.running
  const players = state.players.filter(player => !isTeamPseudoPlayer(player) && (projection
    ? Object.values(projection.participants).some(participant => participant.playerId === player.id && participant.teamSide === side)
    : (player.teamSide === 'opponent' ? 'opponent' : 'tracked') === side))
  return <section className="py-3 pb-20">
    <div className="mb-3 flex flex-wrap gap-2">
      {lineup && <button type="button" className="btn-secondary flex min-h-11 items-center gap-2 px-3" onClick={onManage}
        disabled={manageDisabled} title={manageDisabled ? 'Pause and review the clock before changing the lineup.' : undefined}>
        <Users size={16} aria-hidden /> Manage Lineup
      </button>}
      <button type="button" className="btn-secondary flex min-h-11 items-center gap-2 px-3" disabled={!canAdd} onClick={onAdd}>
        <Plus size={16} aria-hidden /> Add Player
      </button>
    </div>
    {players.length === 0 && <p className="py-4 text-sm text-content-muted">No individual players.</p>}
    <div className="grid gap-2">
      {players.map(player => {
        const participant = projection && Object.values(projection.participants).find(item => item.playerId === player.id)
        const status = participant?.ejected ? 'Ejected' : participant?.disqualified ? 'Disqualified'
          : lineup && participant ? lineup.boundaryConfirmationRequired ? 'Lineup review required'
            : lineup.currentParticipantIds.includes(participant.participantId) ? 'On court' : 'Bench'
            : 'Lineup not tracked'
        return <button key={player.id} id={`basketball-roster-${player.id}`} type="button" onClick={() => onOpen(player.id)}
          className="min-h-16 rounded-lg border border-line bg-surface p-3 text-left text-content">
          <span className="block break-words font-semibold">#{player.number || '?'} {player.name}</span>
          {status && <span className="block text-xs text-content-muted">{status}</span>}
          <span className="block break-words text-xs text-content-muted">{participant?.position ?? 'Position unassigned'}</span>
          {state.sport && <span className="block text-xs text-content-muted">{formatCompactGameStatLine(state.sport, player.stats)}</span>}
        </button>
      })}
    </div>
  </section>
}
