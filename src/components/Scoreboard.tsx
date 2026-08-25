import { FilePenLine } from 'lucide-react'
import { useGame } from '../context/GameContext'
import { getDisplayedHomeScore } from '../lib/gameScore'
import { isTeamPseudoPlayer } from '../lib/teamPlayers'
import type { BasketballTeamSide } from '../lib/basketball/types'
import { isBasketballEventLocalOnly } from '../lib/basketball/eventCloudPolicy'

interface EventScoreControls {
  disabled: boolean
  onAdjust: (teamSide: BasketballTeamSide, delta: 1 | -1) => void
  onOfficialCorrection: () => void
}

interface ScoreboardProps {
  readOnly?: boolean
  eventScoreControls?: EventScoreControls
}

export default function Scoreboard({ readOnly = false, eventScoreControls }: ScoreboardProps) {
  const { state, dispatch } = useGame()
  const { sport, gameInfo, players, opponentScore, homeTeamScore, homeScoreAdjustment, cloudSync } =
    state

  if (!sport || !gameInfo) return null

  const rosterPlayers = players.filter(p => !isTeamPseudoPlayer(p))
  const teamScore = getDisplayedHomeScore(sport, rosterPlayers, homeTeamScore, homeScoreAdjustment)

  const syncLabel = (() => {
    if (isBasketballEventLocalOnly(state) && cloudSync.status !== 'error') {
      return 'Cloud Sync: local only'
    }
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
          {!readOnly && <div className="flex justify-center gap-2 mt-1">
            <button
              onClick={() => dispatch({ type: 'DECREMENT_HOME_SCORE' })}
              className="w-8 h-8 rounded-full bg-white/20 text-white text-sm font-bold active:scale-90 transition-transform"
            >
              −
            </button>
            <button
              onClick={() => dispatch({ type: 'INCREMENT_HOME_SCORE' })}
              className="w-8 h-8 rounded-full bg-white/20 text-white text-sm font-bold active:scale-90 transition-transform"
            >
              +
            </button>
          </div>}
          {eventScoreControls && <div className="flex justify-center gap-2 mt-1">
            <button
              onClick={() => eventScoreControls.onAdjust('tracked', -1)}
              disabled={eventScoreControls.disabled || teamScore === 0}
              aria-label={`Decrease ${gameInfo.teamName} score`}
              className="w-8 h-8 rounded-full bg-white/20 text-white text-sm font-bold active:scale-90 transition-transform disabled:opacity-30"
            >
              -
            </button>
            <button
              onClick={() => eventScoreControls.onAdjust('tracked', 1)}
              disabled={eventScoreControls.disabled}
              aria-label={`Increase ${gameInfo.teamName} score`}
              className="w-8 h-8 rounded-full bg-white/20 text-white text-sm font-bold active:scale-90 transition-transform disabled:opacity-30"
            >
              +
            </button>
          </div>}
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
          {!readOnly && <div className="flex justify-center gap-2 mt-1">
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
          </div>}
          {eventScoreControls && <div className="flex justify-center gap-2 mt-1">
            <button
              onClick={() => eventScoreControls.onAdjust('opponent', -1)}
              disabled={eventScoreControls.disabled || opponentScore === 0}
              aria-label={`Decrease ${gameInfo.opponentName} score`}
              className="w-8 h-8 rounded-full bg-white/20 text-white text-sm font-bold active:scale-90 transition-transform disabled:opacity-30"
            >
              -
            </button>
            <button
              onClick={() => eventScoreControls.onAdjust('opponent', 1)}
              disabled={eventScoreControls.disabled}
              aria-label={`Increase ${gameInfo.opponentName} score`}
              className="w-8 h-8 rounded-full bg-white/20 text-white text-sm font-bold active:scale-90 transition-transform disabled:opacity-30"
            >
              +
            </button>
          </div>}
        </div>
      </div>

      {eventScoreControls && (
        <button
          type="button"
          onClick={eventScoreControls.onOfficialCorrection}
          disabled={eventScoreControls.disabled}
          className="mx-auto mt-3 flex min-h-9 items-center gap-2 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/25 disabled:opacity-30"
        >
          <FilePenLine size={15} aria-hidden="true" />
          Official correction
        </button>
      )}

      {gameInfo.tournamentName && (
        <p className="text-center text-xs opacity-60 mt-2">{gameInfo.tournamentName}</p>
      )}
      {cloudSync.repairedPlayerLinks && cloudSync.repairedPlayerLinks.length > 0 && (
        <p role="alert" className="text-center text-[11px] mt-1 rounded bg-amber-500/25 px-2 py-1">
          Fixed a duplicate cloud link for {cloudSync.repairedPlayerLinks.join(', ')}. Earlier
          syncs of this game merged their stats — check those totals in the cloud.
        </p>
      )}
      {syncLabel && (
        <p className="text-center text-[11px] opacity-70 mt-1">{syncLabel}</p>
      )}
    </div>
  )
}
