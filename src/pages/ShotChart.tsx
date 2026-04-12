import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import BasketballCourt from '../components/shot-chart/BasketballCourt'
import { classifyShotZone, isThreePointer } from '../components/shot-chart/courtGeometry'
import {
  isTeamPseudoPlayer,
  TEAM_PLAYER_HOME_ID,
  TEAM_PLAYER_OPP_ID,
} from '../lib/teamPlayers'
import type { ActionLogEntry, Player, ShotRecord } from '../types'

function sortTeamPlayersFirst(players: Player[]): Player[] {
  const teams = players.filter(isTeamPseudoPlayer)
  const home = teams.find(p => p.id === TEAM_PLAYER_HOME_ID || p.teamSide === 'home')
  const opp = teams.find(p => p.id === TEAM_PLAYER_OPP_ID || p.teamSide === 'opponent')
  const restTeam = teams.filter(p => p !== home && p !== opp)
  const individuals = players.filter(p => !isTeamPseudoPlayer(p))
  const orderedTeams = [home, opp, ...restTeam].filter(Boolean) as Player[]
  return [...orderedTeams, ...individuals]
}

function newShotId(): string {
  return `shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

function shotLabelFromLogEntry(
  entry: ActionLogEntry | undefined,
  players: Player[]
): string | null {
  if (!entry?.shotId || entry.type !== 'increment' || !entry.playerId || !entry.statId) {
    return null
  }
  const player = players.find(p => p.id === entry.playerId)
  const num = player?.number?.trim()
  const who = num ? `#${num}` : player?.name?.split(' ')[0] ?? 'Player'
  const sid = entry.statId
  let kind = sid.toUpperCase()
  if (sid === '2pt') kind = '2PT Made'
  else if (sid === '2pt_miss') kind = '2PT Miss'
  else if (sid === '3pt') kind = '3PT Made'
  else if (sid === '3pt_miss') kind = '3PT Miss'
  return `Last: ${who} ${kind}`
}

/**
 * Shot chart: `#/shot-chart`. Taps dispatch `ADD_SHOT`; markers use `state.shotChart`.
 */
export default function ShotChart() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const { sport, gameInfo, players, activePlayerId, shotChart, actionLog } = state
  const [mode, setMode] = useState<'made' | 'missed'>('made')

  const allowed = Boolean(sport && sport.id === 'basketball' && gameInfo)

  useEffect(() => {
    if (!allowed) {
      navigate('/', { replace: true })
    }
  }, [allowed, navigate])

  const selectorPlayers = useMemo(() => sortTeamPlayersFirst(players), [players])
  const effectivePlayerId =
    activePlayerId && players.some(p => p.id === activePlayerId)
      ? activePlayerId
      : selectorPlayers[0]?.id ?? null

  const onCourtTap = useCallback(
    (x: number, y: number) => {
      if (!effectivePlayerId) return
      const three = isThreePointer(x, y)
      const shot: ShotRecord = {
        id: newShotId(),
        x,
        y,
        made: mode === 'made',
        shotType: three ? '3pt' : '2pt',
        zone: classifyShotZone(x, y),
        playerId: effectivePlayerId,
        timestamp: Date.now(),
      }
      dispatch({ type: 'ADD_SHOT', shot })
    },
    [dispatch, effectivePlayerId, mode]
  )

  const lastEntry = actionLog.length > 0 ? actionLog[actionLog.length - 1] : undefined
  const canUndoShot = Boolean(lastEntry?.shotId)
  const undoShotSubtitle = useMemo(
    () => shotLabelFromLogEntry(lastEntry, players),
    [lastEntry, players]
  )
  const canClearShots = shotChart.length > 0

  const handleClearChart = () => {
    if (
      !window.confirm(
        'Remove every shot from the chart and undo their scoring stats? Stat taps (no location) are not changed.'
      )
    ) {
      return
    }
    dispatch({ type: 'CLEAR_SHOT_CHART' })
  }

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
        <p className="text-xs text-slate-500 mt-1">
          Tap coordinates are feet from the rim (
          <code className="bg-slate-100 px-1 rounded">shotChartCoordinates.ts</code>
          ).
        </p>

        <div className="mt-3 flex rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <button
            type="button"
            onClick={() => setMode('made')}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              mode === 'made'
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Made
          </button>
          <button
            type="button"
            onClick={() => setMode('missed')}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              mode === 'missed'
                ? 'bg-rose-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Missed
          </button>
        </div>
      </div>

      <div className="px-3 py-2 max-w-lg mx-auto w-full">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide items-stretch">
          {selectorPlayers.map((player, index) => {
            const isTeam = isTeamPseudoPlayer(player)
            const teamCount = selectorPlayers.filter(isTeamPseudoPlayer).length
            const showDivider = isTeam && index === teamCount - 1 && teamCount > 0
            const isActive = player.id === effectivePlayerId

            return (
              <div key={player.id} className="flex flex-shrink-0 items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_ACTIVE_PLAYER', playerId: player.id })}
                  title={player.name}
                  className={`
                    flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold max-w-[10.5rem]
                    transition-all duration-150 active:scale-95 text-left
                    ${isTeam
                      ? isActive
                        ? `bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-md ring-2 ring-white/30`
                        : `bg-gradient-to-br from-slate-100 to-slate-200/90 text-slate-800 border border-slate-300/80 shadow-sm`
                      : isActive
                        ? `${sport!.theme.bg} text-white shadow-md`
                        : 'bg-white text-slate-600 border border-slate-200'
                    }
                  `}
                >
                  <span className={isTeam ? 'opacity-90' : 'opacity-70'}>
                    {isTeam ? '★' : `#${player.number || '?'}`}
                  </span>{' '}
                  <span className="line-clamp-2 break-words">
                    {isTeam ? player.name : player.name.split(' ')[0]}
                  </span>
                </button>
                {showDivider && (
                  <div className="w-px self-stretch min-h-[2.5rem] bg-slate-300 shrink-0" aria-hidden />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="px-3 pb-2 max-w-lg mx-auto w-full space-y-2">
        <button
          type="button"
          disabled={!canUndoShot}
          onClick={() => dispatch({ type: 'UNDO_LAST_SHOT' })}
          className="w-full py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-800
                     disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99] transition-transform"
        >
          ↩ Undo last shot
        </button>
        {undoShotSubtitle && (
          <p className="text-center text-xs text-slate-500 -mt-1">{undoShotSubtitle}</p>
        )}
        {!canUndoShot && actionLog.length > 0 && (
          <p className="text-center text-xs text-slate-400">
            Last action was not from the chart — use <span className="font-medium">Undo</span> on Game Tracker
            for stat taps and other changes.
          </p>
        )}
        <button
          type="button"
          disabled={!canClearShots}
          onClick={handleClearChart}
          className="w-full py-2 rounded-xl text-sm font-medium border border-rose-200 bg-rose-50 text-rose-800
                     disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99] transition-transform"
        >
          Clear all chart shots
        </button>
      </div>

      <div className="px-3 pb-6 max-w-lg mx-auto w-full flex-1 flex flex-col">
        <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm mt-1">
          <BasketballCourt shots={shotChart} onCourtTap={onCourtTap} className="w-full" />
        </div>
      </div>
    </div>
  )
}
