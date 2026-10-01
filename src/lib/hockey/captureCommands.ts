import type { GameState } from '../../types'
import type { GameEvent, GameEventActor, GameEventLocation } from '../gameEvents/types'
import { isHockeyReason } from './events'
import { hockeyParticipantRemoved, otherHockeySide } from './captureProjection'
import { createHockeyUuid } from './id'
import {
  hockeyClockDisplay,
  hockeyPauseIfRunning,
  runHockeyCommand,
  type HockeyCommandContext,
  type HockeyCommandResult,
  type HockeyPendingEvent,
} from './live'
import {
  hockeyCurrentGameTimeMs,
  hockeyGameTimeMs,
  hockeyGoalStrengthFor,
  hockeyPenaltyBoxAt,
  hockeyPenaltyDefaultDurationMs,
  hockeyStrengthState,
  type HockeyPenaltyBox,
  type HockeyStrengthState,
} from './penalties'
import { sortHockeyActors } from './positions'
import { hockeyActivePeriod, hockeyClockMomentAt, lastHockeyPeriod } from './projector'
import { HOCKEY_FACEOFF_DOTS, oppositeHockeyDirection, type HockeyFaceoffDotId } from './rinkGeometry'
import type {
  HockeyGoalieChangeReason,
  HockeyInfraction,
  HockeyOffenderKind,
  HockeyPenaltyClass,
  HockeySportGameState,
  HockeyStrength,
  HockeyTeamEventKind,
  HockeyMatchParticipant,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyMissType,
  HockeyOnIce,
  HockeyOpponentGoalie,
  HockeyShootoutOutcome,
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
  /**
   * Corrections only (HKY-4B): the goalie the shot was recorded against, kept as stored even
   * when goalie changes now put someone else in net. Absent means the goalie in net.
   */
  goalieId?: string | null
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
  /**
   * Goals only (HKY-3B): the recorder's confirmed strength. Defaults to the strength derived
   * from the penalty box, or even strength in a clockless game.
   */
  strength?: HockeyStrength | null
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
    const facedGoalie = input.goalieId === undefined ? netGoalie : input.goalieId
    if (facedGoalie !== null && !emptyNet) {
      if (!knownHockeyGoalie(sport.setup, projection, defending, facedGoalie)) return 'Pick a goalie from that side.'
      actors.push(hockeyGoalieActor(sport.setup, projection, defending, facedGoalie))
    }

    const location = sideLocation(projection, side, input.location)
    if (input.strength && !goal) return 'Only a goal records its strength.'
    const strength = goal
      ? input.strength ?? hockeyDerivedGoalStrength(sport.setup, projection, active.id, elapsedMs, side)
      : null

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
        strength,
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

// ---------------------------------------------------------------------------
// Penalties (HKY-3A)

export interface HockeyPenaltyInput {
  /** The penalized side. */
  side: HockeySide
  class: HockeyPenaltyClass
  infraction: HockeyInfraction
  infractionLabel?: string | null
  /** Defaults to the rules' length for the class. */
  durationMs?: number
  offenderKind: HockeyOffenderKind
  offender?: HockeyActorChoice | null
  servedBy?: HockeyActorChoice | null
  /** A player on the other side. */
  drawnBy?: HockeyActorChoice | null
  delayed?: boolean
}

export interface RecordHockeyPenaltiesInput {
  penalties: HockeyPenaltyInput[]
  /** Marks the penalties coincidental; the unit must hold a penalty for each side. */
  coincidental?: boolean
  /** Deterministic capture id for tests; generated when the unit has more than one penalty. */
  captureCommandId?: string
}

/**
 * Records one or more penalties as one capture unit, so Undo and Restore treat them together.
 * Coincidence is never inferred: only the recorder's Coincidental choice groups them.
 */
export function recordHockeyPenalties(
  state: GameState,
  input: RecordHockeyPenaltiesInput,
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (sport, projection) => {
    const active = hockeyActivePeriod(projection)
    if (projection.status !== 'in_progress' || !active) return 'Penalties are recorded during a period.'
    if (input.penalties.length === 0) return 'Add a penalty.'
    const elapsedMs = captureElapsed(projection, context.occurredAt)
    if (typeof elapsedMs === 'string') return elapsedMs
    const coincidental = input.coincidental === true
    if (coincidental && new Set(input.penalties.map(penalty => penalty.side)).size < 2) {
      return 'Coincidental penalties need a penalty on each side.'
    }
    const captureCommandId = input.penalties.length > 1 ? input.captureCommandId ?? createHockeyUuid() : null
    const pending: HockeyPendingEvent[] = []
    for (const penalty of input.penalties) {
      const actors: GameEventActor[] = []
      const push = (role: string, owner: HockeySide, choice: HockeyActorChoice | null | undefined) => {
        if (!choice) return null
        const actor = choiceActor(sport.setup, role, owner, choice)
        if (typeof actor === 'string') return actor
        actors.push(actor)
        return null
      }
      const bench = penalty.offenderKind === 'bench' || penalty.offenderKind === 'staff'
      const problem =
        push('offender', penalty.side, bench ? null : penalty.offender) ??
        push('served_by', penalty.side, penalty.servedBy) ??
        push('drawn_by', otherHockeySide(penalty.side), penalty.drawnBy)
      if (problem) return problem
      const infractionLabel = penalty.infraction === 'other' ? cleanLabel(penalty.infractionLabel) : null
      if (penalty.infraction === 'other' && !infractionLabel) return 'Name the infraction.'
      const durationMs = penalty.class === 'penalty_shot'
        ? 0
        : penalty.durationMs ?? hockeyPenaltyDefaultDurationMs(sport.setup.rulesSnapshot.penalties, penalty.class)
      pending.push({
        eventType: 'hockey.penalty',
        teamSide: penalty.side,
        actors,
        payload: {
          captureCommandId,
          class: penalty.class,
          infraction: penalty.infraction,
          infractionLabel,
          durationMs,
          offenderKind: penalty.offenderKind,
          delayed: penalty.delayed ?? false,
          coincidenceGroupId: coincidental ? captureCommandId : null,
        },
        period: { id: active.id, order: active.order },
        elapsedMs,
      })
    }
    return pending
  })
}

/**
 * Ends one running or waiting penalty segment now (HKY-3A), for the rare case the clock-derived
 * expiry is wrong. Assessed PIM never changes; anchored games only.
 */
export function releaseHockeyPenalty(
  state: GameState,
  input: { penaltyEventId: string; segment?: 1 | 2; reason: string },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (sport, projection) => {
    const active = hockeyActivePeriod(projection)
    if (!projection.clock) return { code: 'clock_unavailable', message: 'Penalties are released early only in games with a clock.' }
    if (projection.status !== 'in_progress' || !active) return 'Penalties are released during a period.'
    const reason = input.reason.trim()
    if (!isHockeyReason(reason)) return { code: 'reason_required', message: 'Say why the penalty is ending early.' }
    const elapsedMs = captureElapsed(projection, context.occurredAt)
    if (typeof elapsedMs === 'string') return elapsedMs
    const record = projection.penalties.find(entry => entry.eventId === input.penaltyEventId)
    if (!record) return 'That penalty is not in this game.'
    const segment = input.segment ?? 1
    const box = hockeyPenaltyBoxAt(sport.setup, projection, hockeyGameTimeMs(projection, active.id, elapsedMs))
    const entry = box[record.side].find(item => item.penaltyEventId === record.eventId && item.segment === segment)
    if (!entry) return 'That penalty has already ended.'
    return [{
      eventType: 'hockey.penalty_release',
      teamSide: record.side,
      payload: { captureCommandId: null, penaltyEventId: record.eventId, segment, reason },
      period: { id: active.id, order: active.order },
      elapsedMs,
    }]
  })
}

/** The strength a goal would carry now: derived from the box, or even strength without a clock. */
export function hockeyDerivedGoalStrength(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection,
  periodId: string,
  elapsedMs: number | null,
  scoringSide: HockeySide
): HockeyStrength {
  if (!projection.clock) return 'ev'
  const box = hockeyPenaltyBoxAt(setup, projection, hockeyGameTimeMs(projection, periodId, elapsedMs))
  return hockeyGoalStrengthFor(hockeyStrengthState(setup, projection, box), scoringSide)
}

/** A team timeout (HKY-3B). A running clock is paused in the same command. */
export function recordHockeyTimeout(
  state: GameState,
  input: { side: HockeySide },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    const active = hockeyActivePeriod(projection)
    if (projection.status !== 'in_progress' || !active) return 'Timeouts are taken during a period.'
    const period = { id: active.id, order: active.order }
    const events: HockeyPendingEvent[] = []
    let elapsedMs: number | null = null
    if (projection.clock) {
      const pause = hockeyPauseIfRunning(projection, period, context.occurredAt)
      if (typeof pause === 'string') return pause
      if (pause) events.push(pause.event)
      elapsedMs = pause ? pause.elapsedMs : projection.clock.elapsedMs
    }
    events.push({
      eventType: 'hockey.timeout',
      teamSide: input.side,
      payload: { captureCommandId: null },
      period,
      elapsedMs,
    })
    return events
  })
}

/** Icing or offside against a side (HKY-3B), with an optional rink location. */
export function recordHockeyTeamEvent(
  state: GameState,
  input: { kind: HockeyTeamEventKind; side: HockeySide; location?: { x: number; y: number } | null },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    const active = hockeyActivePeriod(projection)
    if (projection.status !== 'in_progress' || !active) return 'Icing and offside are recorded during a period.'
    const elapsedMs = captureElapsed(projection, context.occurredAt)
    if (typeof elapsedMs === 'string') return elapsedMs
    return [{
      eventType: 'hockey.team_event',
      teamSide: input.side,
      location: sideLocation(projection, input.side, input.location),
      payload: { captureCommandId: null, kind: input.kind },
      period: { id: active.id, order: active.order },
      elapsedMs,
    }]
  })
}

export interface HockeyPenaltyBoxReading {
  box: HockeyPenaltyBox
  /** Null for clockless games, which have no derived strength. */
  strength: HockeyStrengthState | null
}

/** The box and strength at the displayed clock; display only, never written to state. */
export function hockeyPenaltyBoxNow(sport: HockeySportGameState, nowIso: string): HockeyPenaltyBoxReading {
  const projection = sport.projection
  const reading = hockeyClockDisplay(sport, nowIso)
  const gameTimeMs = hockeyCurrentGameTimeMs(projection, reading?.elapsedMs ?? null)
  const box = hockeyPenaltyBoxAt(sport.setup, projection, gameTimeMs)
  return { box, strength: projection.clock ? hockeyStrengthState(sport.setup, projection, box) : null }
}

/** Tracked players still in the game: game misconducts and match penalties remove players. */
export function hockeyAvailableParticipants(
  participants: readonly HockeyMatchParticipant[],
  projection: Pick<HockeyMatchProjection, 'removedParticipantIds'>
): HockeyMatchParticipant[] {
  return participants.filter(participant => !hockeyParticipantRemoved(projection, participant.id))
}

/**
 * The default tracked faceoff taker (HKY-0 Q7): the last tracked taker, else the first
 * dressed centre, else nobody.
 */
export function hockeyFaceoffTakerDefault(setup: HockeyMatchSetup, projection: HockeyMatchProjection): string | null {
  const last = projection.lastTrackedFaceoffTakerId
  const available = hockeyAvailableParticipants(hockeySkaterChoices(setup), projection)
  if (last && available.some(entry => entry.id === last)) return last
  return available.find(entry => entry.position === 'C')?.id ?? null
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
  // Setup names a number-only player "#7", which must not read "#7 #7".
  if (!participant.number || participant.displayName === `#${participant.number}`) return participant.displayName
  return `#${participant.number} ${participant.displayName}`
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
    skaterParticipantIds: (previous?.skaterParticipantIds ?? setup.openingLineup.skaterParticipantIds)
      .filter(id => !hockeyParticipantRemoved(projection, id)),
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

function knownHockeyGoalie(setup: HockeyMatchSetup, projection: HockeyMatchProjection, side: HockeySide, goalieId: string): boolean {
  if (side === 'opponent') return projection.opponentGoalies.some(entry => entry.id === goalieId)
  return setup.participants.some(entry => entry.id === goalieId)
}

export function hockeyGoalieActor(
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

// ---------------------------------------------------------------------------
// Shootout (HKY-3C)

/** Starts the shootout once overtime has ended tied and the rules need a winner. */
export function startHockeyShootout(
  state: GameState,
  input: { firstSide: HockeySide },
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (_sport, projection) => {
    if (!projection.shootoutAvailable) return 'A shootout starts after overtime ends tied, when the rules have one.'
    const last = lastHockeyPeriod(projection)!
    return [{
      eventType: 'hockey.shootout_started',
      payload: { captureCommandId: null, firstSide: input.firstSide },
      period: { id: last.id, order: last.order },
      elapsedMs: null,
    }]
  })
}

export interface RecordHockeyShootoutAttemptInput {
  outcome: HockeyShootoutOutcome
  /** Absent or null records an unnamed shooter. */
  shooter?: HockeyActorChoice | null
}

/** Records the next attempt for the side whose turn it is; the defending goalie is stamped. */
export function recordHockeyShootoutAttempt(
  state: GameState,
  input: RecordHockeyShootoutAttemptInput,
  context: HockeyCommandContext
): HockeyCommandResult {
  return runHockeyCommand(state, context, (sport, projection) => {
    const shootout = projection.shootout
    if (projection.status !== 'in_progress' || !shootout) return 'Start the shootout first.'
    if (!shootout.nextSide) return 'The shootout is decided.'
    const side = shootout.nextSide
    const defending = otherHockeySide(side)
    const actors: GameEventActor[] = []
    if (input.shooter) {
      const actor = choiceActor(sport.setup, 'shooter', side, input.shooter)
      if (typeof actor === 'string') return actor
      actors.push(actor)
    }
    const goalie = projection.goalieInNet[defending]
    if (goalie !== null) actors.push(hockeyGoalieActor(sport.setup, projection, defending, goalie))
    const last = lastHockeyPeriod(projection)!
    return [{
      eventType: 'hockey.shootout_attempt',
      teamSide: side,
      payload: { captureCommandId: null, outcome: input.outcome },
      period: { id: last.id, order: last.order },
      elapsedMs: null,
      actors,
    }]
  })
}
