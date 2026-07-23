import { ChevronLeft, RefreshCw, Users } from 'lucide-react'
import type { SoccerSummaryResult } from '../../lib/soccer/summary'
import type { SoccerSummarySource } from '../../lib/soccer/summarySource'

interface SoccerSummaryHeaderProps {
  source: SoccerSummarySource
  result: SoccerSummaryResult
  refreshing: boolean
  onBack: () => void
  onRefresh: () => void
  onOpenRecorders?: () => void
}

export default function SoccerSummaryHeader({
  source,
  result,
  refreshing,
  onBack,
  onRefresh,
  onOpenRecorders,
}: SoccerSummaryHeaderProps) {
  const teamName = source.state.gameInfo?.teamName ?? 'Tracked team'
  const opponentName = source.state.gameInfo?.opponentName ?? 'Opponent'
  const status = source.kind === 'local'
    ? 'Local'
    : source.kind === 'cloud_primary'
      ? 'Synced Primary'
      : 'Canonical Final'

  return (
    <header className="bg-emerald-900 text-white">
      <div className="mx-auto max-w-2xl px-3 pb-5 pt-3">
        <div className="flex min-h-10 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-white/10"
            aria-label="Back"
            title="Back"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold">Match Summary</h1>
            <p className="truncate text-xs text-emerald-100">{status}</p>
          </div>
          {onOpenRecorders && (
            <button
              type="button"
              onClick={onOpenRecorders}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-white/10"
              aria-label="Recorder streams"
              title="Recorder streams"
            >
              <Users size={19} />
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-white/10 disabled:opacity-50"
            aria-label="Refresh summary"
            title="Refresh summary"
          >
            <RefreshCw size={19} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)] items-end gap-2 text-center">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-emerald-100" title={teamName}>
              {teamName}
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums">
              {result.trackedScore}
            </p>
          </div>
          <div className="pb-1">
            <p className="text-sm font-bold">{result.resultLabel}</p>
            <p className="mt-0.5 min-h-4 text-xs text-emerald-100">
              {result.decisionLabel ?? result.matchStateLabel}
            </p>
            {result.decisionLabel === 'Pens' && result.shootoutScore && (
              <p className="mt-1 text-xs font-semibold tabular-nums text-emerald-100">
                {result.shootoutScore.tracked}-{result.shootoutScore.opponent} pens
              </p>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-emerald-100" title={opponentName}>
              {opponentName}
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums">
              {result.opponentScore}
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}
