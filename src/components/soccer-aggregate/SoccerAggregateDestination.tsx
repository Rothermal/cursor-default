import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useSoccerAggregateDestination } from '../../hooks/useSoccerAggregateDestination'
import {
  SOCCER_AGGREGATE_DESTINATION_CATEGORIES,
  formatSoccerAggregateMetric,
  soccerAggregateCategoryHasValues,
  soccerAggregateGenericQualityMessage,
  soccerAggregateManagedDiagnostics,
  soccerAggregateMetricLabel,
  soccerAggregateVisibleColumns,
  sortSoccerAggregatePlayers,
  type SoccerAggregateCategoryDestination,
  type SoccerAggregateMetricId,
} from '../../lib/soccer/aggregateDestinations'
import type {
  SoccerAggregateGame,
  SoccerAggregateResult,
  SoccerAggregateTeam,
} from '../../lib/soccer/aggregateProjection'
import type { SoccerCanonicalAggregateLoadScope } from '../../lib/soccer/aggregateTransport'
import { gameInfoPath, playerInfoPath } from '../../lib/teamInfo'

export type SoccerAggregateDestinationVariant =
  | 'season'
  | 'team'
  | 'tournament'

interface SoccerAggregateDestinationProps {
  variant: SoccerAggregateDestinationVariant
  scope: SoccerCanonicalAggregateLoadScope
  teamIds: string[]
  teamIdForLinks?: string | null
  seasonId?: string | null
  overviewExtra?: ReactNode
  className?: string
}

interface SoccerAggregateDestinationPageProps
  extends SoccerAggregateDestinationProps {
  title: string
  subtitle: string
  backPath: string
}

type DestinationTab = 'overview' | 'players' | 'games'

export function SoccerAggregateDestinationPage({
  title,
  subtitle,
  backPath,
  ...destinationProps
}: SoccerAggregateDestinationPageProps) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-slate-800 text-white px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold truncate">{title}</h1>
            <p className="text-sm text-slate-300 truncate">{subtitle}</p>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-5 max-w-3xl mx-auto w-full">
        <SoccerAggregateDestination {...destinationProps} />
      </main>
    </div>
  )
}

export function SoccerAggregateDestination({
  variant,
  scope,
  teamIds,
  teamIdForLinks = null,
  seasonId = null,
  overviewExtra,
  className = '',
}: SoccerAggregateDestinationProps) {
  const {
    result,
    progress,
    loading,
    refreshing,
    error,
    rosterWarning,
    refresh,
  } = useSoccerAggregateDestination({ scope, teamIds })
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
          <p className="font-semibold text-slate-800">
            {variant === 'season'
              ? 'Season leaderboard'
              : variant === 'team'
                ? 'Team statistics'
                : 'Tournament statistics'}
          </p>
          {variant === 'season' && (
            <p className="text-xs text-slate-500 mt-0.5">
              Includes completed canonical matches from teams you can read.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-600
                     flex items-center justify-center hover:bg-slate-50 disabled:opacity-50"
          aria-label="Refresh soccer statistics"
          title="Refresh"
        >
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && !result && <SoccerAggregateLoadingState progress={progress} />}
      {error && !result && <SoccerAggregateErrorState code={error.code} refresh={refresh} />}
      {error && result && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Refresh failed. Showing the last successfully loaded canonical statistics.
        </div>
      )}
      {rosterWarning && result && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {rosterWarning}
        </div>
      )}

      {aggregate && (
        <>
          {refreshing && (
            <p className="text-xs text-slate-500" role="status">
              Refreshing canonical matches...
            </p>
          )}
          <SoccerAggregateQualityNotice aggregate={aggregate} />

          {aggregate.includedMatchCount === 0 ? (
            <SoccerAggregateEmptyState
              title="No completed canonical matches"
              detail="Finalize a soccer match to include it in these statistics."
            />
          ) : (
            <>
              {variant !== 'season' && (
                <DestinationTabs value={tab} onChange={setTab} />
              )}
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
              {tab === 'games' && <Games games={aggregate.games} />}
            </>
          )}
        </>
      )}
    </div>
  )
}

export function SoccerAggregateLoadingState({
  progress,
}: {
  progress: ReturnType<typeof useSoccerAggregateDestination>['progress']
}) {
  const label = progress?.stage === 'projecting'
    ? `Building ${progress.projectedCount} of ${progress.projectionTotal} matches`
    : progress && progress.publicationCount > 0
      ? `Loaded ${progress.publicationCount} canonical matches`
      : 'Loading canonical matches'
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-5 text-center">
      <RefreshCw size={20} className="animate-spin mx-auto text-sky-600 mb-2" />
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="text-xs text-slate-500 mt-1">Large scopes may take a moment.</p>
    </div>
  )
}

export function SoccerAggregateErrorState({
  code,
  refresh,
}: {
  code: string
  refresh: () => void
}) {
  const copy = code === 'backend_update_required'
    ? {
        title: 'Backend update required',
        detail: 'Apply the latest Supabase migrations before loading soccer statistics.',
      }
    : code === 'not_configured'
      ? {
          title: 'Supabase not configured',
          detail: 'Configure Supabase before loading cloud soccer statistics.',
        }
      : code === 'access_denied'
      ? {
          title: 'Statistics unavailable',
          detail: 'You no longer have access to this soccer scope.',
        }
      : {
          title: 'Statistics could not load',
          detail: 'Check your connection and try again.',
        }
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4">
      <div className="flex gap-3">
        <AlertTriangle size={19} className="text-rose-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-rose-900">{copy.title}</p>
          <p className="text-sm text-rose-800 mt-1">{copy.detail}</p>
          {code !== 'access_denied' && (
            <button
              type="button"
              onClick={refresh}
              className="text-sm font-semibold text-rose-800 underline mt-2"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function SoccerAggregateQualityNotice({
  aggregate,
}: {
  aggregate: SoccerAggregateResult
}) {
  const generic = soccerAggregateGenericQualityMessage(aggregate)
  const managed = soccerAggregateManagedDiagnostics(aggregate)
  if (!generic) return null
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex gap-2">
        <AlertTriangle size={17} className="text-amber-700 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Partial statistics</p>
          <p className="text-sm text-amber-800 mt-0.5">{generic}</p>
          {managed.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs font-semibold text-amber-900 cursor-pointer">
                Managed-team diagnostics ({managed.length})
              </summary>
              <ul className="mt-2 space-y-2">
                {managed.map((item, index) => (
                  <li
                    key={`${item.publicationId}:${item.participantId ?? index}`}
                    className="text-xs text-amber-900"
                  >
                    <span>{item.gameDate || 'Unknown date'}: {item.message}</span>
                    {item.gameId !== 'unknown' && (
                      <Link
                        to={gameInfoPath(item.gameId)}
                        className="font-semibold underline ml-1"
                      >
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

function DestinationTabs({
  value,
  onChange,
}: {
  value: DestinationTab
  onChange: (value: DestinationTab) => void
}) {
  return (
    <div className="grid grid-cols-3 rounded-lg border border-slate-200 bg-slate-100 p-1">
      {(['overview', 'players', 'games'] as const).map(tab => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`h-9 rounded-md text-sm font-semibold capitalize ${
            value === tab
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

function Overview({
  aggregate,
  teamId,
  extra,
}: {
  aggregate: SoccerAggregateResult
  teamId: string | null
  extra?: ReactNode
}) {
  const team = teamId
    ? aggregate.teams.find(item => item.teamId === teamId) ?? aggregate.teams[0]
    : aggregate.teams[0]
  if (!team) {
    return (
      <SoccerAggregateEmptyState
        title="No team totals"
        detail="The included matches did not produce a readable team summary."
      />
    )
  }
  return (
    <div className="space-y-4">
      <RecordSummary team={team} />
      <ForAgainstSummary team={team} />
      {extra}
    </div>
  )
}

function RecordSummary({ team }: { team: SoccerAggregateTeam }) {
  const { result } = team
  const cells = [
    ['M', result.matches],
    ['W', result.wins],
    ['D', result.draws],
    ['L', result.losses],
    ['GF', result.goalsFor],
    ['GA', result.goalsAgainst],
    ['GD', result.goalDifference > 0 ? `+${result.goalDifference}` : result.goalDifference],
    ['CS', result.cleanSheets],
  ] as const
  return (
    <section>
      <h2 className="font-semibold text-slate-800 mb-2">Overview</h2>
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
        {cells.map(([label, value]) => (
          <div key={label} className="bg-white px-2 py-3 text-center">
            <p className="font-bold text-slate-900 tabular-nums">{value}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function ForAgainstSummary({ team }: { team: SoccerAggregateTeam }) {
  const rows = [
    ['Goals', 'goals'],
    ['Shots', 'shots'],
    ['On target', 'shotsOnTarget'],
    ['Corners', 'corners'],
    ['Offsides', 'offsides'],
    ['Fouls', 'fouls'],
    ['Yellow', 'yellowCards'],
    ['Red', 'redCards'],
  ] as const
  return (
    <section>
      <h2 className="font-semibold text-slate-800 mb-2">For / Against</h2>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Stat</th>
              <th className="px-3 py-2 text-right font-semibold">For</th>
              <th className="px-3 py-2 text-right font-semibold">Against</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key]) => (
              <tr key={key} className="border-t border-slate-100">
                <th className="px-3 py-2 text-left font-medium text-slate-700">{label}</th>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                  {team.forAgainst.tracked[key]}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {team.forAgainst.opponent[key]}
                </td>
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
  aggregate: SoccerAggregateResult
  teamIdForLinks: string | null
  seasonId: string | null
}) {
  const [categoryId, setCategoryId] = useState('attack')
  const category = SOCCER_AGGREGATE_DESTINATION_CATEGORIES.find(
    item => item.id === categoryId
  ) ?? SOCCER_AGGREGATE_DESTINATION_CATEGORIES[1]
  const [metricId, setMetricId] = useState<SoccerAggregateMetricId>(
    category.defaultMetricId
  )

  useEffect(() => {
    setMetricId(category.defaultMetricId)
  }, [category])

  if (aggregate.players.length === 0) {
    return (
      <SoccerAggregateEmptyState
        title="No resolved players"
        detail="Match totals are available, but no participant has a stable cloud player identity."
      />
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Statistic categories">
        {SOCCER_AGGREGATE_DESTINATION_CATEGORIES.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategoryId(item.id)}
            className={`h-9 px-3 rounded-lg text-sm font-semibold whitespace-nowrap border ${
              item.id === category.id
                ? 'bg-slate-800 border-slate-800 text-white'
                : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-slate-500">Rank by</span>
        <select
          value={metricId}
          onChange={event => setMetricId(event.target.value as SoccerAggregateMetricId)}
          className="input-field mt-1"
        >
          {category.metricIds.map(id => (
            <option key={id} value={id}>{soccerAggregateMetricLabel(id).label}</option>
          ))}
        </select>
      </label>
      {soccerAggregateCategoryHasValues(aggregate.players, category) ? (
        <PlayerTable
          players={aggregate.players}
          category={category}
          metricId={metricId}
          teamIdForLinks={teamIdForLinks}
          seasonId={seasonId}
        />
      ) : (
        <SoccerAggregateEmptyState
          title={`No ${category.label.toLowerCase()} statistics`}
          detail="Choose another category or record this statistic in a completed match."
        />
      )}
    </section>
  )
}

function PlayerTable({
  players,
  category,
  metricId,
  teamIdForLinks,
  seasonId,
}: {
  players: SoccerAggregateResult['players']
  category: SoccerAggregateCategoryDestination
  metricId: SoccerAggregateMetricId
  teamIdForLinks: string | null
  seasonId: string | null
}) {
  const sorted = useMemo(
    () => sortSoccerAggregatePlayers(players, metricId, category.rankingMetricIds),
    [category.rankingMetricIds, metricId, players]
  )
  const columns = soccerAggregateVisibleColumns(category, metricId)
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold min-w-[150px]">
              Player
            </th>
            {columns.map(id => (
              <th key={id} className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                {soccerAggregateMetricLabel(id).shortLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((player, index) => {
            const teamId = teamIdForLinks && player.teamIds.includes(teamIdForLinks)
              ? teamIdForLinks
              : player.teamIds[0] ?? null
            return (
              <tr key={player.playerId} className="border-t border-slate-100">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-slate-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 shrink-0 text-xs text-slate-400">{index + 1}</span>
                    {teamId ? (
                      <Link
                        to={playerInfoPath(player.playerId, teamId, seasonId)}
                        className="truncate hover:underline"
                      >
                        {player.number ? `#${player.number} ` : ''}{player.displayName}
                      </Link>
                    ) : (
                      <span className="truncate">
                        {player.number ? `#${player.number} ` : ''}{player.displayName}
                      </span>
                    )}
                  </div>
                </th>
                {columns.map(id => (
                  <td
                    key={id}
                    className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${
                      id === metricId ? 'font-bold text-slate-900' : 'text-slate-600'
                    }`}
                  >
                    {formatSoccerAggregateMetric(player, id)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Games({ games }: { games: SoccerAggregateGame[] }) {
  if (games.length === 0) {
    return (
      <SoccerAggregateEmptyState
        title="No games"
        detail="No completed canonical matches are in this scope."
      />
    )
  }
  return (
    <section className="space-y-2">
      {games.map(game => (
        <Link
          key={game.publicationId}
          to={gameInfoPath(game.gameId, game.teamId)}
          className="block rounded-lg border border-slate-200 bg-white px-3 py-3 hover:border-sky-300"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-slate-800 truncate">{game.trackedTeamName}</p>
              <p className="text-sm text-slate-500 truncate">
                {game.date} vs {game.opponentName}
              </p>
            </div>
            <span className={`font-bold shrink-0 ${
              game.result === 'win'
                ? 'text-emerald-700'
                : game.result === 'loss'
                  ? 'text-rose-700'
                  : 'text-slate-600'
            }`}>
              {game.result === 'win' ? 'W' : game.result === 'loss' ? 'L' : 'D'}{' '}
              {game.trackedScore}-{game.opponentScore}
            </span>
          </div>
        </Link>
      ))}
    </section>
  )
}

export function SoccerAggregateEmptyState({
  title,
  detail,
}: {
  title: string
  detail: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-5 text-center">
      <p className="font-semibold text-slate-700">{title}</p>
      <p className="text-sm text-slate-500 mt-1">{detail}</p>
    </div>
  )
}
