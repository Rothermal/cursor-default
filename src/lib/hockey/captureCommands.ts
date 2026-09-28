import type { GameState } from '../../types'
import type { GameEvent, GameEventActor, GameEventLocation } from '../gameEvents/types'
import { isHockeyReason } from './events'
import { otherHockeySide } from './captureProjection'
import { runHockeyCommand, type HockeyCommandContext, type HockeyCommandResult } from './live'
import { sortHockeyActors } from './positions'
import { hockeyActivePeriod, hockeyClockMomentAt } from './projector'
import { HOCKEY_FACEOFF_DOTS, oppositeHockeyDirection, type HockeyFaceoffDotId } from './rinkGeometry'
import type {
  HockeyGoalieChangeReason,
  HockeyMatchParticipant,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyMissType,
  HockeyOnIce,
  HockeyOpponentGoalie,
  HockeyShotOutcome,
  HockeySide,
} from './types'
import { HOCKEY_EMPTY_NET } from './types'

/** A tracked player by match identity, or an opponent by label (Q6). */
export type HockeyActorChoice = { participantId: string } | { label: string }

export interface RecordHockeyShotInput {
  side: HockeySide
  outcome: HockeyShotOutcome
  missType?: HockeyMissType | null
  penaltyShot?: boolean
  /** Overrides the empty-net value prefilled from the goalie in net. */
  emptyNet?: boolean
  /** Absent or null credits the team, unattributed. */
  shooter?: HockeyActorChoice | null
  /** Primary first; at most two, goals only. */
  assists?: HockeyActorChoice[]
  /** Blocked shots only, from the defending side. */
  blocker?: HockeyActorChoice | null
  /** Canonical rink point, or null for an unlocated shot. */
  location?: { x: number; y: number } | null
  /** Goals only; defaults to not recorded. */
  onIce?: HockeyOnIce | null
}

export const HOCKEY_ON_ICE_NOT_RECORDED: HockeyOnIce = Object.freeze({
  status: 'not_recorded',
  skaterParticipantIds: [],
  goalie: null,
}) as HockeyOnIce

/**
 * Records one shot. The defending goalie and the empty-net value come from a fresh
 * projection at capture and are stored as recorded, so later corrections never move them.
 */
export function recordHockeyShot(
  state: GameState,
  input: RecordHockeyShotInput,
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (sport, projection) => {
    const active = hockeyActivePeriod(projection)
    if (projection.status !== 'in_progress' || !active) return 'Shots are recorded during a period.'
    const elapsedMs = captureElapsed(projection, context.occurredAt)
    if (typeof elapsedMs === 'string') return elapsedMs
    const side = input.side
    const defending = otherHockeySide(side)
    const netGoalie = projection.goalieInNet[defending]
    const emptyNet = input.emptyNet ?? netGoalie === null
    const goal = input.outcome === 'goal'

    const actors: GameEventActor[] = []
    const push = (role: string, owner: HockeySide, choice: HockeyActorChoice | null | undefined) => {
      if (!choice) return null
      const actor = choiceActor(sport.setup, role, owner, choice)
      if (typeof actor === 'string') return actor
      actors.push(actor)
      return null
    }
    const assists = input.assists ?? []
    if (assists.length > 0 && !goal) return 'Only a goal has assists.'
    if (assists.length > 2) return 'A goal has at most two assists.'
    if (input.blocker && input.outcome !== 'blocked') return 'Only a blocked shot has a blocker.'
    const problem =
      push('shooter', side, input.shooter) ??
      push('assist_primary', side, assists[0]) ??
      push('assist_secondary', side, assists[1]) ??
      push('blocker', defending, input.blocker)
    if (problem) return problem
    if (!emptyNet && netGoalie !== null) actors.push(goalieActor(sport.setup, projection, defending, netGoalie))

    const location = sideLocation(projection, side, input.location)

    return [{
      eventType: 'hockey.shot',
      teamSide: side,
      location,
      actors,
      payload: {
        captureCommandId: null,
        outcome: input.outcome,
        missType: input.outcome === 'missed' ? input.missType ?? null : null,
        emptyNet,
        penaltyShot: input.penaltyShot ?? false,
        strength: null,
        onIce: goal ? structuredClone(input.onIce ?? HOCKEY_ON_ICE_NOT_RECORDED) : null,
      },
      period: { id: active.id, order: active.order },
      elapsedMs,
    }]
  })
}

/** Changes the goalie in one net. A null goalie pulls the goalie for an extra attacker. */
export function changeHockeyGoalie(
  state: GameState,
  input: {
    side: HockeySide
    inParticipantId: string | null
    reason?: HockeyGoalieChangeReason
    /** Opponent only: introduces a new goalie identity. */
    newOpponentGoalie?: HockeyOpponentGoalie | null
  },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    if (projection.status !== 'in_progress') return 'Goalie changes are recorded while the match is in progress.'
    const elapsedMs = captureElapsed(projection, context.occurredAt)
    if (typeof elapsedMs === 'string') return elapsedMs
    const current = projection.goalieInNet[input.side]
    const reason: HockeyGoalieChangeReason = input.reason ??
      (input.inParticipantId === null ? 'pulled' : current === null ? 'return' : 'tactical')
    const added = input.newOpponentGoalie ?? null
    const period = hockeyActivePeriod(projection) ?? projection.periods[projection.periods.length - 1]
    if (!period) return 'The game has not started.'
    return [{
      eventType: 'hockey.goalie_change',
      teamSide: input.side,
      payload: {
        captureCommandId: null,
        inParticipantId: input.inParticipantId,
        reason,
        newOpponentGoalie: added
          ? { id: added.id, label: cleanLabel(added.label), number: cleanLabel(added.number) }
          : null,
      },
      period: { id: period.id, order: period.order },
      elapsedMs,
    }]
  })
}

export function pullHockeyGoalie(
  state: GameState,
  input: { side: HockeySide },
  context: HockeyCommandContext
): HockeyCommandResult {
  return changeHockeyGoalie(state, { side: input.side, inParticipantId: null, reason: 'pulled' }, context)
}

/** Plus or minus one for one side, with a reason; never creates a player goal. */
export function adjustHockeyScore(
  state: GameState,
  input: { side: HockeySide; delta: 1 | -1; reason: string },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    if (projection.status !== 'in_progress') return 'Reopen the match to adjust the score.'
    const reason = input.reason.trim()
    if (!isHockeyReason(reason)) return { code: 'reason_required', message: 'Say why the score is changing.' }
    if (projection.score[input.side] + input.delta < 0) return 'A score cannot go below zero.'
    const elapsedMs = captureElapsed(projection, context.occurredAt)
    if (typeof elapsedMs === 'string') return elapsedMs
    const period = hockeyActivePeriod(projection) ?? projection.periods[projection.periods.length - 1]
    if (!period) return 'The game has not started.'
    return [{
      eventType: 'hockey.score_adjustment',
      teamSide: input.side,
      payload: { captureCommandId: null, delta: input.delta, reason },
      period: { id: period.id, order: period.order },
      elapsedMs,
    }]
  })
}

export interface RecordHockeyFaceoffInput {
  dotId: HockeyFaceoffDotId
  winner: HockeySide
  /** A dressed tracked skater, or null when unknown. */
  takerParticipantId?: string | null
  opponentTakerLabel?: string | null
}

/**
 * Records a faceoff at a dot (HKY-2C). The location is the dot's exact point in the
 * tracked side's direction for the period, so zone stats never depend on where the tap landed.
 */
export function recordHockeyFaceoff(
  state: GameState,
  input: RecordHockeyFaceoffInput,
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (sport, projection) => {
    const active = hockeyActivePeriod(projection)
    if (projection.status !== 'in_progress' || !active) return 'Faceoffs are recorded during a period.'
    const direction = active.trackedAttackingDirection
    if (!direction) return 'The tracked side\'s direction is not known for this period.'
    const elapsedMs = captureElapsed(projection, context.occurredAt)
    if (typeof elapsedMs === 'string') return elapsedMs
    const dot = HOCKEY_FACEOFF_DOTS[input.dotId]
    if (!dot) return 'Unknown faceoff dot.'
    const actors: GameEventActor[] = []
    if (input.takerParticipantId) {
      const actor = choiceActor(sport.setup, 'taker', 'tracked', { participantId: input.takerParticipantId })
      if (typeof actor === 'string') return actor
      actors.push(actor)
    }
    if (input.opponentTakerLabel && cleanLabel(input.opponentTakerLabel)) {
      const actor = choiceActor(sport.setup, 'opponent_taker', 'opponent', { label: input.opponentTakerLabel })
      if (typeof actor === 'string') return actor
      actors.push(actor)
    }
    return [{
      eventType: 'hockey.faceoff',
      location: { x: dot.x, y: dot.y, attackingDirection: direction },
      actors,
      payload: { captureCommandId: null, dotId: input.dotId, winner: input.winner },
      period: { id: active.id, order: active.order },
      elapsedMs,
    }]
  })
}

export type HockeyPlayKind = 'hit' | 'takeaway' | 'giveaway'

export interface RecordHockeyPlayInput {
  kind: HockeyPlayKind
  /** The side that made the hit, took the puck, or gave it away. */
  side: HockeySide
  player?: HockeyActorChoice | null
  /** Hits only: the player hit, on the other side. */
  hitPlayer?: HockeyActorChoice | null
  location?: { x: number; y: number } | null
}

/** Records a hit, takeaway or giveaway; every actor and the location are optional. */
export function recordHockeyPlay(
  state: GameState,
  input: RecordHockeyPlayInput,
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (sport, projection) => {
    const active = hockeyActivePeriod(projection)
    if (projection.status !== 'in_progress' || !active) return 'Plays are recorded during a period.'
    const elapsedMs = captureElapsed(projection, context.occurredAt)
    if (typeof elapsedMs === 'string') return elapsedMs
    if (input.hitPlayer && input.kind !== 'hit') return 'Only a hit names the player hit.'
    const actors: GameEventActor[] = []
    const push = (role: string, owner: HockeySide, choice: HockeyActorChoice | null | undefined) => {
      if (!choice) return null
      const actor = choiceActor(sport.setup, role, owner, choice)
      if (typeof actor === 'string') return actor
      actors.push(actor)
      return null
    }
    const problem =
      push(input.kind === 'hit' ? 'hitter' : 'player', input.side, input.player) ??
      push('hit_player', otherHockeySide(input.side), input.hitPlayer)
    if (problem) return problem
    return [{
      eventType: `hockey.${input.kind}`,
      teamSide: input.side,
      location: sideLocation(projection, input.side, input.location),
      actors,
      payload: { captureCommandId: null },
      period: { id: active.id, order: active.order },
      elapsedMs,
    }]
  })
}

/**
 * The default tracked faceoff taker (HKY-0 Q7): the last tracked taker, else the first
 * dressed centre, else nobody.
 */
export function hockeyFaceoffTakerDefault(setup: HockeyMatchSetup, projection: HockeyMatchProjection): string | null {
  const last = projection.lastTrackedFaceoffTakerId
  if (last && setup.participants.some(entry => entry.id === last && entry.dressedAs === 'skater')) return last
  return hockeySkaterChoices(setup).find(entry => entry.position === 'C')?.id ?? null
}

// ---------------------------------------------------------------------------
// Actor eligibility without shift tracking (HKY-0 §9)

/** Every dressed skater, in actor order. The opening five never narrows it. */
export function hockeySkaterChoices(setup: HockeyMatchSetup): HockeyMatchParticipant[] {
  return sortHockeyActors(setup.participants.filter(participant => participant.dressedAs === 'skater'))
}

/** Scorers and assisters: every dressed player, skaters first; a goalie can earn an assist. */
export function hockeyScorerChoices(setup: HockeyMatchSetup): HockeyMatchParticipant[] {
  return [...hockeySkaterChoices(setup), ...hockeyGoalieChoices(setup)]
}

export function hockeyGoalieChoices(setup: HockeyMatchSetup): HockeyMatchParticipant[] {
  return sortHockeyActors(setup.participants.filter(participant => participant.dressedAs === 'goalie'))
}

export function hockeyOpponentGoalieChoices(projection: HockeyMatchProjection): HockeyOpponentGoalie[] {
  return projection.opponentGoalies.map(goalie => ({ ...goalie }))
}

/** Opponent labels used in this match, most recent first, for the recent-label chip row (Q6). */
export function recentHockeyOpponentLabels(events: readonly GameEvent[], limit = 8): string[] {
  const labels: string[] = []
  const ordered = [...events].sort((left, right) => right.sequence - left.sequence)
  for (const event of ordered) {
    if (event.deletedAt) continue
    for (const actor of event.actors) {
      if (hockeyActorSide(event, actor) !== 'opponent' || actor.role === 'goalie' || !actor.label) continue
      const label = actor.label.trim()
      if (!labels.some(existing => existing.toLowerCase() === label.toLowerCase())) labels.push(label)
      if (labels.length >= limit) return labels
    }
  }
  return labels
}

/** The side an actor plays for, from the event type, its side and the actor's role. */
export function hockeyActorSide(event: GameEvent, actor: GameEventActor): HockeySide | null {
  if (event.eventType === 'hockey.faceoff') return actor.role === 'taker' ? 'tracked' : 'opponent'
  if (event.teamSide !== 'tracked' && event.teamSide !== 'opponent') return null
  const against = actor.role === 'goalie' || actor.role === 'blocker' || actor.role === 'hit_player'
  return against ? otherHockeySide(event.teamSide) : event.teamSide
}

export function hockeyParticipantLabel(participant: HockeyMatchParticipant): string {
  return participant.number ? `#${participant.number} ${participant.displayName}` : participant.displayName
}

export function hockeyOpponentGoalieLabel(goalie: HockeyOpponentGoalie): string {
  if (goalie.label && goalie.number) return `#${goalie.number} ${goalie.label}`
  if (goalie.label) return goalie.label
  return goalie.number ? `#${goalie.number}` : 'Opponent goalie'
}

// ---------------------------------------------------------------------------
// Dialog prefills and rink markers

/**
 * The on-ice guess for the next goal (HKY-2 on-ice prompt): the previous goal's recorded
 * skaters, or the opening lineup before the first goal, with the goalie currently in net.
 * It is a guess for the recorder to confirm, never stored unless they touch it.
 */
export function hockeyOnIcePrefill(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection,
  events: readonly GameEvent[]
): { skaterParticipantIds: string[]; goalie: string } {
  const previous = [...events]
    .filter(event => event.eventType === 'hockey.shot' && !event.deletedAt)
    .sort((left, right) => right.sequence - left.sequence)
    .map(event => (event.payload as { onIce?: HockeyOnIce | null }).onIce)
    .find((onIce): onIce is HockeyOnIce => Boolean(onIce && onIce.status !== 'not_recorded' && onIce.skaterParticipantIds.length > 0))
  return {
    skaterParticipantIds: [...(previous?.skaterParticipantIds ?? setup.openingLineup.skaterParticipantIds)],
    goalie: projection.goalieInNet.tracked ?? HOCKEY_EMPTY_NET,
  }
}

export interface HockeyShotMarker {
  id: string
  x: number
  y: number
  teamSide: HockeySide
  kind: HockeyShotOutcome
  label: string
}

/** Located shots for the rink, labelled for screen readers. */
export function hockeyShotMarkers(setup: HockeyMatchSetup, events: readonly GameEvent[]): HockeyShotMarker[] {
  return events
    .filter(event => event.eventType === 'hockey.shot' && !event.deletedAt && event.location)
    .map(event => {
      const outcome = (event.payload as { outcome: HockeyShotOutcome }).outcome
      const shooter = event.actors.find(actor => actor.role === 'shooter')
      const who = shooter
        ? setup.participants.find(entry => entry.id === shooter.participantId)?.displayName ?? shooter.label ?? 'Unknown'
        : 'Team'
      return {
        id: event.id,
        x: event.location!.x,
        y: event.location!.y,
        teamSide: event.teamSide as HockeySide,
        kind: outcome,
        label: `${event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'} ${HOCKEY_OUTCOME_LABELS[outcome].toLowerCase()} by ${who}`,
      }
    })
}

/** Located hits, takeaways and giveaways for the rink (HKY-2C), on the acting side's colour. */
export function hockeyPlayMarkers(setup: HockeyMatchSetup, events: readonly GameEvent[]): HockeyRinkPlayMarker[] {
  const names: Record<string, string> = { 'hockey.hit': 'hit', 'hockey.takeaway': 'takeaway', 'hockey.giveaway': 'giveaway' }
  return events
    .filter(event => names[event.eventType] && !event.deletedAt && event.location)
    .map(event => {
      const actor = event.actors.find(entry => entry.role === 'hitter' || entry.role === 'player')
      const who = actor
        ? setup.participants.find(entry => entry.id === actor.participantId)?.displayName ?? actor.label ?? 'Unknown'
        : 'Team'
      return {
        id: event.id,
        x: event.location!.x,
        y: event.location!.y,
        teamSide: event.teamSide as HockeySide,
        kind: 'event' as const,
        label: `${event.teamSide === 'tracked' ? 'Tracked' : 'Opponent'} ${names[event.eventType]} by ${who}`,
      }
    })
}

export interface HockeyRinkPlayMarker extends Omit<HockeyShotMarker, 'kind'> {
  kind: 'event'
}

export const HOCKEY_OUTCOME_LABELS: Record<HockeyShotOutcome, string> = {
  goal: 'Goal',
  saved: 'Saved',
  missed: 'Missed',
  blocked: 'Blocked',
}

// ---------------------------------------------------------------------------
// Internals

function choiceActor(
  setup: HockeyMatchSetup,
  role: string,
  owner: HockeySide,
  choice: HockeyActorChoice
): GameEventActor | string {
  if (owner === 'tracked') {
    if (!('participantId' in choice)) return 'Pick a dressed player for the tracked team.'
    const participant = setup.participants.find(entry => entry.id === choice.participantId)
    if (!participant) return 'That player is not dressed for this game.'
    return participantActor(role, participant)
  }
  if (!('label' in choice)) return 'Opponent players are entered by label.'
  const label = cleanLabel(choice.label)
  if (!label) return 'Enter the opponent player as a number or name.'
  return { role, kind: 'unknown', label }
}

function participantActor(role: string, participant: HockeyMatchParticipant): GameEventActor {
  return participant.playerId
    ? { role, kind: 'player', playerId: participant.playerId, participantId: participant.id }
    : { role, kind: 'unknown', label: participant.displayName, participantId: participant.id }
}

function goalieActor(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection,
  side: HockeySide,
  goalieId: string
): GameEventActor {
  if (side === 'tracked') {
    const participant = setup.participants.find(entry => entry.id === goalieId)!
    return participantActor('goalie', participant)
  }
  const goalie = projection.opponentGoalies.find(entry => entry.id === goalieId)
  return {
    role: 'goalie',
    kind: 'unknown',
    label: goalie ? hockeyOpponentGoalieLabel(goalie) : 'Opponent goalie',
    participantId: goalieId,
  }
}

/** Clock time for a capture: the running or paused anchored clock inside a period, else null. */
function captureElapsed(projection: HockeyMatchProjection, occurredAt: string): number | null | string {
  const clock = projection.clock
  const active = hockeyActivePeriod(projection)
  if (!clock || !active) return null
  const moment = hockeyClockMomentAt(clock, occurredAt, active.durationMs)
  if (!moment.ok) return moment.message
  if (clock.running && moment.unboundedElapsedMs >= active.durationMs) {
    return 'The period clock has expired; pause it first.'
  }
  return moment.elapsedMs
}

/** A canonical point stamped with `side`'s attacking direction, or null without one. */
function sideLocation(
  projection: HockeyMatchProjection,
  side: HockeySide,
  point: { x: number; y: number } | null | undefined
): GameEventLocation | null {
  const direction = projection.trackedAttackingDirection
  if (!point || !direction) return null
  return {
    x: clamp(point.x),
    y: clamp(point.y),
    attackingDirection: side === 'tracked' ? direction : oppositeHockeyDirection(direction),
  }
}

function cleanLabel(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim().slice(0, 80) : ''
  return trimmed || null
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
