import type { GameEventActor } from '../gameEvents/types'
import { hockeyParticipantRemoved } from './captureProjection'
import type {
  HockeyMatchParticipant,
  HockeyMatchProjection,
  HockeyMatchResult,
  HockeyMatchSetup,
  HockeyShootoutProjection,
  HockeySide,
} from './types'

/**
 * The hockey shootout (HKY-3C). Sides alternate from `firstSide`; after the rules' rounds
 * the shootout goes to sudden death. It ends early once one side cannot be caught.
 * Attempts never count as shots, goals or saves.
 */

const other = (side: HockeySide): HockeySide => (side === 'tracked' ? 'opponent' : 'tracked')

/** Recomputes the next side, round and winner after the attempts so far. */
export function refreshHockeyShootout(shootout: HockeyShootoutProjection, rounds: number): void {
  const taken = { tracked: 0, opponent: 0 }
  for (const attempt of shootout.attempts) taken[attempt.side] += 1
  const goals = shootout.goals
  let winner: HockeySide | null = null
  if (taken.tracked <= rounds && taken.opponent <= rounds) {
    // Within the rounds: decided once the trailing side's remaining attempts cannot catch up.
    for (const side of ['tracked', 'opponent'] as const) {
      const rival = other(side)
      if (goals[side] > goals[rival] + (rounds - taken[rival])) winner = side
    }
  } else if (taken.tracked === taken.opponent && goals.tracked !== goals.opponent) {
    // Sudden death: decided after a complete round with a leader.
    winner = goals.tracked > goals.opponent ? 'tracked' : 'opponent'
  }
  shootout.winner = winner
  if (winner) {
    shootout.nextSide = null
    return
  }
  const first = shootout.firstSide
  const next = taken[first] === taken[other(first)] ? first : other(first)
  shootout.nextSide = next
  shootout.round = taken[next] + 1
  shootout.suddenDeath = shootout.round > rounds
}

/** Tracked players who may shoot: dressed skaters still in the game. */
export function hockeyShootoutShooterPool(
  setup: HockeyMatchSetup,
  projection: Pick<HockeyMatchProjection, 'removedParticipantIds'>
): HockeyMatchParticipant[] {
  return setup.participants.filter(entry => entry.dressedAs === 'skater' && !hockeyParticipantRemoved(projection, entry.id))
}

/**
 * Shooter eligibility from `shootout.repeatShooters`: `never` allows one attempt each,
 * `after_all` lets a tracked player shoot again only once every eligible teammate has shot
 * as often, and `any` has no limit. Opponent shooters are labels with no known roster, so
 * `after_all` cannot be checked for them and only `never` compares labels.
 */
export function checkHockeyShootoutShooter(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection,
  side: HockeySide,
  shooter: GameEventActor | undefined
): string | null {
  const shootout = projection.shootout
  const rules = setup.rulesSnapshot.shootout
  if (!shootout || !rules || !shooter) return null
  const sameSide = shootout.attempts.filter(attempt => attempt.side === side)
  if (side === 'tracked') {
    const pool = hockeyShootoutShooterPool(setup, projection)
    const participant = pool.find(entry => entry.id === shooter.participantId)
    if (!participant) return 'A shootout shooter is a dressed skater still in the game.'
    const count = (id: string) => sameSide.filter(attempt => attempt.shooterParticipantId === id).length
    const mine = count(participant.id)
    if (rules.repeatShooters === 'never' && mine > 0) return `${participant.displayName} has already shot.`
    if (rules.repeatShooters === 'after_all' && pool.some(entry => count(entry.id) < mine)) {
      return `${participant.displayName} can shoot again once every other skater has shot.`
    }
    return null
  }
  if (shooter.participantId !== undefined) return 'Opponent shooters are labels.'
  const label = (shooter.label ?? '').trim().toLowerCase()
  if (rules.repeatShooters === 'never' && sameSide.some(attempt => (attempt.shooterLabel ?? '').trim().toLowerCase() === label)) {
    return `${shooter.label} has already shot.`
  }
  return null
}

/** Tracked skaters the shootout rules allow to shoot next, for the picker. */
export function hockeyShootoutEligibleShooters(
  setup: HockeyMatchSetup,
  projection: HockeyMatchProjection
): HockeyMatchParticipant[] {
  return hockeyShootoutShooterPool(setup, projection).filter(participant =>
    checkHockeyShootoutShooter(setup, projection, 'tracked', { role: 'shooter', kind: 'unknown', label: participant.displayName, participantId: participant.id }) === null
  )
}

/** `3-2`, `3-2 (OT)` or `3-2 (SO)`. */
export function formatHockeyFinalScore(result: HockeyMatchResult): string {
  const score = `${result.finalScore.tracked}-${result.finalScore.opponent}`
  if (result.decidedIn === 'overtime') return `${score} (OT)`
  if (result.decidedIn === 'shootout') return `${score} (SO)`
  return score
}

export const HOCKEY_RESULT_LABELS = { win: 'Win', loss: 'Loss', tie: 'Tie' } as const
