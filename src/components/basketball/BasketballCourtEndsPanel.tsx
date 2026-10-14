import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import { switchBasketballEnds } from '../../lib/basketball/commands'
import { basketballShownCourtEnds } from '../../lib/basketball/fullCourtView'
import { gameSideDisplayName } from '../../lib/display'

/**
 * Actions: which basket each team shoots at, with Switch ends (BKE-7 §3.2). Shown for
 * full-court games only. A switch applies from now on and is undone like any capture.
 */
export default function BasketballCourtEndsPanel({ disabled }: { disabled: boolean }) {
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)
  // Left and right as shown, so a flipped view never reads as switched ends.
  const ends = basketballShownCourtEnds(state)
  if (!ends) return null
  const switchEnds = () => {
    const result = switchBasketballEnds(state, { recorderUserId: user?.id ?? null })
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }
  return (
    <section className="border-y border-line bg-surface px-3 py-3" aria-labelledby="basketball-court-ends-title">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="basketball-court-ends-title" className="text-sm font-bold text-content">Court ends</h3>
          <p className="break-words text-xs text-content-muted">
            {gameSideDisplayName(state.gameInfo, 'tracked')}: {ends.tracked} basket.{' '}
            {gameSideDisplayName(state.gameInfo, 'opponent')}: {ends.opponent} basket.
          </p>
        </div>
        <button
          type="button"
          onClick={switchEnds}
          disabled={disabled}
          className="btn-secondary inline-flex min-h-10 shrink-0 items-center gap-2 px-3 py-2 text-sm disabled:bg-control-disabled disabled:text-content-disabled"
        >
          <ArrowLeftRight size={16} aria-hidden />
          Switch ends
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-danger-content">{error}</p>}
    </section>
  )
}
