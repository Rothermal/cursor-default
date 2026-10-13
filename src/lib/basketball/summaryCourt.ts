import type { GameState } from '../../types'
import { compareGameEventCaptureOrder } from '../gameEvents/stream'
import type { GameEventLocation } from '../gameEvents/types'
import { basketballCourtOrientationForState, HALFCOURT_Y } from './courtGeometry'
import { basketballFullCourtLocation, basketballShotFeet } from './fullCourtGeometry'
import { BASKETBALL_LOCATED_PLAY_TYPES, basketballPlaySpotText } from './playLocations'
import {
  buildBasketballTimelineReview,
  type BasketballTimelineEventReview,
  type BasketballTimelinePeriodOption,
} from './timeline'
import type { BasketballAttackingDirection, BasketballMatchEvent, BasketballTeamSide } from './types'

/**
 * Summary court frame (BKE-7D): the tracked team always attacks right and the opponent
 * left, so a game reads the same whichever way each half was played. A location aimed
 * the other way turns half a turn, as `hockeySummaryPoint` does; nothing is stored.
 */
export const BASKETBALL_SUMMARY_DIRECTIONS: Record<BasketballTeamSide, BasketballAttackingDirection> = {
  tracked: 'left_to_right',
  opponent: 'right_to_left',
}

/**
 * A stored location as a 0..1 point on the summary full court. Half-court-frame locations
 * from games recorded before BKE-7 sit at their side's summary basket.
 */
export function basketballSummaryCourtPoint(
  location: Pick<GameEventLocation, 'x' | 'y' | 'attackingDirection'>,
  side: BasketballTeamSide
): { x: number; y: number } {
  const target = BASKETBALL_SUMMARY_DIRECTIONS[side]
  if (location.attackingDirection === 'unknown') {
    const placed = basketballFullCourtLocation(basketballShotFeet(location), target)
    return { x: placed.x, y: placed.y }
  }
  if (location.attackingDirection === target) return { x: location.x, y: location.y }
  return { x: 1 - location.x, y: 1 - location.y }
}

/**
 * The same point as a location on the summary court, aimed at the side's summary basket.
 * Summary text reads this, never the stored location, so words match the marker.
 */
export function basketballSummaryCourtLocation(
  location: Pick<GameEventLocation, 'x' | 'y' | 'attackingDirection'>,
  side: BasketballTeamSide
): GameEventLocation {
  return { ...basketballSummaryCourtPoint(location, side), attackingDirection: BASKETBALL_SUMMARY_DIRECTIONS[side] }
}

/**
 * Rim-relative half-court feet for the Half court view, or null for a shot beyond half
 * court (§3.5): points are folded onto one basket, never clamped or moved.
 */
export function basketballSummaryHalfCourtPoint(
  location: Pick<GameEventLocation, 'x' | 'y' | 'attackingDirection'>
): { x: number; y: number } | null {
  const feet = basketballShotFeet(location)
  return feet.y <= HALFCOURT_Y ? feet : null
}

// ---------------------------------------------------------------------------
// Plays map

export type BasketballSummaryPlayKind = 'rebound' | 'steal' | 'block' | 'turnover' | 'foul'

export const BASKETBALL_SUMMARY_PLAY_KINDS: Array<{ kind: BasketballSummaryPlayKind; label: string; letter: string }> = [
  { kind: 'rebound', label: 'Rebound', letter: 'R' },
  { kind: 'steal', label: 'Steal', letter: 'S' },
  { kind: 'block', label: 'Block', letter: 'B' },
  { kind: 'turnover', label: 'Turnover', letter: 'T' },
  { kind: 'foul', label: 'Foul', letter: 'F' },
]

export interface BasketballSummaryPlay {
  id: string
  kind: BasketballSummaryPlayKind
  /** The Timeline review with its court spot text describing `point` as shown. */
  review: BasketballTimelineEventReview
  teamSide: BasketballTeamSide
  participantId: string | null
  participantLabel: string
  periodId: string
  periodLabel: string
  /** 0..1 on the summary full court. */
  point: { x: number; y: number }
}

export interface BasketballSummaryPlayFilters {
  teamSide: 'all' | BasketballTeamSide
  participantId: 'all' | string
  periodId: 'all' | string
  kind: 'all' | BasketballSummaryPlayKind
}

export const DEFAULT_BASKETBALL_SUMMARY_PLAY_FILTERS: BasketballSummaryPlayFilters = {
  teamSide: 'all',
  participantId: 'all',
  periodId: 'all',
  kind: 'all',
}

export interface BasketballSummaryPlayReview {
  plays: BasketballSummaryPlay[]
  periods: BasketballTimelinePeriodOption[]
  participants: Array<{ id: string; label: string; teamSide: BasketballTeamSide }>
}

/** Active located plays (BKE-7C) in capture order, for the Plays map. */
export function basketballSummaryPlayReview(state: GameState): BasketballSummaryPlayReview {
  const timeline = buildBasketballTimelineReview(state, { groupOrder: 'oldest_first' })
  const orientation = basketballCourtOrientationForState(state)
  const plays = timeline.activeGroups
    .flatMap(group => group.events)
    .filter(review => BASKETBALL_LOCATED_PLAY_TYPES.has(review.event.eventType))
    .sort((left, right) => compareGameEventCaptureOrder(left.event, right.event))
    .flatMap(review => {
      const event = review.event
      const location = event.location
      const side = event.teamSide
      if (!location || location.attackingDirection === 'unknown') return []
      if (side !== 'tracked' && side !== 'opponent') return []
      const summaryLocation = basketballSummaryCourtLocation(location, side)
      return [{
        id: event.id,
        kind: playKind(event),
        // Summary-only text: the stored event and the Timeline review stay as recorded.
        review: { ...review, spotLabel: basketballPlaySpotText(summaryLocation, orientation) },
        teamSide: side,
        participantId: event.actors[0]?.participantId ?? null,
        participantLabel: review.actorLabel,
        periodId: event.period.id,
        periodLabel: review.periodLabel,
        point: { x: summaryLocation.x, y: summaryLocation.y },
      } satisfies BasketballSummaryPlay]
    })
  const participantIds = new Set(plays.flatMap(play => play.participantId ? [play.participantId] : []))
  const periodIds = new Set(plays.map(play => play.periodId))
  return {
    plays,
    periods: timeline.periods.filter(period => periodIds.has(period.id)),
    participants: timeline.participants.filter(participant => participantIds.has(participant.id)),
  }
}

export function filterBasketballSummaryPlays(
  review: BasketballSummaryPlayReview,
  filters: BasketballSummaryPlayFilters
): BasketballSummaryPlay[] {
  return review.plays.filter(play =>
    (filters.teamSide === 'all' || play.teamSide === filters.teamSide) &&
    (filters.participantId === 'all' || play.participantId === filters.participantId) &&
    (filters.periodId === 'all' || play.periodId === filters.periodId) &&
    (filters.kind === 'all' || play.kind === filters.kind)
  )
}

function playKind(event: BasketballMatchEvent): BasketballSummaryPlayKind {
  switch (event.eventType) {
    case 'basketball.rebound': return 'rebound'
    case 'basketball.steal': return 'steal'
    case 'basketball.block': return 'block'
    case 'basketball.turnover': return 'turnover'
    default: return 'foul'
  }
}
