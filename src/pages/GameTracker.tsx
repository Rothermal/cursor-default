import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { computeCategoryTotal } from '../config/sports'
import { resolveTeamStatsConfig } from '../config/teamStatsDefaults'
import { buildPeriodSegmentLabels, getBonusFoulCountForPeriod } from '../lib/teamStatsPeriods'
import type { BasketballTeamStatsConfig, Player, StatAction, StatCategory } from '../types'
import Scoreboard from '../components/Scoreboard'
import StatButton from '../components/StatButton'
import PeriodToggle from '../components/team-stats/PeriodToggle'
import BasketballBonusIndicator from '../components/team-stats/BasketballBonusIndicator'
import {
  isTeamPseudoPlayer,
  TEAM_PLAYER_HOME_ID,
  TEAM_PLAYER_OPP_ID,
} from '../lib/teamPlayers'

function sortTeamPlayersFirst(players: Player[]): Player[] {
  const teams = players.filter(isTeamPseudoPlayer)
  const home = teams.find(p => p.id === TEAM_PLAYER_HOME_ID || p.teamSide === 'home')
  const opp = teams.find(p => p.id === TEAM_PLAYER_OPP_ID || p.teamSide === 'opponent')
  const restTeam = teams.filter(p => p !== home && p !== opp)
  const individuals = players.filter(p => !isTeamPseudoPlayer(p))
  const orderedTeams = [home, opp, ...restTeam].filter(Boolean) as Player[]
  return [...orderedTeams, ...individuals]
}

/** Strip `_pN` suffix for config lookup (undo log stores scoped ids). */
function baseStatId(statId: string): string {
  return statId.replace(/_p\d+$/, '')
}

function findStatShortLabel(categories: StatCategory[] | undefined, statId: string | undefined): string {
  if (!statId) return ''
  const base = baseStatId(statId)
  for (const cat of categories ?? []) {
    for (const action of cat.actions) {
      if (action.id === base) return action.shortLabel
    }
  }
  return statId
}

function hasPeriodScopedActions(categories: StatCategory[] | undefined): boolean {
  if (!categories) return false
  return categories.some(cat => cat.actions.some(a => a.periodScoped))
}

/** Sum stats for `baseId_p1`, `baseId_p2`, ... */
function sumPeriodScopedStats(stats: Record<string, number>, baseId: string): number {
  const prefix = `${baseId}_p`
  let sum = 0
  for (const [key, val] of Object.entries(stats)) {
    if (key.startsWith(prefix)) sum += val
  }
  return sum
}

function actualStatId(action: StatAction, currentPeriod: number): string {
  return action.periodScoped ? `${action.id}_p${currentPeriod}` : action.id
}

/** Max timeouts for this period index (1-based); undefined = unlimited. */
function timeoutCapForPeriod(
  rules: BasketballTeamStatsConfig | null,
  periodIndex: number
): number | undefined {
  if (!rules) return undefined
  const capReg = rules.timeoutsPerPeriod
  const capOt = rules.timeoutsPerOvertime ?? rules.timeoutsPerPeriod
  const isOt = periodIndex > rules.periodsPerGame
  const cap = isOt ? capOt : capReg
  if (cap == null) return undefined
  return cap
}

export default function GameTracker() {
  const navigate = useNavigate()
  const { state, dispatch, flushCloudSync } = useGame()
  const {
    sport,
    players,
    activePlayerId,
    actionLog,
    notes,
    gameInfo,
    currentPeriod,
    teamStatsConfig,
    shotChart,
  } = state

  const [showAddPlayer, setShowAddPlayer] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNumber, setNewNumber] = useState('')
  const [localNotes, setLocalNotes] = useState(notes)

  const teamRules = useMemo(
    () => (sport ? resolveTeamStatsConfig(sport, teamStatsConfig) : null),
    [sport, teamStatsConfig]
  )

  const basePeriodCount = teamRules?.periodsPerGame ?? 2
  const [periodButtonCount, setPeriodButtonCount] = useState(basePeriodCount)

  useEffect(() => {
    setPeriodButtonCount(basePeriodCount)
  }, [basePeriodCount, sport?.id])

  useEffect(() => {
    if (currentPeriod > periodButtonCount) {
      setPeriodButtonCount(currentPeriod)
    }
  }, [currentPeriod, periodButtonCount])

  const periodSegmentLabels = useMemo(
    () => (teamRules ? buildPeriodSegmentLabels(teamRules, periodButtonCount) : []),
    [periodButtonCount, teamRules]
  )

  const addOvertimeLabel = useMemo(() => {
    const ot = teamRules?.overtimeLabel ?? 'OT'
    return `+ ${ot}`
  }, [teamRules])

  const handleAddOvertime = useCallback(() => {
    const nextCount = periodButtonCount + 1
    setPeriodButtonCount(nextCount)
    dispatch({ type: 'SET_PERIOD', period: nextCount })
  }, [dispatch, periodButtonCount])

  // Flush cloud sync when leaving Game Tracker so latest stats are saved (must run before any early return)
  useEffect(() => {
    return () => {
      flushCloudSync()
    }
  }, [flushCloudSync])

  useEffect(() => {
    setLocalNotes(notes)
  }, [notes])

  useEffect(() => {
    if (!sport?.teamCategories?.length || !gameInfo) return

    const hasHome = players.some(p => p.id === TEAM_PLAYER_HOME_ID)
    const hasOpp = players.some(p => p.id === TEAM_PLAYER_OPP_ID)
    if (hasHome && hasOpp) return

    const homeTeamPlayer: Player = {
      id: TEAM_PLAYER_HOME_ID,
      name: gameInfo.teamName,
      number: '★',
      stats: {},
      isTeamPlayer: true,
      teamSide: 'home',
    }
    const oppTeamPlayer: Player = {
      id: TEAM_PLAYER_OPP_ID,
      name: gameInfo.opponentName,
      number: '★',
      stats: {},
      isTeamPlayer: true,
      teamSide: 'opponent',
    }

    const withoutPlaceholders = players.filter(
      p => p.id !== TEAM_PLAYER_HOME_ID && p.id !== TEAM_PLAYER_OPP_ID
    )
    dispatch({
      type: 'SET_PLAYERS',
      players: [homeTeamPlayer, oppTeamPlayer, ...withoutPlaceholders],
    })
  }, [sport, gameInfo, players, dispatch])

  const selectorPlayers = useMemo(() => sortTeamPlayersFirst(players), [players])
  const teamSelectorCount = selectorPlayers.filter(isTeamPseudoPlayer).length

  if (!sport || !gameInfo || players.length === 0) {
    navigate('/')
    return null
  }

  const activePlayer = players.find(p => p.id === activePlayerId) || players[0]
  const showTeamStatGrid = Boolean(activePlayer.isTeamPlayer && sport.teamCategories?.length)
  const showPeriodToggle =
    showTeamStatGrid && hasPeriodScopedActions(sport.teamCategories)

  const gridCategories = showTeamStatGrid ? sport.teamCategories! : sport.categories

  const foulBaseForBonus = sport.teamFoulBaseStatId ?? null
  const teamFoulCountThisPeriod =
    showTeamStatGrid && foulBaseForBonus && teamRules
      ? getBonusFoulCountForPeriod(activePlayer.stats, foulBaseForBonus, currentPeriod, teamRules)
      : 0

  const showBonusBanner =
    showTeamStatGrid && Boolean(foulBaseForBonus) && teamRules !== null

  const handleUndo = () => {
    dispatch({ type: 'UNDO' })
  }

  const lastAction = actionLog.length > 0 ? actionLog[actionLog.length - 1] : null
  const lastActionLabel = (() => {
    if (!lastAction) return null
    if (lastAction.type === 'opponent_score_up') return 'Opp +1'
    if (lastAction.type === 'opponent_score_down') return 'Opp -1'
    if (lastAction.type === 'home_score_up' || lastAction.type === 'home_team_score_up') return 'Home +1'
    if (lastAction.type === 'home_score_down' || lastAction.type === 'home_team_score_down') return 'Home -1'
    const player = players.find(p => p.id === lastAction.playerId)
    if (!player) return null
    const statId = lastAction.statId
    let statLabel =
      findStatShortLabel(sport.categories, statId) ||
      findStatShortLabel(sport.teamCategories, statId)
    if (!statLabel && statId) statLabel = statId
    const direction = lastAction.type === 'increment' ? '+' : '-'
    if (player.isTeamPlayer) {
      const prefix = player.name.trim().split(/\s+/)[0] || 'Team'
      return `${prefix} ${statLabel} ${direction}`
    }
    return `#${player.number || '?'} ${statLabel} ${direction}`
  })()

  const handleAddPlayer = () => {
    if (!newName.trim()) return
    const player = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: newName.trim(),
      number: newNumber.trim(),
      stats: {},
    }
    dispatch({ type: 'ADD_PLAYER', player })
    dispatch({ type: 'SET_ACTIVE_PLAYER', playerId: player.id })
    setNewName('')
    setNewNumber('')
    setShowAddPlayer(false)
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <div className="px-3 pt-3 pb-2 max-w-lg mx-auto w-full">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-slate-500 font-medium active:scale-95 transition-transform"
          >
            ← Home
          </button>
          <button
            onClick={() => navigate('/summary')}
            className="text-sm text-blue-600 font-semibold active:scale-95 transition-transform"
          >
            Summary →
          </button>
        </div>

        <Scoreboard />

        {sport.id === 'basketball' && (
          <button
            type="button"
            onClick={() => navigate('/shot-chart')}
            className="relative mt-3 w-full py-3 rounded-xl font-semibold text-white shadow-md active:scale-[0.99] transition-transform
                       bg-gradient-to-r from-orange-500 to-amber-600 border border-orange-600/30"
          >
            <span className="mr-1" aria-hidden>
              🏀
            </span>
            Shot chart
            {shotChart.length > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[1.35rem] h-6 px-1.5 rounded-full bg-white text-orange-700 text-xs font-bold
                           flex items-center justify-center shadow border border-orange-200"
                aria-label={`${shotChart.length} shots on chart`}
              >
                {shotChart.length > 99 ? '99+' : shotChart.length}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="px-3 py-2 max-w-lg mx-auto w-full">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide items-stretch">
          {selectorPlayers.map((player, index) => {
            const isTeam = isTeamPseudoPlayer(player)
            const showDivider = isTeam && index === teamSelectorCount - 1 && teamSelectorCount > 0
            const isActive = player.id === activePlayer.id

            return (
              <div key={player.id} className="flex flex-shrink-0 items-stretch gap-2">
                <button
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
                        ? `${sport.theme.bg} text-white shadow-md`
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
                  <div
                    className="w-px self-stretch min-h-[2.5rem] bg-slate-300 shrink-0"
                    aria-hidden
                  />
                )}
              </div>
            )
          })}
          <button
            onClick={() => setShowAddPlayer(!showAddPlayer)}
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-white border-2 border-dashed
                       border-slate-300 text-slate-400 text-xl font-bold
                       active:scale-95 transition-transform flex items-center justify-center"
          >
            +
          </button>
        </div>

        {showAddPlayer && (
          <div className="card mt-2 flex gap-2 items-end">
            <input
              type="text"
              value={newNumber}
              onChange={e => setNewNumber(e.target.value)}
              placeholder="#"
              className="input-field w-14 text-center text-sm py-2"
              inputMode="numeric"
            />
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Player name"
              className="input-field flex-1 text-sm py-2"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleAddPlayer() }}
            />
            <button
              onClick={handleAddPlayer}
              disabled={!newName.trim()}
              className="btn-primary px-3 py-2 text-sm"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {showPeriodToggle && teamRules && (
        <div className="px-3 max-w-lg mx-auto w-full">
          <PeriodToggle
            periods={periodButtonCount}
            periodLabels={periodSegmentLabels}
            currentPeriod={currentPeriod}
            onPeriodChange={p => dispatch({ type: 'SET_PERIOD', period: p })}
            onAddOvertime={handleAddOvertime}
            sportTheme={sport.theme}
            addOvertimeLabel={addOvertimeLabel}
          />
        </div>
      )}

      {showBonusBanner && teamRules && (
        <div className="px-3 max-w-lg mx-auto w-full">
          <BasketballBonusIndicator
            foulCount={teamFoulCountThisPeriod}
            bonusThreshold={teamRules.bonusThreshold}
            doubleBonusThreshold={teamRules.doubleBonusThreshold}
            hasOneAndOne={teamRules.hasOneAndOne}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 pb-20 max-w-lg mx-auto w-full">
        <div className="space-y-4 mt-2">
          {gridCategories.map(category => {
            const missMap: Record<string, typeof category.actions[0]> = {}
            for (const a of category.actions) {
              if (a.madeStatId) missMap[a.madeStatId] = a
            }
            const visibleActions = category.actions.filter(a => !a.madeStatId)

            let displayTotal: number | null = null
            if (category.showTotal) {
              if (showTeamStatGrid) {
                let sum = 0
                for (const a of visibleActions) {
                  const sid = actualStatId(a, currentPeriod)
                  sum += activePlayer.stats[sid] || 0
                }
                displayTotal = sum
              } else if (category.actions.some(a => a.pointValue)) {
                displayTotal = category.actions.reduce(
                  (s, a) => s + (activePlayer.stats[a.id] || 0) * (a.pointValue || 0),
                  0
                )
              } else {
                displayTotal = computeCategoryTotal(category, activePlayer.stats)
              }
            }

            return (
              <div key={category.id}>
                {!category.hideHeader && (
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                      {category.name}
                    </h3>
                    {displayTotal !== null && (
                      <span className="text-sm font-bold text-slate-700">
                        {category.totalLabel}: {displayTotal}
                      </span>
                    )}
                  </div>
                )}
                {category.hideHeader && displayTotal !== null && (
                  <div className="flex justify-end mb-2">
                    <span className="text-sm font-bold text-slate-700">
                      {category.totalLabel}: {displayTotal}
                    </span>
                  </div>
                )}
                <div className={`grid gap-2 ${
                  category.columns === 2 ? 'grid-cols-2' :
                  visibleActions.length === 1 ? 'grid-cols-1' :
                  visibleActions.length === 2 ? 'grid-cols-2' :
                  'grid-cols-3'
                }`}>
                  {visibleActions.map(action => {
                    const missAction = missMap[action.id]
                    const scopedId = actualStatId(action, currentPeriod)
                    const periodTotal =
                      action.periodScoped
                        ? sumPeriodScopedStats(activePlayer.stats, action.id)
                        : null
                    const timeoutCap =
                      showTeamStatGrid && action.id === 'team_to_used' && action.periodScoped
                        ? timeoutCapForPeriod(teamRules, currentPeriod)
                        : undefined
                    const currentVal = activePlayer.stats[scopedId] || 0

                    const subtitleParts: string[] = []
                    if (action.periodScoped && periodTotal !== null) {
                      subtitleParts.push(`Total: ${periodTotal}`)
                    }
                    if (timeoutCap !== undefined) {
                      subtitleParts.push(`${currentVal}/${timeoutCap} this period`)
                    }
                    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined

                    const chartAwareTitle =
                      sport.id === 'basketball' &&
                      (action.id === '2pt' ||
                        action.id === '2pt_miss' ||
                        action.id === '3pt' ||
                        action.id === '3pt_miss' ||
                        action.id === 'ft' ||
                        action.id === 'ft_miss')
                        ? 'Shots from the Shot Chart include court location. Taps here count in stats only and do not add markers on the chart.'
                        : undefined

                    const buttonKey = action.periodScoped ? `${action.id}_p${currentPeriod}` : action.id
                    const statButton = (
                      <StatButton
                        label={action.label}
                        shortLabel={action.shortLabel}
                        value={currentVal}
                        color={action.color ?? category.color}
                        pointValue={action.pointValue}
                        subtitle={subtitle}
                        maxValue={timeoutCap}
                        onIncrement={() =>
                          dispatch({
                            type: 'INCREMENT_STAT',
                            playerId: activePlayer.id,
                            statId: scopedId,
                          })
                        }
                        onDecrement={() =>
                          dispatch({
                            type: 'DECREMENT_STAT',
                            playerId: activePlayer.id,
                            statId: scopedId,
                          })
                        }
                        onAttempt={missAction ? () =>
                          dispatch({
                            type: 'INCREMENT_STAT',
                            playerId: activePlayer.id,
                            statId: missAction.id,
                          }) : undefined
                        }
                        attemptCount={missAction ? (activePlayer.stats[missAction.id] || 0) : undefined}
                      />
                    )

                    return chartAwareTitle ? (
                      <span key={buttonKey} title={chartAwareTitle} className="block cursor-help">
                        {statButton}
                      </span>
                    ) : (
                      <span key={buttonKey}>{statButton}</span>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="mt-2">
            <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Game Notes
            </label>
            <textarea
              value={localNotes}
              onChange={e => setLocalNotes(e.target.value)}
              onBlur={() => dispatch({ type: 'SET_NOTES', notes: localNotes })}
              placeholder="Add notes about the game…"
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700
                         placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300
                         resize-none"
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t border-slate-200 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {lastActionLabel && (
              <span>Last: <span className="font-medium text-slate-600">{lastActionLabel}</span></span>
            )}
          </div>
          <button
            onClick={handleUndo}
            disabled={actionLog.length === 0}
            className="btn-secondary py-2 px-4 text-sm disabled:opacity-30"
          >
            ↩ Undo
          </button>
        </div>
      </div>
    </div>
  )
}
