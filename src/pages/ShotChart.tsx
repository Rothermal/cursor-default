import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import BasketballCourt from '../components/shot-chart/BasketballCourt'

/**
 * Full-screen shot chart (SC-2 will add mode toggle, taps → ShotRecords, summary, etc.).
 * URL: `#/shot-chart` (HashRouter). Requires an in-progress basketball game.
 */
export default function ShotChart() {
  const navigate = useNavigate()
  const { state } = useGame()
  const { sport, gameInfo } = state

  const allowed = Boolean(sport && sport.id === 'basketball' && gameInfo)

  useEffect(() => {
    if (!allowed) {
      navigate('/', { replace: true })
    }
  }, [allowed, navigate])

  if (!allowed) {
    return null
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <div className="px-3 pt-3 pb-2 max-w-lg mx-auto w-full">
        <button
          type="button"
          onClick={() => navigate('/game')}
          className="text-sm text-slate-500 font-medium active:scale-95 transition-transform"
        >
          ← Back to Stats
        </button>
        <h1 className="mt-2 text-lg font-semibold text-slate-800">Shot chart</h1>
        <p className="text-sm text-slate-500 mt-1">
          SC-2 adds recording and summaries. Tap coordinates are feet from the rim — see{' '}
          <code className="text-xs bg-slate-100 px-1 rounded">src/lib/shotChartCoordinates.ts</code>.
        </p>
      </div>
      <div className="px-3 pb-6 max-w-lg mx-auto w-full flex-1 flex flex-col">
        <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm mt-2">
          <BasketballCourt shots={[]} className="w-full" />
        </div>
      </div>
    </div>
  )
}
