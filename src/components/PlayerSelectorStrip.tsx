import { useMemo } from 'react'
import type { Player } from '../types'
import {
  isTeamPseudoPlayer,
  TEAM_PLAYER_HOME_ID,
  TEAM_PLAYER_OPP_ID,
} from '../lib/teamPlayers'

/** Team pseudo-players (home, opponent) first, then individuals — shared selector order. */
export function sortTeamPlayersFirst(players: Player[]): Player[] {
  const teams = players.filter(isTeamPseudoPlayer)
  const home = teams.find(p => p.id === TEAM_PLAYER_HOME_ID || p.teamSide === 'home')
  const opp = teams.find(p => p.id === TEAM_PLAYER_OPP_ID || p.teamSide === 'opponent')
  const restTeam = teams.filter(p => p !== home && p !== opp)
  const individuals = players.filter(p => !isTeamPseudoPlayer(p))
  const orderedTeams = [home, opp, ...restTeam].filter(Boolean) as Player[]
  return [...orderedTeams, ...individuals]
}

interface PlayerSelectorStripProps {
  players: Player[]
  activePlayerId: string | null
  onSelectPlayer: (playerId: string) => void
  /** Tailwind bg class for the active individual-player chip (sport theme). */
  activeBgClass: string
  /** When provided, renders a trailing "+" button that calls this handler. */
  onAddPlayer?: () => void
  /** Pin the strip to the top of the page scroll (single-page Game Tracker). */
  sticky?: boolean
}

/**
 * Horizontal player-select strip shared by Game Tracker (and formerly Shot Chart).
 * Team pseudo-players lead, separated from individuals by a divider.
 */
export default function PlayerSelectorStrip({
  players,
  activePlayerId,
  onSelectPlayer,
  activeBgClass,
  onAddPlayer,
  sticky = false,
}: PlayerSelectorStripProps) {
  const selectorPlayers = useMemo(() => sortTeamPlayersFirst(players), [players])
  const teamSelectorCount = selectorPlayers.filter(isTeamPseudoPlayer).length

  const strip = (
    <div className="px-3 py-2 max-w-lg mx-auto w-full">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide items-stretch">
        {selectorPlayers.map((player, index) => {
          const isTeam = isTeamPseudoPlayer(player)
          const showDivider = isTeam && index === teamSelectorCount - 1 && teamSelectorCount > 0
          const isActive = player.id === activePlayerId

          return (
            <div key={player.id} className="flex flex-shrink-0 items-stretch gap-2">
              <button
                type="button"
                onClick={() => onSelectPlayer(player.id)}
                title={player.name}
                className={`
                  flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold max-w-[10.5rem]
                  transition-all duration-150 active:scale-95 text-left
                  ${isTeam
                    ? isActive
                      ? `bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-md ring-2 ring-white/30`
                      : `bg-gradient-to-br from-slate-100 to-slate-200/90 text-slate-800 border border-slate-300/80 shadow-sm`
                    : isActive
                      ? `${activeBgClass} text-white shadow-md`
                      : 'bg-white text-slate-600 border border-slate-200'
                  }
                `}
              >
                <span className={isTeam ? 'opacity-90' : 'opacity-70'}>
                  {isTeam ? '★' : `#${player.number || '?'}`}
                </span>{' '}
                <span className="line-clamp-2 break-words">
                  {isTeam ? player.name : player.name.split(' ')[0]}
                </span>
              </button>
              {showDivider && (
                <div
                  className="w-px self-stretch min-h-[2.5rem] bg-slate-300 shrink-0"
                  aria-hidden
                />
              )}
            </div>
          )
        })}
        {onAddPlayer && (
          <button
            type="button"
            onClick={onAddPlayer}
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-white border-2 border-dashed
                       border-slate-300 text-slate-400 text-xl font-bold
                       active:scale-95 transition-transform flex items-center justify-center"
          >
            +
          </button>
        )}
      </div>
    </div>
  )

  if (!sticky) return strip

  return (
    <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur border-b border-slate-200/60">
      {strip}
    </div>
  )
}
