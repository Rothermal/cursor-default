import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BadgeAlert,
  ChevronLeft,
  Compass,
  Goal,
  Flag,
  FlagTriangleRight,
  History,
  Map,
  MoreHorizontal,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  TimerReset,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import SoccerField, {
  type SoccerFieldMarker,
  type SoccerFieldMarkerKind,
} from '../components/soccer/SoccerField'
import SoccerIncidentCaptureDialog, {
  type SoccerIncidentDraft,
  type SoccerIncidentEvent,
  type SoccerIncidentKind,
} from '../components/soccer/SoccerIncidentCaptureDialog'
import SoccerLiveActionDialog, {
  type SoccerLiveDialogKind,
} from '../components/soccer/SoccerLiveActionDialog'
import SoccerTimeline from '../components/soccer/SoccerTimeline'
import SoccerScoreTimelineDialog from '../components/soccer/SoccerScoreTimelineDialog'
import SoccerShootoutManagementDialog, { type SoccerShootoutManagementKind } from '../components/soccer/SoccerShootoutManagementDialog'
import SoccerShootoutSetupDialog from '../components/soccer/SoccerShootoutSetupDialog'
import SoccerShootoutWorkspace from '../components/soccer/SoccerShootoutWorkspace'
import SoccerCloudConflictDialog from '../components/soccer/SoccerCloudConflictDialog'
import SoccerRecorderDialog from '../components/soccer/SoccerRecorderDialog'
import SoccerShotCaptureDialog, {
  type SoccerCaptureDraft,
} from '../components/soccer/SoccerShotCaptureDialog'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import type { GameState } from '../types'
import type { GameEvent } from '../lib/gameEvents/types'
import {
  endSoccerPeriod,
  endSoccerMatch,
  formatSoccerDuration,
  inspectSoccerHistory,
  orderedSoccerSegments,
  participantActiveMs,
  recordSoccerDirectionChange,
  reopenSoccerMatch,
  soccerLifecycleAction,
  soccerMatchActionsAvailable,
  soccerFieldReviewEvents,
  soccerTeamEventReviewPresentation,
  soccerClockDisplayValue,
  startNextSoccerPeriod,
  toggleSoccerClock,
  type SoccerLiveResult,
  type SoccerMatchProjection,
  type SoccerOwnGoalEvent,
  type SoccerProjectedParticipant,
  type SoccerScoreAdjustmentEvent,
  type SoccerShotEvent,
} from '../lib/soccer'
import { sportDashboardPath } from '../lib/sportNavigation'
import {
  loadSoccerGameRecorders,
  primarySoccerRecorder,
  type SoccerRecorderSummary,
} from '../lib/soccer/recorders'
import { soccerSummaryPath } from '../lib/soccer/summary'

type MainTab = 'field' | 'lineup' | 'timeline'
type LineupTab = 'on_field' | 'bench'
type MarkerSideFilter = 'all' | 'tracked' | 'opponent'
type MarkerScope = 'current' | 'match'
type MarkerFamilyFilter = 'all' | 'shots' | 'defense' | 'incidents'

export default function SoccerGameTracker() {
  const navigate = useNavigate()
  const { state, dispatch, flushCloudSync, resolveEventConflict } = useGame()
  const { user } = useAuth()
  const soccerState = state.sportGameState?.sportId === 'soccer'
    ? state.sportGameState
    : null
  const projection = soccerState?.projection ?? null
  const [nowMs, setNowMs] = useState(Date.now())
  const [mainTab, setMainTab] = useState<MainTab>('field')
  const [lineupTab, setLineupTab] = useState<LineupTab>('on_field')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [dialogKind, setDialogKind] = useState<SoccerLiveDialogKind | null>(null)
  const [dialogParticipantId, setDialogParticipantId] = useState<string | null>(null)
  const [confirmEndPeriod, setConfirmEndPeriod] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  const [captureDraft, setCaptureDraft] = useState<SoccerCaptureDraft | null>(null)
  const [incidentDraft, setIncidentDraft] = useState<SoccerIncidentDraft | null>(null)
  const [fieldFlipped, setFieldFlipped] = useState(false)
  const [markerSideFilter, setMarkerSideFilter] = useState<MarkerSideFilter>('all')
  const [markerScope, setMarkerScope] = useState<MarkerScope>('current')
  const [markerFamilyFilter, setMarkerFamilyFilter] = useState<MarkerFamilyFilter>('all')
  const [clusterEventIds, setClusterEventIds] = useState<string[] | null>(null)
  const [scoreTimelineOpen, setScoreTimelineOpen] = useState(false)
  const [scoreAdjustmentEdit, setScoreAdjustmentEdit] = useState<SoccerScoreAdjustmentEvent | null>(null)
  const [shootoutSetupOpen, setShootoutSetupOpen] = useState(false)
  const [shootoutManagement, setShootoutManagement] = useState<SoccerShootoutManagementKind | null>(null)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [recordersOpen, setRecordersOpen] = useState(false)
  const [recorders, setRecorders] = useState<SoccerRecorderSummary[]>([])
  const [recordersLoading, setRecordersLoading] = useState(false)
  const applyingRef = useRef(false)

  const invalidRoute = !state.sport || state.sport.id !== 'soccer' || !state.gameInfo || !soccerState || !projection
  useEffect(() => {
    if (invalidRoute) navigate('/setup', { replace: true })
  }, [invalidRoute, navigate])

  useEffect(() => {
    if (!projection?.clock.running) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [projection?.clock.running])

  useEffect(() => {
    applyingRef.current = false
    setIsApplying(false)
  }, [state])

  const cloudConflicts = state.cloudSync.eventConflicts ?? []
  const primaryRecorder = primarySoccerRecorder(recorders)

  const refreshRecorders = async () => {
    const gameId = state.cloudSync.gameId
    if (!gameId) {
      setRecorders([])
      return
    }
    setRecordersLoading(true)
    try {
      setRecorders(await loadSoccerGameRecorders(gameId))
    } catch {
      setRecorders([])
    } finally {
      setRecordersLoading(false)
    }
  }

  useEffect(() => {
    void refreshRecorders()
    // A confirmed checkpoint changes lastSyncedAt and can add the current recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cloudSync.gameId, state.cloudSync.lastSyncedAt])

  useEffect(() => {
    if (!state.cloudSync.gameId) return
    const timer = window.setInterval(() => { void refreshRecorders() }, 30_000)
    const onFocus = () => { void refreshRecorders() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cloudSync.gameId])

  useEffect(() => {
    if (cloudConflicts.length > 0) setConflictOpen(true)
  }, [cloudConflicts.length])

  const exportRecovery = () => {
    const blob = new Blob([
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        kind: 'soccer-game-recovery',
        gameState: state,
      }, null, 2),
    ], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `statkeeper-soccer-recovery-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const resolveConflict = (eventId: string, resolution: 'local' | 'remote') => {
    const result = resolveEventConflict(eventId, resolution)
    if (!result.ok) {
      setError(result.reason)
      return
    }
    if (cloudConflicts.length === 1) setConflictOpen(false)
  }

  const retrySync = async () => {
    setSyncBusy(true)
    const result = await flushCloudSync()
    setSyncBusy(false)
    if (!result.ok) setError(result.reason)
  }

  const inspection = useMemo(() => inspectSoccerHistory(state), [state])
  const clockValue = soccerClockDisplayValue(state, nowMs)
  const segments = projection ? orderedSoccerSegments(projection.currentRules) : []
  const currentSegment = segments.find(segment => segment.id === projection?.currentPeriodId) ?? null
  const lifecycleAction = projection ? soccerLifecycleAction(projection) : { kind: 'none' as const }
  const nextSegment = lifecycleAction.kind === 'start_period' ? lifecycleAction.segment : null

  if (invalidRoute || !state.gameInfo || !soccerState || !projection || !clockValue) return null

  const healthy = inspection.complete
  const ended = projection.status === 'ended'
  const cloudFinal = state.cloudSync.gameStatus === 'final'
  const shootoutActive = projection.status === 'shootout' && projection.shootout !== null
  const options = { recorderUserId: user?.id ?? null }
  const participants = Object.values(projection.participants)
  const onField = participants.filter(participant => participant.status === 'on_field')
  const bench = participants.filter(participant => participant.status !== 'on_field')
  const visibleParticipants = lineupTab === 'on_field' ? onField : bench
  const capturePreferences = soccerState.capturePreferences
  const fieldCaptureEnabled =
    healthy && projection.status === 'in_progress' && !isApplying && !cloudFinal
  const substitutionActionEnabled =
    healthy &&
    soccerMatchActionsAvailable(projection) &&
    !isApplying &&
    !cloudFinal
  const markerFilterSummary = [
    markerFamilyFilter === 'all'
      ? null
      : markerFamilyFilter === 'shots'
        ? 'Shots'
        : markerFamilyFilter === 'defense'
          ? 'Defense'
          : 'Incidents',
    markerSideFilter === 'all'
      ? null
      : markerSideFilter === 'tracked'
        ? 'Tracked'
        : 'Opponent',
    markerScope === 'current' ? 'Current period' : 'Full match',
  ].filter(Boolean).join(' · ')
  const reviewPeriodId = projection.currentPeriodId
    ?? projection.completedPeriodIds[projection.completedPeriodIds.length - 1]
    ?? null
  const fieldMarkers: SoccerFieldMarker[] = soccerFieldReviewEvents(inspection.activeEvents, {
    side: markerSideFilter,
    scope: markerScope,
    periodId: reviewPeriodId,
    family: markerFamilyFilter,
  })
    .map(event => ({
      id: event.id,
      x: event.location?.x ?? 0,
      y: event.location?.y ?? 0,
      teamSide: event.teamSide,
      kind: markerKind(event),
      label: markerLabel(event),
    }))

  const setCaptureSide = (teamSide: 'tracked' | 'opponent') => {
    dispatch({ type: 'SET_SOCCER_CAPTURE_PREFERENCES', preferences: { teamSide } })
  }

  const setCaptureMode = (captureMode: 'shot' | 'defense' | 'foul') => {
    dispatch({ type: 'SET_SOCCER_CAPTURE_PREFERENCES', preferences: { captureMode } })
  }

  const openIncident = (
    kind: SoccerIncidentKind,
    location: SoccerIncidentDraft['location'],
    mode: SoccerIncidentDraft['mode'] = 'live',
    event?: SoccerIncidentEvent
  ) => {
    if (cloudFinal) return
    setIncidentDraft({
      kind,
      teamSide: event?.teamSide ?? capturePreferences.teamSide,
      location: event?.location ?? location,
      mode,
      event,
    })
  }

  const editFieldEvent = (event: GameEvent) => {
    if (cloudFinal) return
    if (event.eventType === 'soccer.shot' || event.eventType === 'soccer.own_goal') {
      const attackingEvent = event as SoccerShotEvent | SoccerOwnGoalEvent
      setCaptureDraft({
        mode: 'edit',
        teamSide: attackingEvent.teamSide,
        location: event.location,
        event: attackingEvent,
      })
      return
    }
    if (isIncidentEvent(event)) openIncident(incidentKind(event), event.location, 'edit', event)
  }

  const applyResult = (result: SoccerLiveResult): boolean => {
    if (applyingRef.current) return false
    if (cloudFinal) {
      setError('Reopen the cloud game before changing its event history.')
      return false
    }
    if (!result.ok) {
      setError(result.message)
      return false
    }
    if (inspection.complete && !result.inspection.complete) {
      setError('That change would leave the match history incomplete.')
      return false
    }
    applyingRef.current = true
    setIsApplying(true)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    setError(null)
    setDialogKind(null)
    setDialogParticipantId(null)
    setActionsOpen(false)
    if (!result.inspection.complete) setMainTab('timeline')
    return true
  }

  const openDialog = (kind: SoccerLiveDialogKind, participantId: string | null = null) => {
    setDialogParticipantId(participantId)
    setDialogKind(kind)
    setActionsOpen(false)
  }

  const primaryClockAction = () => {
    applyResult(toggleSoccerClock(state, options))
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 pb-8" aria-busy={isApplying}>
      {isApplying && <div className="fixed inset-0 z-[70] cursor-wait" aria-hidden="true" />}
      <header className="bg-emerald-800 text-white px-4 py-3">
        <div className="mx-auto flex w-full min-w-0 max-w-2xl items-center gap-3">
          <button type="button" onClick={() => navigate(sportDashboardPath('soccer'))} className="h-9 w-9 grid place-items-center rounded-md bg-white/15" aria-label="Back to soccer dashboard" title="Back">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-bold truncate">{state.gameInfo.teamName} vs {state.gameInfo.opponentName}</h1>
            <p className="flex min-w-0 items-center gap-2 text-xs text-emerald-100">
              <span className="truncate">{currentSegment?.label ?? (ended ? 'Match ended' : nextSegment ? `${nextSegment.label} next` : 'Periods complete')}</span>
              <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 font-semibold">
                {soccerCloudStatusLabel(state)}
              </span>
            </p>
          </div>
          {!ended && (
            <button type="button" onClick={() => setActionsOpen(true)} disabled={!healthy || isApplying || cloudFinal} className="h-9 w-9 grid place-items-center rounded-md bg-white/15 disabled:opacity-40" aria-label="Match actions" title="Match actions">
              <MoreHorizontal size={21} />
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-2xl">
        <section className="px-4 py-4 text-center border-b border-slate-200 bg-white">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <button type="button" onClick={() => { setScoreAdjustmentEdit(null); setScoreTimelineOpen(true) }} className="min-w-0 rounded-md px-1 py-1 hover:bg-slate-50" aria-label={`Open ${state.gameInfo.teamName} scoring timeline`}>
              <p className="truncate text-xs font-semibold text-slate-500">{state.gameInfo.teamName}</p>
              <p className="text-4xl font-bold tabular-nums text-emerald-800">{state.homeTeamScore ?? 0}</p>
            </button>
            <div className="min-w-24">
              <div className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase text-slate-500">
                <span>{currentSegment?.label ?? (ended ? 'Final' : 'Break')}</span>
                <span className={`h-2 w-2 rounded-full ${projection.clock.running ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              </div>
              <div className="mt-1 flex min-h-9 items-baseline justify-center gap-1">
                <p className="text-3xl font-bold text-slate-900 tabular-nums leading-none">{clockValue.primary}</p>
                {clockValue.overrun && <span className="text-sm font-bold text-amber-600 tabular-nums">{clockValue.overrun}</span>}
              </div>
              <p className="mt-1 text-[11px] font-medium text-slate-500">{projection.clock.running ? 'Running' : 'Stopped'}</p>
            </div>
            <button type="button" onClick={() => { setScoreAdjustmentEdit(null); setScoreTimelineOpen(true) }} className="min-w-0 rounded-md px-1 py-1 hover:bg-slate-50" aria-label={`Open ${state.gameInfo.opponentName} scoring timeline`}>
              <p className="truncate text-xs font-semibold text-slate-500">{state.gameInfo.opponentName}</p>
              <p className="text-4xl font-bold tabular-nums text-slate-800">{state.opponentScore}</p>
            </button>
          </div>

          {!healthy ? (
            <button type="button" onClick={() => setMainTab('timeline')} className="mt-5 w-full rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              Review Timeline Issues
            </button>
          ) : ended ? (
            <div className="mt-5 space-y-2">
              <p className="text-sm font-bold text-slate-700">{matchResultLabel(projection, state.gameInfo.teamName, state.gameInfo.opponentName)}</p>
              <button
                type="button"
                onClick={() => navigate(soccerSummaryPath({ from: 'tracker' }))}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
              >
                <Flag size={18} /> View Summary
              </button>
              {cloudFinal ? (
                <p className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  This cloud result is locked. Reopen it from Match Summary.
                </p>
              ) : (
                <button type="button" onClick={() => setReopenOpen(true)} className="w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 flex items-center justify-center gap-2">
                  <RotateCcw size={18} /> Reopen Match
                </button>
              )}
            </div>
          ) : projection.status === 'suspended' ? (
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => applyResult(reopenSoccerMatch(state, 'Match resumed', options))} className="rounded-md bg-emerald-700 px-4 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
                <Play size={18} /> Resume Match
              </button>
              <button type="button" onClick={() => openDialog('end')} className="rounded-md border border-red-300 bg-white px-4 py-3 text-sm font-bold text-red-700">Abandon</button>
            </div>
          ) : projection.status === 'period_break' ? (
            <div className="mt-5 grid grid-cols-2 gap-2">
              {lifecycleAction.kind === 'start_period' ? (
                <button type="button" onClick={() => applyResult(startNextSoccerPeriod(state, options))} className="rounded-md bg-emerald-700 px-4 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
                  <Play size={18} /> Start {lifecycleAction.segment.label}
                </button>
              ) : lifecycleAction.kind === 'start_shootout' ? (
                <button type="button" onClick={() => setShootoutSetupOpen(true)} className="rounded-md bg-emerald-700 px-4 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
                  <Goal size={18} /> Start Shootout
                </button>
              ) : lifecycleAction.kind === 'complete' ? (
                <button type="button" onClick={() => applyResult(endSoccerMatch(state, 'completed', options))} className="rounded-md bg-emerald-700 px-4 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
                  <Flag size={18} /> {lifecycleAction.label}
                </button>
              ) : <span />}
              <button type="button" onClick={() => openDialog('end')} className="rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 flex items-center justify-center gap-2">
                <MoreHorizontal size={18} /> Match Status
              </button>
            </div>
          ) : shootoutActive ? null : (
            <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
              <button type="button" onClick={primaryClockAction} className={`rounded-md px-4 py-3 text-sm font-bold text-white flex items-center justify-center gap-2 ${projection.clock.running ? 'bg-amber-600' : 'bg-emerald-700'}`}>
                {projection.clock.running ? <Pause size={19} /> : <Play size={19} />}
                {projection.clock.running ? 'Pause Clock' : 'Start Clock'}
              </button>
              <button type="button" onClick={() => setConfirmEndPeriod(true)} className="rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700">End Period</button>
            </div>
          )}
        </section>

        {error && <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {cloudConflicts.length > 0 ? (
          <div className="mx-4 mt-4 flex items-center gap-3 border border-amber-300 bg-amber-50 px-3 py-3 text-amber-900">
            <BadgeAlert size={20} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Needs Attention</p>
              <p className="text-xs">{cloudConflicts.length} {cloudConflicts.length === 1 ? 'event needs' : 'events need'} review</p>
            </div>
            <button type="button" onClick={() => setConflictOpen(true)} className="min-h-9 rounded-md bg-amber-700 px-3 text-xs font-bold text-white">Review</button>
          </div>
        ) : state.cloudSync.status === 'error' ? (
          <div className="mx-4 mt-4 flex items-center gap-3 border border-red-200 bg-red-50 px-3 py-3 text-red-800">
            <BadgeAlert size={20} className="shrink-0" />
            <p className="min-w-0 flex-1 truncate text-xs" title={state.cloudSync.lastError ?? undefined}>{state.cloudSync.lastError ?? 'Cloud sync needs attention.'}</p>
            <button type="button" onClick={() => { void retrySync() }} disabled={syncBusy} className="min-h-9 rounded-md bg-red-700 px-3 text-xs font-bold text-white disabled:opacity-50">{syncBusy ? 'Retrying...' : 'Retry'}</button>
            <button type="button" onClick={exportRecovery} className="min-h-9 rounded-md border border-red-300 bg-white px-3 text-xs font-bold text-red-700">Export</button>
          </div>
        ) : null}

        {state.cloudSync.gameId && (
          <button
            type="button"
            onClick={() => {
              setRecordersOpen(true)
              void refreshRecorders()
            }}
            className="mx-4 mt-4 flex min-h-12 items-center gap-3 border-y border-slate-200 bg-white px-1 text-left"
          >
            <Users size={19} className="shrink-0 text-emerald-700" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-slate-800">
                {recordersLoading
                  ? 'Loading recorder streams...'
                  : `${recorders.length} ${recorders.length === 1 ? 'recorder' : 'recorders'}`}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {primaryRecorder
                  ? `Primary: ${primaryRecorder.displayName}`
                  : 'Primary recorder pending'}
              </span>
            </span>
            {recorders.some(recorder => !recorder.checkpointCurrent) && (
              <BadgeAlert size={17} className="shrink-0 text-amber-600" />
            )}
          </button>
        )}

        {!healthy && mainTab !== 'timeline' && (
          <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3">
            <p className="text-sm font-bold text-red-800">Live controls are locked</p>
            <p className="text-xs text-red-700 mt-1">Correct the diagnosed match timeline before recording more events.</p>
          </div>
        )}

        <nav className="grid grid-cols-3 border-b border-slate-200 bg-white" aria-label="Soccer tracker views">
          <TabButton active={mainTab === 'field'} label={shootoutActive ? 'Shootout' : 'Field'} icon={shootoutActive ? <Goal size={17} /> : <Map size={17} />} onClick={() => setMainTab('field')} />
          <TabButton active={mainTab === 'lineup'} label="Lineup" icon={<Users size={17} />} onClick={() => setMainTab('lineup')} />
          <TabButton active={mainTab === 'timeline'} label="Timeline" icon={<History size={17} />} onClick={() => setMainTab('timeline')} />
        </nav>

        <div className="px-4 py-5">
          {mainTab === 'field' && shootoutActive ? (
            <div className="space-y-6">
              <SoccerShootoutWorkspace
                state={state}
                inspection={inspection}
                recorderUserId={user?.id ?? null}
                busy={isApplying}
                onApply={applyResult}
                onCard={() => setShootoutManagement('card')}
                onGoalkeeper={() => setShootoutManagement('goalkeeper')}
                onEligibility={() => setShootoutManagement('eligibility')}
              />
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase text-slate-500">Normal match field review</h2>
                <SoccerField
                  trackedDirection={projection.attackingDirection}
                  captureSide={capturePreferences.teamSide}
                  flipped={fieldFlipped}
                  disabled
                  markers={fieldMarkers}
                  onFlip={() => setFieldFlipped(value => !value)}
                  onLocation={() => {}}
                  onMarker={eventId => {
                    const event = inspection.activeEvents.find(candidate => candidate.id === eventId)
                    if (event) editFieldEvent(event)
                  }}
                  onCluster={setClusterEventIds}
                />
              </section>
            </div>
          ) : mainTab === 'field' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 rounded-md bg-slate-200 p-1">
                <ModeButton active={capturePreferences.teamSide === 'tracked'} label="Tracked" onClick={() => setCaptureSide('tracked')} />
                <ModeButton active={capturePreferences.teamSide === 'opponent'} label="Opponent" onClick={() => setCaptureSide('opponent')} />
              </div>

              <div>
                <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">Field capture</p>
                <div className="grid grid-cols-3 rounded-md bg-slate-200 p-1">
                  <ModeButton active={capturePreferences.captureMode === 'shot'} label="Shot" onClick={() => setCaptureMode('shot')} />
                  <ModeButton active={capturePreferences.captureMode === 'defense'} label="Defense" onClick={() => setCaptureMode('defense')} />
                  <ModeButton active={capturePreferences.captureMode === 'foul'} label="Foul" onClick={() => setCaptureMode('foul')} />
                </div>
              </div>

              <SoccerField
                trackedDirection={projection.attackingDirection}
                captureSide={capturePreferences.teamSide}
                flipped={fieldFlipped}
                disabled={!fieldCaptureEnabled}
                markers={fieldMarkers}
                onFlip={() => setFieldFlipped(value => !value)}
                onLocation={location => {
                  if (capturePreferences.captureMode === 'shot') {
                    setCaptureDraft({ teamSide: capturePreferences.teamSide, location })
                  } else {
                    openIncident(capturePreferences.captureMode, location)
                  }
                }}
                onMarker={eventId => {
                  const event = inspection.activeEvents.find(candidate => candidate.id === eventId)
                  if (event) editFieldEvent(event)
                }}
                onCluster={setClusterEventIds}
              />

              <div className="grid grid-cols-4 gap-2" role="group" aria-label="Quick capture">
                <QuickCaptureButton
                  label="Goal"
                  icon={<Goal size={18} />}
                  disabled={!fieldCaptureEnabled}
                  onClick={() => {
                    setCaptureDraft({
                      teamSide: capturePreferences.teamSide,
                      location: null,
                      outcome: 'goal',
                    })
                  }}
                />
                <QuickCaptureButton
                  label="Foul"
                  icon={<FlagTriangleRight size={18} />}
                  disabled={!fieldCaptureEnabled}
                  onClick={() => openIncident('foul', null)}
                />
                <QuickCaptureButton
                  label="Card"
                  icon={<BadgeAlert size={18} />}
                  disabled={!fieldCaptureEnabled}
                  onClick={() => openIncident('card', null)}
                />
                <QuickCaptureButton
                  label="Team"
                  icon={<Flag size={18} />}
                  disabled={!fieldCaptureEnabled}
                  onClick={() => openIncident('team_event', null)}
                />
              </div>

              {!ended && (
                <div className="grid grid-cols-[minmax(0,1fr)_3rem] gap-2" role="group" aria-label="Field match actions">
                  <button
                    type="button"
                    onClick={() => openDialog('substitution')}
                    disabled={!substitutionActionEnabled}
                    className="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-md border border-emerald-700 bg-emerald-50 px-3 text-sm font-bold text-emerald-800 disabled:border-slate-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:opacity-50"
                  >
                    <Repeat2 size={18} />
                    <span className="truncate">Substitution</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionsOpen(true)}
                    disabled={!healthy || isApplying || cloudFinal}
                    className="grid min-h-12 w-12 place-items-center rounded-md border border-slate-300 bg-white text-slate-700 disabled:opacity-40"
                    aria-label="More match actions"
                    title="More match actions"
                  >
                    <MoreHorizontal size={20} />
                  </button>
                </div>
              )}

              <details className="border-y border-slate-200 py-2">
                <summary className="cursor-pointer text-sm font-semibold text-slate-600">
                  Marker filters <span className="font-normal text-slate-500">· {markerFilterSummary}</span>
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">Marker family</p>
                    <div className="grid grid-cols-4 rounded-md bg-slate-200 p-1">
                      <ModeButton active={markerFamilyFilter === 'all'} label="All" onClick={() => setMarkerFamilyFilter('all')} />
                      <ModeButton active={markerFamilyFilter === 'shots'} label="Shots" onClick={() => setMarkerFamilyFilter('shots')} />
                      <ModeButton active={markerFamilyFilter === 'defense'} label="Defense" onClick={() => setMarkerFamilyFilter('defense')} />
                      <ModeButton active={markerFamilyFilter === 'incidents'} label="Incidents" onClick={() => setMarkerFamilyFilter('incidents')} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">Marker side</p>
                      <div className="grid grid-cols-3 rounded-md bg-slate-200 p-1">
                        <ModeButton active={markerSideFilter === 'all'} label="All" onClick={() => setMarkerSideFilter('all')} />
                        <ModeButton active={markerSideFilter === 'tracked'} label="Tracked" onClick={() => setMarkerSideFilter('tracked')} />
                        <ModeButton active={markerSideFilter === 'opponent'} label="Opp." onClick={() => setMarkerSideFilter('opponent')} />
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">Marker period</p>
                      <div className="grid grid-cols-2 rounded-md bg-slate-200 p-1">
                        <ModeButton active={markerScope === 'current'} label="Current" onClick={() => setMarkerScope('current')} />
                        <ModeButton active={markerScope === 'match'} label="Match" onClick={() => setMarkerScope('match')} />
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          ) : mainTab === 'lineup' ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center mb-4">
                <Metric label="On field" value={`${onField.length}/${projection.currentRules.maxOnFieldPlayers}`} />
                <Metric label="Subs" value={limitValue(projection.substitutionCount, projection.currentRules.substitutionLimit)} />
                <Metric label="Windows" value={limitValue(projection.substitutionWindowCount, projection.currentRules.substitutionWindowLimit)} />
              </div>
              <div className="grid grid-cols-2 rounded-md bg-slate-200 p-1 mb-3">
                <ModeButton active={lineupTab === 'on_field'} label={`On Field (${onField.length})`} onClick={() => setLineupTab('on_field')} />
                <ModeButton active={lineupTab === 'bench'} label={`Bench (${bench.length})`} onClick={() => setLineupTab('bench')} />
              </div>
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {visibleParticipants.map(participant => (
                  <ParticipantRow
                    key={participant.participantId}
                    participant={participant}
                    projection={projection}
                    nowMs={nowMs}
                    disabled={!healthy || ended || cloudFinal}
                    canResolve={participant.playerId === null && state.players.some(player => !participants.some(item => item.playerId === player.id))}
                    onRole={() => openDialog('roles', participant.participantId)}
                    onResolve={() => openDialog('resolve', participant.participantId)}
                  />
                ))}
              </div>
              {visibleParticipants.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No participants in this view.</p>}
            </>
          ) : (
            <SoccerTimeline
              state={state}
              inspection={inspection}
              busy={isApplying}
              onApply={applyResult}
              recorderUserId={user?.id ?? null}
              defaultTeamSide={capturePreferences.teamSide}
              allowAddEvent={!projection.shootout}
              readOnly={cloudFinal}
            />
          )}
        </div>
      </main>

      {actionsOpen && (
        <ActionSheet
          status={projection.status}
          onClose={() => setActionsOpen(false)}
          onAction={openDialog}
          onDirection={() => applyResult(recordSoccerDirectionChange(
            state,
            projection.attackingDirection === 'left_to_right' ? 'right_to_left' : 'left_to_right',
            options
          ))}
        />
      )}

      <SoccerLiveActionDialog
        kind={dialogKind}
        state={state}
        recorderUserId={user?.id ?? null}
        initialParticipantId={dialogParticipantId}
        busy={isApplying}
        onApply={applyResult}
        onClose={() => {
          setDialogKind(null)
          setDialogParticipantId(null)
        }}
      />

      <SoccerShotCaptureDialog
        draft={captureDraft}
        state={state}
        recorderUserId={user?.id ?? null}
        busy={isApplying}
        onApply={applyResult}
        onClose={() => setCaptureDraft(null)}
      />

      <SoccerIncidentCaptureDialog
        draft={incidentDraft}
        state={state}
        recorderUserId={user?.id ?? null}
        busy={isApplying}
        onApply={applyResult}
        onClose={() => setIncidentDraft(null)}
      />

      {shootoutSetupOpen && (
        <SoccerShootoutSetupDialog
          state={state}
          recorderUserId={user?.id ?? null}
          busy={isApplying}
          onApply={applyResult}
          onClose={() => setShootoutSetupOpen(false)}
        />
      )}

      {shootoutManagement && (
        <SoccerShootoutManagementDialog
          kind={shootoutManagement}
          state={state}
          recorderUserId={user?.id ?? null}
          busy={isApplying}
          onApply={applyResult}
          onClose={() => setShootoutManagement(null)}
        />
      )}

      {clusterEventIds && (
        <ClusterSheet
          events={inspection.activeEvents.filter(event => clusterEventIds.includes(event.id))}
          onSelect={event => {
            setClusterEventIds(null)
            editFieldEvent(event)
          }}
          onClose={() => setClusterEventIds(null)}
        />
      )}

      {conflictOpen && cloudConflicts.length > 0 && (
        <SoccerCloudConflictDialog
          conflicts={cloudConflicts}
          busy={syncBusy}
          onResolve={resolveConflict}
          onExport={exportRecovery}
          onClose={() => setConflictOpen(false)}
        />
      )}

      <SoccerRecorderDialog
        open={recordersOpen}
        baseState={state}
        currentUserId={user?.id ?? null}
        recorders={recorders}
        onRecordersChanged={refreshRecorders}
        onClose={() => setRecordersOpen(false)}
      />

      <SoccerScoreTimelineDialog
        open={scoreTimelineOpen}
        state={state}
        inspection={inspection}
        recorderUserId={user?.id ?? null}
        initialEdit={scoreAdjustmentEdit}
        busy={isApplying}
        readOnly={cloudFinal}
        onApply={result => {
          const applied = applyResult(result)
          if (applied && result.ok && !result.inspection.complete) setScoreTimelineOpen(false)
          return applied
        }}
        onEditAttacking={event => {
          setScoreTimelineOpen(false)
          setScoreAdjustmentEdit(null)
          setCaptureDraft({
            mode: 'edit',
            teamSide: event.teamSide,
            location: event.location,
            event,
          })
        }}
        onClose={() => {
          setScoreTimelineOpen(false)
          setScoreAdjustmentEdit(null)
        }}
      />

      <ConfirmDialog
        open={confirmEndPeriod}
        title={`End ${currentSegment?.label ?? 'period'}?`}
        message="The clock will pause and the period will be marked complete."
        confirmLabel="End Period"
        cancelLabel="Keep Playing"
        destructive={false}
        onConfirm={() => {
          setConfirmEndPeriod(false)
          applyResult(endSoccerPeriod(state, options))
        }}
        onCancel={() => setConfirmEndPeriod(false)}
      />

      {reopenOpen && (
        <ReopenMatchDialog
          abandoned={projection.endReason === 'abandoned'}
          busy={isApplying}
          onClose={() => setReopenOpen(false)}
          onReopen={reason => {
            const applied = applyResult(reopenSoccerMatch(state, reason, options))
            if (applied) setReopenOpen(false)
          }}
        />
      )}
    </div>
  )
}

function soccerCloudStatusLabel(state: GameState): string {
  if (state.cloudSync.gameStatus === 'final') return 'Finalized'
  if (state.cloudSync.status === 'error') return 'Needs Attention'
  if (state.cloudSync.status === 'syncing') return 'Syncing'
  if (state.cloudSync.status === 'synced') return 'Synced'
  return 'Local'
}

function ParticipantRow({ participant, projection, nowMs, disabled, canResolve, onRole, onResolve }: {
  participant: SoccerProjectedParticipant
  projection: SoccerMatchProjection
  nowMs: number
  disabled: boolean
  canResolve: boolean
  onRole: () => void
  onResolve: () => void
}) {
  const activeMs = participantActiveMs(participant, projection, nowMs)
  return (
    <div className="min-h-16 py-2 flex items-center gap-3">
      <span className="w-8 text-center text-sm font-bold text-slate-500">{participant.number ?? '-'}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-800 truncate">{participant.displayName}</p>
        <p className="text-xs text-slate-500 capitalize truncate">
          {participant.role.label ?? participant.role.group.replace('_', ' ')} · {formatSoccerDuration(activeMs)}
          {participant.status === 'left' ? ' · Left match' : ''}
        </p>
      </div>
      {participant.role.group === 'goalkeeper' && <Shield size={16} className="text-emerald-700 shrink-0" />}
      {!disabled && (
        <div className="flex gap-1">
          {canResolve && <button type="button" onClick={onResolve} className="h-9 px-2 text-xs font-bold text-blue-600" title="Resolve participant">Resolve</button>}
          {participant.status !== 'left' && <button type="button" onClick={onRole} className="h-9 px-2 text-xs font-bold text-slate-600">Role</button>}
        </div>
      )}
    </div>
  )
}

function ActionSheet({ status, onClose, onAction, onDirection }: {
  status: SoccerMatchProjection['status']
  onClose: () => void
  onAction: (kind: SoccerLiveDialogKind) => void
  onDirection: () => void
}) {
  const standardActions: Array<{ kind: SoccerLiveDialogKind; label: string; icon: ReactNode }> = [
    { kind: 'substitution', label: 'Substitutions', icon: <Repeat2 size={20} /> },
    { kind: 'roles', label: 'Roles', icon: <Users size={20} /> },
    { kind: 'clock', label: 'Correct clock', icon: <TimerReset size={20} /> },
    { kind: 'participant', label: 'Add participant', icon: <UserPlus size={20} /> },
    { kind: 'rules', label: 'Match rules', icon: <SlidersHorizontal size={20} /> },
    { kind: 'end', label: 'End match', icon: <Flag size={20} /> },
  ]
  const standardControls = soccerMatchActionsAvailable({ status })
  const actions = standardControls
    ? standardActions
    : [{ kind: 'end' as const, label: 'Match status', icon: <Flag size={20} /> }]
  return (
    <div className="fixed inset-0 z-40 bg-black/45 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-lg sm:rounded-lg p-4" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h2 className="font-bold text-slate-800">Match Actions</h2><button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button></div>
        <div className="grid grid-cols-2 gap-2">
          {actions.map(action => <button key={action.kind} type="button" onClick={() => onAction(action.kind)} className="min-h-16 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 flex items-center gap-3">{action.icon}{action.label}</button>)}
          {standardControls && <button type="button" onClick={onDirection} className="min-h-16 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 flex items-center gap-3"><Compass size={20} />Switch direction</button>}
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`h-12 flex items-center justify-center gap-2 text-sm font-bold border-b-2 ${active ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-slate-500'}`}>{icon}{label}</button>
}

function ModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`h-9 rounded text-xs font-semibold ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{label}</button>
}

function QuickCaptureButton({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-1 text-[11px] font-bold text-slate-700 disabled:opacity-40">
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-slate-200 bg-white px-2 py-2"><p className="font-bold text-slate-800 tabular-nums">{value}</p><p className="text-[11px] text-slate-500">{label}</p></div>
}

function limitValue(used: number, limit: number | null): string {
  return limit === null ? `${used}/-` : `${used}/${limit}`
}

function ReopenMatchDialog({ abandoned, busy, onClose, onReopen }: { abandoned: boolean; busy: boolean; onClose: () => void; onReopen: (reason: string | null) => void }) {
  const [reason, setReason] = useState('')
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}><div role="dialog" aria-modal="true" aria-label="Reopen match" className="w-full rounded-t-lg bg-white p-4 sm:max-w-md sm:rounded-lg" onClick={event => event.stopPropagation()}><div className="mb-3 flex items-center gap-3"><h2 className="flex-1 font-bold text-slate-900">Reopen Match</h2><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button></div><p className="mb-3 text-sm text-slate-600">Reopening returns the match to its last valid correction point.</p><label className="block text-xs font-bold uppercase text-slate-500">Reason {abandoned ? '(required)' : '(optional)'}<textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} className="input-field mt-1 resize-none" /></label><button type="button" disabled={busy || (abandoned && !reason.trim())} onClick={() => onReopen(reason.trim() || null)} className="mt-4 min-h-12 w-full rounded-md bg-slate-800 text-sm font-bold text-white disabled:opacity-40">Reopen Match</button></div></div>
}

function matchResultLabel(projection: SoccerMatchProjection, trackedName: string, opponentName: string): string {
  if (projection.result === 'draw') return 'Draw'
  if (projection.result === 'abandoned') return 'Match abandoned'
  if (projection.result === 'tracked_win') return `${trackedName} won${projection.decidedStage === 'shootout' ? ' on shootout' : ''}`
  if (projection.result === 'opponent_win') return `${opponentName} won${projection.decidedStage === 'shootout' ? ' on shootout' : ''}`
  return 'Result unresolved'
}

function markerLabel(event: GameEvent): string {
  const side = event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'
  if (event.eventType === 'soccer.own_goal') return `Own goal, ${side.toLowerCase()} side benefits`
  if (event.eventType === 'soccer.defensive_action') {
    const payload = event.payload as { action: string; tackleOutcome: string | null }
    const detail = payload.action === 'tackle' ? ` ${payload.tackleOutcome}` : ''
    return `${side} ${payload.action.replace('_', ' ')}${detail}`
  }
  if (event.eventType === 'soccer.foul') return `${side} foul`
  if (event.eventType === 'soccer.card') {
    return `${side} ${(event.payload as { sanction: string }).sanction.replace(/_/g, ' ')}`
  }
  if (event.eventType === 'soccer.team_event') {
    return soccerTeamEventReviewPresentation(event).label
  }
  const payload = event.payload as { outcome?: unknown }
  const outcome = typeof payload.outcome === 'string' ? payload.outcome.replace('_', ' ') : 'shot'
  const shooter = event.actors.find(actor => actor.role === 'shooter')
  return `${side} ${outcome}${shooter?.label ? ` by ${shooter.label}` : ''}`
}

function markerKind(event: GameEvent): SoccerFieldMarkerKind {
  if (event.eventType === 'soccer.own_goal') return 'own_goal'
  if (event.eventType === 'soccer.shot') {
    return (event.payload as { outcome: SoccerFieldMarkerKind }).outcome
  }
  if (event.eventType === 'soccer.defensive_action') {
    const payload = event.payload as { action: string; tackleOutcome: string | null }
    return payload.action === 'tackle'
      ? payload.tackleOutcome === 'won' ? 'tackle_won' : 'tackle_lost'
      : payload.action as SoccerFieldMarkerKind
  }
  if (event.eventType === 'soccer.foul') return 'foul'
  if (event.eventType === 'soccer.card') {
    return (event.payload as { sanction: string }).sanction === 'yellow' ? 'yellow_card' : 'red_card'
  }
  if (event.eventType === 'soccer.team_event') {
    return (event.payload as { kind: SoccerFieldMarkerKind }).kind
  }
  return 'saved'
}

function isIncidentEvent(event: GameEvent): event is SoccerIncidentEvent {
  return event.eventType === 'soccer.defensive_action' ||
    event.eventType === 'soccer.foul' ||
    event.eventType === 'soccer.card' ||
    event.eventType === 'soccer.team_event'
}

function incidentKind(event: SoccerIncidentEvent): SoccerIncidentKind {
  if (event.eventType === 'soccer.defensive_action') return 'defense'
  if (event.eventType === 'soccer.team_event') return 'team_event'
  return event.eventType === 'soccer.foul' ? 'foul' : 'card'
}

function ClusterSheet({ events, onSelect, onClose }: { events: GameEvent[]; onSelect: (event: GameEvent) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="w-full rounded-t-lg bg-white p-4 sm:max-w-md sm:rounded-lg" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-slate-800">Events at this location</h2><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button></div>
        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {events.map(event => <button key={event.id} type="button" onClick={() => onSelect(event)} className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left"><span className="truncate text-sm font-semibold text-slate-800">{markerLabel(event)}</span><span className="text-xs font-bold text-emerald-700">Edit</span></button>)}
        </div>
      </div>
    </div>
  )
}
