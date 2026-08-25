import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeAlert, Clock3, Link2, List, Minus, ReceiptText, Target, Trash2, UserX } from 'lucide-react'
import { useGame } from '../context/GameContext'
import { useAuth } from '../context/AuthContext'
import { computeCategoryTotal } from '../config/sports'
import { resolveTeamStatsConfig } from '../config/teamStatsDefaults'
import { buildPeriodSegmentLabels, getBonusFoulCountForPeriod } from '../lib/teamStatsPeriods'
import { basketballRulesAllowOneAndOne } from '../lib/basketball/rules'
import { basketballBonusFoulCountsForPeriod } from '../lib/basketball/administrativeProjection'
import type { BasketballTeamStatsConfig, StatAction, StatCategory } from '../types'
import Scoreboard from '../components/Scoreboard'
import StatButton from '../components/StatButton'
import PlayerSelectorStrip from '../components/PlayerSelectorStrip'
import ShotChartPanel from '../components/shot-chart/ShotChartPanel'
import RecentEventsPopup from '../components/RecentEventsPopup'
import BasketballRecentEventsPopup from '../components/basketball/BasketballRecentEventsPopup'
import BasketballLifecycleControls from '../components/basketball/BasketballLifecycleControls'
import BasketballEventBonusPanel from '../components/basketball/BasketballEventBonusPanel'
import BasketballReopenDialog from '../components/basketball/BasketballReopenDialog'
import BasketballLateParticipantDialog from '../components/basketball/BasketballLateParticipantDialog'
import BasketballScoreCorrectionDialog from '../components/basketball/BasketballScoreCorrectionDialog'
import BasketballStealTurnoverDialog from '../components/basketball/BasketballStealTurnoverDialog'
import BasketballFoulDialog, {
  type BasketballFoulDialogInput,
} from '../components/basketball/BasketballFoulDialog'
import BasketballFreeThrowTripDialog from '../components/basketball/BasketballFreeThrowTripDialog'
import BasketballEjectionDialog, {
  type BasketballEjectionDialogInput,
} from '../components/basketball/BasketballEjectionDialog'
import BasketballTimeoutDialog from '../components/basketball/BasketballTimeoutDialog'
import BasketballTimeline from '../components/basketball/BasketballTimeline'
import BasketballRecorderStatus from '../components/basketball/BasketballRecorderStatus'
import BasketballEnableCloudPanel from '../components/basketball/BasketballEnableCloudPanel'
import EventCloudConflictDialog from '../components/game-events/EventCloudConflictDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import PeriodToggle from '../components/team-stats/PeriodToggle'
import BasketballBonusIndicator from '../components/team-stats/BasketballBonusIndicator'
import { isTeamPseudoPlayer, playersWithTeamPlaceholders } from '../lib/teamPlayers'
import type { ShotChartSelection } from '../lib/shotChartViews'
import { formatActionLogEntryLabel } from '../lib/actionLogLabels'
import { sportDashboardPath } from '../lib/sportNavigation'
import { gameInfoPath } from '../lib/teamInfo'
import { basketballSummaryPath } from '../lib/basketball/summary'
import AccessUnavailable from '../components/AccessUnavailable'
import { useTeamRole } from '../hooks/useTeamRole'
import { canTrackGames } from '../lib/teamPermissions'
import {
  authoritativeGameDataDiagnostics,
  SPORT_EVENTS_AUTHORITY,
} from '../lib/gameEvents/authority'
import { gameEventProjectors } from '../lib/gameEvents/runtime'
import {
  abandonBasketballMatch,
  addBasketballLateParticipant,
  basketballCaptureTargetForPlayerId,
  basketballPlayerIdForCapturePreferences,
  completeBasketballMatch,
  endBasketballPeriod,
  hasStartedBasketballEventGame,
  reopenBasketballMatch,
  startNextBasketballPeriod,
  suspendBasketballMatch,
} from '../lib/basketball/commands'
import {
  basketballLiveCaptureUnits,
  canDecrementBasketballFoul,
  canRestoreBasketballCourtUndo,
  decrementBasketballDirectStat,
  decrementBasketballFoul,
  previewBasketballDirectDecrement,
  previewBasketballFoulDecrement,
  previewBasketballFreeThrowTripRemoval,
  removeBasketballFreeThrowTrip,
  restoreLastBasketballCourtUndo,
  undoLatestBasketballCourtCapture,
  type BasketballDirectDecrementPreview,
  type BasketballFoulDecrementPreview,
  type BasketballFoulDecrementTarget,
  type BasketballFreeThrowTripRemovalPreview,
} from '../lib/basketball/courtCorrections'
import {
  adjustBasketballScore,
  captureBasketballDirectStat,
  captureBasketballStealTurnover,
  decrementBasketballMinutes,
  type BasketballDirectStatId,
  type BasketballTurnoverTarget,
} from '../lib/basketball/directCommands'
import {
  basketballFreeThrowTripStatuses,
  captureBasketballFoul,
  captureBasketballFreeThrowAttempt,
} from '../lib/basketball/foulFreeThrowCommands'
import {
  basketballEjectionFoulCandidates,
  basketballOfficialEjectionStatuses,
  captureBasketballOfficialEjection,
  previewBasketballEjectionRemoval,
  removeBasketballOfficialEjection,
  type BasketballEjectionRemovalPreview,
} from '../lib/basketball/ejectionCommands'
import {
  basketballTimeoutInventory,
  captureBasketballTimeout,
  formatBasketballTimeoutInventory,
  previewBasketballTimeoutDecrement,
  removeBasketballTimeout,
  type BasketballTimeoutCapture,
  type BasketballTimeoutDecrementTarget,
  type BasketballTimeoutRemovalPreview,
} from '../lib/basketball/timeoutCommands'
import type {
  BasketballBonusStatus,
  BasketballFoulClass,
  BasketballFoulContext,
  BasketballSportGameState,
  BasketballTeamSide,
} from '../lib/basketball/types'

const BASKETBALL_DIRECT_STAT_IDS = new Set<BasketballDirectStatId>([
  'ft', 'ft_miss', '2pt', '2pt_miss', '3pt', '3pt_miss',
  'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'min', 'team_turnover',
])

function isBasketballDirectStatId(statId: string): statId is BasketballDirectStatId {
  return BASKETBALL_DIRECT_STAT_IDS.has(statId as BasketballDirectStatId)
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
  const isOt = periodIndex > rules.periodsPerGame
  const cap = isOt
    ? rules.timeoutsPerOvertime ?? rules.timeoutsPerPeriod
    : rules.timeoutsPerPeriod
  if (cap == null) return undefined
  return cap
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export default function GameTracker() {
  const navigate = useNavigate()
  const {
    state,
    dispatch,
    flushCloudSync,
    parkingError,
    resolveEventConflict,
  } = useGame()
  const { user } = useAuth()
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
  const [eventCorrectionError, setEventCorrectionError] = useState<string | null>(null)
  const [lateParticipantError, setLateParticipantError] = useState<string | null>(null)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)
  const [directCaptureError, setDirectCaptureError] = useState<string | null>(null)
  const [showScoreCorrection, setShowScoreCorrection] = useState(false)
  const [scoreCorrectionError, setScoreCorrectionError] = useState<string | null>(null)
  const [showStealTurnover, setShowStealTurnover] = useState(false)
  const [stealTurnoverError, setStealTurnoverError] = useState<string | null>(null)
  const [pendingDirectDecrement, setPendingDirectDecrement] = useState<{
    playerId: string
    statId: Exclude<BasketballDirectStatId, 'min'>
    preview: BasketballDirectDecrementPreview
  } | null>(null)
  const [directDecrementError, setDirectDecrementError] = useState<string | null>(null)
  const [foulDialog, setFoulDialog] = useState<{
    teamSide: BasketballTeamSide
    playerId: string | null
    foulClass: BasketballFoulClass
    context: BasketballFoulContext
  } | null>(null)
  const [foulError, setFoulError] = useState<string | null>(null)
  const [activeFreeThrowTrip, setActiveFreeThrowTrip] = useState<{
    eventId: string
    suggestedPlayerId: string | null
  } | null>(null)
  const [freeThrowError, setFreeThrowError] = useState<string | null>(null)
  const [pendingFoulDecrement, setPendingFoulDecrement] = useState<{
    target: BasketballFoulDecrementTarget
    preview: BasketballFoulDecrementPreview
  } | null>(null)
  const [pendingTripRemoval, setPendingTripRemoval] = useState<{
    eventId: string
    preview: BasketballFreeThrowTripRemovalPreview
  } | null>(null)
  const [showEjectionDialog, setShowEjectionDialog] = useState(false)
  const [ejectionError, setEjectionError] = useState<string | null>(null)
  const [pendingEjectionRemoval, setPendingEjectionRemoval] = useState<{
    eventId: string
    preview: BasketballEjectionRemovalPreview
  } | null>(null)
  const [showTimeoutDialog, setShowTimeoutDialog] = useState(false)
  const [timeoutError, setTimeoutError] = useState<string | null>(null)
  const [pendingTimeoutRemoval, setPendingTimeoutRemoval] = useState<{
    target: BasketballTimeoutDecrementTarget
    preview: BasketballTimeoutRemovalPreview
  } | null>(null)
  const [administrativeCorrectionError, setAdministrativeCorrectionError] = useState<string | null>(null)
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  const [pendingLocalEnd, setPendingLocalEnd] = useState<'suspend' | 'abandon' | null>(null)
  const [showReopenDialog, setShowReopenDialog] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [cloudRecoveryError, setCloudRecoveryError] = useState<string | null>(null)
  // Shot-chart view filter (F2): local UI state, not persisted (D16/D17). "All" changes
  // only what the court displays; the recording target stays `activePlayerId` (D5/D14).
  const [showAllShots, setShowAllShots] = useState(false)
  const [basketballWorkspace, setBasketballWorkspace] = useState<'track' | 'timeline'>('track')
  const basketballTrackTabRef = useRef<HTMLButtonElement>(null)
  const basketballTimelineTabRef = useRef<HTMLButtonElement>(null)

  const handleBasketballWorkspaceKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let nextWorkspace: 'track' | 'timeline' | null = null
    if (event.key === 'ArrowLeft' || event.key === 'Home') nextWorkspace = 'track'
    if (event.key === 'ArrowRight' || event.key === 'End') nextWorkspace = 'timeline'
    if (!nextWorkspace) return
    event.preventDefault()
    setBasketballWorkspace(nextWorkspace)
    window.requestAnimationFrame(() => {
      const target = nextWorkspace === 'track' ? basketballTrackTabRef.current : basketballTimelineTabRef.current
      target?.focus()
    })
  }, [])

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
    if (state.gameDataAuthority === SPORT_EVENTS_AUTHORITY) return
    if (state.cloudSync.teamId && !canTrackGames(teamAccess.role)) return
    if (!sport?.teamCategories?.length || !gameInfo) return

    const nextPlayers = playersWithTeamPlaceholders(players, gameInfo.teamName, gameInfo.opponentName)
    if (!nextPlayers) return

    dispatch({ type: 'SET_PLAYERS', players: nextPlayers })
  }, [sport, gameInfo, players, dispatch, state.cloudSync.teamId, state.gameDataAuthority, teamAccess.role])

  const isBasketballEventMode = hasStartedBasketballEventGame(state)
  const cloudConflicts = isBasketballEventMode
    ? state.cloudSync.eventConflicts ?? []
    : []

  useEffect(() => {
    if (cloudConflicts.length > 0) setConflictOpen(true)
  }, [cloudConflicts.length])

  const exportBasketballRecovery = () => {
    const blob = new Blob([
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        kind: 'basketball-game-recovery',
        gameState: state,
      }, null, 2),
    ], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `statkeeper-basketball-recovery-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const resolveBasketballConflict = (eventId: string, resolution: 'local' | 'remote') => {
    const result = resolveEventConflict(eventId, resolution)
    if (!result.ok) {
      setCloudRecoveryError(result.reason)
      return
    }
    setCloudRecoveryError(null)
    if (cloudConflicts.length === 1) setConflictOpen(false)
  }

  const retryBasketballSync = async () => {
    setSyncBusy(true)
    const result = await flushCloudSync()
    setSyncBusy(false)
    if (!result.ok) setCloudRecoveryError(result.reason)
  }

  useEffect(() => {
    if (!isBasketballEventMode) setBasketballWorkspace('track')
  }, [isBasketballEventMode])
  const basketballSportState = isBasketballEventMode && state.sportGameState?.sportId === 'basketball'
    ? state.sportGameState
    : null
  const basketballMatchOpen = basketballSportState?.projection.status === 'in_progress' ||
    basketballSportState?.projection.status === 'period_break'
  const basketballCaptureUnits = useMemo(
    () => isBasketballEventMode ? basketballLiveCaptureUnits(state) : [],
    [isBasketballEventMode, state]
  )
  const basketballTripStatuses = useMemo(
    () => isBasketballEventMode ? basketballFreeThrowTripStatuses(state) : [],
    [isBasketballEventMode, state]
  )
  const basketballEjectionStatuses = useMemo(
    () => isBasketballEventMode ? basketballOfficialEjectionStatuses(state) : [],
    [isBasketballEventMode, state]
  )
  const ejectionFoulCandidates = useMemo(
    () => isBasketballEventMode ? basketballEjectionFoulCandidates(state) : [],
    [isBasketballEventMode, state]
  )
  const timeoutInventory = useMemo(
    () => isBasketballEventMode ? basketballTimeoutInventory(state) : null,
    [isBasketballEventMode, state]
  )
  const canRestoreBasketball = isBasketballEventMode && canRestoreBasketballCourtUndo(state)

  const handleSelectPlayer = useCallback(
    (playerId: string) => {
      setShowAllShots(false)
      dispatch({ type: 'SET_ACTIVE_PLAYER', playerId })
      if (isBasketballEventMode) {
        const target = basketballCaptureTargetForPlayerId(state, playerId)
        if (target.ok) {
          dispatch({
            type: 'SET_BASKETBALL_CAPTURE_PREFERENCES',
            preferences: {
              teamSide: target.value.teamSide,
              selectedParticipantId: target.value.selection.kind === 'participant'
                ? target.value.selection.participantId
                : null,
              selectionInitialized: true,
            },
          })
        }
      }
    },
    [dispatch, isBasketballEventMode, state]
  )

  const activeProjector = state.sport ? gameEventProjectors.get(state.sport.id) : undefined
  const authoritativeDiagnostics = authoritativeGameDataDiagnostics(
    state,
    activeProjector?.requiresSportGameState === true
  )
  if (
    state.gameDataAuthority === SPORT_EVENTS_AUTHORITY &&
    authoritativeDiagnostics.length > 0
  ) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="max-w-lg mx-auto">
          <AccessUnavailable
            title="Event game unavailable"
            message={authoritativeDiagnostics[0].message}
            actionLabel={sport ? `Back to ${sport.name}` : 'Back to Sports'}
            onAction={() => navigate(sport ? sportDashboardPath(sport.id) : '/')}
          />
        </div>
      </div>
    )
  }

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

  const preferredCapturePlayerId = isBasketballEventMode
    ? basketballPlayerIdForCapturePreferences(state)
    : null
  const activePlayer = players.find(p => p.id === (preferredCapturePlayerId ?? activePlayerId)) || players[0]
  const isBasketball = sport.id === 'basketball'
  const shotChartSelection: ShotChartSelection = showAllShots
    ? { kind: 'all' }
    : { kind: 'player', playerId: activePlayer.id }
  const showTeamStatGrid = Boolean(activePlayer.isTeamPlayer && sport.teamCategories?.length)
  const showPeriodToggle =
    showTeamStatGrid && hasPeriodScopedActions(sport.teamCategories)

  const gridCategories = showTeamStatGrid ? sport.teamCategories! : sport.categories
  const basketballPeriodActive = basketballSportState?.projection.status === 'in_progress'
  const displayGridCategories = isBasketballEventMode
    ? gridCategories
        .map(category => ({
          ...category,
          actions: category.actions.filter(action =>
            showTeamStatGrid
              ? action.id === 'team_turnover' || action.id === 'team_foul' || action.id === 'team_tech'
              : (isBasketballDirectStatId(action.id) && action.id !== 'team_turnover') || action.id === 'pf'
          ),
        }))
        .filter(category => category.actions.length > 0)
    : gridCategories
  const activeBasketballParticipant = basketballSportState
    ? Object.values(basketballSportState.projection.participants)
        .find(participant => participant.playerId === activePlayer.id)
    : null
  const stealTurnoverSide: BasketballTeamSide | null = activeBasketballParticipant
    ? activeBasketballParticipant.teamSide === 'tracked' ? 'opponent' : 'tracked'
    : null
  const stealTurnoverTeamName = stealTurnoverSide === 'tracked'
    ? gameInfo.teamName
    : gameInfo.opponentName
  const stealTurnoverCandidates = stealTurnoverSide && basketballSportState
    ? Object.values(basketballSportState.projection.participants)
        .filter(participant =>
          participant.teamSide === stealTurnoverSide &&
          participant.playerId &&
          !participant.disqualified &&
          !participant.ejected
        )
        .map(participant => ({
          playerId: participant.playerId!,
          label: `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}`,
        }))
    : []
  const foulCandidates = basketballSportState
    ? Object.values(basketballSportState.projection.participants)
        .filter(participant => participant.playerId && !participant.disqualified && !participant.ejected)
        .map(participant => ({
          playerId: participant.playerId!,
          teamSide: participant.teamSide,
          label: `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}`,
        }))
    : []
  const currentPeriodId = basketballSportState?.projection.currentPeriodId ?? null
  const currentBasketballSegment = basketballSportState?.projection.periods.find(
    period => period.id === currentPeriodId
  ) ?? null
  const currentBasketballFouls = currentPeriodId && basketballSportState
    ? basketballBonusFoulCountsForPeriod(
        basketballSportState.projection,
        currentPeriodId,
        basketballSportState.setup.rulesSnapshot
      ) ?? { tracked: 0, opponent: 0 }
    : { tracked: 0, opponent: 0 }
  const currentBasketballBonus: Record<BasketballTeamSide, BasketballBonusStatus> = currentPeriodId
    ? basketballSportState?.projection.bonusStatusByPeriod[currentPeriodId] ?? { tracked: 'none', opponent: 'none' }
    : { tracked: 'none', opponent: 'none' }
  const reviewableFreeThrowTrips = basketballTripStatuses.filter(trip =>
    trip.periodId === currentPeriodId && (
      trip.open || trip.attempts.some(attempt => attempt.deleted)
    )
  )
  const openFreeThrowTripCount = reviewableFreeThrowTrips.filter(trip => trip.open).length
  const selectedFreeThrowTrip = activeFreeThrowTrip
    ? basketballTripStatuses.find(trip => trip.eventId === activeFreeThrowTrip.eventId) ?? null
    : null
  const freeThrowCandidates = selectedFreeThrowTrip
    ? foulCandidates.filter(candidate => candidate.teamSide === selectedFreeThrowTrip.teamSide)
    : []
  const activeCaptureTarget = isBasketballEventMode
    ? basketballCaptureTargetForPlayerId(state, activePlayer.id)
    : null
  const activeCaptureSide = activeCaptureTarget?.ok
    ? activeCaptureTarget.value.teamSide
    : basketballSportState?.capturePreferences.teamSide ?? 'tracked'
  const activeFoulOffenderAvailable = Boolean(
    activeBasketballParticipant &&
    !activeBasketballParticipant.disqualified &&
    !activeBasketballParticipant.ejected
  )
  const activePlayerUnavailable = Boolean(
    activeBasketballParticipant &&
    (activeBasketballParticipant.disqualified || activeBasketballParticipant.ejected)
  )
  const unavailableMessage = activeBasketballParticipant?.ejected
    ? `${activeBasketballParticipant.displayName} is ejected and unavailable for new stats.`
    : activeBasketballParticipant?.disqualified
      ? `${activeBasketballParticipant.displayName} is disqualified and unavailable for new stats.`
      : undefined
  const basketballCaptureDisabledMessage = !basketballPeriodActive
    ? basketballLifecycleCaptureMessage(basketballSportState)
    : unavailableMessage
  const playerStatusLabels = basketballSportState
    ? Object.fromEntries(Object.values(basketballSportState.projection.participants).flatMap(participant =>
        participant.playerId && (participant.ejected || participant.disqualified)
          ? [[participant.playerId, participant.ejected ? 'Ejected' : 'DQ']]
          : []
      ))
    : {}
  const ejectionCandidates = basketballSportState
    ? Object.values(basketballSportState.projection.participants)
        .filter(participant => participant.playerId && !participant.ejected)
        .map(participant => ({
          playerId: participant.playerId!,
          teamSide: participant.teamSide,
          label: `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}${participant.disqualified ? ' (DQ)' : ''}`,
        }))
    : []
  const foulBaseForBonus = sport.teamFoulBaseStatId ?? null
  const teamFoulCountThisPeriod =
    showTeamStatGrid && foulBaseForBonus && teamRules
      ? getBonusFoulCountForPeriod(activePlayer.stats, foulBaseForBonus, currentPeriod, teamRules)
      : 0

  const showBonusBanner =
    showTeamStatGrid && Boolean(foulBaseForBonus) && teamRules !== null

  const clearTrackerActionErrors = () => {
    setDirectCaptureError(null)
    setDirectDecrementError(null)
    setAdministrativeCorrectionError(null)
    setEjectionError(null)
    setTimeoutError(null)
  }

  const handleUndo = () => {
    dispatch({ type: 'UNDO' })
  }

  const handleBasketballUndo = () => {
    const result = undoLatestBasketballCourtCapture(state)
    if (!result.ok) {
      setEventCorrectionError(result.message)
      return
    }
    setEventCorrectionError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleBasketballRestore = () => {
    const result = restoreLastBasketballCourtUndo(state)
    if (!result.ok) {
      setEventCorrectionError(result.message)
      return
    }
    setEventCorrectionError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleDirectCapture = (playerId: string, statId: BasketballDirectStatId) => {
    clearTrackerActionErrors()
    const result = captureBasketballDirectStat(state, {
      recorderUserId: user?.id ?? null,
      playerId,
      statId,
    })
    if (!result.ok) {
      setDirectCaptureError(result.message)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const applyDirectDecrement = (
    playerId: string,
    statId: Exclude<BasketballDirectStatId, 'min'>
  ) => {
    clearTrackerActionErrors()
    const result = decrementBasketballDirectStat(state, playerId, statId)
    if (!result.ok) {
      setDirectDecrementError(result.message)
      return false
    }
    setPendingDirectDecrement(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    return true
  }

  const handleDirectDecrement = (playerId: string, statId: BasketballDirectStatId) => {
    clearTrackerActionErrors()
    const preview = previewBasketballDirectDecrement(state, playerId, statId)
    if (!preview.ok) {
      setDirectDecrementError(preview.message)
      return
    }
    if (statId === 'min') {
      const result = decrementBasketballMinutes(state, {
        recorderUserId: user?.id ?? null,
        playerId,
      })
      if (!result.ok) {
        setDirectDecrementError(result.message)
        return
      }
      dispatch({ type: 'HYDRATE_STATE', state: result.state })
      return
    }
    if (preview.value.requiresConfirmation) {
      setDirectDecrementError(null)
      setPendingDirectDecrement({ playerId, statId, preview: preview.value })
      return
    }
    applyDirectDecrement(playerId, statId)
  }

  const handleQuickScoreAdjustment = (teamSide: BasketballTeamSide, delta: 1 | -1) => {
    clearTrackerActionErrors()
    const result = adjustBasketballScore(state, {
      recorderUserId: user?.id ?? null,
      teamSide,
      delta,
      reason: 'scoreboard_control',
    })
    if (!result.ok) {
      setDirectCaptureError(result.message)
      return
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleOfficialScoreCorrection = (input: {
    teamSide: BasketballTeamSide
    delta: number
    note: string
  }) => {
    clearTrackerActionErrors()
    const result = adjustBasketballScore(state, {
      recorderUserId: user?.id ?? null,
      ...input,
      reason: 'official_correction',
    })
    if (!result.ok) {
      setScoreCorrectionError(result.message)
      return
    }
    setScoreCorrectionError(null)
    setShowScoreCorrection(false)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleStealTurnover = (turnoverTarget: BasketballTurnoverTarget) => {
    clearTrackerActionErrors()
    const result = captureBasketballStealTurnover(state, {
      recorderUserId: user?.id ?? null,
      stealerPlayerId: activePlayer.id,
      turnoverTarget,
    })
    if (!result.ok) {
      setStealTurnoverError(result.message)
      return
    }
    setStealTurnoverError(null)
    setShowStealTurnover(false)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleFoulCapture = (input: BasketballFoulDialogInput) => {
    clearTrackerActionErrors()
    const result = captureBasketballFoul(state, {
      recorderUserId: user?.id ?? null,
      ...input,
    })
    if (!result.ok) {
      setFoulError(result.message)
      return
    }
    setFoulError(null)
    setFoulDialog(null)
    if (result.tripEventId) {
      setFreeThrowError(null)
      setActiveFreeThrowTrip({
        eventId: result.tripEventId,
        suggestedPlayerId: input.drawnBy?.kind === 'player' ? input.drawnBy.playerId : null,
      })
    }
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const openFoulDialog = (
    teamSide: BasketballTeamSide,
    playerId: string | null,
    foulClass: BasketballFoulClass,
    context: BasketballFoulContext
  ) => {
    setFoulError(null)
    clearTrackerActionErrors()
    setFoulDialog({ teamSide, playerId, foulClass, context })
  }

  const handleFreeThrowAttempt = (playerId: string, made: boolean) => {
    if (!selectedFreeThrowTrip) return
    clearTrackerActionErrors()
    const result = captureBasketballFreeThrowAttempt(state, {
      recorderUserId: user?.id ?? null,
      tripEventId: selectedFreeThrowTrip.eventId,
      shooterPlayerId: playerId,
      made,
    })
    if (!result.ok) {
      setFreeThrowError(result.message)
      return
    }
    setFreeThrowError(null)
    if (result.tripComplete) setActiveFreeThrowTrip(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleFoulDecrement = (target: BasketballFoulDecrementTarget) => {
    clearTrackerActionErrors()
    const preview = previewBasketballFoulDecrement(state, target)
    if (!preview.ok) {
      setAdministrativeCorrectionError(preview.message)
      return
    }
    setPendingFoulDecrement({ target, preview: preview.value })
  }

  const applyFoulDecrement = () => {
    if (!pendingFoulDecrement) return
    clearTrackerActionErrors()
    const result = decrementBasketballFoul(state, pendingFoulDecrement.target)
    if (!result.ok) {
      setAdministrativeCorrectionError(result.message)
      return
    }
    setPendingFoulDecrement(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleFreeThrowTripRemoval = (eventId: string) => {
    clearTrackerActionErrors()
    const preview = previewBasketballFreeThrowTripRemoval(state, eventId)
    if (!preview.ok) {
      setFreeThrowError(preview.message)
      return
    }
    setFreeThrowError(null)
    setPendingTripRemoval({ eventId, preview: preview.value })
  }

  const applyFreeThrowTripRemoval = () => {
    if (!pendingTripRemoval) return
    clearTrackerActionErrors()
    const result = removeBasketballFreeThrowTrip(state, pendingTripRemoval.eventId)
    if (!result.ok) {
      setAdministrativeCorrectionError(result.message)
      return
    }
    setPendingTripRemoval(null)
    setActiveFreeThrowTrip(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleEjectionCapture = (input: BasketballEjectionDialogInput) => {
    clearTrackerActionErrors()
    const result = captureBasketballOfficialEjection(state, {
      recorderUserId: user?.id ?? null,
      ...input,
    })
    if (!result.ok) {
      setEjectionError(result.message)
      return
    }
    setEjectionError(null)
    setShowEjectionDialog(false)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleEjectionRemoval = (eventId: string) => {
    clearTrackerActionErrors()
    const preview = previewBasketballEjectionRemoval(state, eventId)
    if (!preview.ok) {
      setAdministrativeCorrectionError(preview.message)
      return
    }
    setPendingEjectionRemoval({ eventId, preview: preview.value })
  }

  const applyEjectionRemoval = () => {
    if (!pendingEjectionRemoval) return
    clearTrackerActionErrors()
    const result = removeBasketballOfficialEjection(state, pendingEjectionRemoval.eventId)
    if (!result.ok) {
      setAdministrativeCorrectionError(result.message)
      return
    }
    setPendingEjectionRemoval(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleTimeoutCapture = (timeout: BasketballTimeoutCapture) => {
    clearTrackerActionErrors()
    const result = captureBasketballTimeout(state, {
      recorderUserId: user?.id ?? null,
      timeout,
    })
    if (!result.ok) {
      setTimeoutError(result.message)
      return
    }
    setTimeoutError(null)
    setShowTimeoutDialog(false)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleTimeoutRemoval = (target: BasketballTimeoutDecrementTarget) => {
    clearTrackerActionErrors()
    const preview = previewBasketballTimeoutDecrement(state, target)
    if (!preview.ok) {
      setAdministrativeCorrectionError(preview.message)
      return
    }
    setPendingTimeoutRemoval({ target, preview: preview.value })
  }

  const applyTimeoutRemoval = () => {
    if (!pendingTimeoutRemoval) return
    clearTrackerActionErrors()
    const result = removeBasketballTimeout(state, pendingTimeoutRemoval.target)
    if (!result.ok) {
      setAdministrativeCorrectionError(result.message)
      return
    }
    setPendingTimeoutRemoval(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const lastAction = actionLog.length > 0 ? actionLog[actionLog.length - 1] : null
  const lastActionLabel = lastAction
    ? formatActionLogEntryLabel(lastAction, players, sport)
    : null
  const eventLastActionLabel = basketballCaptureUnits[0]
    ? `${basketballCaptureUnits[0].who} ${basketballCaptureUnits[0].what}`
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

  const handleAddBasketballParticipant = (input: {
    teamSide: 'tracked' | 'opponent'
    displayName: string
    number: string
  }) => {
    const result = addBasketballLateParticipant(state, {
      recorderUserId: user?.id ?? null,
      ...input,
    })
    if (!result.ok) {
      setLateParticipantError(result.message)
      return
    }
    setLateParticipantError(null)
    setLifecycleError(null)
    setShowAddPlayer(false)
    setShowAllShots(false)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleEndBasketballPeriod = () => {
    const result = endBasketballPeriod(state, { recorderUserId: user?.id ?? null })
    if (!result.ok) {
      setLifecycleError(result.message)
      return
    }
    setLifecycleError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleStartNextBasketballPeriod = () => {
    const result = startNextBasketballPeriod(state, { recorderUserId: user?.id ?? null })
    if (!result.ok) {
      setLifecycleError(result.message)
      return
    }
    setLifecycleError(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
  }

  const handleCompleteBasketballMatch = () => {
    const result = completeBasketballMatch(state, { recorderUserId: user?.id ?? null })
    if (!result.ok) {
      setLifecycleError(result.message)
      setShowCompleteConfirm(false)
      return
    }
    setLifecycleError(null)
    setShowCompleteConfirm(false)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    navigate(
      result.state.cloudSync.gameId
        ? gameInfoPath(result.state.cloudSync.gameId, result.state.cloudSync.teamId)
        : basketballSummaryPath({ from: 'tracker' })
    )
  }

  const applyLocalBasketballEnd = () => {
    if (!pendingLocalEnd) return
    const command = pendingLocalEnd === 'suspend'
      ? suspendBasketballMatch
      : abandonBasketballMatch
    const result = command(state, { recorderUserId: user?.id ?? null })
    if (!result.ok) {
      setLifecycleError(result.message)
      return
    }
    setLifecycleError(null)
    setPendingLocalEnd(null)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    if (pendingLocalEnd === 'abandon' && result.state.cloudSync.gameId) {
      navigate(gameInfoPath(result.state.cloudSync.gameId, result.state.cloudSync.teamId))
    }
  }

  const handleReopenBasketballMatch = (reason: string) => {
    const result = reopenBasketballMatch(state, {
      recorderUserId: user?.id ?? null,
      reason,
    })
    if (!result.ok) {
      setReopenError(result.message)
      return
    }
    setLifecycleError(null)
    setReopenError(null)
    setShowReopenDialog(false)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
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
            onClick={() => navigate(isBasketballEventMode
              ? basketballSummaryPath({ from: 'tracker' })
              : '/summary')}
            className="text-sm text-blue-600 font-semibold active:scale-95 transition-transform"
          >
            Summary →
          </button>
        </div>

        <Scoreboard
          readOnly={isBasketballEventMode}
          eventScoreControls={basketballSportState ? {
            disabled: !basketballPeriodActive,
            onAdjust: handleQuickScoreAdjustment,
            onOfficialCorrection: () => {
              setScoreCorrectionError(null)
              setShowScoreCorrection(true)
            },
          } : undefined}
        />
        {parkingError && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {parkingError}
          </div>
        )}
        {cloudRecoveryError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {cloudRecoveryError}
          </div>
        )}
        <BasketballEnableCloudPanel state={state} />
        {cloudConflicts.length > 0 ? (
          <div className="mt-3 flex items-center gap-3 border border-amber-300 bg-amber-50 px-3 py-3 text-amber-900">
            <BadgeAlert size={20} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Needs Attention</p>
              <p className="text-xs">{cloudConflicts.length} {cloudConflicts.length === 1 ? 'event needs' : 'events need'} review</p>
            </div>
            <button type="button" onClick={() => setConflictOpen(true)} className="min-h-9 rounded-md bg-amber-700 px-3 text-xs font-bold text-white">Review</button>
          </div>
        ) : isBasketballEventMode && state.cloudSync.status === 'error' ? (
          <div className="mt-3 flex items-center gap-3 border border-red-200 bg-red-50 px-3 py-3 text-red-800">
            <BadgeAlert size={20} className="shrink-0" />
            <p className="min-w-0 flex-1 truncate text-xs" title={state.cloudSync.lastError ?? undefined}>{state.cloudSync.lastError ?? 'Cloud sync needs attention.'}</p>
            <button type="button" onClick={() => { void retryBasketballSync() }} disabled={syncBusy} className="min-h-9 rounded-md bg-red-700 px-3 text-xs font-bold text-white disabled:opacity-50">{syncBusy ? 'Retrying...' : 'Retry'}</button>
            <button type="button" onClick={exportBasketballRecovery} className="min-h-9 rounded-md border border-red-300 bg-white px-3 text-xs font-bold text-red-700">Export</button>
          </div>
        ) : null}
        {isBasketballEventMode && state.cloudSync.gameId && (
          <BasketballRecorderStatus
            gameId={state.cloudSync.gameId}
            teamId={state.cloudSync.teamId}
            refreshSignal={state.cloudSync.lastSyncedAt}
          />
        )}
        {basketballSportState && (
          <BasketballLifecycleControls
            sportState={basketballSportState}
            errorMessage={lifecycleError}
            onEndPeriod={handleEndBasketballPeriod}
            onStartNextPeriod={handleStartNextBasketballPeriod}
            onComplete={() => setShowCompleteConfirm(true)}
            onSuspend={() => {
              setLifecycleError(null)
              setPendingLocalEnd('suspend')
            }}
            onAbandon={() => {
              setLifecycleError(null)
              setPendingLocalEnd('abandon')
            }}
            onReopen={() => {
              setReopenError(null)
              setShowReopenDialog(true)
            }}
          />
        )}
        {basketballSportState && currentBasketballSegment && (
          <BasketballEventBonusPanel
            periodLabel={currentBasketballSegment.label}
            trackedTeamName={gameInfo.teamName}
            opponentName={gameInfo.opponentName}
            trackedFouls={currentBasketballFouls.tracked}
            opponentFouls={currentBasketballFouls.opponent}
            trackedStatus={currentBasketballBonus.tracked}
            opponentStatus={currentBasketballBonus.opponent}
            hasOneAndOne={basketballRulesAllowOneAndOne(
              basketballSportState.setup.rulesSnapshot,
              currentBasketballSegment.id
            )}
          />
        )}
      </div>

      {isBasketballEventMode && (
        <div className="mx-auto w-full max-w-lg px-3 pb-2">
          <div className="grid h-11 grid-cols-2 rounded-lg border border-slate-300 bg-slate-100 p-1" role="tablist" aria-label="Basketball game workspace">
            <button
              ref={basketballTrackTabRef}
              type="button"
              id="basketball-track-tab"
              role="tab"
              aria-controls="basketball-track-panel"
              aria-selected={basketballWorkspace === 'track'}
              tabIndex={basketballWorkspace === 'track' ? 0 : -1}
              onClick={() => setBasketballWorkspace('track')}
              onKeyDown={handleBasketballWorkspaceKeyDown}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-md text-sm font-bold ${
                basketballWorkspace === 'track'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600'
              }`}
            >
              <Target size={16} aria-hidden />
              Track
            </button>
            <button
              ref={basketballTimelineTabRef}
              type="button"
              id="basketball-timeline-tab"
              role="tab"
              aria-controls="basketball-timeline-panel"
              aria-selected={basketballWorkspace === 'timeline'}
              tabIndex={basketballWorkspace === 'timeline' ? 0 : -1}
              onClick={() => setBasketballWorkspace('timeline')}
              onKeyDown={handleBasketballWorkspaceKeyDown}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-md text-sm font-bold ${
                basketballWorkspace === 'timeline'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600'
              }`}
            >
              <List size={16} aria-hidden />
              Timeline
            </button>
          </div>
        </div>
      )}

      {(!isBasketballEventMode || basketballWorkspace === 'track') ? (
        <div
          id={isBasketballEventMode ? 'basketball-track-panel' : undefined}
          role={isBasketballEventMode ? 'tabpanel' : undefined}
          aria-labelledby={isBasketballEventMode ? 'basketball-track-tab' : undefined}
          className="w-full"
        >
      <PlayerSelectorStrip
        players={players}
        activePlayerId={activePlayer.id}
        onSelectPlayer={handleSelectPlayer}
        activeBgClass={sport.theme.bg}
        onAddPlayer={isBasketballEventMode
          ? basketballMatchOpen
            ? () => {
                setLateParticipantError(null)
                setShowAddPlayer(true)
              }
            : undefined
          : () => setShowAddPlayer(!showAddPlayer)}
        sticky
        onSelectAll={isBasketball ? () => setShowAllShots(true) : undefined}
        allActive={showAllShots}
        playerStatusLabels={playerStatusLabels}
      />

      {!isBasketballEventMode && showAddPlayer && (
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
          <ShotChartPanel
            selection={shotChartSelection}
            onSelectPlayer={handleSelectPlayer}
            captureDisabled={isBasketballEventMode && (!basketballPeriodActive || activePlayerUnavailable)}
            captureDisabledMessage={basketballCaptureDisabledMessage}
          />
          {!isBasketballEventMode && (
            <p className="mt-2 text-[11px] text-slate-400 leading-snug px-1">
              The court popup and the buttons below adjust the same player stats — the popup is
              fast in-play entry (shots keep their location); the buttons are for direct entry
              and corrections.
            </p>
          )}
        </div>
      )}

      {!isBasketballEventMode && showPeriodToggle && teamRules && (
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

      {!isBasketballEventMode && showBonusBanner && teamRules && (
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
          {displayGridCategories.map(category => {
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
                    const directStatId = isBasketballEventMode && isBasketballDirectStatId(action.id)
                      ? action.id
                      : null
                    const directMissStatId = isBasketballEventMode && missAction && isBasketballDirectStatId(missAction.id)
                      ? missAction.id
                      : null
                    const decrementPreview = directStatId
                      ? previewBasketballDirectDecrement(state, activePlayer.id, directStatId)
                      : null
                    const missDecrementPreview = directMissStatId
                      ? previewBasketballDirectDecrement(state, activePlayer.id, directMissStatId)
                      : null
                    const foulTarget: BasketballFoulDecrementTarget | null = isBasketballEventMode
                      ? action.id === 'pf'
                        ? { kind: 'player', playerId: activePlayer.id }
                        : action.id === 'team_foul'
                          ? { kind: 'team_foul', teamSide: activeCaptureSide }
                          : action.id === 'team_tech'
                            ? { kind: 'team_technical', teamSide: activeCaptureSide }
                            : null
                      : null
                    const foulDecrementAvailable = foulTarget
                      ? canDecrementBasketballFoul(state, foulTarget)
                      : false
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
                        disabled={isBasketballEventMode && !basketballPeriodActive}
                        incrementDisabled={isBasketballEventMode && (
                          activePlayerUnavailable ||
                          (action.id === 'pf' && !activeFoulOffenderAvailable)
                        )}
                        attemptIncrementDisabled={isBasketballEventMode && activePlayerUnavailable}
                        decrementDisabled={isBasketballEventMode && (
                          foulTarget ? !foulDecrementAvailable : !decrementPreview?.ok
                        )}
                        attemptDecrementDisabled={isBasketballEventMode && !missDecrementPreview?.ok}
                        onIncrement={() => {
                          if (action.id === 'pf') {
                            openFoulDialog(activeCaptureSide, activePlayer.id, 'personal', 'common')
                          } else if (action.id === 'team_foul') {
                            openFoulDialog(activeCaptureSide, null, 'personal', 'common')
                          } else if (action.id === 'team_tech') {
                            openFoulDialog(activeCaptureSide, null, 'technical', 'administrative')
                          } else if (directStatId) {
                            handleDirectCapture(activePlayer.id, directStatId)
                          } else {
                            dispatch({
                              type: 'INCREMENT_STAT',
                              playerId: activePlayer.id,
                              statId: scopedId,
                            })
                          }
                        }}
                        onDecrement={() => {
                          if (foulTarget) {
                            handleFoulDecrement(foulTarget)
                          } else if (directStatId) {
                            handleDirectDecrement(activePlayer.id, directStatId)
                          } else {
                            dispatch({
                              type: 'DECREMENT_STAT',
                              playerId: activePlayer.id,
                              statId: scopedId,
                            })
                          }
                        }}
                        onAttempt={missAction ? () => directMissStatId
                          ? handleDirectCapture(activePlayer.id, directMissStatId)
                          : dispatch({
                              type: 'INCREMENT_STAT',
                              playerId: activePlayer.id,
                              statId: missAction.id,
                            }) : undefined
                        }
                        onAttemptDecrement={directMissStatId
                          ? () => handleDirectDecrement(activePlayer.id, directMissStatId)
                          : undefined
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
          {isBasketballEventMode && activeBasketballParticipant && !isTeamPseudoPlayer(activePlayer) && (
            <button
              type="button"
              onClick={() => {
                setStealTurnoverError(null)
                setShowStealTurnover(true)
              }}
              disabled={!basketballPeriodActive || activePlayerUnavailable}
              className="btn-secondary flex min-h-11 w-full items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-40"
            >
              <Link2 size={16} aria-hidden />
              Steal + Turnover
            </button>
          )}
          {isBasketballEventMode && timeoutInventory && (
            <section className="border-y border-sky-200 bg-sky-50 px-3 py-3" aria-labelledby="basketball-timeouts-title">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 id="basketball-timeouts-title" className="text-sm font-bold text-sky-950">Timeouts</h3>
                  <p className="text-xs text-sky-800">{timeoutInventory.scopeLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearTrackerActionErrors()
                    setShowTimeoutDialog(true)
                  }}
                  disabled={!basketballPeriodActive}
                  className="btn-secondary inline-flex min-h-10 shrink-0 items-center gap-2 px-3 py-2 text-sm disabled:opacity-40"
                >
                  <Clock3 size={16} aria-hidden />
                  Record
                </button>
              </div>
              <div className="mt-3 divide-y divide-sky-200 border-t border-sky-200">
                <TimeoutInventoryRow
                  label={gameInfo.teamName}
                  detail={formatBasketballTimeoutInventory(timeoutInventory.tracked)}
                  removeDisabled={!basketballPeriodActive || timeoutInventory.tracked.used === 0}
                  onRemove={() => handleTimeoutRemoval({ mode: 'charged', teamSide: 'tracked' })}
                />
                <TimeoutInventoryRow
                  label={gameInfo.opponentName}
                  detail={formatBasketballTimeoutInventory(timeoutInventory.opponent)}
                  removeDisabled={!basketballPeriodActive || timeoutInventory.opponent.used === 0}
                  onRemove={() => handleTimeoutRemoval({ mode: 'charged', teamSide: 'opponent' })}
                />
                <TimeoutInventoryRow
                  label="Media"
                  detail={countLabel(timeoutInventory.neutralMedia, 'recorded timeout')}
                  removeDisabled={!basketballPeriodActive || timeoutInventory.neutralMedia === 0}
                  onRemove={() => handleTimeoutRemoval({ mode: 'neutral', kind: 'media' })}
                />
                <TimeoutInventoryRow
                  label="Official"
                  detail={countLabel(timeoutInventory.neutralOfficial, 'recorded timeout')}
                  removeDisabled={!basketballPeriodActive || timeoutInventory.neutralOfficial === 0}
                  onRemove={() => handleTimeoutRemoval({ mode: 'neutral', kind: 'official' })}
                />
              </div>
            </section>
          )}
          {isBasketballEventMode && (
            <section className="border-y border-rose-200 bg-rose-50 px-3 py-3" aria-labelledby="basketball-ejections-title">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 id="basketball-ejections-title" className="text-sm font-bold text-rose-950">Official ejections</h3>
                  <p className="text-xs text-rose-800">{basketballEjectionStatuses.length > 0 ? countLabel(basketballEjectionStatuses.length, 'recorded ruling') : 'No recorded rulings'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearTrackerActionErrors()
                    setShowEjectionDialog(true)
                  }}
                  disabled={!basketballPeriodActive}
                  className="btn-secondary inline-flex min-h-10 shrink-0 items-center gap-2 px-3 py-2 text-sm disabled:opacity-40"
                >
                  <UserX size={16} aria-hidden />
                  Record
                </button>
              </div>
              {basketballEjectionStatuses.length > 0 && (
                <div className="mt-3 divide-y divide-rose-200 border-t border-rose-200">
                  {basketballEjectionStatuses.map(ejection => (
                    <div key={ejection.eventId} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{ejection.subjectLabel}</p>
                        <p className="line-clamp-2 text-xs text-slate-600">
                          {ejection.teamSide === 'tracked' ? gameInfo.teamName : gameInfo.opponentName} - {ejection.reason}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleEjectionRemoval(ejection.eventId)}
                        disabled={!ejection.removable}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-700 disabled:opacity-30"
                        aria-label={`Remove ejection for ${ejection.subjectLabel}`}
                        title={ejection.removable ? 'Remove official ejection' : 'Only current-period ejections can be corrected'}
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {isBasketballEventMode && reviewableFreeThrowTrips.length > 0 && (
            <section className="border-y border-amber-200 bg-amber-50 px-3 py-3" aria-labelledby="basketball-open-trips-title">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 id="basketball-open-trips-title" className="text-sm font-bold text-amber-950">
                  Awarded free throws
                </h3>
                <span className="text-xs font-semibold text-amber-800">
                  {openFreeThrowTripCount > 0
                    ? `${openFreeThrowTripCount} open`
                    : 'Review corrections'}
                </span>
              </div>
              <div className="space-y-2">
                {reviewableFreeThrowTrips.map(trip => {
                  const teamName = trip.teamSide === 'tracked' ? gameInfo.teamName : gameInfo.opponentName
                  const lastShooter = [...trip.attempts]
                    .reverse()
                    .find(attempt => !attempt.deleted && attempt.shooterPlayerId)?.shooterPlayerId ?? null
                  return (
                    <div key={trip.eventId} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{teamName}</p>
                        <p className="text-xs text-slate-600">
                          {trip.open
                            ? `Attempt ${trip.nextAttemptNumber} of ${trip.maximumAttempts}`
                            : 'Closed · removed position retained'}
                          {trip.oneAndOne ? ' · one-and-one' : ''}
                          {trip.technical ? ' · technical' : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFreeThrowError(null)
                          setActiveFreeThrowTrip({ eventId: trip.eventId, suggestedPlayerId: lastShooter })
                        }}
                        disabled={!basketballPeriodActive}
                        className="btn-secondary inline-flex min-h-10 shrink-0 items-center gap-2 px-3 py-2 text-sm disabled:opacity-40"
                      >
                        <ReceiptText size={16} aria-hidden />
                        {trip.open ? 'Record' : 'Review'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
          {isBasketballEventMode && (directCaptureError || directDecrementError || administrativeCorrectionError) && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
              {directCaptureError ?? directDecrementError ?? administrativeCorrectionError}
            </p>
          )}
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
        </div>
      ) : (
        <BasketballTimeline />
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t border-slate-200 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="min-w-0 pr-3 text-xs text-slate-400">
            {(isBasketballEventMode ? eventLastActionLabel : lastActionLabel) && (
              <span className="block truncate">Last: <span className="font-medium text-slate-600">{isBasketballEventMode ? eventLastActionLabel : lastActionLabel}</span></span>
            )}
          </div>
          <button
            onClick={() => setShowRecentEvents(true)}
            disabled={isBasketballEventMode
              ? basketballCaptureUnits.length === 0 && !canRestoreBasketball
              : actionLog.length === 0}
            className="btn-secondary py-2 px-4 text-sm disabled:opacity-30"
          >
            ↩ Undo
          </button>
        </div>
      </div>

      {showRecentEvents && isBasketballEventMode && (
        <BasketballRecentEventsPopup
          units={basketballCaptureUnits}
          canRestore={canRestoreBasketball}
          errorMessage={eventCorrectionError}
          onUndoTop={handleBasketballUndo}
          onRestore={handleBasketballRestore}
          onClose={() => {
            setEventCorrectionError(null)
            setShowRecentEvents(false)
          }}
        />
      )}

      {showRecentEvents && !isBasketballEventMode && (
        <RecentEventsPopup
          entries={actionLog}
          players={players}
          sport={sport}
          onUndoTop={handleUndo}
          onClose={() => setShowRecentEvents(false)}
        />
      )}

      {showAddPlayer && basketballSportState && basketballMatchOpen && (
        <BasketballLateParticipantDialog
          trackedTeamName={gameInfo.teamName}
          opponentName={gameInfo.opponentName}
          defaultSide={basketballSportState.capturePreferences.teamSide}
          errorMessage={lateParticipantError}
          onAdd={handleAddBasketballParticipant}
          onClose={() => {
            setLateParticipantError(null)
            setShowAddPlayer(false)
          }}
        />
      )}

      {showScoreCorrection && basketballSportState && (
        <BasketballScoreCorrectionDialog
          trackedTeamName={gameInfo.teamName}
          opponentName={gameInfo.opponentName}
          trackedScore={basketballSportState.projection.score.tracked}
          opponentScore={basketballSportState.projection.score.opponent}
          errorMessage={scoreCorrectionError}
          onSubmit={handleOfficialScoreCorrection}
          onClose={() => {
            setScoreCorrectionError(null)
            setShowScoreCorrection(false)
          }}
        />
      )}

      {showStealTurnover && activeBasketballParticipant && stealTurnoverSide && (
        <BasketballStealTurnoverDialog
          stealerLabel={`${activeBasketballParticipant.number ? `#${activeBasketballParticipant.number} ` : ''}${activeBasketballParticipant.displayName}`}
          turnoverTeamName={stealTurnoverTeamName}
          candidates={stealTurnoverCandidates}
          errorMessage={stealTurnoverError}
          onSubmit={handleStealTurnover}
          onClose={() => {
            setStealTurnoverError(null)
            setShowStealTurnover(false)
          }}
        />
      )}

      {showEjectionDialog && basketballSportState && (
        <BasketballEjectionDialog
          trackedTeamName={gameInfo.teamName}
          opponentName={gameInfo.opponentName}
          candidates={ejectionCandidates}
          foulCandidates={ejectionFoulCandidates}
          defaultSide={activeBasketballParticipant?.teamSide ?? basketballSportState.capturePreferences.teamSide}
          defaultPlayerId={activeBasketballParticipant?.playerId ?? null}
          errorMessage={ejectionError}
          onSubmit={handleEjectionCapture}
          onClose={() => {
            setEjectionError(null)
            setShowEjectionDialog(false)
          }}
        />
      )}

      {showTimeoutDialog && basketballSportState && timeoutInventory && (
        <BasketballTimeoutDialog
          trackedTeamName={gameInfo.teamName}
          opponentName={gameInfo.opponentName}
          inventory={timeoutInventory}
          defaultSide={activeBasketballParticipant?.teamSide ?? basketballSportState.capturePreferences.teamSide}
          errorMessage={timeoutError}
          onSubmit={handleTimeoutCapture}
          onClose={() => {
            setTimeoutError(null)
            setShowTimeoutDialog(false)
          }}
        />
      )}

      {showReopenDialog && basketballSportState && (
        <BasketballReopenDialog
          statusLabel={basketballTerminalStatusLabel(basketballSportState)}
          errorMessage={reopenError}
          onSubmit={handleReopenBasketballMatch}
          onClose={() => {
            setReopenError(null)
            setShowReopenDialog(false)
          }}
        />
      )}

      {foulDialog && basketballSportState && (
        <BasketballFoulDialog
          key={`${foulDialog.teamSide}:${foulDialog.playerId ?? 'team'}:${foulDialog.foulClass}:${foulDialog.context}`}
          trackedTeamName={gameInfo.teamName}
          opponentName={gameInfo.opponentName}
          candidates={foulCandidates}
          defaultSide={foulDialog.teamSide}
          defaultPlayerId={foulDialog.playerId}
          defaultClass={foulDialog.foulClass}
          defaultContext={foulDialog.context}
          errorMessage={foulError}
          onSubmit={handleFoulCapture}
          onClose={() => {
            setFoulError(null)
            setFoulDialog(null)
          }}
        />
      )}

      {selectedFreeThrowTrip && (
        <BasketballFreeThrowTripDialog
          key={selectedFreeThrowTrip.eventId}
          trip={selectedFreeThrowTrip}
          teamName={selectedFreeThrowTrip.teamSide === 'tracked' ? gameInfo.teamName : gameInfo.opponentName}
          candidates={freeThrowCandidates}
          suggestedPlayerId={activeFreeThrowTrip?.suggestedPlayerId}
          errorMessage={freeThrowError}
          onRecord={handleFreeThrowAttempt}
          onAddParticipant={() => {
            dispatch({
              type: 'SET_BASKETBALL_CAPTURE_PREFERENCES',
              preferences: {
                teamSide: selectedFreeThrowTrip.teamSide,
                selectedParticipantId: null,
                selectionInitialized: true,
              },
            })
            setFreeThrowError(null)
            setActiveFreeThrowTrip(null)
            setLateParticipantError(null)
            setShowAddPlayer(true)
          }}
          onRemove={() => handleFreeThrowTripRemoval(selectedFreeThrowTrip.eventId)}
          onClose={() => {
            setFreeThrowError(null)
            setActiveFreeThrowTrip(null)
          }}
        />
      )}

      <ConfirmDialog
        open={pendingLocalEnd !== null}
        title={pendingLocalEnd === 'suspend' ? 'Suspend game?' : 'Abandon game?'}
        message={pendingLocalEnd === 'suspend'
          ? 'Recording will pause at the current period state. Reopen the game with a reason to continue.'
          : 'The game will end as abandoned. Its recorded events remain available for review and reasoned reopening.'}
        confirmLabel={pendingLocalEnd === 'suspend' ? 'Suspend' : 'Abandon'}
        cancelLabel="Keep tracking"
        error={lifecycleError}
        onConfirm={applyLocalBasketballEnd}
        onCancel={() => {
          setLifecycleError(null)
          setPendingLocalEnd(null)
        }}
      />

      <ConfirmDialog
        open={pendingTimeoutRemoval !== null}
        title="Remove timeout?"
        message={pendingTimeoutRemoval
          ? [
              `${pendingTimeoutRemoval.preview.label} for ${pendingTimeoutRemoval.preview.ownerLabel} in ${pendingTimeoutRemoval.preview.periodLabel} will be removed.`,
              pendingTimeoutRemoval.preview.target.mode === 'charged'
                ? pendingTimeoutRemoval.preview.chargedRemainingAfter === null
                  ? 'Charged timeout inventory remains unlimited.'
                  : `${pendingTimeoutRemoval.preview.chargedRemainingAfter} charged timeout${pendingTimeoutRemoval.preview.chargedRemainingAfter === 1 ? '' : 's'} will remain.`
                : 'Team charged timeout inventory is unchanged.',
            ].join(' ')
          : ''}
        confirmLabel="Remove"
        cancelLabel="Keep"
        error={administrativeCorrectionError}
        onConfirm={applyTimeoutRemoval}
        onCancel={() => {
          setAdministrativeCorrectionError(null)
          setPendingTimeoutRemoval(null)
        }}
      />

      <ConfirmDialog
        open={pendingEjectionRemoval !== null}
        title="Remove official ejection?"
        message={pendingEjectionRemoval
          ? [
              `${pendingEjectionRemoval.preview.subjectLabel} will no longer be marked ejected.`,
              pendingEjectionRemoval.preview.subjectIsPlayer
                ? pendingEjectionRemoval.preview.playerRemainsDisqualified
                  ? 'The player remains disqualified by the foul limit.'
                  : 'The player will be available for new stats.'
                : null,
              pendingEjectionRemoval.preview.linkedFoulKept
                ? 'The related foul remains recorded.'
                : null,
            ].filter(Boolean).join(' ')
          : ''}
        confirmLabel="Remove"
        cancelLabel="Keep"
        error={administrativeCorrectionError}
        onConfirm={applyEjectionRemoval}
        onCancel={() => {
          setAdministrativeCorrectionError(null)
          setPendingEjectionRemoval(null)
        }}
      />

      <ConfirmDialog
        open={pendingFoulDecrement !== null}
        title="Remove foul?"
        message={pendingFoulDecrement
          ? [
              pendingFoulDecrement.preview.removesPersonalFoul ? 'The personal-foul count will decrease.' : null,
              pendingFoulDecrement.preview.removesTeamFoul ? 'The team-foul count will decrease.' : null,
              pendingFoulDecrement.preview.removesTechnical ? 'The technical-foul count will decrease.' : null,
              pendingFoulDecrement.preview.bonusStatusBefore !== pendingFoulDecrement.preview.bonusStatusAfter
                ? `Bonus changes from ${pendingFoulDecrement.preview.bonusStatusBefore.replace(/_/g, ' ')} to ${pendingFoulDecrement.preview.bonusStatusAfter.replace(/_/g, ' ')}.`
                : null,
              pendingFoulDecrement.preview.clearsDisqualification
                ? 'The player will no longer be disqualified.'
                : null,
              pendingFoulDecrement.preview.unlinkedTripCount > 0
                ? `${countLabel(pendingFoulDecrement.preview.unlinkedTripCount, 'free-throw award')} will be kept and unlinked.`
                : null,
              pendingFoulDecrement.preview.unlinkedEjectionCount > 0
                ? `${countLabel(pendingFoulDecrement.preview.unlinkedEjectionCount, 'ejection')} will be kept and unlinked.`
                : null,
              pendingFoulDecrement.preview.removedAutomaticEjectionCount > 0
                ? `${countLabel(pendingFoulDecrement.preview.removedAutomaticEjectionCount, 'automatic ejection')} will also be removed.`
                : null,
            ].filter(Boolean).join(' ')
          : ''}
        confirmLabel="Remove"
        cancelLabel="Keep"
        error={administrativeCorrectionError}
        onConfirm={applyFoulDecrement}
        onCancel={() => {
          setAdministrativeCorrectionError(null)
          setPendingFoulDecrement(null)
        }}
      />

      <ConfirmDialog
        open={pendingTripRemoval !== null}
        title="Remove free-throw award?"
        message={pendingTripRemoval
          ? `The award will be removed.${pendingTripRemoval.preview.unlinkedAttemptCount > 0
              ? ` ${countLabel(pendingTripRemoval.preview.unlinkedAttemptCount, 'recorded attempt')} will be kept and unlinked.`
              : ''}`
          : ''}
        confirmLabel="Remove"
        cancelLabel="Keep"
        error={administrativeCorrectionError}
        onConfirm={applyFreeThrowTripRemoval}
        onCancel={() => {
          setAdministrativeCorrectionError(null)
          setPendingTripRemoval(null)
        }}
      />

      <ConfirmDialog
        open={pendingDirectDecrement !== null}
        title={`Remove ${pendingDirectDecrement?.preview.label ?? 'stat'}?`}
        message={pendingDirectDecrement
          ? [
              `This removes the selected ${pendingDirectDecrement.preview.label}.`,
              pendingDirectDecrement.preview.linkedAssistCount > 0
                ? `${countLabel(pendingDirectDecrement.preview.linkedAssistCount, 'linked assist')} will also be removed.`
                : null,
              pendingDirectDecrement.preview.linkedReboundCount > 0
                ? `${countLabel(pendingDirectDecrement.preview.linkedReboundCount, 'linked rebound')} will also be removed.`
                : null,
              pendingDirectDecrement.preview.unlinkedBlockCount > 0
                ? `${countLabel(pendingDirectDecrement.preview.unlinkedBlockCount, 'linked block')} will be kept and unlinked.`
                : null,
              pendingDirectDecrement.preview.consumesFreeThrowTripPosition
                ? 'Its awarded-trip position stays consumed; reopen the trip workspace to review or remove the award.'
                : null,
            ].filter(Boolean).join(' ')
          : ''}
        confirmLabel="Remove"
        cancelLabel="Keep"
        error={directDecrementError}
        onConfirm={() => {
          if (pendingDirectDecrement) {
            applyDirectDecrement(pendingDirectDecrement.playerId, pendingDirectDecrement.statId)
          }
        }}
        onCancel={() => {
          setDirectDecrementError(null)
          setPendingDirectDecrement(null)
        }}
      />

      <ConfirmDialog
        open={showCompleteConfirm}
        title="End this game?"
        message={state.cloudSync.gameId
          ? 'This records the result locally and opens Game Info to review and finalize the cloud result.'
          : 'This records the current result and makes ordinary game capture read-only.'}
        confirmLabel="End Game"
        cancelLabel="Keep Tracking"
        destructive={false}
        error={lifecycleError}
        onConfirm={handleCompleteBasketballMatch}
        onCancel={() => setShowCompleteConfirm(false)}
      />

      {conflictOpen && cloudConflicts.length > 0 && (
        <EventCloudConflictDialog
          conflicts={cloudConflicts}
          busy={syncBusy}
          onResolve={resolveBasketballConflict}
          onExport={exportBasketballRecovery}
          onClose={() => setConflictOpen(false)}
        />
      )}
    </div>
  )
}

function TimeoutInventoryRow({
  label,
  detail,
  removeDisabled,
  onRemove,
}: {
  label: string
  detail: string
  removeDisabled: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">{label}</p>
        <p className="text-xs text-slate-600">{detail}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removeDisabled}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-white text-sky-800 disabled:opacity-30"
        aria-label={`Remove latest ${label} timeout`}
        title={removeDisabled ? 'No matching current-period timeout to remove' : 'Remove latest timeout'}
      >
        <Minus size={16} aria-hidden />
      </button>
    </div>
  )
}

function basketballLifecycleCaptureMessage(
  sportState: BasketballSportGameState | null
): string | undefined {
  switch (sportState?.projection.status) {
    case 'period_break': return 'Start the next period to record Basketball events.'
    case 'suspended': return 'Reopen the suspended game to resume Basketball event capture.'
    case 'ended': return 'Reopen the ended game before recording more Basketball events.'
    default: return undefined
  }
}

function basketballTerminalStatusLabel(sportState: BasketballSportGameState): string {
  if (sportState.projection.status === 'suspended') return 'Suspended game'
  if (sportState.projection.endReason === 'abandoned') return 'Abandoned game'
  return 'Completed game'
}
