import { ChevronLeft, RefreshCw } from 'lucide-react'
import type { BasketballSummarySource } from '../../lib/basketball/summarySource'
import { gameSideDisplayName } from '../../lib/display'

interface Props {
  source: BasketballSummarySource
  healthy: boolean
  refreshing: boolean
  onBack: () => void
  onRefresh: () => void
}

export default function BasketballSummaryHeader({
  source,
  healthy,
  refreshing,
  onBack,
  onRefresh,
}: Props) {
  const projection = source.state.sportGameState?.sportId === 'basketball'
    ? source.state.sportGameState.projection
    : null
  const authority = sourceLabel(source)
  const freshness = source.kind === 'canonical'
    ? source.publication.finalizedAt
    : source.recorder?.checkpointSyncedAt ?? null

  return (
    <header className="bg-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 pb-5 pt-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
            aria-label="Back"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 text-center">
            <p className="truncate text-xs font-semibold uppercase text-amber-300">
              {authority}
            </p>
            {freshness && (
              <p className="mt-0.5 text-[11px] text-slate-400">
                Updated {formatTimestamp(freshness)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
            aria-label="Refresh summary"
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamScore
            name={gameSideDisplayName(source.state.gameInfo, 'tracked', 'Tracked team')}
            score={healthy && projection ? projection.score.tracked : null}
          />
          <span className="text-sm font-semibold text-slate-500">vs</span>
          <TeamScore
            name={gameSideDisplayName(source.state.gameInfo, 'opponent')}
            score={healthy && projection ? projection.score.opponent : null}
            align="right"
          />
        </div>
      </div>
    </header>
  )
}

function TeamScore({
  name,
  score,
  align = 'left',
}: {
  name: string
  score: number | null
  align?: 'left' | 'right'
}) {
  return (
    <div className={align === 'right' ? 'text-right' : 'text-left'}>
      <p className="break-words text-sm font-semibold text-slate-200">{name}</p>
      <p className="mt-1 text-4xl font-bold tabular-nums">{score ?? '--'}</p>
    </div>
  )
}

function sourceLabel(source: BasketballSummarySource): string {
  switch (source.kind) {
    case 'local':
      return 'This device'
    case 'cloud_primary':
      return `Primary recording: ${source.recorder.displayName}`
    case 'cloud_recording':
      return `Other recording: ${source.recorder.displayName}`
    case 'canonical':
      return `Official final: ${source.recorder.displayName}`
  }
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
