import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useBasketballAggregateDestination } from '../../hooks/useBasketballAggregateDestination'
import {
  BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES,
  basketballAggregateCategoryHasValues,
  basketballAggregateGenericQualityMessage,
  basketballAggregateManagedDiagnostics,
  basketballAggregateMetricAvailable,
  basketballAggregateMetricLabel,
  basketballAggregateRankingMetrics,
  basketballAggregateVisibleColumns,
  formatBasketballAggregateMetric,
  sortBasketballAggregatePlayers,
  type BasketballAggregateCategoryDestination,
  type BasketballAggregateMetricId,
} from '../../lib/basketball/aggregateDestinations'
import type {
  BasketballAggregateGame,
  BasketballAggregateResult,
  BasketballAggregateTeam,
} from '../../lib/basketball/aggregateComposition'
import { formatBasketballAggregateStat } from '../../lib/basketball/aggregateStats'
import type { BasketballAggregateLoadScope } from '../../lib/basketball/aggregateTransport'
import { basketballSummaryPath } from '../../lib/basketball/summary'
import { gameInfoPath, playerInfoPath } from '../../lib/teamInfo'

export type BasketballAggregateDestinationVariant = 'season' | 'team' | 'tournament'

interface BasketballAggregateDestinationProps {
  variant: BasketballAggregateDestinationVariant
  scope: BasketballAggregateLoadScope
  teamIds: string[]
  teamIdForLinks?: string | null
  seasonId?: string | null
  overviewExtra?: ReactNode
  className?: string
}

interface BasketballAggregateDestinationPageProps
  extends BasketballAggregateDestinationProps {
  title: string
  subtitle: string
  backPath: string
}

type DestinationTab = 'overview' | 'players' | 'games'

export function BasketballAggregateDestinationPage({
  title,
  subtitle,
  backPath,
  ...destinationProps
}: BasketballAggregateDestinationPageProps) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <header className="bg-surface border-b border-line text-content px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="w-9 h-9 shrink-0 rounded-lg bg-control flex items-center justify-center hover:bg-control-hover"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold truncate">{title}</h1>
            <p className="text-sm text-content-muted truncate">{subtitle}</p>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-5 max-w-3xl mx-auto w-full">
        <BasketballAggregateDestination {...destinationProps} />
      </main>
    </div>
  )
}

export function BasketballAggregateDestination({
  variant,
  scope,
  teamIds,
  teamIdForLinks = null,
  seasonId = null,
  overviewExtra,
  className = '',
}: BasketballAggregateDestinationProps) {
  const { result, progress, loading, refreshing, error, rosterWarning, refresh } =
    useBasketballAggregateDestination({ scope, teamIds })
  const [tab, setTab] = useState<DestinationTab>(
    variant === 'season' ? 'players' : 'overview'
  )
  const aggregate = result?.aggregate ?? null
  const scopeKey = JSON.stringify(scope)

  useEffect(() => {
    setTab(variant === 'season' ? 'players' : 'overview')
  }, [scopeKey, variant])

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-content">
            {variant === 'season'
              ? 'Season leaderboard'
              : variant === 'team'
                ? 'Team statistics'
                : 'Tournament statistics'}
          </p>
          <p className="text-xs text-content-muted mt-0.5">
            Final legacy games and canonical event publications, one authority per game.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="w-9 h-9 rounded-lg border border-line bg-surface text-content-muted flex items-center justify-center shrink-0 hover:bg-canvas disabled:bg-control-disabled disabled:text-content-disabled"
          aria-label="Refresh Basketball statistics"
          title="Refresh"
        >
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && !result && <LoadingState progress={progress} />}
      {error && !result && <ErrorState code={error.code} refresh={refresh} />}
      {error && result && (
        <Notice>
          Refresh failed. Showing the last successfully loaded Basketball statistics.
        </Notice>
      )}
      {rosterWarning && result && <Notice>{rosterWarning}</Notice>}

      {aggregate && (
        <>
          {refreshing && (
            <p className="text-xs text-content-muted" role="status">
              Refreshing Basketball history...
            </p>
          )}
          <Provenance aggregate={aggregate} />
          <QualityNotice aggregate={aggregate} />
          {aggregate.includedGameCount === 0 ? (
            <EmptyState
              title="No eligible completed games"
              detail="Final legacy games or finalized canonical Basketball publications will appear here."
            />
          ) : (
            <>
              {variant !== 'season' && <Tabs value={tab} onChange={setTab} />}
              {tab === 'overview' && (
                <Overview
                  aggregate={aggregate}
                  teamId={teamIdForLinks}
                  extra={overviewExtra}
                />
              )}
              {tab === 'players' && (
                <Players
                  aggregate={aggregate}
                  teamIdForLinks={teamIdForLinks}
                  seasonId={seasonId}
                />
              )}
              {tab === 'games' && (
                <Games games={aggregate.games} teamIdForLinks={teamIdForLinks} />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function LoadingState({
  progress,
}: {
  progress: ReturnType<typeof useBasketballAggregateDestination>['progress']
}) {
  const loaded = (progress?.canonicalSourceCount ?? 0) + (progress?.legacySourceCount ?? 0)
  const label = progress?.stage === 'projecting'
    ? `Building ${progress.projectedCount} of ${progress.projectionTotal} games`
    : loaded > 0
      ? `Loaded ${loaded} game sources`
      : 'Loading Basketball history'
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-5 text-center">
      <RefreshCw size={20} className="animate-spin mx-auto text-accent mb-2" />
      <p className="text-sm font-medium text-content">{label}</p>
      <p className="text-xs text-content-muted mt-1">Large scopes may take a moment.</p>
    </div>
  )
}

function ErrorState({ code, refresh }: { code: string; refresh: () => void }) {
  const copy = code === 'backend_update_required'
    ? ['Backend update required', 'Apply migration 060 before loading Basketball statistics.']
    : code === 'not_configured'
      ? ['Supabase not configured', 'Configure Supabase before loading cloud statistics.']
      : code === 'access_denied'
        ? ['Statistics unavailable', 'You no longer have access to this Basketball scope.']
        : code === 'invalid_payload'
          ? ['Statistics unavailable', 'The Basketball history response was not valid.']
          : ['Statistics could not load', 'Check your connection and try again.']
  return (
    <div className="rounded-lg border border-danger-line bg-danger px-4 py-4">
      <div className="flex gap-3">
        <AlertTriangle size={19} className="text-danger-content shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-danger-content">{copy[0]}</p>
          <p className="text-sm text-danger-content mt-1">{copy[1]}</p>
          {code !== 'access_denied' && (
            <button type="button" onClick={refresh} className="text-sm font-semibold text-danger-content underline mt-2">
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
      {children}
    </div>
  )
}

function Provenance({ aggregate }: { aggregate: BasketballAggregateResult }) {
  const label = aggregate.provenance === 'mixed'
    ? 'Mixed history'
    : aggregate.provenance === 'canonical'
      ? 'Canonical event history'
      : aggregate.provenance === 'legacy'
        ? 'Legacy history'
        : 'No history'
  return (
    <div className="flex flex-wrap gap-2 text-xs text-content-muted">
      <span className="rounded-md border border-line bg-surface px-2 py-1 font-semibold">
        {label}
      </span>
      <span className="rounded-md border border-line bg-surface px-2 py-1">
        {aggregate.metrics.canonicalGameCount} canonical
      </span>
      <span className="rounded-md border border-line bg-surface px-2 py-1">
        {aggregate.metrics.legacyGameCount} legacy
      </span>
    </div>
  )
}

function QualityNotice({ aggregate }: { aggregate: BasketballAggregateResult }) {
  const generic = basketballAggregateGenericQualityMessage(aggregate)
  const managed = basketballAggregateManagedDiagnostics(aggregate)
  if (!generic) return null
  return (
    <section className="rounded-lg border border-warning-line bg-warning px-4 py-3">
      <div className="flex gap-2">
        <AlertTriangle size={17} className="text-warning-content shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-warning-content">Partial statistics</p>
          <p className="text-sm text-warning-content mt-0.5">{generic}</p>
          {managed.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs font-semibold text-warning-content cursor-pointer">
                Managed-team diagnostics ({managed.length})
              </summary>
              <ul className="mt-2 space-y-2">
                {managed.map((item, index) => (
                  <li key={`${item.sourceId}:${item.participantId ?? index}`} className="text-xs text-warning-content">
                    <span>{item.gameDate || 'Unknown date'}: {item.message}</span>
                    {item.gameId !== 'unknown' && (
                      <Link to={gameInfoPath(item.gameId)} className="font-semibold underline ml-1">
                        Open game
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  )
}

function Tabs({ value, onChange }: { value: DestinationTab; onChange: (value: DestinationTab) => void }) {
  return (
    <div className="grid grid-cols-3 rounded-lg border border-line bg-surface-muted p-1">
      {(['overview', 'players', 'games'] as const).map(tab => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`h-9 rounded-md text-sm font-semibold capitalize ${value === tab ? 'bg-surface text-content shadow-sm' : 'text-content-muted hover:text-content'}`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

function Overview({ aggregate, teamId, extra }: { aggregate: BasketballAggregateResult; teamId: string | null; extra?: ReactNode }) {
  const team = teamId
    ? aggregate.teams.find(item => item.teamId === teamId) ?? aggregate.teams[0]
    : aggregate.teams[0]
  if (!team) {
    return <EmptyState title="No team totals" detail="The included games did not produce a readable team summary." />
  }
  return (
    <div className="space-y-4">
      <RecordSummary team={team} />
      <ForAgainstSummary team={team} />
      {extra}
    </div>
  )
}

function RecordSummary({ team }: { team: BasketballAggregateTeam }) {
  const record = team.record
  const cells = [
    ['G', record.games], ['W', record.wins], ['L', record.losses], ['T', record.draws],
    ['PF', record.pointsFor], ['PA', record.pointsAgainst],
    ['DIFF', record.pointDifference > 0 ? `+${record.pointDifference}` : record.pointDifference],
  ] as const
  return (
    <section>
      <h2 className="font-semibold text-content mb-2">Overview</h2>
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {cells.map(([label, value]) => (
          <div key={label} className="bg-surface px-2 py-3 text-center">
            <p className="font-bold text-content tabular-nums">{value}</p>
            <p className="text-[11px] text-content-muted mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function ForAgainstSummary({ team }: { team: BasketballAggregateTeam }) {
  const rows = [
    ['Points', 'bk_pts'], ['Field goals', 'bk_fgm'], ['3-pointers', 'bk_3pm'],
    ['Free throws', 'bk_ftm'], ['Rebounds', 'bk_reb'], ['Assists', 'bk_ast'],
    ['Turnovers', 'bk_to'], ['Steals', 'bk_stl'], ['Blocks', 'bk_blk'], ['Fouls', 'bk_pf'],
  ] as const
  return (
    <section>
      <h2 className="font-semibold text-content mb-2">Official Team Totals</h2>
      <p className="text-xs text-content-muted mb-2">Includes player, team, and unknown-actor events.</p>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-content-muted">
            <tr><th className="px-3 py-2 text-left font-semibold">Stat</th><th className="px-3 py-2 text-right font-semibold">For</th><th className="px-3 py-2 text-right font-semibold">Against</th></tr>
          </thead>
          <tbody>
            {rows.map(([label, key]) => (
              <tr key={key} className="border-t border-line">
                <th className="px-3 py-2 text-left font-medium text-content">{label}</th>
                <td className="px-3 py-2 text-right tabular-nums text-content">{formatBasketballAggregateStat(key, team.trackedStats[key])}</td>
                <td className="px-3 py-2 text-right tabular-nums text-content-muted">{formatBasketballAggregateStat(key, team.opponentStats[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Players({
  aggregate,
  teamIdForLinks,
  seasonId,
}: {
  aggregate: BasketballAggregateResult
  teamIdForLinks: string | null
  seasonId: string | null
}) {
  const [categoryId, setCategoryId] = useState('scoring')
  const category = BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES.find(item => item.id === categoryId)
    ?? BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES[0]
  const availableRankingMetrics = category.metricIds.filter(metricId =>
    basketballAggregateMetricAvailable(aggregate, metricId)
  )
  const defaultMetric = availableRankingMetrics.includes(category.defaultMetricId)
    ? category.defaultMetricId
    : availableRankingMetrics[0] ?? category.defaultMetricId
  const [metricId, setMetricId] = useState<BasketballAggregateMetricId>(defaultMetric)
  const plusMinusCoverage = aggregate.metricCoverage.bk_pm

  useEffect(() => setMetricId(defaultMetric), [category, defaultMetric])

  if (aggregate.players.length === 0) {
    return <EmptyState title="No resolved players" detail="Team totals are available, but no player contribution has a stable cloud identity." />
  }
  return (
    <section className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Statistic categories">
        {BASKETBALL_AGGREGATE_DESTINATION_CATEGORIES.map(item => (
          <button key={item.id} type="button" onClick={() => setCategoryId(item.id)} className={`h-9 px-3 rounded-lg text-sm font-semibold whitespace-nowrap border ${item.id === category.id ? 'bg-accent border-accent text-accent-content' : 'bg-surface border-line text-content-muted'}`}>
            {item.label}
          </button>
        ))}
      </div>
      {availableRankingMetrics.length > 0 && (
        <label className="block">
          <span className="text-xs font-semibold text-content-muted">Rank by</span>
          <select value={metricId} onChange={event => setMetricId(event.target.value as BasketballAggregateMetricId)} className="input-field mt-1">
            {availableRankingMetrics.map(id => <option key={id} value={id}>{basketballAggregateMetricLabel(id).label}</option>)}
          </select>
        </label>
      )}
      {category.id === 'participation' && plusMinusCoverage && !plusMinusCoverage.complete && (
        <div className="rounded-lg border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
          Plus-minus comparison is unavailable: {plusMinusCoverage.includedGameCount} of{' '}
          {plusMinusCoverage.totalGameCount} games have complete lineup and scoring coverage.
        </div>
      )}
      {basketballAggregateCategoryHasValues(aggregate.players, category, aggregate) && availableRankingMetrics.length > 0 ? (
        <PlayerTable
          aggregate={aggregate}
          category={category}
          metricId={metricId}
          teamIdForLinks={teamIdForLinks}
          seasonId={seasonId}
        />
      ) : (
        <EmptyState title={`No ${category.label.toLowerCase()} statistics`} detail="This metric is unavailable for part of the selected history or has not been recorded." />
      )}
    </section>
  )
}

function PlayerTable({ aggregate, category, metricId, teamIdForLinks, seasonId }: { aggregate: BasketballAggregateResult; category: BasketballAggregateCategoryDestination; metricId: BasketballAggregateMetricId; teamIdForLinks: string | null; seasonId: string | null }) {
  const sorted = useMemo(
    () => sortBasketballAggregatePlayers(
      aggregate.players,
      metricId,
      basketballAggregateRankingMetrics(aggregate, category)
    ),
    [aggregate, category, metricId]
  )
  const columns = basketballAggregateVisibleColumns(category, metricId, aggregate)
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-canvas text-content-muted">
          <tr>
            <th className="sticky left-0 z-10 bg-canvas px-3 py-2 text-left font-semibold w-[180px] min-w-[180px] max-w-[180px]">Player</th>
            {columns.map(id => <th key={id} className="px-2 py-2 text-right font-semibold whitespace-nowrap">{basketballAggregateMetricLabel(id).shortLabel}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((player, index) => {
            const teamId = teamIdForLinks && player.teamIds.includes(teamIdForLinks)
              ? teamIdForLinks
              : player.teamIds[0] ?? null
            return (
            <tr key={player.playerId} className="border-t border-line">
              <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium text-content w-[180px] min-w-[180px] max-w-[180px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 shrink-0 text-xs text-content-subtle">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    {teamId ? (
                      <Link
                        to={playerInfoPath(player.playerId, teamId, seasonId)}
                        className="block truncate hover:underline"
                      >
                        {player.number ? `#${player.number} ` : ''}{player.displayName}
                      </Link>
                    ) : (
                      <span className="block truncate">
                        {player.number ? `#${player.number} ` : ''}{player.displayName}
                      </span>
                    )}
                    <Link
                      to={`/career?playerId=${encodeURIComponent(player.playerId)}&sport=basketball`}
                      className="text-[11px] font-semibold text-accent hover:underline"
                    >
                      Career
                    </Link>
                  </div>
                </div>
              </th>
              {columns.map(id => <td key={id} className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${id === metricId ? 'font-bold text-content' : 'text-content-muted'}`}>{formatBasketballAggregateMetric(player, id)}</td>)}
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Games({ games, teamIdForLinks }: { games: BasketballAggregateGame[]; teamIdForLinks: string | null }) {
  if (games.length === 0) return <EmptyState title="No games" detail="No eligible completed Basketball games are in this scope." />
  return (
    <section className="space-y-2">
      {games.map(game => (
        <Link
          key={`${game.authority}:${game.sourceId}`}
          to={game.authority === 'canonical'
            ? basketballSummaryPath({
                gameId: game.gameId,
                tab: 'overview',
                from: 'team',
                teamId: game.teamId ?? teamIdForLinks,
              })
            : gameInfoPath(game.gameId, game.teamId ?? teamIdForLinks)}
          className="block rounded-lg border border-line bg-surface px-3 py-3 hover:border-accent"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-content truncate">{game.trackedTeamName}</p>
              <p className="text-sm text-content-muted truncate">{game.date} vs {game.opponentName}</p>
              <p className="text-xs text-content-subtle capitalize mt-0.5">{game.authority} source</p>
            </div>
            <span className={`font-bold shrink-0 ${game.result === 'win' ? 'text-success-content' : game.result === 'loss' ? 'text-danger-content' : 'text-content-muted'}`}>
              {game.result === 'win' ? 'W' : game.result === 'loss' ? 'L' : 'T'} {game.trackedScore}-{game.opponentScore}
            </span>
          </div>
        </Link>
      ))}
    </section>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-5 text-center">
      <p className="font-semibold text-content">{title}</p>
      <p className="text-sm text-content-muted mt-1">{detail}</p>
    </div>
  )
}

export {
  EmptyState as BasketballAggregateEmptyState,
  ErrorState as BasketballAggregateErrorState,
  LoadingState as BasketballAggregateLoadingState,
  QualityNotice as BasketballAggregateQualityNotice,
}
