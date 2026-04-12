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
import type { Player, ShotRecord } from '../types'

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

/**
 * Shot chart: `#/shot-chart`. Taps dispatch `ADD_SHOT` (SC-3); markers use `state.shotChart`.
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

  const canUndo = actionLog.length > 0

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

      <div className="px-3 pb-2 max-w-lg mx-auto w-full">
        <button
          type="button"
          disabled={!canUndo}
          onClick={() => dispatch({ type: 'UNDO' })}
          className="w-full py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-700
                     disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99] transition-transform"
        >
          ↩ Undo last action
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
