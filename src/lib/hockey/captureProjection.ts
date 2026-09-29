import type { GameEventActor } from '../gameEvents/types'
import type {
  HockeyEvent,
  HockeyMatchParticipant,
  HockeyMatchProjection,
  HockeyMatchSetup,
  HockeyOnIce,
  HockeyPeriodRecord,
  HockeySide,
} from './types'
import { HOCKEY_EMPTY_NET } from './types'

/** Semantic checks for capture events; replay turns a returned message into a failure. */

export function otherHockeySide(side: HockeySide): HockeySide {
  return side === 'tracked' ? 'opponent' : 'tracked'
}

/** The skater count on the ice for a full-strength side in this period. */
export function hockeyPeriodSkaters(setup: HockeyMatchSetup, period: Pick<HockeyPeriodRecord, 'kind'>): number {
  const rules = setup.rulesSnapshot
  return period.kind === 'overtime' && rules.overtime ? rules.overtime.skaters : rules.skatersPerSide
}

export function checkHockeyShotActors(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection,
  event: HockeyEvent<'hockey.shot'>
): string | null {
  const shooting = event.teamSide
  const defending = otherHockeySide(shooting)
  const byRole = new Map(event.actors.map(actor => [actor.role, actor]))
  for (const actor of event.actors) {
    const side = actor.role === 'goalie' || actor.role === 'blocker' ? defending : shooting
    const message = side === 'tracked'
      ? checkTrackedActor(setup, actor)
      : checkOpponentActor(projection, actor)
    if (message) return message
  }
  const identities = ['shooter', 'assist_primary', 'assist_secondary']
    .map(role => byRole.get(role))
    .filter((actor): actor is GameEventActor => Boolean(actor))
    .map(actorIdentity)
  if (new Set(identities).size !== identities.length) return 'The scorer and assisters must be different players.'
  return null
}

/**
 * A tracked actor is a dressed participant. Goalies stop shots; everyone else who shoots,
 * assists or blocks is chosen from the whole dressed roster, never narrowed by the opening five.
 */
function checkTrackedActor(setup: HockeyMatchSetup, actor: GameEventActor): string | null {
  const participant = setup.participants.find(entry => entry.id === actor.participantId)
  if (!participant) return 'A tracked actor must be a dressed player.'
  if (actor.kind === 'player' ? actor.playerId !== participant.playerId : participant.playerId !== null) {
    return 'The actor does not match the dressed player.'
  }
  if (actor.role === 'goalie' && participant.dressedAs !== 'goalie') return 'Only a dressed goalie can face a shot.'
  if (actor.role === 'blocker' && participant.dressedAs !== 'skater') return 'Only a skater can block a shot.'
  if (actor.role === 'taker' && participant.dressedAs !== 'skater') return 'Only a skater can take a faceoff.'
  return null
}

/**
 * Faceoffs, hits, takeaways and giveaways (HKY-2C). A faceoff's tracked taker is a dressed
 * skater and its opponent taker a label; a hit's `hit_player` is on the other side.
 */
export function checkHockeyPlayActors(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection,
  event: HockeyEvent<'hockey.faceoff' | 'hockey.hit' | 'hockey.takeaway' | 'hockey.giveaway'>
): string | null {
  for (const actor of event.actors) {
    let side: HockeySide
    if (event.eventType === 'hockey.faceoff') side = actor.role === 'taker' ? 'tracked' : 'opponent'
    else if (actor.role === 'hit_player') side = otherHockeySide(event.teamSide as HockeySide)
    else side = event.teamSide as HockeySide
    const message = side === 'tracked' ? checkTrackedActor(setup, actor) : checkOpponentActor(projection, actor)
    if (message) return message
  }
  return null
}

/** Opponent actors are labels; only the goalie carries an opponent goalie identity. */
function checkOpponentActor(projection: HockeyMatchProjection, actor: GameEventActor): string | null {
  if (actor.kind !== 'unknown') return 'Opponent actors are labels.'
  if (actor.role === 'goalie') {
    return projection.opponentGoalies.some(goalie => goalie.id === actor.participantId)
      ? null
      : 'The opponent goalie is not known to this game.'
  }
  return actor.participantId === undefined ? null : 'Opponent skaters are labels, not match participants.'
}

function actorIdentity(actor: GameEventActor): string {
  return actor.participantId ?? `label:${(actor.label ?? '').trim().toLowerCase()}`
}

/** Structural possibility of the tracked side's on-ice set for this period (HKY-2 on-ice prompt). */
export function checkHockeyOnIce(
  setup: HockeyMatchSetup,
  period: Pick<HockeyPeriodRecord, 'kind'>,
  onIce: HockeyOnIce
): string | null {
  const dressed = new Map<string, HockeyMatchParticipant>(setup.participants.map(entry => [entry.id, entry]))
  for (const id of onIce.skaterParticipantIds) {
    if (dressed.get(id)?.dressedAs !== 'skater') return 'On-ice skaters must be dressed skaters.'
  }
  if (onIce.goalie !== null && onIce.goalie !== HOCKEY_EMPTY_NET && dressed.get(onIce.goalie)?.dressedAs !== 'goalie') {
    return 'The on-ice goalie must be a dressed goalie.'
  }
  if (onIce.status !== 'complete') return null
  const cap = hockeyPeriodSkaters(setup, period)
  const minimum = Math.min(setup.rulesSnapshot.minimumSkaters, cap)
  const maximum = onIce.goalie === HOCKEY_EMPTY_NET ? cap + 1 : cap
  const count = onIce.skaterParticipantIds.length
  if (count < minimum || count > maximum) {
    return `A complete set has ${minimum}-${maximum} skaters in this period.`
  }
  return null
}

/** Checks a goalie change against the net it changes. */
export function checkHockeyGoalieChange(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection,
  event: HockeyEvent<'hockey.goalie_change'>
): string | null {
  const side = event.teamSide
  const current = projection.goalieInNet[side]
  const incoming = event.payload.inParticipantId
  if (incoming === null) return current === null ? 'The net is already empty.' : null
  if (incoming === current) return 'That goalie is already in net.'
  if (side === 'tracked') {
    const participant = setup.participants.find(entry => entry.id === incoming)
    return participant?.dressedAs === 'goalie' ? null : 'Only a dressed goalie can go in net.'
  }
  const added = event.payload.newOpponentGoalie
  const known = projection.opponentGoalies.some(goalie => goalie.id === incoming)
  if (added) {
    if (known || setup.participants.some(entry => entry.id === added.id)) return 'That goalie id is already in use.'
    return null
  }
  return known ? null : 'Add the opponent goalie before putting them in net.'
}
