import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronLeft,
  Compass,
  Flag,
  History,
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
import SoccerLiveActionDialog, {
  type SoccerLiveDialogKind,
} from '../components/soccer/SoccerLiveActionDialog'
import SoccerMatchHistory from '../components/soccer/SoccerMatchHistory'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import {
  endSoccerPeriod,
  formatSoccerDuration,
  inspectSoccerHistory,
  orderedSoccerSegments,
  participantActiveMs,
  recordSoccerDirectionChange,
  reopenSoccerMatch,
  soccerClockDisplayValue,
  startNextSoccerPeriod,
  toggleSoccerClock,
  type SoccerLiveResult,
  type SoccerMatchProjection,
  type SoccerProjectedParticipant,
} from '../lib/soccer'
import { sportDashboardPath } from '../lib/sportNavigation'

type MainTab = 'lineup' | 'history'
type LineupTab = 'on_field' | 'bench'

export default function SoccerGameTracker() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const { user } = useAuth()
  const soccerState = state.sportGameState?.sportId === 'soccer'
    ? state.sportGameState
    : null
  const projection = soccerState?.projection ?? null
  const [nowMs, setNowMs] = useState(Date.now())
  const [mainTab, setMainTab] = useState<MainTab>('lineup')
  const [lineupTab, setLineupTab] = useState<LineupTab>('on_field')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [dialogKind, setDialogKind] = useState<SoccerLiveDialogKind | null>(null)
  const [dialogParticipantId, setDialogParticipantId] = useState<string | null>(null)
  const [confirmEndPeriod, setConfirmEndPeriod] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
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

  const inspection = useMemo(() => inspectSoccerHistory(state), [state])
  const clockValue = soccerClockDisplayValue(state, nowMs)
  const segments = projection ? orderedSoccerSegments(projection.currentRules) : []
  const currentSegment = segments.find(segment => segment.id === projection?.currentPeriodId) ?? null
  const nextSegment = projection
    ? segments.find(segment => !projection.completedPeriodIds.includes(segment.id)) ?? null
    : null

  if (invalidRoute || !state.gameInfo || !soccerState || !projection || !clockValue) return null

  const healthy = inspection.complete
  const ended = projection.status === 'ended'
  const options = { recorderUserId: user?.id ?? null }
  const participants = Object.values(projection.participants)
  const onField = participants.filter(participant => participant.status === 'on_field')
  const bench = participants.filter(participant => participant.status !== 'on_field')
  const visibleParticipants = lineupTab === 'on_field' ? onField : bench

  const applyResult = (result: SoccerLiveResult): boolean => {
    if (applyingRef.current) return false
    if (!result.ok) {
      setError(result.message)
      return false
    }
    applyingRef.current = true
    setIsApplying(true)
    dispatch({ type: 'HYDRATE_STATE', state: result.state })
    setError(null)
    setDialogKind(null)
    setDialogParticipantId(null)
    setActionsOpen(false)
    if (!result.inspection.complete) setMainTab('history')
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
    <div className="min-h-screen bg-slate-50 pb-8" aria-busy={isApplying}>
      {isApplying && <div className="fixed inset-0 z-[70] cursor-wait" aria-hidden="true" />}
      <header className="bg-emerald-800 text-white px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button type="button" onClick={() => navigate(sportDashboardPath('soccer'))} className="h-9 w-9 grid place-items-center rounded-md bg-white/15" aria-label="Back to soccer dashboard" title="Back">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-bold truncate">{state.gameInfo.teamName} vs {state.gameInfo.opponentName}</h1>
            <p className="text-xs text-emerald-100 truncate">
              {currentSegment?.label ?? (ended ? 'Match ended' : nextSegment ? `${nextSegment.label} next` : 'Periods complete')}
            </p>
          </div>
          {!ended && (
            <button type="button" onClick={() => setActionsOpen(true)} disabled={!healthy || isApplying} className="h-9 w-9 grid place-items-center rounded-md bg-white/15 disabled:opacity-40" aria-label="Match actions" title="Match actions">
              <MoreHorizontal size={21} />
            </button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto">
        <section className="px-4 py-6 text-center border-b border-slate-200 bg-white">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase text-slate-500 mb-2">
            <span>{currentSegment?.label ?? (ended ? 'Final' : 'Break')}</span>
            <span className={`h-2 w-2 rounded-full ${projection.clock.running ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span>{projection.clock.running ? 'Running' : 'Stopped'}</span>
          </div>
          <div className="min-h-[4.5rem] flex items-baseline justify-center gap-2">
            <p className="text-6xl font-bold text-slate-900 tabular-nums tracking-normal leading-none">{clockValue.primary}</p>
            {clockValue.overrun && <span className="text-xl font-bold text-amber-600 tabular-nums">{clockValue.overrun}</span>}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {projection.currentRules.clockDirection === 'count_up' ? 'Count up' : 'Count down'} · {projection.currentRules.clockDisplay === 'continuous' ? 'Match time' : 'Period time'}
          </p>

          {!healthy ? (
            <button type="button" onClick={() => setMainTab('history')} className="mt-5 w-full rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              Review History Issues
            </button>
          ) : ended ? (
            <button type="button" onClick={() => applyResult(reopenSoccerMatch(state, 'Recorder reopened match', options))} className="mt-5 w-full rounded-md bg-slate-800 px-4 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
              <RotateCcw size={18} /> Reopen Match
            </button>
          ) : projection.status === 'period_break' ? (
            <div className="mt-5 grid grid-cols-2 gap-2">
              {nextSegment ? (
                <button type="button" onClick={() => applyResult(startNextSoccerPeriod(state, options))} className="rounded-md bg-emerald-700 px-4 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
                  <Play size={18} /> Start {nextSegment.label}
                </button>
              ) : <span />}
              <button type="button" onClick={() => openDialog('end')} className="rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 flex items-center justify-center gap-2">
                <Flag size={18} /> End Match
              </button>
            </div>
          ) : (
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

        {!healthy && mainTab !== 'history' && (
          <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3">
            <p className="text-sm font-bold text-red-800">Live controls are locked</p>
            <p className="text-xs text-red-700 mt-1">Correct the diagnosed match history before recording more events.</p>
          </div>
        )}

        <nav className="grid grid-cols-2 border-b border-slate-200 bg-white" aria-label="Soccer tracker views">
          <TabButton active={mainTab === 'lineup'} label="Lineup" icon={<Users size={17} />} onClick={() => setMainTab('lineup')} />
          <TabButton active={mainTab === 'history'} label="History" icon={<History size={17} />} onClick={() => setMainTab('history')} />
        </nav>

        <div className="px-4 py-5">
          {mainTab === 'lineup' ? (
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
                    disabled={!healthy || ended}
                    canResolve={participant.playerId === null && state.players.some(player => !participants.some(item => item.playerId === player.id))}
                    onRole={() => openDialog('roles', participant.participantId)}
                    onResolve={() => openDialog('resolve', participant.participantId)}
                  />
                ))}
              </div>
              {visibleParticipants.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No participants in this view.</p>}
            </>
          ) : (
            <SoccerMatchHistory state={state} inspection={inspection} busy={isApplying} onApply={applyResult} />
          )}
        </div>
      </main>

      {actionsOpen && (
        <ActionSheet
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
    </div>
  )
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

function ActionSheet({ onClose, onAction, onDirection }: {
  onClose: () => void
  onAction: (kind: SoccerLiveDialogKind) => void
  onDirection: () => void
}) {
  const actions: Array<{ kind: SoccerLiveDialogKind; label: string; icon: ReactNode }> = [
    { kind: 'substitution', label: 'Substitutions', icon: <Repeat2 size={20} /> },
    { kind: 'roles', label: 'Roles', icon: <Users size={20} /> },
    { kind: 'clock', label: 'Correct clock', icon: <TimerReset size={20} /> },
    { kind: 'participant', label: 'Add participant', icon: <UserPlus size={20} /> },
    { kind: 'rules', label: 'Match rules', icon: <SlidersHorizontal size={20} /> },
    { kind: 'end', label: 'End match', icon: <Flag size={20} /> },
  ]
  return (
    <div className="fixed inset-0 z-40 bg-black/45 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-lg sm:rounded-lg p-4" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h2 className="font-bold text-slate-800">Match Actions</h2><button type="button" onClick={onClose} className="h-9 w-9 grid place-items-center text-slate-500" aria-label="Close" title="Close"><X size={20} /></button></div>
        <div className="grid grid-cols-2 gap-2">
          {actions.map(action => <button key={action.kind} type="button" onClick={() => onAction(action.kind)} className="min-h-16 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 flex items-center gap-3">{action.icon}{action.label}</button>)}
          <button type="button" onClick={onDirection} className="min-h-16 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 flex items-center gap-3"><Compass size={20} />Switch direction</button>
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

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-slate-200 bg-white px-2 py-2"><p className="font-bold text-slate-800 tabular-nums">{value}</p><p className="text-[11px] text-slate-500">{label}</p></div>
}

function limitValue(used: number, limit: number | null): string {
  return limit === null ? `${used}/-` : `${used}/${limit}`
}
