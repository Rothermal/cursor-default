import {
  Check,
  CircleDot,
  ShieldCheck,
  Target,
  X,
  XCircle,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import {
  soccerSummaryShootoutReview,
  type SoccerShootoutAttemptReview,
  type SoccerShootoutKickerSummary,
  type SoccerShootoutReview as SoccerShootoutReviewModel,
} from '../../lib/soccer'
import type { SoccerSummarySource } from '../../lib/soccer/summarySource'
import { gameSideDisplayName } from '../../lib/display'

interface SoccerShootoutReviewProps {
  source: SoccerSummarySource
}

export default function SoccerShootoutReview({
  source,
}: SoccerShootoutReviewProps) {
  const [selected, setSelected] =
    useState<SoccerShootoutAttemptReview | null>(null)
  const review = useMemo(() => {
    const soccerState = source.state.sportGameState?.sportId === 'soccer'
      ? source.state.sportGameState
      : null
    return soccerState
      ? soccerSummaryShootoutReview(soccerState.projection, source.inspection)
      : null
  }, [source])
  if (!review) return null

  const trackedName = gameSideDisplayName(source.state.gameInfo, 'tracked')
  const opponentName = gameSideDisplayName(source.state.gameInfo, 'opponent')
  const status = shootoutStatus(review, trackedName, opponentName)

  return (
    <main className="mx-auto max-w-2xl pb-10">
      <section className="border-b border-slate-200 bg-white px-4 py-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 text-center">
          <ShootoutScore name={trackedName} score={review.score.tracked} />
          <div className="pb-1 text-xs font-bold uppercase text-slate-400">
            Shootout
          </div>
          <ShootoutScore name={opponentName} score={review.score.opponent} />
        </div>
        <p className="mt-3 text-center text-sm font-bold text-slate-700">{status}</p>
        <div className="mt-4 grid grid-cols-2 divide-x divide-slate-200 border-y border-slate-200 py-3 text-center">
          <Progress
            label={trackedName}
            value={review.initialProgress.tracked}
            total={review.initialKicksPerSide}
          />
          <Progress
            label={opponentName}
            value={review.initialProgress.opponent}
            total={review.initialKicksPerSide}
          />
        </div>
        <p className="mt-2 text-center text-xs text-slate-500">
          {sideName(review.firstKickingSide, trackedName, opponentName)} kicked first
        </p>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 px-4 py-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase text-slate-500">Rounds</h2>
          <span className="text-xs text-slate-500">
            {review.attempts.tracked}-{review.attempts.opponent} official attempts
          </span>
        </div>
        <div className="border-y border-slate-200 bg-white">
          <div className="grid grid-cols-[5.5rem_1fr_1fr] border-b border-slate-200 px-2 py-2 text-[11px] font-bold uppercase text-slate-500">
            <span>Round</span>
            <span className="text-center">{trackedName}</span>
            <span className="text-center">{opponentName}</span>
          </div>
          {review.rounds.map(round => (
            <div
              key={round.round}
              className="grid min-h-20 grid-cols-[5.5rem_1fr_1fr] border-b border-slate-200 px-2 py-3 last:border-b-0"
            >
              <div className="pr-2">
                <p className="text-xs font-bold text-slate-700">{round.label}</p>
                {round.suddenDeath && (
                  <p className="mt-1 text-[10px] font-semibold uppercase text-amber-700">
                    Sudden death
                  </p>
                )}
              </div>
              <AttemptStack
                attempts={round.tracked}
                sideLabel={trackedName}
                onSelect={setSelected}
              />
              <AttemptStack
                attempts={round.opponent}
                sideLabel={opponentName}
                onSelect={setSelected}
              />
            </div>
          ))}
          {review.rounds.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              No shootout kicks recorded.
            </p>
          )}
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white px-4 py-5">
        <h2 className="text-sm font-bold uppercase text-slate-500">
          Kicker Summary
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-y border-slate-200 text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Kicker</th>
                <th className="px-2 py-2 text-center">Att</th>
                <th className="px-2 py-2 text-center">Goals</th>
                <th className="px-2 py-2 text-center">Saved</th>
                <th className="px-2 py-2 text-center">Miss</th>
                <th className="px-2 py-2 text-center">Wood</th>
                <th className="px-2 py-2 text-center">Retake</th>
                <th className="px-2 py-2 text-center">Forfeit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {review.kickers.map(kicker => (
                <KickerRow
                  key={`${kicker.teamSide}:${kicker.key}`}
                  kicker={kicker}
                  sideLabel={sideName(kicker.teamSide, trackedName, opponentName)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white px-4 py-5">
        <h2 className="text-sm font-bold uppercase text-slate-500">
          Goalkeeper Summary
        </h2>
        <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
          {review.goalkeepers.map(goalkeeper => (
            <div
              key={`${goalkeeper.teamSide}:${goalkeeper.key}`}
              className="grid min-h-12 grid-cols-[1fr_auto_auto] items-center gap-4 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-800">
                  {goalkeeper.label}
                </p>
                <p className="text-[11px] font-semibold uppercase text-slate-500">
                  {goalkeeper.teamSide === 'tracked' ? trackedName : opponentName}
                </p>
              </div>
              <SummaryValue label="Faced" value={goalkeeper.attemptsFaced} />
              <SummaryValue label="Saves" value={goalkeeper.saves} />
            </div>
          ))}
          {review.goalkeepers.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              No goalkeeper attempts recorded.
            </p>
          )}
        </div>
      </section>

      {selected && (
        <AttemptDetail
          attempt={selected}
          trackedName={trackedName}
          opponentName={opponentName}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  )
}

function ShootoutScore({ name, score }: { name: string; score: number }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-semibold text-slate-500">{name}</p>
      <p className="mt-1 text-4xl font-bold tabular-nums text-slate-900">{score}</p>
    </div>
  )
}

function Progress({
  label,
  value,
  total,
}: {
  label: string
  value: number
  total: number
}) {
  return (
    <div className="min-w-0 px-3">
      <p className="truncate text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold tabular-nums text-slate-800">
        {value} / {total}
      </p>
    </div>
  )
}

function AttemptStack({
  attempts,
  sideLabel,
  onSelect,
}: {
  attempts: SoccerShootoutAttemptReview[]
  sideLabel: string
  onSelect: (attempt: SoccerShootoutAttemptReview) => void
}) {
  if (attempts.length === 0) {
    return <div className="grid place-items-center text-sm text-slate-300">-</div>
  }
  return (
    <div className="flex flex-col items-center gap-1 px-1">
      {attempts.map(attempt => (
        <button
          key={attempt.eventId}
          type="button"
          onClick={() => onSelect(attempt)}
          className={`flex min-h-9 w-full max-w-36 items-center justify-center gap-1 border px-2 text-[11px] font-bold ${
            outcomeTone(attempt.outcome)
          }`}
          aria-label={`${sideLabel}, ${attempt.kickerLabel}: ${attempt.outcomeLabel}`}
          title={`${attempt.kickerLabel}: ${attempt.outcomeLabel}`}
        >
          <OutcomeIcon outcome={attempt.outcome} />
          <span className="truncate">{attempt.outcomeLabel}</span>
        </button>
      ))}
    </div>
  )
}

function KickerRow({
  kicker,
  sideLabel,
}: {
  kicker: SoccerShootoutKickerSummary
  sideLabel: string
}) {
  return (
    <tr>
      <td className="max-w-48 px-2 py-2">
        <p className="truncate font-semibold text-slate-800">{kicker.label}</p>
        <p className="text-[10px] font-bold uppercase text-slate-400">
          {sideLabel}
        </p>
      </td>
      {[
        kicker.attempts,
        kicker.scores,
        kicker.savesAgainst,
        kicker.misses,
        kicker.woodwork,
        kicker.retakes,
        kicker.forfeits,
      ].map((value, index) => (
        <td key={index} className="px-2 py-2 text-center tabular-nums text-slate-700">
          {value}
        </td>
      ))}
    </tr>
  )
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="w-12 text-center">
      <p className="text-base font-bold tabular-nums text-slate-800">{value}</p>
      <p className="text-[10px] font-semibold uppercase text-slate-400">{label}</p>
    </div>
  )
}

function AttemptDetail({
  attempt,
  trackedName,
  opponentName,
  onClose,
}: {
  attempt: SoccerShootoutAttemptReview
  trackedName: string
  opponentName: string
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shootout attempt detail"
        className="w-full rounded-t-lg bg-white p-4 sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">{attempt.outcomeLabel}</h2>
            <p className="text-xs text-slate-500">
              {attempt.suddenDeath ? 'Sudden death' : `Round ${attempt.round}`}
              {attempt.advances ? ` - official kick ${attempt.kickNumber}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center text-slate-500"
            aria-label="Close"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>
        <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
          <DetailRow
            label="Side"
            value={sideName(attempt.teamSide, trackedName, opponentName)}
          />
          <DetailRow label="Kicker" value={attempt.kickerLabel} />
          <DetailRow label="Goalkeeper" value={attempt.goalkeeperLabel} />
          <DetailRow
            label="Revision"
            value={attempt.event ? String(attempt.event.revision) : 'Unavailable'}
          />
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Shootout corrections continue through the owned local tracker.
        </p>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 py-2 text-sm">
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="text-right font-bold text-slate-800">{value}</dd>
    </div>
  )
}

function OutcomeIcon({ outcome }: { outcome: SoccerShootoutAttemptReview['outcome'] }) {
  const icons: Record<SoccerShootoutAttemptReview['outcome'], ReactNode> = {
    scored: <Check size={14} />,
    saved: <ShieldCheck size={14} />,
    missed: <XCircle size={14} />,
    woodwork: <Target size={14} />,
    retake: <CircleDot size={14} />,
    forfeited: <X size={14} />,
  }
  return icons[outcome]
}

function outcomeTone(outcome: SoccerShootoutAttemptReview['outcome']): string {
  if (outcome === 'scored') return 'border-emerald-300 bg-emerald-50 text-emerald-800'
  if (outcome === 'saved') return 'border-blue-300 bg-blue-50 text-blue-800'
  if (outcome === 'retake') return 'border-violet-300 bg-violet-50 text-violet-800'
  if (outcome === 'forfeited') return 'border-red-300 bg-red-50 text-red-800'
  if (outcome === 'woodwork') return 'border-amber-300 bg-amber-50 text-amber-800'
  return 'border-slate-300 bg-white text-slate-700'
}

function sideName(
  side: 'tracked' | 'opponent',
  trackedName: string,
  opponentName: string
): string {
  return side === 'tracked' ? trackedName : opponentName
}

function shootoutStatus(
  review: SoccerShootoutReviewModel,
  trackedName: string,
  opponentName: string
): string {
  if (review.decided) {
    return `${review.winner === 'tracked' ? trackedName : opponentName} wins`
  }
  if (review.endReason === 'abandoned') return 'Shootout abandoned'
  if (review.matchStatus === 'suspended') return 'Shootout suspended'
  if (review.suddenDeathRound) {
    return `Sudden death - round ${review.suddenDeathRound}`
  }
  return `${sideName(review.nextSide, trackedName, opponentName)} kicks next`
}
