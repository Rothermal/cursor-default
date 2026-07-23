import { ChevronLeft, History, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import SoccerFinalizationPanel from '../components/soccer/SoccerFinalizationPanel'
import SoccerRecorderDialog from '../components/soccer/SoccerRecorderDialog'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { hasUnsyncedParkedBindingForCloudGame } from '../lib/gameParking'
import { formatSoccerDuration } from '../lib/soccer'
import type {
  SoccerRecorderProjection,
  SoccerRecorderSummary,
} from '../lib/soccer/recorders'
import {
  loadSoccerCanonicalOrPrimaryReview,
  type SoccerCanonicalPublication,
} from '../lib/soccer/finalization'

export default function SoccerCloudReview() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { flushCloudSync, markSoccerCloudGameReopened } = useGame()
  const gameId = searchParams.get('gameId')
  const [primary, setPrimary] = useState<SoccerRecorderProjection | null>(null)
  const [publication, setPublication] = useState<SoccerCanonicalPublication | null>(null)
  const [recorders, setRecorders] = useState<SoccerRecorderSummary[]>([])
  const [recordersOpen, setRecordersOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!gameId) {
      setError('Choose a soccer game to review.')
      setLoading(false)
      return
    }
    if (!primary) setLoading(true)
    setError(null)
    try {
      const result = await loadSoccerCanonicalOrPrimaryReview(gameId)
      setPrimary(result.primary)
      setRecorders(result.recorders)
      setPublication(result.publication)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Soccer game could not load.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Loading review...</div>
  }

  if (!primary || error) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-emerald-800 px-4 py-3 text-white">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="grid h-9 w-9 place-items-center"
              aria-label="Back"
              title="Back"
            >
              <ChevronLeft size={22} />
            </button>
            <h1 className="font-bold">Soccer Game Review</h1>
          </div>
        </header>
        <p className="mx-auto max-w-2xl px-4 py-8 text-sm text-red-700">
          {error ?? 'No primary recorder is available.'}
        </p>
      </div>
    )
  }

  const soccerState =
    primary.state.sportGameState?.sportId === 'soccer'
      ? primary.state.sportGameState
      : null
  const events = [
    ...primary.inspection.activeEvents,
    ...primary.inspection.deletedEvents,
  ].sort((a, b) => b.sequence - a.sequence)

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-emerald-800 px-4 py-3 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="grid h-9 w-9 place-items-center"
            aria-label="Back"
            title="Back"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-bold">
              {primary.state.gameInfo?.teamName} vs {primary.state.gameInfo?.opponentName}
            </h1>
            <p className="truncate text-xs text-emerald-100">
              {publication ? 'Canonical final' : 'Read-only primary stream'} |{' '}
              {primary.recorder.displayName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRecordersOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-md bg-white/15"
            aria-label="Recorder streams"
            title="Recorder streams"
          >
            <Users size={20} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl bg-white">
        <section className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 py-5 text-center">
          <div>
            <p className="text-4xl font-bold text-emerald-800">
              {primary.state.homeTeamScore ?? 0}
            </p>
            <p className="mt-1 truncate px-2 text-xs text-slate-500">
              {primary.state.gameInfo?.teamName}
            </p>
          </div>
          <div className="grid place-items-center px-2">
            <div>
              <p className="text-sm font-bold capitalize text-slate-800">
                {soccerState?.projection.status.replace(/_/g, ' ') ?? 'Unknown'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {primary.inspection.complete ? 'Healthy primary' : 'Needs attention'}
              </p>
            </div>
          </div>
          <div>
            <p className="text-4xl font-bold text-slate-800">{primary.state.opponentScore}</p>
            <p className="mt-1 truncate px-2 text-xs text-slate-500">
              {primary.state.gameInfo?.opponentName}
            </p>
          </div>
        </section>

        {(publication || soccerState?.projection.status === 'ended') && (
          <SoccerFinalizationPanel
            baseState={primary.state}
            currentUserId={user?.id ?? null}
            refreshKey={publication?.finalizedAt ?? primary.state.cloudSync.lastSyncedAt}
            flushCloudSync={async () => {
              const result = await flushCloudSync()
              if (!result.ok) return result
              if (
                user?.id &&
                hasUnsyncedParkedBindingForCloudGame(user.id, gameId!)
              ) {
                return {
                  ok: false,
                  reason: 'A local primary stream for this game still has unsynced changes.',
                }
              }
              return { ok: true }
            }}
            onFinalized={() => { void refresh() }}
            onReopened={() => {
              markSoccerCloudGameReopened(gameId!)
              navigate('/games?sport=soccer', { replace: true })
            }}
          />
        )}

        {!primary.inspection.complete && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This primary stream has projection issues and is not ready for finalization.
          </div>
        )}

        <section>
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <History size={18} className="text-slate-500" />
            <h2 className="text-sm font-bold text-slate-800">Primary Timeline</h2>
          </div>
          <div className="divide-y divide-slate-100 px-4">
            {events.map(event => (
              <div key={event.id} className="flex min-h-11 items-center gap-3 py-2 text-xs">
                <span className="w-16 shrink-0 font-semibold tabular-nums text-slate-500">
                  {event.period.id}{' '}
                  {event.elapsedMs === null ? '' : formatSoccerDuration(event.elapsedMs)}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-slate-700 ${
                    event.deletedAt ? 'line-through opacity-50' : ''
                  }`}
                >
                  {event.eventType.replace('soccer.', '').replace(/_/g, ' ')}
                </span>
                <span className="capitalize text-slate-400">{event.teamSide}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SoccerRecorderDialog
        open={recordersOpen}
        baseState={primary.state}
        currentUserId={user?.id ?? null}
        recorders={recorders}
        onRecordersChanged={refresh}
        onClose={() => setRecordersOpen(false)}
      />
    </div>
  )
}
