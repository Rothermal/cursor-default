import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { computeCategoryTotal } from '../config/sports'
import { resolveTeamStatsConfig } from '../config/teamStatsDefaults'
import { buildPeriodSegmentLabels, getBonusFoulCountForPeriod } from '../lib/teamStatsPeriods'
import type { BasketballTeamStatsConfig, StatAction, StatCategory } from '../types'
import Scoreboard from '../components/Scoreboard'
import StatButton from '../components/StatButton'
import PlayerSelectorStrip from '../components/PlayerSelectorStrip'
import ShotChartPanel from '../components/shot-chart/ShotChartPanel'
import RecentEventsPopup from '../components/RecentEventsPopup'
import PeriodToggle from '../components/team-stats/PeriodToggle'
import BasketballBonusIndicator from '../components/team-stats/BasketballBonusIndicator'
import { playersWithTeamPlaceholders } from '../lib/teamPlayers'
import type { ShotChartSelection } from '../lib/shotChartViews'
import { formatActionLogEntryLabel } from '../lib/actionLogLabels'
import { sportDashboardPath } from '../lib/sportNavigation'
import AccessUnavailable from '../components/AccessUnavailable'
import { useTeamRole } from '../hooks/useTeamRole'
import { canTrackGames } from '../lib/teamPermissions'

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
  const { state, dispatch, flushCloudSync, parkingError } = useGame()
  const teamAccess = useTeamRole(state.cloudSync.teamId)
  const {
    sport,
    players,
    activePlayerId,
    actionLog,
    notes,
    gameInfo,
    currentPeriod,
    teamStatsConfig,
  } = state

  const [showAddPlayer, setShowAddPlayer] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNumber, setNewNumber] = useState('')
  const [localNotes, setLocalNotes] = useState(notes)
  const [showRecentEvents, setShowRecentEvents] = useState(false)
  // Shot-chart view filter (F2): local UI state, not persisted (D16/D17). "All" changes
  // only what the court displays; the recording target stays `activePlayerId` (D5/D14).
  const [showAllShots, setShowAllShots] = useState(false)

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
    if (state.cloudSync.teamId && !canTrackGames(teamAccess.role)) return
    if (!sport?.teamCategories?.length || !gameInfo) return

    const nextPlayers = playersWithTeamPlaceholders(players, gameInfo.teamName, gameInfo.opponentName)
    if (!nextPlayers) return

    dispatch({ type: 'SET_PLAYERS', players: nextPlayers })
  }, [sport, gameInfo, players, dispatch, state.cloudSync.teamId, teamAccess.role])

  const handleSelectPlayer = useCallback(
    (playerId: string) => {
      setShowAllShots(false)
      dispatch({ type: 'SET_ACTIVE_PLAYER', playerId })
    },
    [dispatch]
  )

  if (state.cloudSync.teamId && !canTrackGames(teamAccess.role)) {
    const checkingAccess = teamAccess.loading && !teamAccess.error
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="max-w-lg mx-auto">
          <AccessUnavailable
            title={checkingAccess ? 'Checking game access' : 'Game tracking unavailable'}
            message={
              checkingAccess
                ? 'Confirming your role for this team...'
                : teamAccess.error ?? 'Viewer access is read-only. You can review this game from Team Info without changing its stats.'
            }
            actionLabel={checkingAccess ? undefined : 'Back to Team'}
            onAction={checkingAccess ? undefined : () => navigate(
              `/team?teamId=${encodeURIComponent(state.cloudSync.teamId!)}`
            )}
          />
        </div>
      </div>
    )
  }

  if (!sport || !gameInfo || players.length === 0) {
    navigate(sport ? sportDashboardPath(sport.id) : '/')
    return null
  }

  const activePlayer = players.find(p => p.id === activePlayerId) || players[0]
  const isBasketball = sport.id === 'basketball'
  const shotChartSelection: ShotChartSelection = showAllShots
    ? { kind: 'all' }
    : { kind: 'player', playerId: activePlayer.id }
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
  const lastActionLabel = lastAction
    ? formatActionLogEntryLabel(lastAction, players, sport)
    : null

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
            onClick={() => navigate(sportDashboardPath(sport.id))}
            className="text-sm text-slate-500 font-medium active:scale-95 transition-transform"
          >
            Dashboard
          </button>
          <button
            onClick={() => navigate('/summary')}
            className="text-sm text-blue-600 font-semibold active:scale-95 transition-transform"
          >
            Summary →
          </button>
        </div>

        <Scoreboard />
        {parkingError && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {parkingError}
          </div>
        )}
      </div>

      <PlayerSelectorStrip
        players={players}
        activePlayerId={activePlayer.id}
        onSelectPlayer={handleSelectPlayer}
        activeBgClass={sport.theme.bg}
        onAddPlayer={() => setShowAddPlayer(!showAddPlayer)}
        sticky
        onSelectAll={isBasketball ? () => setShowAllShots(true) : undefined}
        allActive={showAllShots}
      />

      {showAddPlayer && (
        <div className="px-3 max-w-lg mx-auto w-full">
          <div className="card mb-2 flex gap-2 items-end">
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
        </div>
      )}

      {isBasketball && (
        <div className="px-3 py-2 max-w-lg mx-auto w-full">
          <ShotChartPanel selection={shotChartSelection} onSelectPlayer={handleSelectPlayer} />
          <p className="mt-2 text-[11px] text-slate-400 leading-snug px-1">
            The court popup and the buttons below adjust the same player stats — the popup is
            fast in-play entry (shots keep their location); the buttons are for direct entry
            and corrections.
          </p>
        </div>
      )}

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

      <div className="px-3 pb-20 max-w-lg mx-auto w-full">
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
                        ? 'Shots logged from the court above store a location marker and count here too. Taps here count in stats only (no marker). Both adjust the same stat — use +/− to correct.'
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
          <div className="min-w-0 pr-3 text-xs text-slate-400">
            {lastActionLabel && (
              <span className="block truncate">Last: <span className="font-medium text-slate-600">{lastActionLabel}</span></span>
            )}
          </div>
          <button
            onClick={() => setShowRecentEvents(true)}
            disabled={actionLog.length === 0}
            className="btn-secondary py-2 px-4 text-sm disabled:opacity-30"
          >
            ↩ Undo
          </button>
        </div>
      </div>

      {showRecentEvents && (
        <RecentEventsPopup
          entries={actionLog}
          players={players}
          sport={sport}
          onUndoTop={handleUndo}
          onClose={() => setShowRecentEvents(false)}
        />
      )}
    </div>
  )
}
