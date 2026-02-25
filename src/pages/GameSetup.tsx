import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'

export default function GameSetup() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const sport = state.sport

  const [teamName, setTeamName] = useState(state.gameInfo?.teamName || '')
  const [opponentName, setOpponentName] = useState(state.gameInfo?.opponentName || '')
  const [tournamentName, setTournamentName] = useState(state.gameInfo?.tournamentName || '')
  const [date, setDate] = useState(
    state.gameInfo?.date || new Date().toISOString().split('T')[0]
  )

  if (!sport) {
    navigate('/')
    return null
  }

  const canProceed = teamName.trim() && opponentName.trim()

  const handleNext = () => {
    if (!canProceed) return
    dispatch({
      type: 'SET_GAME_INFO',
      gameInfo: {
        teamName: teamName.trim(),
        opponentName: opponentName.trim(),
        tournamentName: tournamentName.trim(),
        date,
      },
    })
    navigate('/players')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-4`}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">{sport.icon} {sport.name}</h1>
            <p className="text-sm opacity-80">Game Setup</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Your Team Name *
            </label>
            <input
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="e.g., Eagles"
              className="input-field"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Opponent *
            </label>
            <input
              type="text"
              value={opponentName}
              onChange={e => setOpponentName(e.target.value)}
              placeholder="e.g., Tigers"
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Tournament / League
            </label>
            <input
              type="text"
              value={tournamentName}
              onChange={e => setTournamentName(e.target.value)}
              placeholder="e.g., Spring League 2026"
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="input-field"
            />
          </div>
        </div>

        <button
          onClick={handleNext}
          disabled={!canProceed}
          className="btn-primary w-full mt-8"
        >
          Next: Add Players →
        </button>
      </div>
    </div>
  )
}
