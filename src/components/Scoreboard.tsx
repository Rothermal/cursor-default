import { useGame } from '../context/GameContext'
import { computePlayerScore } from '../config/sports'

export default function Scoreboard() {
  const { state, dispatch } = useGame()
  const { sport, gameInfo, players, opponentScore, cloudSync } = state

  if (!sport || !gameInfo) return null

  const teamScore = players.reduce(
    (total, player) => total + computePlayerScore(sport, player.stats),
    0
  )

  const syncLabel = (() => {
    switch (cloudSync.status) {
      case 'offline':
        return 'Cloud Sync: offline'
      case 'syncing':
        return 'Cloud Sync: syncing...'
      case 'synced':
        return cloudSync.lastSyncedAt ? 'Cloud Sync: saved' : 'Cloud Sync: connected'
      case 'error':
        if (cloudSync.lastError?.includes("Could not find the table 'public.")) {
          return 'Cloud Sync: run migrations'
        }
        if (cloudSync.lastError?.includes('infinite recursion detected in policy')) {
          return 'Cloud Sync: apply 005 migration'
        }
        return 'Cloud Sync: error'
      case 'idle':
      default:
        return null
    }
  })()

  return (
    <div className={`bg-gradient-to-r ${sport.theme.gradient} text-white rounded-2xl p-4 shadow-lg`}>
      <div className="flex items-center justify-between">
        <div className="flex-1 text-center">
          <p className="text-xs font-medium uppercase tracking-wide opacity-80">
            {gameInfo.teamName}
          </p>
          <p className="text-4xl font-bold tabular-nums">{teamScore}</p>
        </div>

        <div className="px-4">
          <p className="text-xs font-medium uppercase tracking-wide opacity-60 text-center">
            {sport.scoreLabel}
          </p>
          <p className="text-lg font-semibold opacity-60 text-center">vs</p>
        </div>

        <div className="flex-1 text-center">
          <p className="text-xs font-medium uppercase tracking-wide opacity-80">
            {gameInfo.opponentName}
          </p>
          <p className="text-4xl font-bold tabular-nums">{opponentScore}</p>
          <div className="flex justify-center gap-2 mt-1">
            <button
              onClick={() => dispatch({ type: 'DECREMENT_OPPONENT_SCORE' })}
              className="w-8 h-8 rounded-full bg-white/20 text-white text-sm font-bold active:scale-90 transition-transform"
            >
              −
            </button>
            <button
              onClick={() => dispatch({ type: 'INCREMENT_OPPONENT_SCORE' })}
              className="w-8 h-8 rounded-full bg-white/20 text-white text-sm font-bold active:scale-90 transition-transform"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {gameInfo.tournamentName && (
        <p className="text-center text-xs opacity-60 mt-2">{gameInfo.tournamentName}</p>
      )}
      {syncLabel && (
        <p className="text-center text-[11px] opacity-70 mt-1">{syncLabel}</p>
      )}
    </div>
  )
}
