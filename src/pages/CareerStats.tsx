import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sports, computePlayerScore, computeCategoryTotal } from '../config/sports'
import type { StatAction, StatCategory } from '../types'
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

  const statsRecord = useMemo(() => {
    const m: Record<string, number> = {}
    for (const [k, v] of Object.entries(careerTotals)) {
      m[k] = v.total
    }
    return m
  }, [careerTotals])

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

  const gp = careerGamesApprox.gameSum

  const renderCareerCategoryTable = (category: StatCategory) => {
    const missByMadeId: Record<string, StatAction> = {}
    for (const action of category.actions) {
      if (action.madeStatId) missByMadeId[action.madeStatId] = action
    }
    const visibleActions = category.actions.filter(a => !a.madeStatId)

    const catTotal =
      category.showTotal
        ? category.actions.some(a => a.pointValue)
          ? category.actions.reduce(
              (sum, a) => sum + (statsRecord[a.id] || 0) * (a.pointValue || 0),
              0
            )
          : computeCategoryTotal(category, statsRecord)
        : null

    const cellTotals = (action: StatAction) => {
      const miss = missByMadeId[action.id]
      const made = statsRecord[action.id] || 0
      if (miss) {
        const missVal = statsRecord[miss.id] || 0
        const att = made + missVal
        const pct = att > 0 ? Math.round((made / att) * 100) : null
        return (
          <>
            <span>
              {made}/{att}
              {pct !== null && <span className="text-slate-400 ml-1">({pct}%)</span>}
            </span>
          </>
        )
      }
      return <>{made}</>
    }

    const cellPerGame = (action: StatAction) => {
      if (gp <= 0) return <>—</>
      const miss = missByMadeId[action.id]
      const made = statsRecord[action.id] || 0
      if (miss) {
        const missVal = statsRecord[miss.id] || 0
        const att = made + missVal
        return (
          <>
            {(made / gp).toFixed(1)}/{(att / gp).toFixed(1)}
            <span className="text-slate-400"> /g</span>
          </>
        )
      }
      return (
        <>
          {(made / gp).toFixed(1)}
          <span className="text-slate-400">/g</span>
        </>
      )
    }

    const cellHigh = (action: StatAction) => {
      const h = careerTotals[action.id]?.high
      if (h === undefined || h <= 0) return <>—</>
      return <>{h}</>
    }

    return (
      <div key={category.id} className="mb-6 last:mb-0">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
          {category.name}
          {category.showTotal && (
            <span className="text-slate-400 ml-2 normal-case">
              — {category.totalLabel}
            </span>
          )}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 pr-2 font-semibold text-slate-600 w-24" />
                {visibleActions.map(action => {
                  const hasMiss = !!missByMadeId[action.id]
                  return (
                    <th
                      key={action.id}
                      className="text-center py-2 px-2 font-semibold text-slate-600 min-w-[56px]"
                    >
                      {hasMiss ? `${action.shortLabel} M/A` : action.shortLabel}
                    </th>
                  )
                })}
                {category.showTotal && catTotal !== null && (
                  <th className="text-center py-2 px-2 font-bold text-slate-700 min-w-[52px]">TOT</th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-2 pr-2 text-slate-500 text-xs font-medium whitespace-nowrap align-top">
                  Total
                </td>
                {visibleActions.map(action => (
                  <td key={action.id} className="text-center py-2 px-2 align-top">
                    {cellTotals(action)}
                  </td>
                ))}
                {category.showTotal && catTotal !== null && (
                  <td className="text-center py-2 px-2 font-semibold text-slate-800 align-top">{catTotal}</td>
                )}
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-1.5 pr-2 text-slate-400 text-xs font-medium whitespace-nowrap align-top">
                  Per game
                </td>
                {visibleActions.map(action => (
                  <td
                    key={`${action.id}-pg`}
                    className="text-center py-1.5 px-2 text-xs text-slate-500 align-top"
                  >
                    {cellPerGame(action)}
                  </td>
                ))}
                {category.showTotal && catTotal !== null && (
                  <td className="text-center py-1.5 px-2 text-xs text-slate-500 align-top">
                    {gp > 0 ? (
                      <>
                        {(catTotal / gp).toFixed(1)}
                        <span className="text-slate-400">/g</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
              </tr>
              <tr>
                <td className="py-1.5 pr-2 text-slate-400 text-xs font-medium whitespace-nowrap align-top">
                  Best game
                </td>
                {visibleActions.map(action => (
                  <td
                    key={`${action.id}-hi`}
                    className="text-center py-1.5 px-2 text-xs text-slate-500 align-top"
                  >
                    {cellHigh(action)}
                  </td>
                ))}
                {category.showTotal && (
                  <td className="text-center py-1.5 px-2 text-xs text-slate-400 align-top">—</td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
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
            <section className="card space-y-2">
              <h2 className="font-semibold text-slate-700">Career totals</h2>
              <p className="text-xs text-slate-500">
                Mirrors game summary: M/A + % for shooting; per-game uses total GP (sum across season/team stints).{' '}
                <strong>Best game</strong> is the max of each stint’s season high (not a separate career-wide game
                query).
              </p>
              {sportConfig && (
                <>
                  {sportConfig.categories.map(cat => renderCareerCategoryTable(cat))}
                  <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                    <span className="font-medium text-slate-600">
                      {computePlayerScore(sportConfig, statsRecord)} {sportConfig.scoreLabel}
                    </span>{' '}
                    (scoring actions) · ~{careerGamesApprox.gameSum} GP across {careerGamesApprox.stintCount} season
                    / team{careerGamesApprox.stintCount !== 1 ? 's' : ''}
                  </p>
                </>
              )}
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
