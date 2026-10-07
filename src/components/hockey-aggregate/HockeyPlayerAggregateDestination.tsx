import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHockeyAggregateDestination } from '../../hooks/useHockeyAggregateDestination'
import {
  hockeyPlayerAggregateGames,
  hockeyPlayerCareerSegments,
  hockeyPlayerProfileBreakdown,
  selectHockeyAggregatePlayer,
  visibleHockeyPlayerCategories,
  type HockeyAggregatePlayerIdentity,
  type HockeyPlayerCareerSegment,
} from '../../lib/hockey/aggregatePlayerDestinations'
import type {
  HockeyAggregateGame,
  HockeyAggregatePlayer,
} from '../../lib/hockey/aggregateProjection'
import {
  formatHockeyAggregateMetric,
  hockeyAggregateMetric,
  hockeyAggregateMetricValue,
  type HockeyAggregateMetricId,
} from '../../lib/hockey/aggregateStats'
import type { HockeyAggregateLoadScope } from '../../lib/hockey/aggregateTransport'
import { hockeyGameLineText } from '../../lib/hockey/aggregateDestinations'
import { hockeySummaryPath } from '../../lib/hockey/summary'
import { supabase } from '../../lib/supabase'
import {
  HockeyAggregateEmptyState,
  HockeyAggregateErrorState,
  HockeyAggregateGameScore,
  HockeyAggregateLoadingState,
  HockeyAggregateNotice,
  HockeyAggregateQualityNotice,
  RefreshButton,
} from './HockeyAggregateDestination'

/**
 * Hockey Player Profile and Career (HKY-6B2). A profile shows the team-season totals with
 * the player's personal games kept apart; Career groups every game by team season.
 */

interface HockeyPlayerAggregateDestinationProps {
  variant: 'profile' | 'career'
  scope: HockeyAggregateLoadScope
  identity: HockeyAggregatePlayerIdentity
  seasonName?: string | null
}

export function HockeyPlayerAggregateDestination({ variant, scope, identity, seasonName = null }: HockeyPlayerAggregateDestinationProps) {
  const stableIdentity = useMemo<HockeyAggregatePlayerIdentity>(
    () => ({ playerId: identity.playerId, displayName: identity.displayName, number: identity.number }),
    [identity.displayName, identity.number, identity.playerId]
  )
  const primary = useHockeyAggregateDestination({ scope, teamIds: [] })
  const personalScope = useMemo<HockeyAggregateLoadScope | null>(
    () => (variant === 'profile' ? { type: 'player', playerId: stableIdentity.playerId } : null),
    [stableIdentity.playerId, variant]
  )
  const personal = useHockeyAggregateDestination({ scope: personalScope, teamIds: [], enabled: variant === 'profile' })
  const refreshPrimary = primary.refresh
  const refreshPersonal = personal.refresh
  const refresh = useCallback(() => {
    refreshPrimary()
    if (variant === 'profile') refreshPersonal()
  }, [refreshPersonal, refreshPrimary, variant])

  const aggregate = primary.result?.aggregate ?? null
  const personalAggregate = personal.result?.aggregate ?? null
  const profile = useMemo(
    () => (aggregate && variant === 'profile' && personalAggregate
      ? hockeyPlayerProfileBreakdown(aggregate, personalAggregate, stableIdentity)
      : null),
    [aggregate, personalAggregate, stableIdentity, variant]
  )
  const player = useMemo(
    () => (aggregate ? profile?.teamPlayer ?? selectHockeyAggregatePlayer(aggregate, stableIdentity) : null),
    [aggregate, profile, stableIdentity]
  )
  const games = useMemo(() => {
    if (!aggregate) return []
    if (variant === 'profile') return profile?.teamGames ?? hockeyPlayerAggregateGames(aggregate, stableIdentity.playerId).filter(game => game.cloudScope === 'team')
    return hockeyPlayerAggregateGames(aggregate, stableIdentity.playerId)
  }, [aggregate, profile, stableIdentity.playerId, variant])
  const segments = useMemo(
    () => (aggregate && variant === 'career' ? hockeyPlayerCareerSegments(aggregate, stableIdentity) : []),
    [aggregate, stableIdentity, variant]
  )
  const seasonNames = useSeasonNames(segments.map(segment => segment.seasonId))
  const loading = primary.loading || personal.loading

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-content">{variant === 'career' ? 'Career totals' : 'Season totals'}</p>
          <p className="text-xs text-content-muted mt-0.5">Finalized Hockey games</p>
        </div>
        <RefreshButton loading={loading} refresh={refresh} />
      </div>

      {primary.loading && !primary.result && <HockeyAggregateLoadingState progress={primary.progress} />}
      {primary.error && !primary.result && <HockeyAggregateErrorState code={primary.error.code} refresh={refresh} />}
      {primary.error && primary.result && <HockeyAggregateNotice>Refresh failed. Showing the last Hockey statistics that loaded.</HockeyAggregateNotice>}
      {variant === 'profile' && personal.error && primary.result && (
        <HockeyAggregateNotice>Personal games could not load. Team totals are still shown.</HockeyAggregateNotice>
      )}

      {aggregate && player && (
        <>
          <HockeyAggregateQualityNotice aggregate={aggregate} />
          {games.length === 0 && (
            <HockeyAggregateEmptyState title="No finalized games" detail="Totals stay at zero until a game this player played in is finalized." />
          )}
          <PlayerCategorySections player={player} />
          {variant === 'profile' ? (
            <>
              <PlayerGameHistory title={seasonName ? `${seasonName} games` : 'Games'} games={games} />
              {profile?.personalSegment && <PersonalHistory segment={profile.personalSegment} />}
            </>
          ) : (
            <CareerHistory segments={segments} seasonNames={seasonNames} />
          )}
        </>
      )}
    </div>
  )
}

function PlayerCategorySections({ player, compact = false }: { player: HockeyAggregatePlayer; compact?: boolean }) {
  const categories = visibleHockeyPlayerCategories(player)
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {categories.map(category => {
        const metricIds = category.metricIds.filter(id => id === 'hky_gp' || id === 'hky_pm' || hockeyAggregateMetricValue(player, id) !== null)
        return (
          <section key={category.id} className="rounded-lg border border-line bg-surface overflow-hidden">
            <h3 className="px-3 py-2 text-sm font-semibold text-content bg-canvas border-b border-line">{category.label}</h3>
            <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
              {metricIds.map(id => (
                <div key={id} className="min-w-0 px-3 py-2.5 border-b border-r border-line">
                  <p className="text-xs text-content-muted truncate">{hockeyAggregateMetric(id).label}</p>
                  <p className="font-bold text-content tabular-nums mt-0.5">{metricText(player, id, category.role)}</p>
                  {id === 'hky_pm' && (
                    <p className="text-[11px] text-content-muted mt-0.5">{player.plusMinus.included} of {player.plusMinus.total} games</p>
                  )}
                  {id === 'save_pct' && player.timeInNet.included < player.timeInNet.total && (
                    <p className="text-[11px] text-content-muted mt-0.5">
                      Timed in {player.timeInNet.included} of {player.timeInNet.total} games; GAA needs all of them.
                    </p>
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

function metricText(player: HockeyAggregatePlayer, id: HockeyAggregateMetricId, role: 'skater' | 'goalie'): string {
  if (id === 'hky_gp') return String(role === 'goalie' ? player.goalieGames : player.skaterGames)
  return formatHockeyAggregateMetric(player, id)
}

function PersonalHistory({ segment }: { segment: HockeyPlayerCareerSegment }) {
  return (
    <section className="space-y-3 border-t border-line pt-5">
      <div>
        <h2 className="font-semibold text-content">Personal games</h2>
        <p className="text-xs text-content-muted mt-0.5">Games you tracked outside a team stay out of team and season totals.</p>
      </div>
      <PlayerCategorySections player={segment.player} compact />
      <PlayerGameHistory title="Personal games" games={segment.games} />
    </section>
  )
}

function CareerHistory({ segments, seasonNames }: { segments: HockeyPlayerCareerSegment[]; seasonNames: Record<string, string> }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-content">By season</h2>
        <p className="text-xs text-content-muted mt-0.5">Each team season and personal games stay separate.</p>
      </div>
      {segments.length === 0 ? (
        <HockeyAggregateEmptyState title="No history" detail="Finalized Hockey games will appear here." />
      ) : (
        segments.map(segment => (
          <details key={segment.key} className="rounded-lg border border-line bg-surface overflow-hidden">
            <summary className="cursor-pointer list-none px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-content truncate">
                    {segment.kind === 'personal' ? 'Personal' : (segment.seasonId && seasonNames[segment.seasonId]) || fallbackSeasonLabel(segment)}
                  </p>
                  {segment.kind === 'team' && <p className="text-sm text-content-muted truncate">{segment.teamName}</p>}
                </div>
                <span className="text-sm font-semibold text-content shrink-0">{segmentHeadline(segment.player)}</span>
              </div>
            </summary>
            <div className="border-t border-line bg-canvas px-3 py-3 space-y-4">
              <PlayerCategorySections player={segment.player} compact />
              <PlayerGameHistory title="Games" games={segment.games} />
            </div>
          </details>
        ))
      )}
    </section>
  )
}

function segmentHeadline(player: HockeyAggregatePlayer): string {
  const parts: string[] = []
  if (player.skaterGames > 0) parts.push(`${player.skaterGames} GP, ${player.stats.hky_pts ?? 0} PTS`)
  if (player.goalieGames > 0) parts.push(`${player.goalieGames} GP in net`)
  return parts.join(' · ') || '0 GP'
}

function PlayerGameHistory({ title, games }: { title: string; games: HockeyAggregateGame[] }) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-content">{title}</h2>
      {games.length === 0 ? (
        <p className="text-sm text-content-muted">No finalized games yet.</p>
      ) : (
        games.map(game => (
          <Link
            key={game.sourceId}
            to={hockeySummaryPath({ gameId: game.gameId, tab: 'overview', from: game.teamId ? 'team' : 'sport', teamId: game.teamId })}
            className="block rounded-lg border border-line bg-surface px-3 py-3 hover:border-accent"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-content truncate">{game.date} vs {game.opponentName}</p>
                <p className="text-xs text-content-muted mt-0.5">{hockeyGameLineText(game.player)}</p>
                <p className="text-xs text-content-subtle mt-0.5 break-words">{game.cloudScope === 'personal' ? 'Personal' : game.trackedTeamName}</p>
              </div>
              <HockeyAggregateGameScore game={game} />
            </div>
          </Link>
        ))
      )}
    </section>
  )
}

function fallbackSeasonLabel(segment: { newestGameDate: string; oldestGameDate: string }): string {
  const oldestYear = segment.oldestGameDate.slice(0, 4)
  const newestYear = segment.newestGameDate.slice(0, 4)
  return oldestYear === newestYear ? `${oldestYear} season` : `${oldestYear}-${newestYear.slice(2)} season`
}

function useSeasonNames(seasonIds: Array<string | null>): Record<string, string> {
  const key = [...new Set(seasonIds.filter((id): id is string => Boolean(id)))].sort().join(',')
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!key || !supabase) {
      setNames({})
      return
    }
    let current = true
    void (async () => {
      const response = await supabase!.from('seasons').select('id,name').in('id', key.split(','))
      if (!current || response.error) return
      setNames(Object.fromEntries(((response.data ?? []) as Array<{ id: string; name: string }>).map(row => [row.id, row.name])))
    })()
    return () => {
      current = false
    }
  }, [key])
  return names
}

