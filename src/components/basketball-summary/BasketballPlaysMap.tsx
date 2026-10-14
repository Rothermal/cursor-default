import { Eye, MapPin } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { basketballCourtOrientationForState } from '../../lib/basketball/courtGeometry'
import { basketballFullCourtFeet } from '../../lib/basketball/fullCourtView'
import {
  BASKETBALL_SUMMARY_PLAY_KINDS,
  basketballSummaryPlayReview,
  DEFAULT_BASKETBALL_SUMMARY_PLAY_FILTERS,
  filterBasketballSummaryPlays,
  type BasketballSummaryPlay,
  type BasketballSummaryPlayFilters,
} from '../../lib/basketball/summaryCourt'
import type { BasketballSummarySource } from '../../lib/basketball/summarySource'
import type { BasketballTimelineEventReview } from '../../lib/basketball/timeline'
import BasketballEventDetailDialog from '../basketball/BasketballEventDetailDialog'
import BasketballFullCourt, { type BasketballCourtPlayMarker } from '../shot-chart/BasketballFullCourt'

const KIND_BY_ID = new Map(BASKETBALL_SUMMARY_PLAY_KINDS.map(kind => [kind.kind, kind]))

/**
 * Plays map (BKE-7D): rebounds, steals, blocks, turnovers and fouls entered from a court
 * tap, on the summary full court (tracked attacks right). Read only for every source;
 * corrections stay on the Timeline.
 */
export default function BasketballPlaysMap({ source }: { source: BasketballSummarySource }) {
  const review = useMemo(() => basketballSummaryPlayReview(source.state), [source.state])
  const [filters, setFilters] = useState<BasketballSummaryPlayFilters>(DEFAULT_BASKETBALL_SUMMARY_PLAY_FILTERS)
  const [detail, setDetail] = useState<BasketballTimelineEventReview | null>(null)
  const returnFocusRef = useRef<HTMLElement | SVGElement | null>(null)
  const plays = useMemo(() => filterBasketballSummaryPlays(review, filters), [filters, review])
  const playById = useMemo(() => new Map(review.plays.map(play => [play.id, play])), [review.plays])
  const trackedName = source.state.gameInfo?.teamName || 'Tracked'
  const opponentName = source.state.gameInfo?.opponentName || 'Opponent'
  const sideName = (side: 'tracked' | 'opponent') => side === 'tracked' ? trackedName : opponentName
  const markers: BasketballCourtPlayMarker[] = plays.map(play => ({
    id: play.id,
    ...basketballFullCourtFeet(play.point),
    letter: KIND_BY_ID.get(play.kind)!.letter,
    tone: play.teamSide,
    label: `View ${KIND_BY_ID.get(play.kind)!.label.toLowerCase()}, ${play.participantLabel}, ${play.periodLabel}`,
  }))

  const open = (play: BasketballSummaryPlay, trigger: HTMLElement | SVGElement | null) => {
    returnFocusRef.current = trigger
    setDetail(play.review)
  }

  const participantLabel = (participantId: string) => {
    const participant = source.state.sportGameState?.sportId === 'basketball'
      ? source.state.sportGameState.projection.participants[participantId]
      : null
    return participant
      ? `${participant.number ? `#${participant.number} ` : ''}${participant.displayName}`
      : 'Unknown participant'
  }

  return (
    <main
      id="basketball-plays-panel"
      role="tabpanel"
      aria-labelledby="basketball-plays-tab"
      className="mx-auto w-full max-w-5xl pb-24"
    >
      <section className="border-b border-line bg-surface px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-content">Plays</h2>
            <p className="mt-0.5 text-sm font-semibold text-content-muted">
              {plays.length} located {plays.length === 1 ? 'play' : 'plays'}
            </p>
          </div>
          <span className="rounded-md bg-control px-2 py-1 text-xs font-bold text-content-muted">Read only</span>
        </div>

        <div className="mt-4" aria-label="Play side filter">
          <span className="mb-1 block text-[11px] font-semibold uppercase text-content-subtle">Side</span>
          <div className="grid grid-cols-3 rounded-md border border-line-strong bg-control p-0.5">
            {([['all', 'All'], ['tracked', trackedName], ['opponent', opponentName]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilters(current => ({ ...current, teamSide: value }))}
                aria-pressed={filters.teamSide === value}
                className={`min-h-10 truncate rounded px-2 text-xs font-bold ${
                  filters.teamSide === value ? 'bg-surface text-content shadow-sm' : 'text-content-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <FilterSelect
            label="Player"
            value={filters.participantId}
            onChange={participantId => setFilters(current => ({ ...current, participantId }))}
            options={[
              { value: 'all', label: 'All players' },
              ...review.participants.map(participant => ({
                value: participant.id,
                label: `${participant.label} (${participant.teamSide === 'tracked' ? 'Tracked' : 'Opponent'})`,
              })),
            ]}
          />
          <FilterSelect
            label="Period"
            value={filters.periodId}
            onChange={periodId => setFilters(current => ({ ...current, periodId }))}
            options={[
              { value: 'all', label: 'Full game' },
              ...review.periods.map(period => ({ value: period.id, label: period.label })),
            ]}
          />
          <FilterSelect
            label="Play"
            value={filters.kind}
            onChange={kind => setFilters(current => ({ ...current, kind: kind as BasketballSummaryPlayFilters['kind'] }))}
            options={[
              { value: 'all', label: 'All plays' },
              ...BASKETBALL_SUMMARY_PLAY_KINDS.map(kind => ({ value: kind.kind, label: kind.label })),
            ]}
          />
        </div>
      </section>

      <section className="border-b border-line bg-surface px-3 py-4" aria-label="Filtered plays court">
        <p className="mb-3 px-1 text-xs font-semibold text-content-muted">
          {BASKETBALL_SUMMARY_PLAY_KINDS.map(kind => `${kind.letter} = ${kind.label}`).join(' · ')}
        </p>
        <BasketballFullCourt
          shots={[]}
          plays={markers}
          onPlayActivate={(marker, element) => {
            const play = playById.get(marker.id)
            if (play) open(play, element)
          }}
          flipped={basketballCourtOrientationForState(source.state) === 'flipped'}
          labels={{ left: opponentName, right: trackedName }}
          className="w-full"
        />
        {plays.length === 0 && (
          <div className="py-5 text-center text-sm text-content-subtle">
            <MapPin className="mx-auto text-content" size={24} aria-hidden />
            <p className="mt-2 font-semibold">No located plays match these filters.</p>
            <p className="mt-1">Plays keep a spot when they are entered from a court tap.</p>
          </div>
        )}
      </section>

      {plays.length > 0 && (
        <section className="border-b border-line bg-surface px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-content">Located plays</h3>
            <span className="text-xs font-bold text-content-subtle">{plays.length}</span>
          </div>
          <ol className="mt-3 divide-y divide-line border-y border-line">
            {plays.map(play => (
              <li key={play.id}>
                <button
                  type="button"
                  onClick={event => open(play, event.currentTarget)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 py-3 text-left active:bg-info"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-content">{KIND_BY_ID.get(play.kind)!.label}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        play.teamSide === 'tracked' ? 'bg-info text-info-content' : 'bg-warning text-warning-content'
                      }`}>
                        {sideName(play.teamSide)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-content-muted">
                      {play.participantLabel} | {play.periodLabel}{play.review.spotLabel ? ` | ${play.review.spotLabel}` : ''}
                    </span>
                  </span>
                  <Eye size={16} className="shrink-0 text-content-subtle" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {detail && (
        <BasketballEventDetailDialog
          review={detail}
          participantLabel={participantLabel}
          teamLabel={detail.teamSide === 'tracked' ? trackedName : detail.teamSide === 'opponent' ? opponentName : 'Game administration'}
          onClose={() => {
            setDetail(null)
            const target = returnFocusRef.current
            returnFocusRef.current = null
            window.setTimeout(() => target?.focus(), 0)
          }}
        />
      )}
    </main>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase text-content-subtle">{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-sm font-semibold text-content">
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}
