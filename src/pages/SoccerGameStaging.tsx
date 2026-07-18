import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Shield } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { elapsedSoccerClockMs } from '../lib/soccer'
import { sportDashboardPath } from '../lib/sportNavigation'

export default function SoccerGameStaging() {
  const navigate = useNavigate()
  const { state } = useGame()
  const soccerState = state.sportGameState?.sportId === 'soccer'
    ? state.sportGameState
    : null
  const projection = soccerState?.projection ?? null
  const [nowMs, setNowMs] = useState(Date.now())

  useEffect(() => {
    if (!projection?.clock.running) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [projection?.clock.running])

  const period = useMemo(() => {
    if (!soccerState) return null
    const rules = soccerState.setup.rulesSnapshot
    return [...rules.regulationSegments, ...rules.extraTimeSegments]
      .find(segment => segment.id === projection?.currentPeriodId) ?? null
  }, [projection?.currentPeriodId, soccerState])

  if (!state.sport || state.sport.id !== 'soccer' || !state.gameInfo || !soccerState || !projection) {
    navigate('/setup')
    return null
  }

  const elapsedMs = elapsedSoccerClockMs(projection, nowMs)
  const onField = Object.values(projection.participants).filter(participant => participant.status === 'on_field')
  const bench = Object.values(projection.participants).filter(participant => participant.status === 'bench')

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-emerald-800 text-white px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button type="button" onClick={() => navigate(sportDashboardPath('soccer'))} className="h-9 w-9 grid place-items-center rounded-md bg-white/15" aria-label="Back to soccer dashboard" title="Back">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="font-bold truncate">{state.gameInfo.teamName} vs {state.gameInfo.opponentName}</h1>
            <p className="text-sm text-emerald-100">{period?.label ?? 'Match'}</p>
          </div>
          <span className="ml-auto rounded bg-white/15 px-2 py-1 text-xs font-semibold">
            {projection.clock.running ? 'Running' : 'Stopped'}
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <section className="text-center py-5 border-b border-slate-200">
          <p className="text-5xl font-bold text-slate-900 tabular-nums tracking-normal">
            {formatElapsed(elapsedMs)}
          </p>
          <p className="text-sm text-slate-500 mt-2">
            {projection.attackingDirection === 'left_to_right' ? 'Attacking left to right' : 'Attacking right to left'}
          </p>
        </section>

        <LineupSection title="On Field" participants={onField} />
        <LineupSection title="Bench" participants={bench} />
      </main>
    </div>
  )
}

function LineupSection({ title, participants }: {
  title: string
  participants: Array<{
    participantId: string
    displayName: string
    number: string | null
    role: { group: string; label: string | null }
  }>
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold uppercase text-slate-500">{title}</h2>
        <span className="text-xs text-slate-400">{participants.length}</span>
      </div>
      <div className="divide-y divide-slate-200 border-y border-slate-200">
        {participants.map(participant => (
          <div key={participant.participantId} className="min-h-12 flex items-center gap-3 py-2">
            <span className="w-8 text-center text-sm font-bold text-slate-500">{participant.number ?? '-'}</span>
            <span className="min-w-0 flex-1 font-medium text-slate-800 truncate">{participant.displayName}</span>
            {participant.role.group === 'goalkeeper' && <Shield size={16} className="text-emerald-700" />}
            <span className="text-xs text-slate-500 capitalize">{participant.role.label ?? participant.role.group}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
