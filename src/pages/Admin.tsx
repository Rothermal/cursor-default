import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sports } from '../config/sports'
import { useSettings } from '../context/SettingsContext'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { supabase } from '../lib/supabase'
import { teamDisplayName } from '../lib/display'
import ConfirmDialog from '../components/ConfirmDialog'

interface AdminSeasonInfo {
  name: string
  sport: string
}

interface AdminTeamRow {
  id: string
  name: string
  nickname: string | null
  season_id: string
  seasons: AdminSeasonInfo
}

interface AdminGameRow {
  id: string
  team_id: string
  opponent_name: string
  game_date: string
  status: string
}

interface AdminTournamentRow {
  id: string
  team_id: string
  name: string
}

interface AdminPlayerRow {
  id: string
  player_id: string
  first_name: string
  last_name: string | null
  jersey_number: string | null
  is_active: boolean
}

export default function Admin() {
  const navigate = useNavigate()
  const { isSportEnabled, toggleSport } = useSettings()
  const { isConfigured, user } = useAuth()
  const { state: gameState, dispatch: gameDispatch } = useGame()
  const supabaseClient = supabase
  const userId = user?.id ?? null

  const enabledCount = sports.filter(s => isSportEnabled(s.id)).length

  const [adminTeams, setAdminTeams] = useState<AdminTeamRow[]>([])
  const [adminGames, setAdminGames] = useState<AdminGameRow[]>([])
  const [adminTournaments, setAdminTournaments] = useState<AdminTournamentRow[]>([])
  const [adminPlayers, setAdminPlayers] = useState<AdminPlayerRow[]>([])
  const [selectedAdminTeamId, setSelectedAdminTeamId] = useState('')
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [showDataMgmt, setShowDataMgmt] = useState(false)

  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState<AdminTeamRow | null>(null)
  const [confirmDeleteGame, setConfirmDeleteGame] = useState<AdminGameRow | null>(null)
  const [confirmDeleteTournament, setConfirmDeleteTournament] = useState<AdminTournamentRow | null>(null)
  const [confirmDeletePlayer, setConfirmDeletePlayer] = useState<AdminPlayerRow | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!showDataMgmt || !isConfigured || !userId || !supabaseClient) return
    let cancelled = false
    const load = async () => {
      setLoadingAdmin(true)
      setAdminError(null)
      const { data: teams, error: tErr } = await supabaseClient
        .from('teams')
        .select('id,name,nickname,season_id,seasons!inner(name,sport)')
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (tErr) { setAdminError(tErr.message); setLoadingAdmin(false); return }
      type RawTeamRow = { id: string; name: string; nickname: string | null; season_id: string; seasons: AdminSeasonInfo | AdminSeasonInfo[] }
      const loaded = ((teams ?? []) as unknown as RawTeamRow[]).map(t => ({
        ...t,
        seasons: Array.isArray(t.seasons) ? t.seasons[0] : t.seasons,
      })) as AdminTeamRow[]
      setAdminTeams(loaded)
      setSelectedAdminTeamId(prev => {
        if (prev && loaded.some(t => t.id === prev)) return prev
        return loaded[0]?.id ?? ''
      })
      setLoadingAdmin(false)
    }
    void load()
    return () => { cancelled = true }
  }, [showDataMgmt, isConfigured, userId, supabaseClient])

  useEffect(() => {
    if (!showDataMgmt || !selectedAdminTeamId || !supabaseClient) {
      setAdminGames([])
      setAdminTournaments([])
      setAdminPlayers([])
      return
    }
    let cancelled = false
    const load = async () => {
      const [gamesRes, tournamentsRes, playersRes] = await Promise.all([
        supabaseClient.from('games').select('id,team_id,opponent_name,game_date,status')
          .eq('team_id', selectedAdminTeamId).order('created_at', { ascending: false }),
        supabaseClient.from('tournaments').select('id,team_id,name')
          .eq('team_id', selectedAdminTeamId).order('name', { ascending: true }),
        supabaseClient.from('team_players').select('id,player_id,jersey_number,is_active,players!inner(id,first_name,last_name)')
          .eq('team_id', selectedAdminTeamId).order('joined_at', { ascending: true }),
      ])
      if (cancelled) return
      setAdminGames((gamesRes.data ?? []) as AdminGameRow[])
      setAdminTournaments((tournamentsRes.data ?? []) as AdminTournamentRow[])
      setAdminPlayers(
        ((playersRes.data ?? []) as unknown as Array<{
          id: string; player_id: string; jersey_number: string | null; is_active: boolean;
          players: { id: string; first_name: string; last_name: string | null }
        }>).map(r => ({
          id: r.id,
          player_id: r.player_id,
          first_name: r.players.first_name,
          last_name: r.players.last_name,
          jersey_number: r.jersey_number,
          is_active: r.is_active,
        }))
      )
    }
    void load()
    return () => { cancelled = true }
  }, [showDataMgmt, selectedAdminTeamId, supabaseClient])

  const handleAdminDeleteTeam = async (team: AdminTeamRow) => {
    if (!supabaseClient) return
    setAdminError(null)
    setDeletingId(team.id)
    const { error } = await supabaseClient.from('teams').delete().eq('id', team.id)
    setDeletingId(null)
    if (error) { setAdminError(error.message); return }
    if (gameState.cloudSync.teamId === team.id) gameDispatch({ type: 'RESET_GAME' })
    setAdminTeams(prev => {
      const next = prev.filter(t => t.id !== team.id)
      if (selectedAdminTeamId === team.id) {
        setSelectedAdminTeamId(next[0]?.id ?? '')
      }
      return next
    })
  }

  const handleAdminDeleteGame = async (game: AdminGameRow) => {
    if (!supabaseClient) return
    setAdminError(null)
    setDeletingId(game.id)
    const { error } = await supabaseClient.from('games').delete().eq('id', game.id)
    setDeletingId(null)
    if (error) { setAdminError(error.message); return }
    if (gameState.cloudSync.gameId === game.id) gameDispatch({ type: 'RESET_GAME' })
    setAdminGames(prev => prev.filter(g => g.id !== game.id))
  }

  const handleAdminDeleteTournament = async (tournament: AdminTournamentRow) => {
    if (!supabaseClient) return
    setAdminError(null)
    setDeletingId(tournament.id)
    const { error } = await supabaseClient.from('tournaments').delete().eq('id', tournament.id)
    setDeletingId(null)
    if (error) { setAdminError(error.message); return }
    setAdminTournaments(prev => prev.filter(t => t.id !== tournament.id))
  }

  const handleAdminDeletePlayer = async (player: AdminPlayerRow) => {
    if (!supabaseClient) return
    setAdminError(null)
    setDeletingId(player.id)
    const { error } = await supabaseClient.from('players').delete().eq('id', player.player_id)
    setDeletingId(null)
    if (error) { setAdminError(error.message); return }
    setAdminPlayers(prev => prev.filter(p => p.id !== player.id))
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">Settings</h1>
            <p className="text-sm opacity-80">Configure available sports</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-700">Sports</h2>
            <span className="text-sm text-slate-400">
              {enabledCount} of {sports.length} enabled
            </span>
          </div>

          <div className="space-y-2">
            {sports.map(sport => {
              const enabled = isSportEnabled(sport.id)
              return (
                <div
                  key={sport.id}
                  className={`
                    card flex items-center justify-between py-3 transition-colors
                    ${enabled ? '' : 'opacity-60'}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{sport.icon}</span>
                    <div>
                      <span className="font-medium text-slate-700">{sport.name}</span>
                      <p className="text-xs text-slate-400">
                        {sport.categories.reduce((n, c) => n + c.actions.length, 0)} stats
                        across {sport.categories.length} categories
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleSport(sport.id)}
                    className={`
                      relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0
                      ${enabled ? 'bg-blue-600' : 'bg-slate-300'}
                    `}
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Toggle ${sport.name}`}
                  >
                    <span
                      className={`
                        absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow
                        transition-transform duration-200
                        ${enabled ? 'translate-x-5' : 'translate-x-0'}
                      `}
                    />
                  </button>
                </div>
              )
            })}
          </div>

          {enabledCount === 0 && (
            <p className="text-center text-sm text-amber-600 mt-4 bg-amber-50 rounded-xl p-3">
              Enable at least one sport to start tracking games.
            </p>
          )}
        </section>

        {isConfigured && user && (
          <section className="card mt-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-2">Cloud Teams</h2>
            <p className="text-sm text-slate-500 mb-4">
              Create teams and manage player rosters saved to Supabase.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => navigate('/teams')}
                className="btn-primary w-full"
              >
                Manage Teams & Rosters →
              </button>
              <button
                onClick={() => navigate('/games')}
                className="btn-secondary w-full"
              >
                View Cloud Games →
              </button>
            </div>
          </section>
        )}

        {isConfigured && user && (
          <section className="mt-6">
            <button
              type="button"
              onClick={() => setShowDataMgmt(!showDataMgmt)}
              className="card w-full text-left"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-700">Data Management</h2>
                  <p className="text-sm text-slate-500">Delete teams, games, players, tournaments</p>
                </div>
                <span className="text-slate-400 text-lg">{showDataMgmt ? '▲' : '▼'}</span>
              </div>
            </button>

            {showDataMgmt && (
              <div className="mt-3 space-y-3">
                {adminError && (
                  <div className="card bg-red-50 border-red-200 text-red-700 text-sm">{adminError}</div>
                )}

                {loadingAdmin ? (
                  <p className="text-sm text-slate-500 animate-pulse card">Loading...</p>
                ) : adminTeams.length === 0 ? (
                  <p className="text-sm text-slate-500 card">No teams found.</p>
                ) : (
                  <>
                    <div className="card space-y-2">
                      <label className="block text-sm font-semibold text-slate-700">Select Team</label>
                      <select
                        value={selectedAdminTeamId}
                        onChange={e => setSelectedAdminTeamId(e.target.value)}
                        className="input-field"
                      >
                        {adminTeams.map(t => {
                          const sport = sports.find(s => s.id === t.seasons.sport)
                          return (
                            <option key={t.id} value={t.id}>
                              {sport?.icon ?? '🏟️'} {teamDisplayName(t)}{t.seasons.name ? ` (${t.seasons.name})` : ''}
                            </option>
                          )
                        })}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const team = adminTeams.find(t => t.id === selectedAdminTeamId)
                          if (team) setConfirmDeleteTeam(team)
                        }}
                        disabled={!selectedAdminTeamId || deletingId === selectedAdminTeamId}
                        className="text-sm text-red-600 font-semibold underline disabled:opacity-40"
                      >
                        Delete this team (and all its data)
                      </button>
                    </div>

                    {selectedAdminTeamId && (
                      <>
                        {adminGames.length > 0 && (
                          <div className="card space-y-2">
                            <h3 className="text-sm font-semibold text-slate-700">
                              Games ({adminGames.length})
                            </h3>
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                              {adminGames.map(g => (
                                <div key={g.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-2 py-1.5">
                                  <div className="min-w-0">
                                    <p className="text-sm text-slate-700 truncate">vs {g.opponent_name}</p>
                                    <p className="text-xs text-slate-400">{g.game_date} · {g.status}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteGame(g)}
                                    disabled={deletingId === g.id}
                                    className="text-slate-400 hover:text-red-500 p-1 shrink-0"
                                    title="Delete game"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {adminPlayers.length > 0 && (
                          <div className="card space-y-2">
                            <h3 className="text-sm font-semibold text-slate-700">
                              Players ({adminPlayers.length})
                            </h3>
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                              {adminPlayers.map(p => (
                                <div key={p.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-2 py-1.5">
                                  <div className="min-w-0">
                                    <p className="text-sm text-slate-700 truncate">
                                      #{p.jersey_number || '—'} {[p.first_name, p.last_name].filter(Boolean).join(' ')}
                                    </p>
                                    <p className="text-xs text-slate-400">{p.is_active ? 'Active' : 'Inactive'}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeletePlayer(p)}
                                    disabled={deletingId === p.id}
                                    className="text-slate-400 hover:text-red-500 p-1 shrink-0"
                                    title="Delete player"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {adminTournaments.length > 0 && (
                          <div className="card space-y-2">
                            <h3 className="text-sm font-semibold text-slate-700">
                              Tournaments ({adminTournaments.length})
                            </h3>
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                              {adminTournaments.map(t => (
                                <div key={t.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-2 py-1.5">
                                  <p className="text-sm text-slate-700 truncate">{t.name}</p>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteTournament(t)}
                                    disabled={deletingId === t.id}
                                    className="text-slate-400 hover:text-red-500 p-1 shrink-0"
                                    title="Delete tournament"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            <ConfirmDialog
              open={confirmDeleteTeam !== null}
              title="Delete Team"
              message={
                confirmDeleteTeam
                  ? `Permanently delete "${teamDisplayName(confirmDeleteTeam)}" and ALL its players, games, stats, and tournaments? This cannot be undone.`
                  : ''
              }
              confirmLabel="Yes, Delete"
              onConfirm={() => {
                if (confirmDeleteTeam) void handleAdminDeleteTeam(confirmDeleteTeam)
                setConfirmDeleteTeam(null)
              }}
              onCancel={() => setConfirmDeleteTeam(null)}
            />

            <ConfirmDialog
              open={confirmDeleteGame !== null}
              title="Delete Game"
              message={
                confirmDeleteGame
                  ? `Permanently delete the game vs ${confirmDeleteGame.opponent_name} (${confirmDeleteGame.game_date})? All stats for this game will be lost.`
                  : ''
              }
              confirmLabel="Yes, Delete"
              onConfirm={() => {
                if (confirmDeleteGame) void handleAdminDeleteGame(confirmDeleteGame)
                setConfirmDeleteGame(null)
              }}
              onCancel={() => setConfirmDeleteGame(null)}
            />

            <ConfirmDialog
              open={confirmDeleteTournament !== null}
              title="Delete Tournament"
              message={
                confirmDeleteTournament
                  ? `Delete "${confirmDeleteTournament.name}"? Games linked to this tournament will keep their data but lose the tournament association.`
                  : ''
              }
              confirmLabel="Yes, Delete"
              onConfirm={() => {
                if (confirmDeleteTournament) void handleAdminDeleteTournament(confirmDeleteTournament)
                setConfirmDeleteTournament(null)
              }}
              onCancel={() => setConfirmDeleteTournament(null)}
            />

            <ConfirmDialog
              open={confirmDeletePlayer !== null}
              title="Delete Player"
              message={
                confirmDeletePlayer
                  ? `Permanently delete "${[confirmDeletePlayer.first_name, confirmDeletePlayer.last_name].filter(Boolean).join(' ')}" and all their game stats? This cannot be undone.`
                  : ''
              }
              confirmLabel="Yes, Delete"
              onConfirm={() => {
                if (confirmDeletePlayer) void handleAdminDeletePlayer(confirmDeletePlayer)
                setConfirmDeletePlayer(null)
              }}
              onCancel={() => setConfirmDeletePlayer(null)}
            />
          </section>
        )}

        <button
          onClick={() => navigate('/')}
          className="btn-primary w-full mt-8"
        >
          ← Back to Home
        </button>
      </div>
    </div>
  )
}
