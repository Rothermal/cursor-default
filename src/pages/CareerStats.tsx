import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sports, computePlayerScore } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame, gameStateFromHydratedCloudGame } from '../context/GameContext'
import { supabase } from '../lib/supabase'
import { loadCloudGameById, touchCloudGameLastOpened } from '../lib/cloudSync'
import { playerDisplayName } from '../lib/display'
import PlayerStatSummaryTables, { type StatHighGameMap } from '../components/PlayerStatSummaryTables'
import { buildResolvedByGameForPlayer } from '../lib/playerStatSummaryTables'

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

  const { isConfigured, user } = useAuth()
  const { dispatch } = useGame()
  const supabaseClient = supabase
  const userId = user?.id ?? null

  const [player, setPlayer] = useState<PlayerMeta | null>(null)
  const [rows, setRows] = useState<CareerRow[]>([])
  const [selectedSport, setSelectedSport] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [careerHighGames, setCareerHighGames] = useState<StatHighGameMap>({})
  const [careerResolvedByGame, setCareerResolvedByGame] = useState<Record<string, Record<string, number>>>({})
  const [loadingCareerHighs, setLoadingCareerHighs] = useState(false)

  const [segmentHighs, setSegmentHighs] = useState<Record<string, StatHighGameMap>>({})
  const [segmentResolved, setSegmentResolved] = useState<Record<string, Record<string, Record<string, number>>>>({})
  const [loadingSegmentKey, setLoadingSegmentKey] = useState<string | null>(null)

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
    const byStat: Record<string, number> = {}
    for (const r of filteredRows) {
      byStat[r.stat_id] = (byStat[r.stat_id] ?? 0) + Number(r.total)
    }
    return byStat
  }, [filteredRows])

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
        teamId: first.team_id,
        seasonName: first.season_name,
        teamName: first.team_name,
        gamesPlayed: gp,
        score,
        statRows,
        statsRecord: stats,
      }
    })
  }, [filteredRows, sportConfig])

  const statsRecord = careerTotals

  useEffect(() => {
    if (!playerId || !supabaseClient || !sportConfig || filteredRows.length === 0) {
      setCareerHighGames({})
      setCareerResolvedByGame({})
      return
    }
    let cancelled = false
    const load = async () => {
      setLoadingCareerHighs(true)
      const { data, error: rpcErr } = await supabaseClient.rpc('get_player_stat_high_games', {
        p_player_id: playerId,
      })
      if (cancelled) return
      if (rpcErr) {
        setCareerHighGames({})
        setCareerResolvedByGame({})
        setLoadingCareerHighs(false)
        return
      }
      const highs: StatHighGameMap = {}
      const gameIds: string[] = []
      for (const row of (data ?? []) as Array<{ stat_id: string; game_id: string; value: number }>) {
        highs[row.stat_id] = { game_id: row.game_id, value: row.value }
        if (!gameIds.includes(row.game_id)) gameIds.push(row.game_id)
      }
      setCareerHighGames(highs)
      const results = await Promise.all(
        gameIds.map(gid =>
          supabaseClient.rpc('get_game_stats_resolved', { p_game_id: gid })
        )
      )
      if (cancelled) return
      const rowsByGame = results.map(r => (r.data ?? []) as Array<{ player_id: string; stat_id: string; value: number }>)
      setCareerResolvedByGame(buildResolvedByGameForPlayer(gameIds, playerId, rowsByGame))
      setLoadingCareerHighs(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [playerId, supabaseClient, sportConfig, filteredRows.length])

  useEffect(() => {
    if (!playerId || !supabaseClient || !sportConfig || segments.length === 0) {
      setSegmentHighs({})
      setSegmentResolved({})
      return
    }
    let cancelled = false
    const loadAll = async () => {
      const nextHighs: Record<string, StatHighGameMap> = {}
      const nextRes: Record<string, Record<string, Record<string, number>>> = {}
      for (const seg of segments) {
        if (cancelled) return
        setLoadingSegmentKey(seg.key)
        const { data, error: rpcErr } = await supabaseClient.rpc('get_player_stat_high_games_for_team', {
          p_player_id: playerId,
          p_team_id: seg.teamId,
        })
        if (cancelled) return
        if (rpcErr) {
          nextHighs[seg.key] = {}
          nextRes[seg.key] = {}
          continue
        }
        const highs: StatHighGameMap = {}
        const gameIds: string[] = []
        for (const row of (data ?? []) as Array<{ stat_id: string; game_id: string; value: number }>) {
          highs[row.stat_id] = { game_id: row.game_id, value: row.value }
          if (!gameIds.includes(row.game_id)) gameIds.push(row.game_id)
        }
        nextHighs[seg.key] = highs
        const results = await Promise.all(
          gameIds.map(gid =>
            supabaseClient.rpc('get_game_stats_resolved', { p_game_id: gid })
          )
        )
        if (cancelled) return
        const rowsByGame = results.map(r => (r.data ?? []) as Array<{ player_id: string; stat_id: string; value: number }>)
        nextRes[seg.key] = buildResolvedByGameForPlayer(gameIds, playerId, rowsByGame)
      }
      if (cancelled) return
      setSegmentHighs(nextHighs)
      setSegmentResolved(nextRes)
      setLoadingSegmentKey(null)
    }
    void loadAll()
    return () => {
      cancelled = true
    }
  }, [playerId, supabaseClient, sportConfig, segments])

  const openGameSummary = useCallback(
    async (gameId: string) => {
      if (!userId || !sportConfig || !supabaseClient) return
      const cloudGame = await loadCloudGameById(userId, gameId).catch(() => null)
      if (!cloudGame) return
      await touchCloudGameLastOpened(cloudGame.gameId).catch(() => {})
      const nextState = gameStateFromHydratedCloudGame(cloudGame, sportConfig)

      dispatch({ type: 'HYDRATE_STATE', state: nextState })
      navigate('/summary')
    },
    [userId, sportConfig, supabaseClient, dispatch, navigate]
  )

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
            {sportConfig && (
              <PlayerStatSummaryTables
                sport={sportConfig}
                statsRecord={statsRecord}
                gamesPlayed={careerGamesApprox.gameSum}
                highGames={careerHighGames}
                resolvedByGame={careerResolvedByGame}
                onOpenGame={openGameSummary}
                loadingHigh={loadingCareerHighs}
                title="Career totals"
                description="Same layout as game summary. Per-game uses sum of GP per season/team stint. Tap Best game to open that game’s summary (migration 026 for links)."
                footer={
                  <>
                    <span className="font-medium text-slate-600">
                      {computePlayerScore(sportConfig, statsRecord)} {sportConfig.scoreLabel}
                    </span>{' '}
                    (scoring actions) · ~{careerGamesApprox.gameSum} GP across {careerGamesApprox.stintCount} season
                    / team{careerGamesApprox.stintCount !== 1 ? 's' : ''}
                  </>
                }
              />
            )}

            <section className="card space-y-3">
              <h2 className="font-semibold text-slate-700">By season</h2>
              <div className="space-y-4">
                {segments.map(seg =>
                  sportConfig ? (
                    <div key={seg.key} className="rounded-xl border border-slate-200 bg-white px-3 py-3 space-y-2">
                      <div>
                        <p className="font-medium text-slate-800">{seg.seasonName}</p>
                        <p className="text-sm text-slate-500">{seg.teamName}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {seg.gamesPlayed} GP
                          {sportConfig && (
                            <>
                              {' · '}
                              {seg.score} {sportConfig.scoreLabel}
                            </>
                          )}
                        </p>
                      </div>
                      <PlayerStatSummaryTables
                        sport={sportConfig}
                        statsRecord={seg.statsRecord}
                        gamesPlayed={seg.gamesPlayed}
                        highGames={segmentHighs[seg.key] ?? {}}
                        resolvedByGame={segmentResolved[seg.key] ?? {}}
                        onOpenGame={openGameSummary}
                        loadingHigh={loadingSegmentKey === seg.key}
                        title="Season totals"
                        description="Best game uses only games for this team."
                      />
                    </div>
                  ) : null
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
