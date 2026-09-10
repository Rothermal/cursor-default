import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSoccerAggregateDestination } from '../../hooks/useSoccerAggregateDestination'
import {
  formatSoccerAggregateMetric,
  soccerAggregateMetricLabel,
} from '../../lib/soccer/aggregateDestinations'
import {
  selectSoccerAggregatePlayer,
  soccerPlayerAggregateGames,
  soccerPlayerCareerSegments,
  visibleSoccerPlayerAggregateCategories,
  type SoccerAggregatePlayerIdentity,
} from '../../lib/soccer/aggregatePlayerDestinations'
import type {
  SoccerAggregateGame,
  SoccerAggregatePlayer,
} from '../../lib/soccer/aggregateProjection'
import type { SoccerAggregateStats } from '../../lib/soccer/aggregateStats'
import type { SoccerCanonicalAggregateLoadScope } from '../../lib/soccer/aggregateTransport'
import { soccerSummaryPath } from '../../lib/soccer/summary'
import { supabase } from '../../lib/supabase'
import {
  SoccerAggregateEmptyState,
  SoccerAggregateErrorState,
  SoccerAggregateLoadingState,
  SoccerAggregateQualityNotice,
} from './SoccerAggregateDestination'

interface SoccerPlayerAggregateDestinationProps {
  variant: 'profile' | 'career'
  scope: SoccerCanonicalAggregateLoadScope
  teamIds: string[]
  identity: SoccerAggregatePlayerIdentity
  seasonName?: string | null
}

export function SoccerPlayerAggregateDestination({
  variant,
  scope,
  teamIds,
  identity,
  seasonName = null,
}: SoccerPlayerAggregateDestinationProps) {
  const {
    result,
    progress,
    loading,
    refreshing,
    error,
    rosterWarning,
    refresh,
  } = useSoccerAggregateDestination({ scope, teamIds })
  const aggregate = result?.aggregate ?? null
  const identityTeamKey = [...new Set(identity.teamIds ?? [])].sort().join(',')
  const stableIdentity = useMemo<SoccerAggregatePlayerIdentity>(() => ({
    playerId: identity.playerId,
    displayName: identity.displayName,
    number: identity.number,
    teamIds: identityTeamKey ? identityTeamKey.split(',') : [],
  }), [
    identity.displayName,
    identity.number,
    identity.playerId,
    identityTeamKey,
  ])
  const player = useMemo(
    () => aggregate ? selectSoccerAggregatePlayer(aggregate, stableIdentity) : null,
    [aggregate, stableIdentity]
  )
  const games = useMemo(
    () => aggregate
      ? soccerPlayerAggregateGames(aggregate, stableIdentity.playerId)
      : [],
    [aggregate, stableIdentity.playerId]
  )
  const segments = useMemo(
    () => aggregate && variant === 'career'
      ? soccerPlayerCareerSegments(aggregate, stableIdentity)
      : [],
    [aggregate, stableIdentity, variant]
  )
  const seasonNames = useSoccerAggregateSeasonNames(
    segments.map(segment => segment.seasonId)
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-content">
            {variant === 'career' ? 'Career totals' : 'Season totals'}
          </p>
          <p className="text-xs text-content-muted mt-0.5">
            Completed canonical soccer matches
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="w-9 h-9 rounded-lg border border-line bg-surface text-content-muted
                     flex items-center justify-center shrink-0 hover:bg-canvas disabled:bg-control-disabled disabled:text-content-disabled"
          aria-label="Refresh soccer statistics"
          title="Refresh"
        >
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && !result && <SoccerAggregateLoadingState progress={progress} />}
      {error && !result && (
        <SoccerAggregateErrorState code={error.code} refresh={refresh} />
      )}
      {error && result && (
        <div className="rounded-lg border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
          Refresh failed. Showing the last successfully loaded canonical statistics.
        </div>
      )}
      {rosterWarning && result && (
        <div className="rounded-lg border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
          {rosterWarning}
        </div>
      )}

      {aggregate && player && (
        <>
          {refreshing && (
            <p className="text-xs text-content-muted" role="status">
              Refreshing canonical matches...
            </p>
          )}
          <SoccerAggregateQualityNotice aggregate={aggregate} />
          {aggregate.includedMatchCount === 0 && (
            <SoccerAggregateEmptyState
              title="No completed canonical matches"
              detail="Participation remains available at zero until a soccer match is finalized."
            />
          )}
          <PlayerCategorySections player={player} />

          {variant === 'profile' ? (
            <PlayerGameHistory
              title={seasonName ? `${seasonName} game history` : 'Game history'}
              games={games}
              playerId={stableIdentity.playerId}
            />
          ) : (
            <CareerHistory
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

function PlayerCategorySections({
  player,
  compact = false,
}: {
  player: SoccerAggregatePlayer
  compact?: boolean
}) {
  const categories = visibleSoccerPlayerAggregateCategories(player)
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {categories.map(category => (
        <section
          key={category.id}
          className="rounded-lg border border-line bg-surface overflow-hidden"
        >
          <h3 className="px-3 py-2 text-sm font-semibold text-content bg-canvas border-b border-line">
            {category.label}
          </h3>
          <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {category.metricIds.map(metricId => (
              <div
                key={metricId}
                className="min-w-0 px-3 py-2.5 border-b border-r border-line"
              >
                <p className="text-xs text-content-muted truncate">
                  {soccerAggregateMetricLabel(metricId).label}
                </p>
                <p className="font-bold text-content tabular-nums mt-0.5">
                  {formatSoccerAggregateMetric(player, metricId)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function CareerHistory({
  segments,
  playerId,
  seasonNames,
}: {
  segments: ReturnType<typeof soccerPlayerCareerSegments>
  playerId: string
  seasonNames: Record<string, string>
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-content">By season</h2>
        <p className="text-xs text-content-muted mt-0.5">
          Team stints remain separate when a player appears for more than one team.
        </p>
      </div>
      {segments.length === 0 ? (
        <SoccerAggregateEmptyState
          title="No season history"
          detail="Finalized canonical matches will appear here."
        />
      ) : (
        segments.map(segment => (
          <details
            key={segment.key}
            className="rounded-lg border border-line bg-surface overflow-hidden"
          >
            <summary className="cursor-pointer list-none px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-content truncate">
                    {segment.seasonId
                      ? seasonNames[segment.seasonId] ?? fallbackSeasonLabel(segment)
                      : fallbackSeasonLabel(segment)}
                  </p>
                  <p className="text-sm text-content-muted truncate">{segment.teamName}</p>
                </div>
                <span className="text-sm font-semibold text-content shrink-0">
                  {segment.player.stats.soc_app} APP
                </span>
              </div>
            </summary>
            <div className="border-t border-line bg-canvas px-3 py-3 space-y-4">
              <PlayerCategorySections player={segment.player} compact />
              <PlayerGameHistory
                title="Games"
                games={segment.games}
                playerId={playerId}
              />
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
  games: SoccerAggregateGame[]
  playerId: string
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-content">{title}</h2>
      {games.length === 0 ? (
        <p className="text-sm text-content-muted">No finalized canonical games yet.</p>
      ) : (
        games.map(game => (
          <Link
            key={game.publicationId}
            to={soccerSummaryPath({
              gameId: game.gameId,
              tab: 'players',
              from: 'team',
              teamId: game.teamId,
            })}
            className="block rounded-lg border border-line bg-surface px-3 py-3 hover:border-accent"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-content truncate">
                  {game.date} vs {game.opponentName}
                </p>
                <p className="text-xs text-content-muted mt-0.5">
                  {compactGameLine(game.playerStats?.[playerId])}
                </p>
              </div>
              <span className={`font-bold shrink-0 ${
                game.result === 'win'
                  ? 'text-success-content'
                  : game.result === 'loss'
                    ? 'text-danger-content'
                    : 'text-content-muted'
              }`}>
                {game.result === 'win' ? 'W' : game.result === 'loss' ? 'L' : 'D'}{' '}
                {game.trackedScore}-{game.opponentScore}
              </span>
            </div>
          </Link>
        ))
      )}
    </section>
  )
}

function compactGameLine(stats: SoccerAggregateStats | undefined): string {
  if (!stats) return 'Canonical player detail unavailable'
  return [
    `${stats.soc_goal} G`,
    `${stats.soc_ast} A`,
    `${stats.soc_sot} SOT`,
    `${stats.soc_min_sec < 3_600
      ? `${Math.floor(stats.soc_min_sec / 60)}:${String(stats.soc_min_sec % 60).padStart(2, '0')}`
      : `${Math.floor(stats.soc_min_sec / 3_600)}:${String(Math.floor((stats.soc_min_sec % 3_600) / 60)).padStart(2, '0')}:${String(stats.soc_min_sec % 60).padStart(2, '0')}`} MIN`,
  ].join(' · ')
}

function fallbackSeasonLabel(segment: {
  newestGameDate: string
  oldestGameDate: string
}): string {
  const oldestYear = segment.oldestGameDate.slice(0, 4)
  const newestYear = segment.newestGameDate.slice(0, 4)
  return oldestYear === newestYear
    ? `${oldestYear} season`
    : `${oldestYear}-${newestYear.slice(2)} season`
}

function useSoccerAggregateSeasonNames(
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
