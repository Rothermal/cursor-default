import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadBasketballGameRecorders,
  type BasketballRecorderSummary,
} from '../lib/basketball/recorders'

export function useBasketballRecorderPresence(
  gameId: string | null,
  refreshSignal?: string | null
) {
  const [recorders, setRecorders] = useState<BasketballRecorderSummary[]>([])
  const [loading, setLoading] = useState(Boolean(gameId))
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!gameId) {
      setRecorders([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    try {
      const rows = await loadBasketballGameRecorders(gameId)
      if (requestId !== requestIdRef.current) return
      setRecorders(rows)
      setError(null)
    } catch (caught) {
      if (requestId !== requestIdRef.current) return
      setError(caught instanceof Error ? caught.message : 'Recorder streams could not load.')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [gameId])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshSignal])

  useEffect(() => {
    if (!gameId) return
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onOnline = () => { void refresh() }
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      requestIdRef.current += 1
    }
  }, [gameId, refresh])

  return { recorders, loading, error, refresh }
}
