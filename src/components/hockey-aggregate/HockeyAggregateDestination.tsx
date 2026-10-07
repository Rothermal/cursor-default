import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useHockeyAggregateDestination } from '../../hooks/useHockeyAggregateDestination'
import type {
  HockeyAggregateGame,
  HockeyAggregateResult,
  HockeyAggregateTeam,
  HockeyAggregateTeamTotals,
} from '../../lib/hockey/aggregateProjection'
import {
  HOCKEY_AGGREGATE_CATEGORIES,
  formatHockeyAggregateMetric,
  hockeyAggregateMetric,
  hockeyAggregateRankingMetrics,
  rankHockeyAggregatePlayers,
  type HockeyAggregateCategory,
  type HockeyAggregateMetricId,
} from '../../lib/hockey/aggregateStats'
import type {
  HockeyAggregateLoadProgress,
  HockeyAggregateLoadScope,
  HockeyAggregateTransportErrorCode,
} from '../../lib/hockey/aggregateTransport'
import {
  hockeyAggregateErrorCopy,
  hockeyAggregateOutcomeLabel,
  hockeyAggregateQualityMessage,
} from '../../lib/hockey/aggregateDestinations'
import { hockeySummaryPath } from '../../lib/hockey/summary'
import { playerInfoPath } from '../../lib/teamInfo'

/**
 * Hockey season stats (HKY-6B2) for Leaderboard, Team Stats and Tournament Stats: final
 * canonical publications only, one per game. Goalies rank only against goalies.
 */

export type HockeyAggregateDestinationVariant = 'season' | 'team' | 'tournament'

interface HockeyAggregateDestinationProps {
  variant: HockeyAggregateDestinationVariant
  scope: HockeyAggregateLoadScope
  teamIds: string[]
  teamIdForLinks?: string | null
  seasonId?: string | null
  overviewExtra?: ReactNode
  className?: string
}

interface HockeyAggregateDestinationPageProps extends HockeyAggregateDestinationProps {
  title: string
  subtitle: string
  backPath: string
}

type DestinationTab = 'overview' | 'players' | 'games'

export function HockeyAggregateDestinationPage({ title, subtitle, backPath, ...destinationProps }: HockeyAggregateDestinationPageProps) {
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
        <HockeyAggregateDestination {...destinationProps} />
      </main>
    </div>
  )
}

export function HockeyAggregateDestination({
  variant,
  scope,
  teamIds,
  teamIdForLinks = null,
  seasonId = null,
  overviewExtra,
  className = '',
}: HockeyAggregateDestinationProps) {
  const { result, progress, loading, error, rosterWarning, refresh } = useHockeyAggregateDestination({ scope, teamIds })
  const [tab, setTab] = useState<DestinationTab>(variant === 'season' ? 'players' : 'overview')
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
            {variant === 'season' ? 'Season leaderboard' : variant === 'team' ? 'Team statistics' : 'Tournament statistics'}
          </p>
          <p className="text-xs text-content-muted mt-0.5">Finalized Hockey games, one published result per game.</p>
        </div>
        <RefreshButton loading={loading} refresh={refresh} />
      </div>

      {loading && !result && <HockeyAggregateLoadingState progress={progress} />}
      {error && !result && <HockeyAggregateErrorState code={error.code} refresh={refresh} />}
      {error && result && <HockeyAggregateNotice>Refresh failed. Showing the last Hockey statistics that loaded.</HockeyAggregateNotice>}
      {rosterWarning && result && <HockeyAggregateNotice>{rosterWarning}</HockeyAggregateNotice>}

      {aggregate && (
        <>
          {loading && <p className="text-xs text-content-muted" role="status">Refreshing Hockey statistics...</p>}
          <HockeyAggregateQualityNotice aggregate={aggregate} />
          {aggregate.includedGameCount === 0 && aggregate.players.length === 0 ? (
            <HockeyAggregateEmptyState title="No finalized games" detail="Hockey games appear here once a manager finalizes them in the cloud." />
          ) : (
            <>
              {variant !== 'season' && <Tabs value={tab} onChange={setTab} />}
              {tab === 'overview' && <Overview aggregate={aggregate} teamId={teamIdForLinks} extra={overviewExtra} />}
              {tab === 'players' && <Players aggregate={aggregate} teamIdForLinks={teamIdForLinks} seasonId={seasonId} />}
              {tab === 'games' && <Games games={aggregate.games} teamIdForLinks={teamIdForLinks} />}
            </>
          )}
        </>
      )}
    </div>
  )
}

export function RefreshButton({ loading, refresh }: { loading: boolean; refresh: () => void }) {
  return (
    <button
      type="button"
      onClick={refresh}
      disabled={loading}
      className="w-9 h-9 rounded-lg border border-line bg-surface text-content-muted flex items-center justify-center shrink-0 hover:bg-canvas disabled:bg-control-disabled disabled:text-content-disabled"
      aria-label="Refresh Hockey statistics"
      title="Refresh"
    >
      <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
    </button>
  )
}

export function HockeyAggregateLoadingState({ progress }: { progress: HockeyAggregateLoadProgress | null }) {
  const label = progress?.stage === 'projecting'
    ? `Building ${progress.projectedCount} of ${progress.sourceCount} games`
    : progress && progress.sourceCount > 0
      ? `Loaded ${progress.sourceCount} games`
      : 'Loading Hockey history'
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-5 text-center" role="status">
      <RefreshCw size={20} className="animate-spin mx-auto text-accent mb-2" />
      <p className="text-sm font-medium text-content">{label}</p>
      <p className="text-xs text-content-muted mt-1">Large scopes may take a moment.</p>
    </div>
  )
}

export function HockeyAggregateErrorState({ code, refresh }: { code: HockeyAggregateTransportErrorCode; refresh: () => void }) {
  const [title, detail] = hockeyAggregateErrorCopy(code)
  return (
    <div className="rounded-lg border border-danger-line bg-danger px-4 py-4" role="alert">
      <div className="flex gap-3">
        <AlertTriangle size={19} className="text-danger-content shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-danger-content">{title}</p>
          <p className="text-sm text-danger-content mt-1">{detail}</p>
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

export function HockeyAggregateNotice({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">{children}</div>
}

export function HockeyAggregateQualityNotice({ aggregate }: { aggregate: HockeyAggregateResult }) {
  const message = hockeyAggregateQualityMessage(aggregate)
  if (!message) return null
  return (
    <section className="rounded-lg border border-warning-line bg-warning px-4 py-3">
      <div className="flex gap-2">
        <AlertTriangle size={17} className="text-warning-content shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-warning-content">Partial statistics</p>
          <p className="text-sm text-warning-content mt-0.5">{message}</p>
        </div>
      </div>
    </section>
  )
}

function Tabs({ value, onChange }: { value: DestinationTab; onChange: (value: DestinationTab) => void }) {
  return (
    <div className="grid grid-cols-3 rounded-lg border border-line bg-surface-muted p-1" role="tablist">
      {(['overview', 'players', 'games'] as const).map(tab => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={value === tab}
          onClick={() => onChange(tab)}
          className={`h-9 rounded-md text-sm font-semibold capitalize ${value === tab ? 'bg-surface text-content shadow-sm' : 'text-content-muted hover:text-content'}`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

function Overview({ aggregate, teamId, extra }: { aggregate: HockeyAggregateResult; teamId: string | null; extra?: ReactNode }) {
  const team = teamId ? aggregate.teams.find(item => item.teamId === teamId) ?? aggregate.teams[0] : aggregate.teams[0]
  if (!team) return <HockeyAggregateEmptyState title="No team totals" detail="No finalized team game is in this scope yet." />
  return (
    <div className="space-y-4">
      <RecordSummary team={team} />
      <ForAgainstSummary team={team} />
      {extra}
    </div>
  )
}

function RecordSummary({ team }: { team: HockeyAggregateTeam }) {
  const record = team.record
  const difference = record.goalsFor - record.goalsAgainst
  const cells = [
    ['GP', record.games], ['W', record.wins], ['L', record.losses], ['OTL', record.overtimeLosses],
    ['T', record.ties], ['GF', record.goalsFor], ['GA', record.goalsAgainst],
    ['DIFF', difference > 0 ? `+${difference}` : difference],
  ] as const
  return (
    <section>
      <h2 className="font-semibold text-content mb-2">Record</h2>
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

const TEAM_TOTAL_ROWS: Array<[string, keyof HockeyAggregateTeamTotals]> = [
  ['Goals', 'goals'], ['Shots on goal', 'shotsOnGoal'], ['Power-play goals', 'powerPlayGoals'],
  ['Short-handed goals', 'shortHandedGoals'], ['Faceoffs won', 'faceoffsWon'], ['Hits', 'hits'],
  ['Blocked shots', 'blockedShots'], ['Takeaways', 'takeaways'], ['Giveaways', 'giveaways'],
  ['Penalty minutes', 'penaltyMinutes'],
]

function ForAgainstSummary({ team }: { team: HockeyAggregateTeam }) {
  return (
    <section>
      <h2 className="font-semibold text-content mb-2">Team totals</h2>
      <p className="text-xs text-content-muted mb-2">Includes events with no named player. GF and GA above also count the goal a shootout win adds.</p>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-content-muted">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Stat</th>
              <th className="px-3 py-2 text-right font-semibold">For</th>
              <th className="px-3 py-2 text-right font-semibold">Against</th>
            </tr>
          </thead>
          <tbody>
            {TEAM_TOTAL_ROWS.map(([label, key]) => (
              <tr key={key} className="border-t border-line">
                <th className="px-3 py-2 text-left font-medium text-content">{label}</th>
                <td className="px-3 py-2 text-right tabular-nums text-content">{team.totals.tracked[key]}</td>
                <td className="px-3 py-2 text-right tabular-nums text-content-muted">{team.totals.opponent[key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Players({ aggregate, teamIdForLinks, seasonId }: { aggregate: HockeyAggregateResult; teamIdForLinks: string | null; seasonId: string | null }) {
  const [categoryId, setCategoryId] = useState('scoring')
  const category = HOCKEY_AGGREGATE_CATEGORIES.find(item => item.id === categoryId) ?? HOCKEY_AGGREGATE_CATEGORIES[0]
  const rankingMetrics = useMemo(() => hockeyAggregateRankingMetrics(aggregate.players, category), [aggregate.players, category])
  const defaultMetric = rankingMetrics.includes(category.defaultMetricId) ? category.defaultMetricId : rankingMetrics[0] ?? category.defaultMetricId
  const [metricId, setMetricId] = useState<HockeyAggregateMetricId>(defaultMetric)
  useEffect(() => setMetricId(defaultMetric), [category, defaultMetric])
  const ranked = useMemo(() => rankHockeyAggregatePlayers(aggregate.players, category, metricId), [aggregate.players, category, metricId])

  if (aggregate.players.length === 0) {
    return <HockeyAggregateEmptyState title="No players" detail="Team totals are available, but no player line has a team roster identity." />
  }
  return (
    <section className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Statistic categories">
        {HOCKEY_AGGREGATE_CATEGORIES.map(item => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === category.id}
            onClick={() => setCategoryId(item.id)}
            className={`h-9 px-3 rounded-lg text-sm font-semibold whitespace-nowrap border ${item.id === category.id ? 'bg-accent border-accent text-accent-content' : 'bg-surface border-line text-content-muted'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-content-muted">Rank by</span>
        <select value={metricId} onChange={event => setMetricId(event.target.value as HockeyAggregateMetricId)} className="input-field mt-1">
          {rankingMetrics.map(id => <option key={id} value={id}>{hockeyAggregateMetric(id).label}</option>)}
        </select>
      </label>
      {category.id === 'plus_minus' && aggregate.plusMinus.included < aggregate.plusMinus.total && (
        <HockeyAggregateNotice>
          Plus/minus counts goals with every skater on the ice recorded: {aggregate.plusMinus.included} of {aggregate.plusMinus.total} games are complete.
        </HockeyAggregateNotice>
      )}
      {category.role === 'goalie' && !rankingMetrics.includes('gaa') && ranked.length > 0 && (
        <p className="text-xs text-content-muted">GAA and time in net show once every game a goalie played was timed.</p>
      )}
      {ranked.length === 0 ? (
        <HockeyAggregateEmptyState
          title={category.role === 'goalie' ? 'No goalie games' : `No ${category.label.toLowerCase()} statistics`}
          detail={category.role === 'goalie' ? 'Goalies appear once they have played in net.' : 'Nothing in this category has been recorded yet.'}
        />
      ) : (
        <PlayerTable players={ranked} category={category} metricId={metricId} rankingMetrics={rankingMetrics} teamIdForLinks={teamIdForLinks} seasonId={seasonId} />
      )}
    </section>
  )
}

function PlayerTable({
  players,
  category,
  metricId,
  rankingMetrics,
  teamIdForLinks,
  seasonId,
}: {
  players: HockeyAggregateResult['players']
  category: HockeyAggregateCategory
  metricId: HockeyAggregateMetricId
  rankingMetrics: HockeyAggregateMetricId[]
  teamIdForLinks: string | null
  seasonId: string | null
}) {
  const columns = category.metricIds.filter(id => rankingMetrics.includes(id))
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="bg-canvas text-content-muted">
          <tr>
            <th className="sticky left-0 z-10 bg-canvas px-3 py-2 text-left font-semibold w-[180px] min-w-[180px] max-w-[180px]">
              {category.role === 'goalie' ? 'Goalie' : 'Player'}
            </th>
            {columns.map(id => (
              <th key={id} className="px-2 py-2 text-right font-semibold whitespace-nowrap" title={hockeyAggregateMetric(id).label}>
                {hockeyAggregateMetric(id).shortLabel}
              </th>
            ))}
            {category.id === 'plus_minus' && <th className="px-2 py-2 text-right font-semibold whitespace-nowrap" title="Games with every skater on the ice recorded">Counted</th>}
          </tr>
        </thead>
        <tbody>
          {players.map((player, index) => {
            const teamId = teamIdForLinks && player.teamIds.includes(teamIdForLinks) ? teamIdForLinks : player.teamIds[0] ?? null
            const name = `${player.number ? `#${player.number} ` : ''}${player.displayName}`
            return (
              <tr key={player.playerId} className="border-t border-line">
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium text-content w-[180px] min-w-[180px] max-w-[180px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 shrink-0 text-xs text-content-subtle">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      {teamId ? (
                        <Link to={playerInfoPath(player.playerId, teamId, seasonId)} className="block truncate hover:underline">{name}</Link>
                      ) : (
                        <span className="block truncate">{name}</span>
                      )}
                      <Link to={`/career?playerId=${encodeURIComponent(player.playerId)}&sport=hockey`} className="text-[11px] font-semibold text-accent hover:underline">
                        Career
                      </Link>
                    </div>
                  </div>
                </th>
                {columns.map(id => (
                  <td key={id} className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${id === metricId ? 'font-bold text-content' : 'text-content-muted'}`}>
                    {id === 'hky_gp' && category.role === 'goalie'
                      ? player.goalieGames
                      : id === 'hky_gp'
                        ? player.skaterGames
                        : formatHockeyAggregateMetric(player, id)}
                  </td>
                ))}
                {category.id === 'plus_minus' && (
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-content-muted">
                    {player.plusMinus.included} of {player.plusMinus.total}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Games({ games, teamIdForLinks }: { games: HockeyAggregateGame[]; teamIdForLinks: string | null }) {
  if (games.length === 0) return <HockeyAggregateEmptyState title="No games" detail="No finalized Hockey game is in this scope yet." />
  return (
    <section className="space-y-2">
      {games.map(game => (
        <Link
          key={game.sourceId}
          to={hockeySummaryPath({ gameId: game.gameId, tab: 'overview', from: 'team', teamId: game.teamId ?? teamIdForLinks })}
          className="block rounded-lg border border-line bg-surface px-3 py-3 hover:border-accent"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-content truncate">{game.trackedTeamName}</p>
              <p className="text-sm text-content-muted truncate">{game.date} vs {game.opponentName}</p>
            </div>
            <HockeyAggregateGameScore game={game} />
          </div>
        </Link>
      ))}
    </section>
  )
}

export function HockeyAggregateGameScore({ game }: { game: HockeyAggregateGame }) {
  const tone = game.outcome === 'win' ? 'text-success-content' : game.outcome === 'tie' ? 'text-content-muted' : 'text-danger-content'
  return (
    <span className={`font-bold shrink-0 tabular-nums ${tone}`}>
      {hockeyAggregateOutcomeLabel(game)} {game.trackedScore}-{game.opponentScore}
    </span>
  )
}

export function HockeyAggregateEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-5 text-center">
      <p className="font-semibold text-content">{title}</p>
      <p className="text-sm text-content-muted mt-1">{detail}</p>
    </div>
  )
}
