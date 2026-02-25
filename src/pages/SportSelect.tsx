import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { sports } from '../config/sports'

export default function SportSelect() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()

  const handleSelect = (sportId: string) => {
    const sport = sports.find(s => s.id === sportId)
    if (sport) {
      dispatch({ type: 'SET_SPORT', sport })
      navigate('/setup')
    }
  }

  const hasActiveGame = state.sport && state.players.length > 0

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 px-4 py-8 max-w-lg mx-auto w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-800">📊 StatKeeper</h1>
          <p className="text-slate-500 mt-2">Track game stats in real time</p>
        </div>

        {hasActiveGame && (
          <div className="card mb-6 border-blue-200 bg-blue-50">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-blue-800">
                  {state.sport!.icon} Active Game
                </p>
                <p className="text-sm text-blue-600">
                  {state.gameInfo?.teamName} vs {state.gameInfo?.opponentName}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate('/game')}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold
                             active:scale-95 transition-transform"
                >
                  Resume
                </button>
                <button
                  onClick={() => dispatch({ type: 'RESET_GAME' })}
                  className="bg-white text-blue-600 px-3 py-2 rounded-lg text-sm font-semibold
                             border border-blue-200 active:scale-95 transition-transform"
                >
                  New
                </button>
              </div>
            </div>
          </div>
        )}

        <h2 className="text-lg font-semibold text-slate-700 mb-3">Choose a Sport</h2>

        <div className="grid grid-cols-2 gap-3">
          {sports.map(sport => (
            <button
              key={sport.id}
              onClick={() => handleSelect(sport.id)}
              className={`
                card flex flex-col items-center gap-2 py-6
                hover:shadow-md active:scale-[0.97] transition-all duration-150
                border-2 border-transparent hover:${sport.theme.border}
              `}
            >
              <span className="text-4xl">{sport.icon}</span>
              <span className="font-semibold text-slate-700">{sport.name}</span>
              <span className="text-xs text-slate-400">
                {sport.categories.reduce((n, c) => n + c.actions.length, 0)} stats
              </span>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          More sports coming soon • v0.1.0
        </p>
      </div>
    </div>
  )
}
