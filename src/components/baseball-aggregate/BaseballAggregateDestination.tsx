import { useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useBaseballAggregateDestination, type BaseballTotalsSource } from '../../hooks/useBaseballAggregateDestination'
import { BASEBALL_DESTINATION_METRICS, baseballCareerSegments, baseballMetricText, baseballMetricValue, baseballPlayerFromGames, rankBaseballPlayers, type BaseballAggregateCategory } from '../../lib/baseball/aggregateDestinations'
import { aggregateBaseballMatches } from '../../lib/baseball/aggregateProjection'
import type { BaseballAggregateLoadScope, BaseballAggregateMatch, BaseballAggregatePlayer, BaseballAggregateResult } from '../../lib/baseball/aggregateTypes'
import { BASEBALL_LEGACY_STATS, type BaseballLegacyResult } from '../../lib/baseball/legacyAggregates'
import { baseballSummaryPath } from '../../lib/baseball/summary'
import type { BaseballRulesVariant } from '../../lib/baseball/types'
import { playerInfoPath } from '../../lib/teamInfo'

const BASEBALL_VARIANT_LABELS: Record<BaseballRulesVariant, string> = { baseball: 'Baseball', softball_fastpitch: 'Fastpitch softball', softball_slowpitch: 'Slowpitch softball' }
const categories: Array<[BaseballAggregateCategory, string, string]> = [['batting','Batting','bsb_h'], ['running','Baserunning','bsb_sb'], ['pitching','Pitching','bsb_p_k'], ['fielding','Fielding','bsb_f_po']]

export function BaseballAggregateDestination({ scope, teamIds, teamIdForLinks = null, identity, mode = 'team' }: {
  scope: BaseballAggregateLoadScope; teamIds: string[]; teamIdForLinks?: string | null
  identity?: { playerId: string; displayName: string; number: string | null }; mode?: 'team' | 'season' | 'tournament' | 'profile' | 'career'
}) {
  const [source, setSource] = useState<BaseballTotalsSource>('events')
  const [variant, setVariant] = useState<BaseballRulesVariant>('baseball')
  const primary = useBaseballAggregateDestination({ scope, teamIds, source, variant })
  const personal = useBaseballAggregateDestination({ scope: mode === 'profile' && identity ? { type: 'player', playerId: identity.playerId } : null, teamIds: [], source, variant })
  const refresh = () => { primary.refresh(); if (mode === 'profile') personal.refresh() }
  return <div className="space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-base font-semibold text-content">{mode === 'career' ? 'Career totals' : mode === 'profile' ? 'Team-season totals' : mode === 'season' ? 'Season leaderboard' : mode === 'tournament' ? 'Tournament statistics' : 'Team statistics'}</h2>
        <p className="text-xs text-content-muted mt-1">{source === 'events' ? `${BASEBALL_VARIANT_LABELS[variant]} / Active canonical publications / Completed games` : 'Legacy stat-grid counters / Final games / Variant not recorded'}</p></div>
      <button type="button" aria-label="Refresh Baseball statistics" title="Refresh" onClick={refresh} className="h-9 w-9 shrink-0 border border-line rounded-lg bg-surface flex items-center justify-center"><RefreshCw size={17} className={primary.loading ? 'animate-spin' : ''} /></button>
    </div>
    <div className="grid grid-cols-2 border border-line rounded-lg overflow-hidden" aria-label="Statistics source">
      {(['events','legacy'] as const).map(value => <button key={value} type="button" aria-pressed={source === value} onClick={() => setSource(value)} className={`min-h-9 px-2 text-sm font-semibold ${source === value ? 'bg-accent text-accent-content' : 'bg-surface text-content-muted'}`}>{value === 'events' ? 'Event Totals' : 'Legacy Totals'}</button>)}
    </div>
    {source === 'events' && <label className="block text-xs font-semibold text-content-muted">Variant<select className="input-field mt-1" value={variant} onChange={event => setVariant(event.target.value as BaseballRulesVariant)}>{Object.entries(BASEBALL_VARIANT_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    {primary.loading && <p role="status" className="text-sm text-content-muted">Loading Baseball statistics{primary.progress ? ` (${primary.progress.sourceCount} sources)` : ''}...</p>}
    {primary.error && <div role="alert" className="text-sm text-danger-content">{primary.error}<button type="button" className="ml-2 underline" onClick={refresh}>Retry</button></div>}
    {primary.warning && <Notice>{primary.warning}</Notice>}
    {primary.result?.source === 'events' && <EventContent key={`${variant}:${mode}`} aggregate={primary.result.data.aggregate} seasonNames={primary.result.seasonNames} identity={identity} mode={mode} teamId={teamIdForLinks} />}
    {primary.result?.source === 'legacy' && <LegacyContent result={primary.result.data} identity={identity} mode={mode} teamId={teamIdForLinks} />}
    {mode === 'profile' && <section className="border-t border-line pt-4 space-y-3"><h2 className="font-semibold text-content">Personal</h2>
      {personal.loading && <p role="status" className="text-sm text-content-muted">Loading Personal history...</p>}
      {personal.error && <Notice>Personal history unavailable: {personal.error}</Notice>}
      {personal.result?.source === 'events' && identity && <>
        {personal.result.data.aggregate.exclusions.length > 0 && <Notice>Authorized-history diagnostics: {personal.result.data.aggregate.exclusions.length} sources were excluded before Personal filtering.</Notice>}
        <EventContent key={variant} aggregate={aggregateBaseballMatches({ type: 'player', playerId: identity.playerId }, variant, personal.result.data.aggregate.games.filter(game => game.game.cloudScope === 'personal'), [])} identity={identity} mode="personal" teamId={null} />
      </>}
      {personal.result?.source === 'legacy' && <LegacyContent result={{ ...personal.result.data, games: personal.result.data.games.filter(row => !row.game.team_id) }} identity={identity} mode="personal" teamId={null} />}
    </section>}
  </div>
}

function Notice({ children }: { children: React.ReactNode }) { return <p className="text-sm bg-warning text-warning-content border border-warning-line rounded-lg px-3 py-2" role="status">{children}</p> }

function EventContent({ aggregate, identity, mode, teamId, seasonNames }: { aggregate: BaseballAggregateResult; identity?: { playerId: string; displayName: string; number: string | null }; mode: string; teamId: string | null; seasonNames?: Record<string, string> }) {
  const [segment, setSegment] = useState('all')
  const segments = baseballCareerSegments(aggregate.games, seasonNames)
  const games = mode === 'career' && segment !== 'all' ? segments.find(row => row.key === segment)?.games ?? [] : aggregate.games
  const players = identity ? [baseballPlayerFromGames(games, identity)] : aggregate.players
  const unlinkedAppearances = games.reduce((count, game) => count + game.unlinked.filter(row => row.appeared).length, 0)
  return <div className="space-y-4">
    {aggregate.quality === 'partial' && <Notice>Partial statistics: {aggregate.exclusions.length} source(s) excluded from this authorized history load.</Notice>}
    {unlinkedAppearances > 0 && <Notice>{unlinkedAppearances} appearances have no player-history link. Valid game totals remain included.</Notice>}
    {mode === 'career' && <label className="block text-xs font-semibold text-content-muted">History segment<select className="input-field mt-1" value={segment} onChange={event => setSegment(event.target.value)}><option value="all">All authorized history</option>{segments.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select></label>}
    <p className="text-xs text-content-muted">{games.length} published games{aggregate.filteredVariantCount ? ` / ${aggregate.filteredVariantCount} other-variant games excluded from the full history load` : ''}</p>
    {games.length === 0 && <p className="text-sm text-content-muted">No eligible finalized games in this scope.</p>}
    {!identity && mode !== 'season' && aggregate.teams.map(team => {
      const matches = aggregate.games.filter(row => row.game.teamId === team.teamId)
      const names = new Set(matches.map(row => row.game.opponentName))
      return <section key={team.teamId} className="space-y-2">
        <h3 className="text-sm font-semibold text-content">{matches[0]?.game.trackedTeamName ?? 'Team'}: {team.wins} W / {team.losses} L / {team.ties} T</h3>
        <table className="w-full text-sm table-fixed"><thead className="text-content-muted"><tr><th className="text-left w-1/2">Team totals</th>{['R','H','E','LOB'].map(label => <th key={label} className="text-right">{label}</th>)}</tr></thead><tbody>{(['tracked','opponent'] as const).map(side => <tr key={side} className="border-t border-line"><th className="py-2 pr-2 text-left font-medium break-words">{side === 'tracked' ? matches[0]?.game.trackedTeamName ?? 'Team' : names.size === 1 ? matches[0].game.opponentName : 'Opponents'}</th>{(['runs','hits','errors','leftOnBase'] as const).map(stat => <td key={stat} className="text-right tabular-nums">{team.totals[side][stat]}</td>)}</tr>)}</tbody></table>
      </section>
    })}
    <BaseballPlayers players={players} teamId={teamId} />
    <EventGames games={games} />
    {mode === 'career' && segment === 'all' && segments.map(row => <section key={row.key} className="border-t border-line pt-3 space-y-2"><h3 className="text-sm font-semibold text-content break-words">{row.label}</h3><p className="text-xs text-content-muted">{row.games.length} games / {identity ? baseballMetricText(baseballPlayerFromGames(row.games, identity), 'bsb_h') : '0'} H</p></section>)}
  </div>
}

export function BaseballPlayers({ players, teamId }: { players: BaseballAggregatePlayer[]; teamId: string | null }) {
  const [category, setCategory] = useState<BaseballAggregateCategory>('batting')
  const [selected, setSelected] = useState('bsb_h')
  const metrics = BASEBALL_DESTINATION_METRICS.filter(metric => metric.category === category && (!metric.id.includes(':') || players.some(player => Number(metric.id.split(':')[1]) in player.pitchingBases)))
  const metric = metrics.find(row => row.id === selected) ?? metrics[0]
  const ranked = rankBaseballPlayers(players, metric)
  return <section className="space-y-3">
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1" aria-label="Statistic category">{categories.map(([id, label, defaultId]) => <button type="button" key={id} aria-pressed={category === id} onClick={() => { setCategory(id); setSelected(defaultId) }} className={`min-h-9 px-2 rounded-md text-sm ${category === id ? 'bg-accent text-accent-content' : 'bg-control text-content'}`}>{label}</button>)}</div>
    <label className="block text-xs font-semibold text-content-muted">Rank by<select className="input-field mt-1" value={metric.id} onChange={event => setSelected(event.target.value)}>{metrics.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
    <table className="w-full text-sm table-fixed"><thead className="text-content-muted border-b border-line"><tr><th className="text-left py-2 w-1/2">Player</th><th className="text-right w-12">GP</th><th className="text-right">{metric.short}</th></tr></thead><tbody>{ranked.map((player, index) => <tr key={player.playerId} className="border-b border-line"><th className="py-3 pr-2 text-left font-medium align-top"><div className="flex gap-2"><span className="text-content-subtle w-5 shrink-0">{baseballMetricValue(player, metric.id).value !== null ? index + 1 : ''}</span><div className="min-w-0 break-words">{teamId ? <Link className="text-accent hover:underline" to={playerInfoPath(player.playerId, teamId)}>{player.displayName}</Link> : player.displayName}<Link className="block text-xs text-accent mt-1" to={`/career?playerId=${encodeURIComponent(player.playerId)}&sport=baseball`}>Career</Link></div></div></th><td className="text-right align-top py-3 tabular-nums">{player.stats.bsb_gp}</td><td className="py-3 text-right align-top tabular-nums"><strong>{baseballMetricText(player, metric.id)}</strong>{baseballMetricValue(player, metric.id).sample && <span className="block text-[11px] text-content-muted mt-1 break-words">{baseballMetricValue(player, metric.id).sample}</span>}</td></tr>)}</tbody></table>
    {category === 'pitching' && players.map(player => <p key={player.playerId} className="text-xs text-content-muted break-words">{player.displayName}: pitch detail {player.pitchCoverage.includedGames} complete / {player.pitchCoverage.excludedGames} excluded games; decisions {player.decisions.valid} valid / {player.decisions.reviewedEmpty} reviewed empty / {player.decisions.absent} absent / {player.decisions.reviewNeeded} review needed.{player.pitchCountLowerBoundGames > 0 ? ` Pitch count is a lower bound in ${player.pitchCountLowerBoundGames} games.` : ''}</p>)}
    {category === 'batting' && players.some(player => player.pitchesSeenLowerBoundGames > 0) && <p className="text-xs text-content-muted">Pitches seen marked &gt;= are lower bounds where Quick PA detail is incomplete.</p>}
  </section>
}

function EventGames({ games }: { games: BaseballAggregateMatch[] }) {
  return <section className="space-y-2"><h3 className="text-sm font-semibold text-content">Published game history</h3>{games.map(match => <Link key={match.sourceId} to={baseballSummaryPath({ gameId: match.game.id, from: match.game.teamId ? 'team' : 'sport', teamId: match.game.teamId })} className="block border-b border-line py-2 text-sm text-accent"><span className="block break-words">{match.game.date} / {match.game.trackedTeamName} vs {match.game.opponentName}</span><span className="text-xs text-content-muted">{match.outcome.toUpperCase()} / {match.teamTotals.tracked.runs}-{match.teamTotals.opponent.runs} / {match.basis}-inning basis / Canonical Summary</span></Link>)}</section>
}

function LegacyContent({ result, identity, mode, teamId }: { result: BaseballLegacyResult; identity?: { playerId: string; displayName: string; number: string | null }; mode: string; teamId: string | null }) {
  const [metric, setMetric] = useState('hits')
  const [segment, setSegment] = useState('all')
  const segmentKey = (row: BaseballLegacyResult['games'][number]) => row.game.team_id ? `${row.game.team_id}:${row.game.season_id}` : 'personal'
  const segments = [...new Map(result.games.map(row => [segmentKey(row), row.game.team_id ? `${row.game.teams?.name ?? 'Team'} / ${row.game.teams?.seasons.name ?? 'No season'}` : 'Personal'])).entries()]
  const games = mode === 'career' && segment !== 'all' ? result.games.filter(row => segmentKey(row) === segment) : result.games
  const players = identity ? [{ ...identity, games: 0, stats: {} as Record<string, number> }] : result.players
  if (identity) for (const game of games) for (const line of game.players) if (line.playerId === identity.playerId) { players[0].games++; for (const [id, value] of Object.entries(line.stats)) players[0].stats[id] = (players[0].stats[id] ?? 0) + value }
  const value = (stats: Record<string, number>) => metric === 'hits' ? ['1b','2b','3b','hr'].reduce((sum, id) => sum + (stats[id] ?? 0), 0) : stats[metric] ?? 0
  return <section className="space-y-3">
    <p className="text-xs text-content-muted">Stored legacy counters only. No batting, pitching or fielding rates; variant not recorded.</p>
    {result.quality === 'partial' && <Notice>Partial Legacy Totals: {result.exclusions.length} game(s) in the authorized history load could not be read.</Notice>}
    {mode === 'career' && <label className="block text-xs font-semibold text-content-muted">History segment<select className="input-field mt-1" value={segment} onChange={event => setSegment(event.target.value)}><option value="all">All authorized history</option>{segments.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
    <label className="block text-xs font-semibold text-content-muted">Legacy metric<select className="input-field mt-1" value={metric} onChange={event => setMetric(event.target.value)}><option value="hits">Hits</option>{BASEBALL_LEGACY_STATS.map(stat => <option key={stat.id} value={stat.id}>{stat.label}</option>)}</select></label>
    <p className="text-xs text-content-muted">{games.length} final legacy games</p>
    <table className="w-full text-sm"><thead><tr className="border-b border-line text-content-muted"><th className="text-left py-2">Player</th><th className="text-right">Recorded games</th><th className="text-right">Total</th></tr></thead><tbody>{[...players].sort((a,b) => value(b.stats) - value(a.stats) || a.displayName.localeCompare(b.displayName)).map(player => <tr key={player.playerId} className="border-b border-line"><th className="text-left py-2 font-medium break-words">{teamId ? <Link to={playerInfoPath(player.playerId, teamId)} className="text-accent">{player.displayName}</Link> : player.displayName}</th><td className="text-right">{player.games}</td><td className="text-right">{value(player.stats)}</td></tr>)}</tbody></table>
    {games.length === 0 && <p className="text-sm text-content-muted">No eligible finalized legacy history.</p>}
    <h3 className="text-sm font-semibold text-content">Legacy game history</h3>{games.map(row => <Link key={row.game.id} to={`/game-info?gameId=${encodeURIComponent(row.game.id)}${row.game.team_id ? `&teamId=${encodeURIComponent(row.game.team_id)}` : ''}`} className="block text-sm text-accent border-b border-line py-2">{row.game.game_date} vs {row.game.opponent_name} / Game Info</Link>)}
    {result.reviewOnly.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold text-content">Unclassified Personal history</h3><p className="text-xs text-content-muted">Sport was not recorded. Review or export only; these games do not contribute to Baseball totals.</p>{result.reviewOnly.map(game => <Link key={game.id} to={`/game-info?gameId=${encodeURIComponent(game.id)}`} className="block text-sm text-accent">{game.game_date} vs {game.opponent_name} / Review and export</Link>)}</section>}
  </section>
}
