import type { GameState, ShotRecord } from '../../types'
import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import { classifyShotZone } from './courtGeometry'
import { basketballShotFeet } from './fullCourtGeometry'
import { basketballFullCourtFeet } from './fullCourtView'
import { basketballSummaryCourtPoint, basketballSummaryHalfCourtPoint } from './summaryCourt'
import {
  basketballShotDetailFromReview,
  buildBasketballTimelineReview,
  type BasketballShotDetailModel,
  type BasketballTimelinePeriodOption,
} from './timeline'
import type { BasketballShotEvent, BasketballTeamSide } from './types'

export type BasketballShotSideFilter = 'all' | BasketballTeamSide
export type BasketballShotResultFilter = 'all' | 'made' | 'missed'
export type BasketballShotValueFilter = 'all' | '2' | '3'

export interface BasketballSummaryShotFilters {
  teamSide: BasketballShotSideFilter
  participantId: 'all' | string
  periodId: 'all' | string
  result: BasketballShotResultFilter
  value: BasketballShotValueFilter
}

export interface BasketballSummaryShotParticipant {
  id: string
  label: string
  teamSide: BasketballTeamSide
}

export interface BasketballSummaryShot {
  id: string
  event: BasketballShotEvent
  /** Half court view: rim-relative feet, or null when unlocated or beyond half court. */
  marker: ShotRecord | null
  /** Full court view: summary-frame feet (tracked attacks right), or null when unlocated. */
  fullCourtMarker: ShotRecord | null
  /** Located past the midcourt line from its basket (§3.5); counted, not drawn on the half court. */
  beyondHalfCourt: boolean
  detail: BasketballShotDetailModel
  teamSide: BasketballTeamSide
  participantId: string | null
  participantLabel: string
  periodId: string
  periodLabel: string
  sequence: number
  made: boolean
  value: 2 | 3
}

export interface BasketballSummaryShotReview {
  shots: BasketballSummaryShot[]
  periods: BasketballTimelinePeriodOption[]
  participants: BasketballSummaryShotParticipant[]
}

export const DEFAULT_BASKETBALL_SUMMARY_SHOT_FILTERS: BasketballSummaryShotFilters = {
  teamSide: 'all',
  participantId: 'all',
  periodId: 'all',
  result: 'all',
  value: 'all',
}

export function basketballSummaryShotReview(state: GameState): BasketballSummaryShotReview {
  const timeline = buildBasketballTimelineReview(state, { groupOrder: 'oldest_first' })
  const fieldGoals = timeline.activeGroups
    .flatMap(group => group.events)
    .filter(review =>
      review.event.eventType === 'basketball.shot' &&
      review.event.payload.attempt === 'field_goal'
    )
    .sort((left, right) => compareGameEventCaptureOrder(left.event, right.event))

  const shots = fieldGoals.flatMap(review => {
    const event = review.event as BasketballShotEvent
    if (event.payload.value !== 2 && event.payload.value !== 3) return []
    const detail = basketballShotDetailFromReview(state, timeline, event.id)
    if (!detail) return []
    const shooter = event.actors.find(actor => actor.role === 'shooter') ?? event.actors[0]
    const participantId = shooter?.participantId ?? null
    const point = event.location ? basketballSummaryHalfCourtPoint(event.location) : null
    const feet = event.location ? basketballShotFeet(event.location) : null
    const side = event.teamSide === 'opponent' ? 'opponent' : 'tracked'
    const full = event.location ? basketballFullCourtFeet(basketballSummaryCourtPoint(event.location, side)) : null
    const record = (at: { x: number; y: number }): ShotRecord => ({
      id: event.id,
      playerId: participantId ?? `team:${event.teamSide}`,
      timestamp: event.sequence,
      made: event.payload.made,
      x: at.x,
      y: at.y,
      shotType: event.payload.value === 3 ? '3pt' : '2pt',
      zone: classifyShotZone(feet!.x, feet!.y),
    })
    return [{
      id: event.id,
      event,
      marker: point ? record(point) : null,
      fullCourtMarker: full ? record(full) : null,
      beyondHalfCourt: Boolean(event.location && !point),
      detail,
      teamSide: event.teamSide,
      participantId,
      participantLabel: review.actorLabel,
      periodId: event.period.id,
      periodLabel: review.periodLabel,
      sequence: event.sequence,
      made: event.payload.made,
      value: event.payload.value,
    } satisfies BasketballSummaryShot]
  })

  const participantIds = new Set(shots.flatMap(shot => shot.participantId ? [shot.participantId] : []))
  const periodIds = new Set(shots.map(shot => shot.periodId))
  return {
    shots,
    periods: timeline.periods.filter(period => periodIds.has(period.id)),
    participants: timeline.participants.filter(participant => participantIds.has(participant.id)),
  }
}

export function filterBasketballSummaryShots(
  review: BasketballSummaryShotReview,
  filters: BasketballSummaryShotFilters
): BasketballSummaryShot[] {
  return review.shots.filter(shot =>
    (filters.teamSide === 'all' || shot.teamSide === filters.teamSide) &&
    (filters.participantId === 'all' || shot.participantId === filters.participantId) &&
    (filters.periodId === 'all' || shot.periodId === filters.periodId) &&
    (filters.result === 'all' || (filters.result === 'made' ? shot.made : !shot.made)) &&
    (filters.value === 'all' || shot.value === Number(filters.value))
  )
}
