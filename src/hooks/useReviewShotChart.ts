import { useEffect, useState } from 'react'
import type { ShotRecord } from '../types'
import { useAuth } from '../context/AuthContext'
import { loadGameShotChartForReview } from '../lib/cloudSync'
import { mergeReviewAndLocalShots } from '../lib/shotChartReview'
import { supabase } from '../lib/supabase'
import type { ShotChartSelection } from '../lib/shotChartViews'

/**
 * Display-only review shot chart for Game Summary (F3).
 * NEVER dispatch review rows into GameState.shotChart.
 */
export function useReviewShotChart(options: {
  gameId: string | null
  sportId: string | undefined
  playerIdMap: Record<string, string>
  localShotChart: ShotRecord[]
  resolvedKey: number
}) {
  const { isConfigured } = useAuth()
  const { gameId, sportId, playerIdMap, localShotChart, resolvedKey } = options
  const [reviewShotChart, setReviewShotChart] = useState<ShotRecord[] | null>(null)
  const [shotViewSelection, setShotViewSelection] = useState<ShotChartSelection>({ kind: 'all' })

  useEffect(() => {
    setReviewShotChart(null)
    if (!isConfigured || !supabase || !gameId || sportId !== 'basketball') return

    let cancelled = false
    const load = async () => {
      try {
        const result = await loadGameShotChartForReview(gameId, playerIdMap)
        if (!cancelled) setReviewShotChart(result.shotChart)
      } catch {
        // Review load is best-effort; fall back to the viewer's own hydrated shots.
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playerIdMap is stable per gameId
  }, [isConfigured, gameId, sportId, resolvedKey])

  const summaryShotChart = mergeReviewAndLocalShots(localShotChart, reviewShotChart)
  const isReviewShotChart = reviewShotChart !== null && reviewShotChart.length > 0
  const showShotChartTab = Boolean(
    sportId === 'basketball' && (localShotChart.length > 0 || summaryShotChart.length > 0)
  )

  return {
    summaryShotChart,
    isReviewShotChart,
    showShotChartTab,
    shotViewSelection,
    setShotViewSelection,
  }
}
