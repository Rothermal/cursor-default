import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { computePlayerScore, computeCategoryTotal } from '../config/sports'

export default function GameSummary() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const { sport, gameInfo, players, opponentScore } = state

  if (!sport || !gameInfo) {
    navigate('/')
    return null
  }

  const teamScore = players.reduce(
    (total, player) => total + computePlayerScore(sport, player.stats),
    0
  )

  const allStatIds = sport.categories.flatMap(c => c.actions.map(a => a.id))

  const teamTotals: Record<string, number> = {}
  for (const statId of allStatIds) {
    teamTotals[statId] = players.reduce((sum, p) => sum + (p.stats[statId] || 0), 0)
  }

  const handleNewGame = () => {
    dispatch({ type: 'RESET_GAME' })
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-6`}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate('/game')}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                         active:scale-90 transition-transform"
            >
              ←
            </button>
            <h1 className="text-lg font-bold">Game Summary</h1>
          </div>

          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <p className="text-sm opacity-80">{gameInfo.teamName}</p>
              <p className="text-4xl font-bold">{teamScore}</p>
            </div>
            <p className="text-xl opacity-60">vs</p>
            <div className="text-center">
              <p className="text-sm opacity-80">{gameInfo.opponentName}</p>
              <p className="text-4xl font-bold">{opponentScore}</p>
            </div>
          </div>

          {gameInfo.tournamentName && (
            <p className="text-center text-sm opacity-60 mt-2">{gameInfo.tournamentName}</p>
          )}
          <p className="text-center text-xs opacity-40 mt-1">{gameInfo.date}</p>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        {sport.categories.map(category => (
          <div key={category.id} className="mb-6">
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
                    <th className="text-left py-2 pr-3 font-semibold text-slate-600">Player</th>
                    {category.actions.map(action => (
                      <th
                        key={action.id}
                        className="text-center py-2 px-2 font-semibold text-slate-600 min-w-[40px]"
                      >
                        {action.shortLabel}
                      </th>
                    ))}
                    {category.showTotal && (
                      <th className="text-center py-2 px-2 font-bold text-slate-700 min-w-[50px]">
                        TOT
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {players.map(player => {
                    const catTotal = category.showTotal
                      ? category.actions.some(a => a.pointValue)
                        ? category.actions.reduce(
                            (sum, a) => sum + (player.stats[a.id] || 0) * (a.pointValue || 0),
                            0
                          )
                        : computeCategoryTotal(category, player.stats)
                      : null

                    return (
                      <tr key={player.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className="text-slate-400 mr-1">#{player.number || '?'}</span>
                          <span className="font-medium">{player.name}</span>
                        </td>
                        {category.actions.map(action => (
                          <td key={action.id} className="text-center py-2 px-2 tabular-nums">
                            {player.stats[action.id] || 0}
                          </td>
                        ))}
                        {category.showTotal && (
                          <td className="text-center py-2 px-2 font-bold tabular-nums">
                            {catTotal}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="py-2 pr-3">Team</td>
                    {category.actions.map(action => (
                      <td key={action.id} className="text-center py-2 px-2 tabular-nums">
                        {teamTotals[action.id] || 0}
                      </td>
                    ))}
                    {category.showTotal && (
                      <td className="text-center py-2 px-2 font-bold tabular-nums">
                        {category.actions.some(a => a.pointValue)
                          ? category.actions.reduce(
                              (sum, a) => sum + (teamTotals[a.id] || 0) * (a.pointValue || 0),
                              0
                            )
                          : computeCategoryTotal(category, teamTotals)
                        }
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="mt-8 space-y-3">
          <button
            onClick={() => navigate('/game')}
            className="btn-primary w-full"
          >
            ← Back to Game
          </button>
          <button
            onClick={handleNewGame}
            className="btn-secondary w-full"
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  )
}
