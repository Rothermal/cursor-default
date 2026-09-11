import { FilePenLine } from 'lucide-react'
import { useGame } from '../context/GameContext'
import { getDisplayedHomeScore } from '../lib/gameScore'
import { isTeamPseudoPlayer } from '../lib/teamPlayers'
import type { BasketballTeamSide } from '../lib/basketball/types'
import { isBasketballEventLocalOnly } from '../lib/basketball/eventCloudPolicy'
import { gameSideDisplayName } from '../lib/display'

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
  const trackedLabel = gameSideDisplayName(gameInfo, 'tracked')
  const opponentLabel = gameSideDisplayName(gameInfo, 'opponent')

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
    <div className="rounded-lg border border-line bg-surface p-4 text-content shadow-sm">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1 text-center">
          <p className="text-xs font-medium break-words text-content-muted">
            {trackedLabel}
          </p>
          <p className="text-4xl font-bold tabular-nums">{teamScore}</p>
          {!readOnly && <div className="flex justify-center gap-2 mt-1">
            <button
              onClick={() => dispatch({ type: 'DECREMENT_HOME_SCORE' })}
              className="w-8 h-8 rounded-full bg-control text-content text-sm font-bold active:scale-90 transition-transform"
            >
              −
            </button>
            <button
              onClick={() => dispatch({ type: 'INCREMENT_HOME_SCORE' })}
              className="w-8 h-8 rounded-full bg-control text-content text-sm font-bold active:scale-90 transition-transform"
            >
              +
            </button>
          </div>}
          {eventScoreControls && <div className="flex justify-center gap-2 mt-1">
            <button
              onClick={() => eventScoreControls.onAdjust('tracked', -1)}
              disabled={eventScoreControls.disabled || teamScore === 0}
              aria-label={`Decrease ${trackedLabel} score`}
              className="w-8 h-8 rounded-full bg-control text-content text-sm font-bold active:scale-90 transition-transform disabled:bg-control-disabled disabled:text-content-disabled"
            >
              -
            </button>
            <button
              onClick={() => eventScoreControls.onAdjust('tracked', 1)}
              disabled={eventScoreControls.disabled}
              aria-label={`Increase ${trackedLabel} score`}
              className="w-8 h-8 rounded-full bg-control text-content text-sm font-bold active:scale-90 transition-transform disabled:bg-control-disabled disabled:text-content-disabled"
            >
              +
            </button>
          </div>}
        </div>

        <div className="px-4">
          <p className="text-xs font-medium text-content-subtle text-center">
            {sport.scoreLabel}
          </p>
          <p className="text-lg font-semibold text-content-subtle text-center">vs</p>
        </div>

        <div className="min-w-0 flex-1 text-center">
          <p className="text-xs font-medium break-words text-content-muted">
            {opponentLabel}
          </p>
          <p className="text-4xl font-bold tabular-nums">{opponentScore}</p>
          {!readOnly && <div className="flex justify-center gap-2 mt-1">
            <button
              onClick={() => dispatch({ type: 'DECREMENT_OPPONENT_SCORE' })}
              className="w-8 h-8 rounded-full bg-control text-content text-sm font-bold active:scale-90 transition-transform"
            >
              −
            </button>
            <button
              onClick={() => dispatch({ type: 'INCREMENT_OPPONENT_SCORE' })}
              className="w-8 h-8 rounded-full bg-control text-content text-sm font-bold active:scale-90 transition-transform"
            >
              +
            </button>
          </div>}
          {eventScoreControls && <div className="flex justify-center gap-2 mt-1">
            <button
              onClick={() => eventScoreControls.onAdjust('opponent', -1)}
              disabled={eventScoreControls.disabled || opponentScore === 0}
              aria-label={`Decrease ${opponentLabel} score`}
              className="w-8 h-8 rounded-full bg-control text-content text-sm font-bold active:scale-90 transition-transform disabled:bg-control-disabled disabled:text-content-disabled"
            >
              -
            </button>
            <button
              onClick={() => eventScoreControls.onAdjust('opponent', 1)}
              disabled={eventScoreControls.disabled}
              aria-label={`Increase ${opponentLabel} score`}
              className="w-8 h-8 rounded-full bg-control text-content text-sm font-bold active:scale-90 transition-transform disabled:bg-control-disabled disabled:text-content-disabled"
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
          className="mx-auto mt-3 flex min-h-9 items-center gap-2 rounded-lg bg-control text-content px-3 py-1.5 text-xs font-semibold hover:bg-control-hover disabled:bg-control-disabled disabled:text-content-disabled"
        >
          <FilePenLine size={15} aria-hidden="true" />
          Official correction
        </button>
      )}

      {gameInfo.tournamentName && (
        <p className="break-words text-center text-xs text-content-subtle mt-2">{gameInfo.tournamentName}</p>
      )}
      {cloudSync.repairedPlayerLinks && cloudSync.repairedPlayerLinks.length > 0 && (
        <p role="alert" className="break-words text-center text-[11px] mt-1 rounded bg-warning text-warning-content px-2 py-1">
          Fixed a duplicate cloud link for {cloudSync.repairedPlayerLinks.join(', ')}. Earlier
          syncs of this game merged their stats — check those totals in the cloud.
        </p>
      )}
      {syncLabel && (
        <p className="text-center text-[11px] text-content-muted mt-1">{syncLabel}</p>
      )}
    </div>
  )
}
