import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useBasketballAggregateDestination } from '../../hooks/useBasketballAggregateDestination'
import {
  basketballAggregateMetricLabel,
  basketballPlayerAggregateMetricAvailable,
  formatBasketballAggregateMetric,
} from '../../lib/basketball/aggregateDestinations'
import {
  basketballPlayerAggregateGames,
  basketballPlayerCareerSegments,
  basketballPlayerGameMetricAvailability,
  basketballPlayerProfileBreakdown,
  selectBasketballAggregatePlayer,
  visibleBasketballPlayerAggregateCategories,
  type BasketballAggregatePlayerIdentity,
  type BasketballPlayerCareerSegment,
} from '../../lib/basketball/aggregatePlayerDestinations'
import type {
  BasketballAggregateGame,
  BasketballAggregatePlayer,
  BasketballAggregateResult,
} from '../../lib/basketball/aggregateComposition'
import {
  formatBasketballAggregateStat,
  type BasketballAggregateStats,
} from '../../lib/basketball/aggregateStats'
import type { BasketballAggregateLoadScope } from '../../lib/basketball/aggregateTransport'
import { basketballSummaryPath } from '../../lib/basketball/summary'
import { supabase } from '../../lib/supabase'
import { gameInfoPath } from '../../lib/teamInfo'
import {
  BasketballAggregateEmptyState,
  BasketballAggregateErrorState,
  BasketballAggregateLoadingState,
  BasketballAggregateQualityNotice,
} from './BasketballAggregateDestination'

interface BasketballPlayerAggregateDestinationProps {
  variant: 'profile' | 'career'
  scope: BasketballAggregateLoadScope
  identity: BasketballAggregatePlayerIdentity
  seasonName?: string | null
}

export function BasketballPlayerAggregateDestination({
  variant,
  scope,
  identity,
  seasonName = null,
}: BasketballPlayerAggregateDestinationProps) {
  const identityTeamKey = [...new Set(identity.teamIds ?? [])].sort().join(',')
  const stableIdentity = useMemo<BasketballAggregatePlayerIdentity>(() => ({
    playerId: identity.playerId,
    displayName: identity.displayName,
    number: identity.number,
    teamIds: identityTeamKey ? identityTeamKey.split(',') : [],
  }), [identity.displayName, identity.number, identity.playerId, identityTeamKey])
  const primary = useBasketballAggregateDestination({ scope, teamIds: [] })
  const personalScope = useMemo<BasketballAggregateLoadScope | null>(
    () => variant === 'profile'
      ? { type: 'player', playerId: stableIdentity.playerId }
      : null,
    [stableIdentity.playerId, variant]
  )
  const personal = useBasketballAggregateDestination({
    scope: personalScope,
    teamIds: [],
    enabled: variant === 'profile',
  })
  const refreshPrimary = primary.refresh
  const refreshPersonal = personal.refresh
  const refresh = useCallback(() => {
    refreshPrimary()
    if (variant === 'profile') refreshPersonal()
  }, [refreshPersonal, refreshPrimary, variant])
  const result = primary.result
  const progress = primary.progress
  const loading = primary.loading
  const refreshing = primary.refreshing || personal.refreshing
  const error = primary.error
  const aggregate = result?.aggregate ?? null
  const personalAggregate = personal.result?.aggregate ?? null
  const allPlayer = useMemo(
    () => aggregate ? selectBasketballAggregatePlayer(aggregate, stableIdentity) : null,
    [aggregate, stableIdentity]
  )
  const segments = useMemo(
    () => aggregate ? basketballPlayerCareerSegments(aggregate, stableIdentity) : [],
    [aggregate, stableIdentity]
  )
  const profile = useMemo(
    () => aggregate && variant === 'profile'
      ? basketballPlayerProfileBreakdown(
          aggregate,
          personalAggregate ?? aggregate,
          stableIdentity,
        )
      : null,
    [aggregate, personalAggregate, stableIdentity, variant]
  )
  const player = variant === 'profile' ? profile?.teamPlayer ?? null : allPlayer
  const games = useMemo(
    () => variant === 'profile'
      ? profile?.teamGames ?? []
      : aggregate
        ? basketballPlayerAggregateGames(aggregate, stableIdentity.playerId)
        : [],
    [aggregate, profile, stableIdentity.playerId, variant]
  )
  const seasonNames = useBasketballAggregateSeasonNames(
    variant === 'career' ? segments.map(segment => segment.seasonId) : []
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-800">
            {variant === 'career' ? 'Career totals' : 'Season totals'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Final legacy games and canonical event publications
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || personal.loading}
          className="w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50"
          aria-label="Refresh Basketball statistics"
          title="Refresh"
        >
          <RefreshCw size={17} className={loading || personal.loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && !result && <BasketballAggregateLoadingState progress={progress} />}
      {error && !result && (
        <BasketballAggregateErrorState code={error.code} refresh={refresh} />
      )}
      {error && result && (
        <WarningNotice>
          Refresh failed. Showing the last successfully loaded Basketball statistics.
        </WarningNotice>
      )}
      {primary.rosterWarning && result && (
        <WarningNotice>{primary.rosterWarning}</WarningNotice>
      )}
      {variant === 'profile' && personal.error && (
        <WarningNotice>
          Personal history could not load. Team and season totals remain available.
        </WarningNotice>
      )}
      {variant === 'profile' && personal.loading && !personal.result && result && (
        <p className="text-xs text-slate-500" role="status">Loading personal history...</p>
      )}
      {profile?.personalSegment && personalAggregate?.quality === 'partial' && (
        <WarningNotice>Some authorized personal contributions could not be included.</WarningNotice>
      )}

      {aggregate && player && (
        <>
          {refreshing && (
            <p className="text-xs text-slate-500" role="status">
              Refreshing Basketball history...
            </p>
          )}
          <BasketballAggregateQualityNotice aggregate={aggregate} />
          {aggregate.includedGameCount === 0 && (
            <BasketballAggregateEmptyState
              title="No eligible completed games"
              detail="Participation remains available at zero until an eligible Basketball game is final."
            />
          )}
          <PlayerCategorySections aggregate={aggregate} player={player} />

          {variant === 'profile' ? (
            <>
              <PlayerGameHistory
                title={seasonName ? `${seasonName} game history` : 'Game history'}
                games={games}
                playerId={stableIdentity.playerId}
              />
              {profile?.personalSegment && (
                <PersonalHistory
                  aggregate={personalAggregate ?? aggregate}
                  segment={profile.personalSegment}
                  playerId={stableIdentity.playerId}
                />
              )}
            </>
          ) : (
            <CareerHistory
              aggregate={aggregate}
              segments={segments}
              playerId={stableIdentity.playerId}
              seasonNames={seasonNames}
            />
          )}
        </>
      )}
    </div>
  )
}

function WarningNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {children}
    </div>
  )
}

function PlayerCategorySections({
  aggregate,
  player,
  availableMetricIds = aggregate.availableMetricIds,
  compact = false,
}: {
  aggregate: BasketballAggregateResult
  player: BasketballAggregatePlayer
  availableMetricIds?: BasketballAggregateResult['availableMetricIds']
  compact?: boolean
}) {
  const scopedAggregate = availableMetricIds === aggregate.availableMetricIds
    ? aggregate
    : { ...aggregate, availableMetricIds }
  const categories = visibleBasketballPlayerAggregateCategories(scopedAggregate, player)
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {categories.map(category => {
        const metricIds = category.metricIds.filter(metricId =>
          basketballPlayerAggregateMetricAvailable(scopedAggregate, player, metricId)
        )
        if (metricIds.length === 0) return null
        return (
          <section
            key={category.id}
            className="rounded-lg border border-slate-200 bg-white overflow-hidden"
          >
            <h3 className="px-3 py-2 text-sm font-semibold text-slate-800 bg-slate-50 border-b border-slate-200">
              {category.label}
            </h3>
            <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
              {metricIds.map(metricId => (
                <div
                  key={metricId}
                  className="min-w-0 px-3 py-2.5 border-b border-r border-slate-100"
                >
                  <p className="text-xs text-slate-500 truncate">
                    {basketballAggregateMetricLabel(metricId).label}
                  </p>
                  <p className="font-bold text-slate-900 tabular-nums mt-0.5">
                    {formatBasketballAggregateMetric(player, metricId)}
                  </p>
                  {(metricId === 'bk_pm' || metricId === 'bk_dnp') &&
                    player.metricCoverage[metricId] && (
                    <>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {player.metricCoverage[metricId]!.includedGameCount} of{' '}
                        {player.metricCoverage[metricId]!.totalGameCount} games
                      </p>
                      {!player.metricCoverage[metricId]!.complete &&
                        player.metricCoverage[metricId]!.reasons[0] && (
                        <p className="text-[11px] leading-4 text-amber-700 mt-1">
                          {player.metricCoverage[metricId]!.reasons[0]}
                        </p>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function PersonalHistory({
  aggregate,
  segment,
  playerId,
}: {
  aggregate: BasketballAggregateResult
  segment: BasketballPlayerCareerSegment
  playerId: string
}) {
  return (
    <section className="space-y-3 border-t border-slate-200 pt-5">
      <div>
        <h2 className="font-semibold text-slate-800">Personal contributions</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Authorized personal games stay separate from team and season totals.
        </p>
      </div>
      <PlayerCategorySections
        aggregate={aggregate}
        player={segment.player}
        availableMetricIds={basketballPlayerGameMetricAvailability(segment.games, playerId)}
        compact
      />
      <PlayerGameHistory title="Personal game history" games={segment.games} playerId={playerId} />
    </section>
  )
}

function CareerHistory({
  aggregate,
  segments,
  playerId,
  seasonNames,
}: {
  aggregate: BasketballAggregateResult
  segments: BasketballPlayerCareerSegment[]
  playerId: string
  seasonNames: Record<string, string>
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-slate-800">By season</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Team stints and personal history remain separate.
        </p>
      </div>
      {segments.length === 0 ? (
        <BasketballAggregateEmptyState
          title="No history"
          detail="Eligible completed Basketball games will appear here."
        />
      ) : (
        segments.map(segment => (
          <details
            key={segment.key}
            className="rounded-lg border border-slate-200 bg-white overflow-hidden"
          >
            <summary className="cursor-pointer list-none px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">
                    {segment.kind === 'personal'
                      ? 'Personal'
                      : segment.seasonId
                        ? seasonNames[segment.seasonId] ?? fallbackSeasonLabel(segment)
                        : fallbackSeasonLabel(segment)}
                  </p>
                  {segment.kind === 'team' && (
                    <p className="text-sm text-slate-500 truncate">{segment.teamName}</p>
                  )}
                </div>
                <span className="text-sm font-semibold text-slate-700 shrink-0">
                  {segment.player.stats.bk_app} APP
                </span>
              </div>
            </summary>
            <div className="border-t border-slate-200 bg-slate-50 px-3 py-3 space-y-4">
              <PlayerCategorySections
                aggregate={aggregate}
                player={segment.player}
                availableMetricIds={basketballPlayerGameMetricAvailability(segment.games, playerId)}
                compact
              />
              <PlayerGameHistory title="Games" games={segment.games} playerId={playerId} />
            </div>
          </details>
        ))
      )}
    </section>
  )
}

function PlayerGameHistory({
  title,
  games,
  playerId,
}: {
  title: string
  games: BasketballAggregateGame[]
  playerId: string
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-slate-800">{title}</h2>
      {games.length === 0 ? (
        <p className="text-sm text-slate-500">No eligible completed games yet.</p>
      ) : (
        games.map(game => (
          <Link
            key={`${game.authority}:${game.sourceId}`}
            to={game.authority === 'canonical'
              ? basketballSummaryPath({
                  gameId: game.gameId,
                  tab: 'players',
                  from: game.teamId ? 'team' : 'sport',
                  teamId: game.teamId,
                })
              : gameInfoPath(game.gameId, game.teamId)}
            className="block rounded-lg border border-slate-200 bg-white px-3 py-3 hover:border-sky-300"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-800 truncate">
                  {game.date} vs {game.opponentName}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {compactGameLine(game.playerStats?.[playerId])}
                </p>
                <p className="text-xs text-slate-400 capitalize mt-0.5">
                  {game.cloudScope === 'personal' ? 'Personal' : game.trackedTeamName} - {game.authority}
                </p>
              </div>
              <span className={`font-bold shrink-0 ${
                game.result === 'win'
                  ? 'text-emerald-700'
                  : game.result === 'loss'
                    ? 'text-rose-700'
                    : 'text-slate-600'
              }`}>
                {game.result === 'win' ? 'W' : game.result === 'loss' ? 'L' : 'T'}{' '}
                {game.trackedScore}-{game.opponentScore}
              </span>
            </div>
          </Link>
        ))
      )}
    </section>
  )
}

function compactGameLine(stats: BasketballAggregateStats | undefined): string {
  if (!stats) return 'Player detail unavailable'
  return [
    `${stats.bk_pts} PTS`,
    `${stats.bk_reb} REB`,
    `${stats.bk_ast} AST`,
    `${formatBasketballAggregateStat('bk_min_sec', stats.bk_min_sec)} MIN`,
  ].join(' - ')
}

function fallbackSeasonLabel(segment: { newestGameDate: string; oldestGameDate: string }): string {
  const oldestYear = segment.oldestGameDate.slice(0, 4)
  const newestYear = segment.newestGameDate.slice(0, 4)
  return oldestYear === newestYear
    ? `${oldestYear} season`
    : `${oldestYear}-${newestYear.slice(2)} season`
}

function useBasketballAggregateSeasonNames(
  seasonIds: Array<string | null>
): Record<string, string> {
  const key = [...new Set(seasonIds.filter((id): id is string => Boolean(id)))]
    .sort()
    .join(',')
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!key || !supabase) {
      setNames({})
      return
    }
    let current = true
    const load = async () => {
      const response = await supabase!
        .from('seasons')
        .select('id,name')
        .in('id', key.split(','))
      if (!current || response.error) return
      setNames(Object.fromEntries(
        ((response.data ?? []) as Array<{ id: string; name: string }>)
          .map(row => [row.id, row.name])
      ))
    }
    void load()
    return () => {
      current = false
    }
  }, [key])

  return names
}
