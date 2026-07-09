import type { Player, ShotRecord } from '../../types'
import BasketballCourt from '../../components/shot-chart/BasketballCourt'
import ShootingSummary from '../../components/shot-chart/ShootingSummary'
import PlayerSelectorStrip from '../../components/PlayerSelectorStrip'
import {
  shootingLine,
  shotsForSelection,
  shotViewEmptyCopy,
  shotViewLabel,
  type ShotChartSelection,
} from '../../lib/shotChartViews'

interface GameSummaryShotChartPanelProps {
  players: Player[]
  summaryShotChart: ShotRecord[]
  isReviewShotChart: boolean
  shotViewSelection: ShotChartSelection
  onShotViewSelectionChange: (selection: ShotChartSelection) => void
  activeBgClass: string
}

/** Read-only shot chart tab for Game Summary — never records or dispatches shots. */
export default function GameSummaryShotChartPanel({
  players,
  summaryShotChart,
  isReviewShotChart,
  shotViewSelection,
  onShotViewSelectionChange,
  activeBgClass,
}: GameSummaryShotChartPanelProps) {
  const visibleShots = shotsForSelection(summaryShotChart, players, shotViewSelection)

  return (
    <div className="space-y-3 mb-6">
      <PlayerSelectorStrip
        players={players}
        activePlayerId={
          shotViewSelection.kind === 'player' ? shotViewSelection.playerId : null
        }
        onSelectPlayer={playerId =>
          onShotViewSelectionChange({ kind: 'player', playerId })
        }
        activeBgClass={activeBgClass}
        onSelectAll={() => onShotViewSelectionChange({ kind: 'all' })}
        allActive={shotViewSelection.kind === 'all'}
      />
      <div className="flex items-baseline justify-between gap-2 px-1">
        <p className="text-sm font-semibold text-slate-600 truncate">
          Shot chart — {shotViewLabel(shotViewSelection, players)}
        </p>
        <p className="text-sm font-bold text-slate-700 shrink-0">
          {shootingLine(visibleShots)}
        </p>
      </div>
      {isReviewShotChart && (
        <p className="text-xs text-slate-400 px-1">
          Combined from all recorders — each player&apos;s shots come from their
          primary recorder&apos;s chart.
        </p>
      )}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <BasketballCourt shots={visibleShots} className="w-full" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <ShootingSummary
          shots={visibleShots}
          emptyMessage={shotViewEmptyCopy(shotViewSelection, players)}
        />
      </div>
    </div>
  )
}
