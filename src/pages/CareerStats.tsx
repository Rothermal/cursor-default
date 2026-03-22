import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sports, computePlayerScore } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { playerDisplayName } from '../lib/display'

interface CareerRow {
  season_id: string
  season_name: string
  team_id: string
  team_name: string
  sport: string
  stat_id: string
  games_played: number
  total: number
  per_game_avg: number
  season_high: number
}

interface PlayerMeta {
  id: string
  first_name: string
  last_name: string | null
  nickname: string | null
}

export default function CareerStats() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const playerId = searchParams.get('playerId')
  const sportParam = searchParams.get('sport')

  const { isConfigured } = useAuth()
  const supabaseClient = supabase

  const [player, setPlayer] = useState<PlayerMeta | null>(null)
  const [rows, setRows] = useState<CareerRow[]>([])
  const [selectedSport, setSelectedSport] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sportsInData = useMemo(() => {
    const set = new Set(rows.map(r => r.sport))
    return [...set].sort()
  }, [rows])

  useEffect(() => {
    if (!playerId || !isConfigured || !supabaseClient) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)

      const [playerRes, careerRes] = await Promise.all([
        supabaseClient
          .from('players')
          .select('id,first_name,last_name,nickname')
          .eq('id', playerId)
          .single(),
        supabaseClient.rpc('get_career_stats_resolved', { p_player_id: playerId }),
      ])

      if (cancelled) return

      if (playerRes.error || !playerRes.data) {
        setError(playerRes.error?.message ?? 'Player not found')
        setLoading(false)
        return
      }

      if (careerRes.error) {
        setError(
          careerRes.error.message.includes('function') && careerRes.error.message.includes('does not exist')
            ? 'Run migration 020_stat_tracking_ui_rpcs.sql in Supabase to enable career stats.'
            : careerRes.error.message
        )
        setLoading(false)
        return
      }

      setPlayer(playerRes.data as PlayerMeta)
      setRows((careerRes.data ?? []) as CareerRow[])
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [playerId, isConfigured, supabaseClient])

  useEffect(() => {
    if (sportsInData.length === 0) return
    const fromUrl = sportParam && sportsInData.includes(sportParam) ? sportParam : null
    setSelectedSport(prev => {
      if (fromUrl) return fromUrl
      if (prev && sportsInData.includes(prev)) return prev
      return sportsInData[0]
    })
  }, [sportsInData, sportParam])

  const filteredRows = useMemo(
    () => rows.filter(r => r.sport === selectedSport),
    [rows, selectedSport]
  )

  const sportConfig = useMemo(
    () => sports.find(s => s.id === selectedSport) ?? null,
    [selectedSport]
  )

  const careerTotals = useMemo(() => {
    const byStat: Record<string, { total: number; high: number }> = {}
    for (const r of filteredRows) {
      if (!byStat[r.stat_id]) byStat[r.stat_id] = { total: 0, high: 0 }
      byStat[r.stat_id].total += Number(r.total)
      byStat[r.stat_id].high = Math.max(byStat[r.stat_id].high, r.season_high)
    }
    return byStat
  }, [filteredRows])

  /** Sum of games_played per season+team stint (same value on each stat row in a stint). */
  const careerGamesApprox = useMemo(() => {
    const byStint = new Map<string, number>()
    for (const r of filteredRows) {
      const k = `${r.season_id}::${r.team_id}`
      if (!byStint.has(k)) byStint.set(k, r.games_played)
    }
    let sum = 0
    for (const g of byStint.values()) sum += g
    return { stintCount: byStint.size, gameSum: sum }
  }, [filteredRows])

  const segments = useMemo(() => {
    const map = new Map<string, CareerRow[]>()
    for (const r of filteredRows) {
      const key = `${r.season_id}::${r.team_id}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return [...map.entries()].map(([key, statRows]) => {
      const first = statRows[0]
      const stats: Record<string, number> = {}
      for (const x of statRows) stats[x.stat_id] = x.total
      const score = sportConfig ? computePlayerScore(sportConfig, stats) : 0
      const gp = Math.max(...statRows.map(x => x.games_played), 0)
      return {
        key,
        seasonName: first.season_name,
        teamName: first.team_name,
        gamesPlayed: gp,
        score,
        statRows,
      }
    })
  }, [filteredRows, sportConfig])

  if (!playerId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Missing player</p>
          <button type="button" onClick={() => navigate('/leaderboard')} className="btn-primary w-full">
            Back to Leaderboard
          </button>
        </div>
      </div>
    )
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Cloud required</p>
          <p className="text-sm text-slate-500 mb-4">Career stats need Supabase.</p>
          <button type="button" onClick={() => navigate('/')} className="btn-primary w-full">
            Home
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500 animate-pulse">Loading career stats...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col px-4 py-6 max-w-lg mx-auto">
        <div className="card bg-red-50 border-red-200 text-red-700 text-sm mb-4">{error}</div>
        <button type="button" onClick={() => navigate(-1)} className="btn-primary">
          Back
        </button>
      </div>
    )
  }

  const shortLabel = (statId: string) => {
    if (!sportConfig) return statId
    for (const cat of sportConfig.categories) {
      const a = cat.actions.find(x => x.id === statId)
      if (a) return a.shortLabel
    }
    return statId
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center active:scale-90 transition-transform"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold truncate">Career Stats</h1>
            {player && (
              <p className="text-sm opacity-80 truncate">{playerDisplayName(player)}</p>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {sportsInData.length > 1 && (
          <section className="card space-y-2">
            <h2 className="font-semibold text-slate-700 text-sm">Sport</h2>
            <select
              value={selectedSport}
              onChange={e => {
                const s = e.target.value
                setSelectedSport(s)
                if (playerId) {
                  navigate(`/career?playerId=${encodeURIComponent(playerId)}&sport=${encodeURIComponent(s)}`, {
                    replace: true,
                  })
                }
              }}
              className="input-field"
            >
              {sportsInData.map(id => {
                const sp = sports.find(x => x.id === id)
                return (
                  <option key={id} value={id}>
                    {sp?.icon} {sp?.name ?? id}
                  </option>
                )
              })}
            </select>
          </section>
        )}

        {filteredRows.length === 0 ? (
          <p className="text-sm text-slate-500">No finalized career stats yet for this sport.</p>
        ) : (
          <>
            <section className="card space-y-3">
              <h2 className="font-semibold text-slate-700">Career totals</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(careerTotals).map(([statId, agg]) => (
                  <div key={statId} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500 uppercase">{shortLabel(statId)}</p>
                    <p className="font-semibold text-slate-800">{agg.total}</p>
                    <p className="text-xs text-slate-400">
                      {careerGamesApprox.gameSum > 0
                        ? `${(agg.total / careerGamesApprox.gameSum).toFixed(1)}/g · `
                        : ''}
                      high {agg.high}
                    </p>
                  </div>
                ))}
              </div>
              {sportConfig && (
                <p className="text-xs text-slate-500">
                  {computePlayerScore(
                    sportConfig,
                    Object.fromEntries(Object.entries(careerTotals).map(([k, v]) => [k, v.total]))
                  )}{' '}
                  {sportConfig.scoreLabel} (scoring actions)
                </p>
              )}
              <p className="text-xs text-slate-500">
                ~{careerGamesApprox.gameSum} game{careerGamesApprox.gameSum !== 1 ? 's' : ''} across{' '}
                {careerGamesApprox.stintCount} season/team
                {careerGamesApprox.stintCount !== 1 ? 's' : ''}
              </p>
            </section>

            <section className="card space-y-3">
              <h2 className="font-semibold text-slate-700">By season</h2>
              <div className="space-y-3">
                {segments.map(seg => (
                  <div key={seg.key} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p className="font-medium text-slate-800">{seg.seasonName}</p>
                    <p className="text-sm text-slate-500">{seg.teamName}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {seg.gamesPlayed} GP
                      {sportConfig && (
                        <>
                          {' · '}
                          {seg.score} {sportConfig.scoreLabel}
                        </>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
