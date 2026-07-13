import { useNavigate } from 'react-router-dom'
import { sports } from '../config/sports'
import { useGame } from '../context/GameContext'
import { useSettings } from '../context/SettingsContext'
import {
  isGameStateForSport,
  isParkedGameForSport,
  sportDashboardPath,
} from '../lib/sportNavigation'

export default function SportSelect() {
  const navigate = useNavigate()
  const { state, activeLocalGameId, parkedGames } = useGame()
  const { isSportEnabled } = useSettings()

  const enabledSports = sports.filter(s => isSportEnabled(s.id))
  const parkedOnly = parkedGames.filter(game => game.localGameId !== activeLocalGameId)

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 px-4 py-8 max-w-lg mx-auto w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-800">StatKeeper</h1>
          <p className="text-slate-500 mt-2">Choose a sport workspace</p>
        </div>

        <h2 className="text-lg font-semibold text-slate-700 mb-3">Sports</h2>

        {enabledSports.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-slate-500 mb-4">No sports enabled yet.</p>
            <button
              type="button"
              onClick={() => navigate('/settings/app')}
              className="btn-primary"
            >
              Go to Settings
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {enabledSports.map(sport => {
              const hasActiveGame = Boolean(
                activeLocalGameId && isGameStateForSport(state, sport.id)
              )
              const parkedForSport = parkedOnly.filter(game => isParkedGameForSport(game, sport.id))
              const needsSync = parkedForSport.some(game => game.syncDirty || game.syncStatus === 'error')
              const statCount = sport.categories.reduce((n, c) => n + c.actions.length, 0)

              return (
                <button
                  key={sport.id}
                  type="button"
                  onClick={() => navigate(sportDashboardPath(sport.id))}
                  className="card text-left flex items-center gap-3 hover:border-blue-200 hover:shadow-md active:scale-[0.99] transition-all"
                >
                  <span className="text-4xl w-12 text-center shrink-0">{sport.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-800">{sport.name}</span>
                    <span className="block text-xs text-slate-500">
                      {statCount} stats
                      {parkedForSport.length > 0 ? ` - ${parkedForSport.length} parked` : ''}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1 shrink-0">
                    {hasActiveGame && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                        Active
                      </span>
                    )}
                    {needsSync && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        Sync
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-8">
          v0.1.0
        </p>
      </div>
    </div>
  )
}
