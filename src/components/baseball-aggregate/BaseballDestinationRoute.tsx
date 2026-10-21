import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { sports as sportConfigs } from '../../config/sports'
import { useAuth } from '../../context/AuthContext'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../../lib/authIdentity'
import { playerDisplayName, teamDisplayName } from '../../lib/display'
import { careerSportOptions } from '../../lib/careerSportOptions'
import { supabase } from '../../lib/supabase'
import { BaseballAggregateDestination } from './BaseballAggregateDestination'
import { loadBaseballAggregates } from '../../lib/baseball/aggregateTransport'
import { allocateBaseballRefreshGeneration } from '../../hooks/useBaseballAggregateDestination'

type Kind = 'season' | 'team' | 'tournament' | 'profile' | 'career'
interface Team { id: string; name: string; nickname: string | null; season_id: string; seasons: { id: string; name: string; sport: string } }
interface Metadata { baseball: boolean; teams: Team[]; team: Team | null; player: { playerId: string; displayName: string; number: string | null } | null; tournament: { id: string; name: string; team_id: string } | null; availableSports: string[]; sportHistoryWarning: string | null }

/** Resolve Baseball before mounting the generic page and its legacy effects. */
export function BaseballDestinationRoute({ kind, fallback }: { kind: Kind; fallback: ReactNode }) {
  const { user, isConfigured } = useAuth()
  const [params] = useSearchParams()
  const userId = user?.id ?? null
  const identity = userId ? captureAuthIdentity(userId) : null
  const query = params.toString()
  const explicit = params.get('sport') === 'baseball'
  const shouldProbe = explicit || kind === 'career' && !params.get('sport') || Boolean(params.get('teamId') && ['season','team','tournament','profile'].includes(kind))
  const key = JSON.stringify([identity, query, kind])
  const lifetime = useRef({ key, token: {} })
  if (lifetime.current.key !== key) lifetime.current = { key, token: {} }
  const token = lifetime.current.token
  const [settled, setSettled] = useState<{ token: object; data: Metadata | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!shouldProbe || !userId || !identity || !isConfigured) return
    const controller = new AbortController()
    const current = () => {
      if (controller.signal.aborted || lifetime.current.token !== token || !isCurrentAuthIdentity(identity)) throw Error('The statistics route changed.')
    }
    void loadBaseballDestinationMetadata(kind, new URLSearchParams(query), controller.signal, current, userId).then(data => {
      current(); setSettled({ token, data, error: null })
    }).catch(error => {
      try { current() } catch { return }
      setSettled({ token, data: null, error: error instanceof Error ? error.message : 'Statistics could not load.' })
    })
    return () => { controller.abort() }
    // The lifetime token includes the auth epoch and complete query, not just the account id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, shouldProbe, isConfigured, token])
  if (!shouldProbe) return fallback
  if (!userId || !isConfigured) return explicit ? <RouteMessage message="Sign in to view Baseball statistics." /> : fallback
  const visible = identity && isCurrentAuthIdentity(identity) && settled?.token === token ? settled : null
  if (!visible) return <RouteMessage message="Loading statistics..." />
  if (visible.error || !visible.data) return <RouteMessage message={visible.error ?? 'Statistics unavailable.'} alert />
  if (!visible.data.baseball) return <>{fallback}</>
  return <BaseballRouteContent key={key} kind={kind} params={params} metadata={visible.data} />
}

async function loadBaseballDestinationMetadata(kind: Kind, params: URLSearchParams, signal: AbortSignal, current: () => void, userId?: string): Promise<Metadata> {
  if (!supabase) throw Error('Supabase is not configured.')
  const data: Metadata = { baseball: params.get('sport') === 'baseball', teams: [], team: null, player: null, tournament: null, availableSports: [], sportHistoryWarning: null }
  const refreshGeneration = allocateBaseballRefreshGeneration()
  const teamId = params.get('teamId')
  if (teamId) {
    current()
    const response = await supabase.from('teams').select('id,name,nickname,season_id,seasons!inner(id,name,sport)').eq('id', teamId).abortSignal(signal).single()
    current()
    if (response.error || !response.data) throw Error('Team not found or unavailable.')
    data.team = response.data as unknown as Team
    data.baseball = data.team.seasons.sport === 'baseball'
    if (params.get('sport') === 'baseball' && !data.baseball) throw Error('This team is not a Baseball team.')
  }
  if (kind === 'career') {
    const sports = new Set<string>()
    if (!params.get('playerId')) throw Error('Select a player.')
    for (let offset = 0; ; offset += 200) {
      current()
      const response = await supabase.from('team_players').select('team_id,teams!inner(seasons!inner(sport))').eq('player_id', params.get('playerId')!).order('team_id').range(offset, offset + 199).abortSignal(signal)
      current()
      if (response.error || !Array.isArray(response.data)) throw Error('Player sport history could not load.')
      for (const row of response.data as unknown as Array<{ teams: { seasons: { sport: string } } }>) sports.add(row.teams.seasons.sport)
      if (response.data.length < 200) break
    }
    const legacySports: string[] = []
    // Legacy rows discover navigation only; Baseball totals retain their own authority.
    for (let offset = 0; ; offset += 200) {
      current()
      const response = await supabase.rpc('get_career_stats_resolved', { p_player_id: params.get('playerId')! })
        .select('sport').order('sport').range(offset, offset + 199).abortSignal(signal)
      current()
      if (response.error || !Array.isArray(response.data) || response.data.some(row => typeof row?.sport !== 'string')) {
        data.sportHistoryWarning = 'Some historical sport choices could not load.'
        break
      }
      legacySports.push(...response.data.map(row => row.sport))
      if (response.data.length < 200) break
    }
    data.availableSports = careerSportOptions(legacySports, [...sports], params.get('sport'))
    if (!params.get('sport')) data.baseball = data.availableSports[0] === 'baseball'
  }
  if (!data.baseball) return data
  if (kind === 'season') {
    for (let offset = 0; ; offset += 200) {
      current()
      const response = await supabase.from('teams').select('id,name,nickname,season_id,seasons!inner(id,name,sport)')
        .eq('seasons.sport', 'baseball').order('id').range(offset, offset + 199).abortSignal(signal)
      current()
      if (response.error || !Array.isArray(response.data)) throw Error('Baseball teams could not load.')
      data.teams.push(...response.data as unknown as Team[])
      if (response.data.length < 200) break
    }
  }
  if (kind === 'profile' || kind === 'career') {
    const id = params.get('playerId')
    if (!id) throw Error('Select a player.')
    current()
    const response = await supabase.from('players').select('id,first_name,last_name,nickname,is_team_placeholder').eq('id', id).eq('is_team_placeholder', false).abortSignal(signal).single()
    current()
    if (response.error && response.error.code !== 'PGRST116') throw Error('Player identity could not load.')
    if (response.data) data.player = { playerId: response.data.id, displayName: playerDisplayName(response.data), number: null }
    else if (userId) {
      // Current players RLS may hide an old removed-roster identity. Canonical source
      // maps still authorize that historical contribution, including its frozen name.
      for (const variant of ['baseball','softball_fastpitch','softball_slowpitch'] as const) {
        current()
        const history = await loadBaseballAggregates({ type: kind === 'career' ? 'career' : 'player', playerId: id,
          ...(kind === 'profile' ? { teamId: data.team!.id, seasonId: data.team!.season_id } : {}) },
        { userId, variant, signal, refreshGeneration })
        current()
        const player = history.aggregate.players.find(row => row.playerId === id)
        if (player) { data.player = { playerId: id, displayName: player.displayName, number: player.number }; break }
      }
    }
    if (!data.player) throw Error('Player identity and authorized Baseball history are unavailable.')
  }
  if (kind === 'tournament') {
    if (!data.team || !params.get('tournamentId')) throw Error('Select an authorized team tournament.')
    current()
    const response = await supabase.from('tournaments').select('id,name,team_id').eq('id', params.get('tournamentId')!).eq('team_id', data.team.id).abortSignal(signal).single()
    current()
    if (response.error || !response.data) throw Error('Tournament not found for this team.')
    data.tournament = response.data
  }
  if (['team','profile'].includes(kind) && !data.team) throw Error('Select a Baseball team.')
  return data
}

function BaseballRouteContent({ kind, params, metadata }: { kind: Kind; params: URLSearchParams; metadata: Metadata }) {
  const navigate = useNavigate()
  const defaultSeason = params.get('seasonId') ?? metadata.team?.season_id ?? metadata.teams[0]?.season_id ?? ''
  const [seasonId, setSeasonId] = useState(defaultSeason)
  useEffect(() => {
    if (kind === 'career' && !params.get('sport') && metadata.player) navigate(`/career?playerId=${encodeURIComponent(metadata.player.playerId)}&sport=baseball`, { replace: true })
  }, [kind, metadata.player, navigate, params])
  const team = metadata.team
  const teamIds = kind === 'season' ? metadata.teams.filter(row => row.season_id === seasonId).map(row => row.id) : team ? [team.id] : []
  const scope = kind === 'career' ? { type: 'career' as const, playerId: metadata.player!.playerId }
    : kind === 'profile' ? { type: 'player' as const, playerId: metadata.player!.playerId, teamId: team!.id, seasonId: team!.season_id }
      : kind === 'tournament' ? { type: 'tournament' as const, id: metadata.tournament!.id, teamId: team!.id }
        : kind === 'season' ? { type: 'season' as const, id: seasonId } : { type: 'team' as const, id: team!.id }
  const back = team ? `/team?teamId=${encodeURIComponent(team.id)}` : '/sport/baseball'
  const title = metadata.player?.displayName ?? metadata.tournament?.name ?? (team ? teamDisplayName(team) : 'Baseball')
  const seasons = [...new Map(metadata.teams.map(row => [row.season_id, row.seasons.name])).entries()]
  return <div className="min-h-screen bg-canvas text-content"><header className="border-b border-line bg-surface px-4 py-4"><div className="max-w-3xl mx-auto flex items-center gap-3"><Link to={back} aria-label="Back" title="Back" className="h-9 w-9 shrink-0 rounded-lg bg-control flex items-center justify-center"><ArrowLeft size={18} /></Link><div className="min-w-0"><h1 className="text-lg font-bold break-words">{title}</h1><p className="text-sm text-content-muted">{team?.seasons.name ?? 'Baseball statistics'}</p></div></div></header>
    <main className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      {metadata.sportHistoryWarning && <p role="status" className="text-sm text-warning-content">{metadata.sportHistoryWarning}</p>}
      {kind === 'career' && metadata.availableSports.length > 1 && <label className="block text-xs font-semibold text-content-muted">Sport<select className="input-field mt-1" value="baseball" onChange={event => navigate(`/career?playerId=${encodeURIComponent(metadata.player!.playerId)}&sport=${encodeURIComponent(event.target.value)}`, { replace: true })}>{metadata.availableSports.map(id => <option key={id} value={id}>{sportConfigs.find(sport => sport.id === id)?.name ?? id}</option>)}</select></label>}
      {kind === 'season' && <label className="block text-xs font-semibold text-content-muted">Season<select className="input-field mt-1" value={seasonId} onChange={event => setSeasonId(event.target.value)}>{seasons.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
      {kind === 'season' && !seasonId ? <p className="text-sm text-content-muted">No authorized Baseball seasons.</p> : <BaseballAggregateDestination scope={scope} teamIds={teamIds} teamIdForLinks={team?.id ?? null} identity={metadata.player ?? undefined} mode={kind} />}
    </main></div>
}
function RouteMessage({ message, alert = false }: { message: string; alert?: boolean }) { return <main className="max-w-3xl mx-auto px-4 py-6"><p role={alert ? 'alert' : 'status'} className="text-sm text-content-muted">{message}</p><Link to="/sport/baseball" className="text-sm text-accent block mt-3">Baseball</Link></main> }
