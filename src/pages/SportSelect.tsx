import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { sports } from '../config/sports'
import { getDisplayedHomeScore } from '../lib/gameScore'
import { isTeamPseudoPlayer } from '../lib/teamPlayers'

export default function SportSelect() {
  const navigate = useNavigate()
  const {
    state,
    activeLocalGameId,
    parkedGames,
    startNewGame,
    parkCurrentGame,
    resumeParkedGame,
    discardParkedGame,
  } = useGame()
  const { user, signOut, isConfigured } = useAuth()
  const { isSportEnabled } = useSettings()
  const [newGameError, setNewGameError] = useState<string | null>(null)

  const enabledSports = sports.filter(s => isSportEnabled(s.id))
  const syncStatusLabel = (() => {
    switch (state.cloudSync.status) {
      case 'offline':
        return 'Cloud Sync: offline'
      case 'syncing':
        return 'Cloud Sync: syncing...'
      case 'synced':
        return 'Cloud Sync: saved'
      case 'error':
        if (state.cloudSync.lastError?.includes("Could not find the table 'public.")) {
          return 'Cloud Sync: run migrations'
        }
        if (state.cloudSync.lastError?.includes('infinite recursion detected in policy')) {
          return 'Cloud Sync: apply 005 migration'
        }
        return 'Cloud Sync: error'
      default:
        return null
    }
  })()

  const hasActiveGame = state.sport && state.players.length > 0
  const parkedOnly = parkedGames.filter(game => game.localGameId !== activeLocalGameId)

  // Live score, mirroring Scoreboard.tsx exactly: roster players only (no team
  // pseudo-players) so the card always matches the in-game scoreboard (F4 D1).
  const liveScoreLine = (() => {
    if (!hasActiveGame) return null
    const rosterPlayers = state.players.filter(p => !isTeamPseudoPlayer(p))
    const homeScore = getDisplayedHomeScore(
      state.sport!,
      rosterPlayers,
      state.homeTeamScore,
      state.homeScoreAdjustment
    )
    return `${homeScore}–${state.opponentScore}`
  })()

  const handleSelect = (sportId: string) => {
    setNewGameError(null)
    if (hasActiveGame && !window.confirm('Park your current game and start a new one?')) {
      return
    }
    const sport = sports.find(s => s.id === sportId)
    if (sport) {
      startNewGame(sport)
      navigate('/setup')
    }
  }

  const handleNewGame = () => {
    setNewGameError(null)
    if (!hasActiveGame) return
    if (!window.confirm('Park your current game and choose another sport?')) {
      return
    }
    parkCurrentGame()
  }

  const routeForResumedGame = (resumed: typeof state) => {
    if (!resumed.sport) return '/'
    if (!resumed.gameInfo) return '/setup'
    if (resumed.players.length === 0) return '/players'
    return '/game'
  }

  const parkedSyncLabel = (game: (typeof parkedGames)[number]) => {
    if (game.syncDirty) {
      if (game.syncStatus === 'error') {
        return game.syncLastError ? `Sync: error - ${game.syncLastError}` : 'Sync: error'
      }
      if (game.syncStatus === 'offline') return 'Sync: offline changes pending'
      if (game.syncStatus === 'syncing') return 'Sync: syncing...'
      return 'Sync: pending'
    }
    if (game.syncStatus === 'synced') return 'Sync: saved'
    return `Sync: ${game.syncStatus}`
  }

  const handleResumeParked = (localGameId: string) => {
    setNewGameError(null)
    const resumed = resumeParkedGame(localGameId)
    if (!resumed) {
      setNewGameError('That parked game could not be loaded.')
      return
    }
    navigate(routeForResumedGame(resumed))
  }

  const handleDiscardParked = (localGameId: string) => {
    setNewGameError(null)
    if (!window.confirm('Discard this parked game? This cannot be undone.')) {
      return
    }
    discardParkedGame(localGameId)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 px-4 py-8 max-w-lg mx-auto w-full">
        <div className="text-center mb-8 relative">
          <button
            onClick={() => navigate('/admin')}
            className="absolute right-0 top-0 w-10 h-10 rounded-full bg-slate-100
                       flex items-center justify-center text-slate-500
                       hover:bg-slate-200 active:scale-90 transition-all"
            aria-label="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </button>
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
                {liveScoreLine && (
                  <p className="text-base font-bold text-blue-800 tabular-nums mt-0.5">
                    {liveScoreLine}
                  </p>
                )}
                {syncStatusLabel && (
                  <p className="text-xs text-blue-500 mt-1">{syncStatusLabel}</p>
                )}
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
                  onClick={handleNewGame}
                  className="bg-white text-blue-600 px-3 py-2 rounded-lg text-sm font-semibold
                             border border-blue-200 active:scale-95 transition-transform"
                >
                  New
                </button>
              </div>
            </div>
            {newGameError && (
              <p className="text-xs text-red-600 mt-2">{newGameError}</p>
            )}
          </div>
        )}

        {parkedOnly.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-3">Parked Games</h2>
            <div className="space-y-2">
              {parkedOnly.map(game => (
                <div key={game.localGameId} className="card flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700 truncate">
                      {game.sportIcon} {game.teamName} vs {game.opponentName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {game.sportName}
                      {game.gameDate ? ` · ${game.gameDate}` : ''}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate" title={parkedSyncLabel(game)}>
                      {parkedSyncLabel(game)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleResumeParked(game.localGameId)}
                      className="bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-semibold
                                 active:scale-95 transition-transform"
                    >
                      Resume
                    </button>
                    <button
                      onClick={() => handleDiscardParked(game.localGameId)}
                      className="bg-white text-slate-600 px-3 py-2 rounded-lg text-sm font-semibold
                                 border border-slate-200 active:scale-95 transition-transform"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <h2 className="text-lg font-semibold text-slate-700 mb-3">Choose a Sport</h2>

        {enabledSports.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🏟️</p>
            <p className="text-slate-500 mb-4">No sports enabled yet.</p>
            <button
              onClick={() => navigate('/admin')}
              className="btn-primary"
            >
              Go to Settings
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {enabledSports.map(sport => (
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
        )}

        {isConfigured && user && (
          <div className="mt-8 text-center">
            <div className="flex flex-wrap gap-2 justify-center mb-3">
              <button
                onClick={() => navigate('/games')}
                className="btn-secondary py-2 px-3 text-xs"
              >
                Cloud Games
              </button>
              <button
                onClick={() => navigate('/teams')}
                className="btn-secondary py-2 px-3 text-xs"
              >
                Teams
              </button>
              <button
                onClick={() => navigate('/leaderboard')}
                className="btn-secondary py-2 px-3 text-xs"
              >
                Season Stats
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-2">
              Signed in as {user.email}
            </p>
            <button
              onClick={signOut}
              className="text-xs text-slate-400 underline hover:text-slate-600"
            >
              Sign Out
            </button>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-4">
          v0.1.0
        </p>
      </div>
    </div>
  )
}
