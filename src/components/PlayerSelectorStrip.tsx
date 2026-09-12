import { useMemo } from 'react'
import type { Player } from '../types'
import { isTeamPseudoPlayer, sortTeamPlayersFirst } from '../lib/teamPlayers'

interface PlayerSelectorStripProps {
  players: Player[]
  activePlayerId: string | null
  onSelectPlayer: (playerId: string) => void
  /** Compatibility prop; selected chips now use the application accent. */
  activeBgClass: string
  /** When provided, renders a trailing "+" button that calls this handler. */
  onAddPlayer?: () => void
  /** Pin the strip to the top of the page scroll (single-page Game Tracker). */
  sticky?: boolean
  /** When provided, renders a leading "All" chip (whole-game shot view, F2). */
  onSelectAll?: () => void
  /** Active styling for the "All" chip; player chips render inactive while set. */
  allActive?: boolean
  /** Optional projected availability status; chips stay selectable for history/corrections. */
  playerStatusLabels?: Record<string, string>
}

/**
 * Horizontal player-select strip shared by Game Tracker (and formerly Shot Chart).
 * Team pseudo-players lead, separated from individuals by a divider.
 */
export default function PlayerSelectorStrip({
  players,
  activePlayerId,
  onSelectPlayer,
  onAddPlayer,
  sticky = false,
  onSelectAll,
  allActive = false,
  playerStatusLabels = {},
}: PlayerSelectorStripProps) {
  const selectorPlayers = useMemo(() => sortTeamPlayersFirst(players), [players])
  const teamSelectorCount = selectorPlayers.filter(isTeamPseudoPlayer).length

  const strip = (
    <div className="px-3 py-2 max-w-lg mx-auto w-full">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide items-stretch">
        {onSelectAll && (
          <div className="flex flex-shrink-0 items-stretch gap-2">
            <button
              type="button"
              onClick={onSelectAll}
              title="Show every shot on the chart"
              className={`
                flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold
                transition-transform duration-150 active:scale-95
                ${allActive
                  ? 'bg-accent text-accent-content shadow-md'
                  : 'bg-surface text-content-muted border border-line'
                }
              `}
            >
              All
            </button>
            <div
              className="w-px self-stretch min-h-[2.5rem] bg-line-strong shrink-0"
              aria-hidden
            />
          </div>
        )}
        {selectorPlayers.map((player, index) => {
          const isTeam = isTeamPseudoPlayer(player)
          const showDivider = isTeam && index === teamSelectorCount - 1 && teamSelectorCount > 0
          const isActive = !allActive && player.id === activePlayerId
          const statusLabel = playerStatusLabels[player.id]

          return (
            <div key={player.id} className="flex flex-shrink-0 items-stretch gap-2">
              <button
                type="button"
                onClick={() => onSelectPlayer(player.id)}
                title={player.name}
                className={`
                  flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold max-w-[10.5rem]
                  transition-transform duration-150 active:scale-95 text-left
                  ${isTeam
                    ? isActive
                      ? `bg-accent text-accent-content shadow-md ring-2 ring-focus`
                      : `bg-surface-muted text-content border border-line shadow-sm`
                    : isActive
                      ? `bg-accent text-accent-content shadow-md`
                      : 'bg-surface text-content-muted border border-line'
                  }
                `}
              >
                <span className={isTeam ? 'opacity-90' : 'opacity-70'}>
                  {isTeam ? '★' : `#${player.number || '?'}`}
                </span>{' '}
                <span className="line-clamp-2 break-words">
                  {isTeam ? player.name : player.name.split(' ')[0]}
                </span>
                {statusLabel && (
                  <span className={`block text-[10px] font-bold uppercase ${isActive ? 'text-accent-content' : 'text-danger-content'}`}>
                    {statusLabel}
                  </span>
                )}
              </button>
              {showDivider && (
                <div
                  className="w-px self-stretch min-h-[2.5rem] bg-line-strong shrink-0"
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
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-surface border-2 border-dashed
                       border-line-strong text-content-subtle text-xl font-bold
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
    <div className="sticky top-0 z-30 bg-surface-muted/95 backdrop-blur border-b border-line/60">
      {strip}
    </div>
  )
}
