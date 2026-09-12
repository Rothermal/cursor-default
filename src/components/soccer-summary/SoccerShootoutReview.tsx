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

  const trackedName = source.state.gameInfo?.teamName ?? 'Tracked'
  const opponentName = source.state.gameInfo?.opponentName ?? 'Opponent'
  const status = shootoutStatus(review, trackedName, opponentName)

  return (
    <main className="mx-auto max-w-2xl pb-10">
      <section className="border-b border-line bg-surface px-4 py-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 text-center">
          <ShootoutScore name={trackedName} score={review.score.tracked} />
          <div className="pb-1 text-xs font-bold uppercase text-content-subtle">
            Shootout
          </div>
          <ShootoutScore name={opponentName} score={review.score.opponent} />
        </div>
        <p className="mt-3 text-center text-sm font-bold text-content">{status}</p>
        <div className="mt-4 grid grid-cols-2 divide-x divide-line border-y border-line py-3 text-center">
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
        <p className="mt-2 text-center text-xs text-content-muted">
          {sideName(review.firstKickingSide, trackedName, opponentName)} kicked first
        </p>
      </section>

      <section className="border-b border-line bg-canvas px-4 py-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase text-content-muted">Rounds</h2>
          <span className="text-xs text-content-muted">
            {review.attempts.tracked}-{review.attempts.opponent} official attempts
          </span>
        </div>
        <div className="border-y border-line bg-surface">
          <div className="grid grid-cols-[5.5rem_1fr_1fr] border-b border-line px-2 py-2 text-[11px] font-bold uppercase text-content-muted">
            <span>Round</span>
            <span className="text-center">{trackedName}</span>
            <span className="text-center">{opponentName}</span>
          </div>
          {review.rounds.map(round => (
            <div
              key={round.round}
              className="grid min-h-20 grid-cols-[5.5rem_1fr_1fr] border-b border-line px-2 py-3 last:border-b-0"
            >
              <div className="pr-2">
                <p className="text-xs font-bold text-content">{round.label}</p>
                {round.suddenDeath && (
                  <p className="mt-1 text-[10px] font-semibold uppercase text-warning-content">
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
            <p className="py-8 text-center text-sm text-content-muted">
              No shootout kicks recorded.
            </p>
          )}
        </div>
      </section>

      <section className="border-b border-line bg-surface px-4 py-5">
        <h2 className="text-sm font-bold uppercase text-content-muted">
          Kicker Summary
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-y border-line text-sm">
            <thead className="bg-canvas text-[10px] uppercase text-content-muted">
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
            <tbody className="divide-y divide-line">
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

      <section className="bg-surface px-4 py-5">
        <h2 className="text-sm font-bold uppercase text-content-muted">
          Goalkeeper Summary
        </h2>
        <div className="mt-3 divide-y divide-line border-y border-line">
          {review.goalkeepers.map(goalkeeper => (
            <div
              key={`${goalkeeper.teamSide}:${goalkeeper.key}`}
              className="grid min-h-12 grid-cols-[1fr_auto_auto] items-center gap-4 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-content">
                  {goalkeeper.label}
                </p>
                <p className="text-[11px] font-semibold uppercase text-content-muted">
                  {goalkeeper.teamSide === 'tracked' ? trackedName : opponentName}
                </p>
              </div>
              <SummaryValue label="Faced" value={goalkeeper.attemptsFaced} />
              <SummaryValue label="Saves" value={goalkeeper.saves} />
            </div>
          ))}
          {review.goalkeepers.length === 0 && (
            <p className="py-6 text-center text-sm text-content-muted">
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
      <p className="truncate text-xs font-semibold text-content-muted">{name}</p>
      <p className="mt-1 text-4xl font-bold tabular-nums text-content">{score}</p>
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
      <p className="truncate text-xs font-semibold text-content-muted">{label}</p>
      <p className="mt-1 text-sm font-bold tabular-nums text-content">
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
    return <div className="grid place-items-center text-sm text-content-subtle">-</div>
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
        <p className="truncate font-semibold text-content">{kicker.label}</p>
        <p className="text-[10px] font-bold uppercase text-content-subtle">
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
        <td key={index} className="px-2 py-2 text-center tabular-nums text-content">
          {value}
        </td>
      ))}
    </tr>
  )
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="w-12 text-center">
      <p className="text-base font-bold tabular-nums text-content">{value}</p>
      <p className="text-[10px] font-semibold uppercase text-content-subtle">{label}</p>
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
      className="fixed inset-0 z-40 flex items-end justify-center bg-overlay/[0.45] sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shootout attempt detail"
        className="w-full rounded-t-lg bg-surface p-4 sm:max-w-md sm:rounded-lg"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-content">{attempt.outcomeLabel}</h2>
            <p className="text-xs text-content-muted">
              {attempt.suddenDeath ? 'Sudden death' : `Round ${attempt.round}`}
              {attempt.advances ? ` - official kick ${attempt.kickNumber}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center text-content-muted"
            aria-label="Close"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>
        <dl className="mt-4 divide-y divide-line border-y border-line">
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
        <p className="mt-3 text-xs text-content-muted">
          Shootout corrections continue through the owned local tracker.
        </p>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 py-2 text-sm">
      <dt className="font-semibold text-content-muted">{label}</dt>
      <dd className="text-right font-bold text-content">{value}</dd>
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
  if (outcome === 'scored') return 'border-success-line bg-success text-success-content'
  if (outcome === 'saved') return 'border-info-line bg-info text-info-content'
  if (outcome === 'retake') return 'border-info-line bg-info text-info-content'
  if (outcome === 'forfeited') return 'border-danger-line bg-danger text-danger-content'
  if (outcome === 'woodwork') return 'border-warning-line bg-warning text-warning-content'
  return 'border-line-strong bg-surface text-content'
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
