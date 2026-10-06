import { hockeyOpponentGoalieLabel, hockeyParticipantLabel } from './captureCommands'
import type { HockeyGameLines } from './gameLines'
import { refreshHockeyShootout } from './shootout'
import type {
  HockeyShootoutAttemptRecord,
  HockeyShootoutOutcome,
  HockeySide,
  HockeySportGameState,
} from './types'

/**
 * The Summary's Shootout tab (HKY-6A2): rounds from the replayed shootout, the deciding
 * attempt and the tracked players' shootout lines. Attempts never count as shots, goals or
 * saves (HKY-3C), so nothing here feeds another total.
 */

export const HOCKEY_SHOOTOUT_OUTCOME_LABELS: Record<HockeyShootoutOutcome, string> = {
  goal: 'Goal',
  saved: 'Saved',
  missed: 'Missed',
}

export interface HockeyShootoutAttemptRow {
  eventId: string
  side: HockeySide
  shooter: string
  goalie: string
  outcome: HockeyShootoutOutcome
  /** The attempt after which the shootout could no longer be caught. */
  deciding: boolean
}

export interface HockeyShootoutRoundRow {
  round: number
  suddenDeath: boolean
  /** The first side's attempt first. */
  attempts: HockeyShootoutAttemptRow[]
}

export interface HockeyShootoutShooterLine {
  participantId: string
  name: string
  attempts: number
  goals: number
}

export interface HockeyShootoutGoalieLine {
  participantId: string
  name: string
  shotsAgainst: number
  saves: number
}

export interface HockeyShootoutSummary {
  firstSide: HockeySide
  goals: Record<HockeySide, number>
  winner: HockeySide | null
  /** The rules' rounds before sudden death. */
  rounds: number
  roundRows: HockeyShootoutRoundRow[]
  shooters: HockeyShootoutShooterLine[]
  goalies: HockeyShootoutGoalieLine[]
}

/** Null until a shootout starts. */
export function hockeyShootoutSummary(sport: HockeySportGameState, lines: HockeyGameLines): HockeyShootoutSummary | null {
  const { setup, projection } = sport
  const shootout = projection.shootout
  if (!shootout) return null
  const rounds = setup.rulesSnapshot.shootout?.rounds ?? 0
  const decidingId = decidingAttemptId(shootout.firstSide, shootout.attempts, rounds)

  const participantName = (id: string | null) => {
    const participant = id ? setup.participants.find(entry => entry.id === id) : undefined
    return participant ? hockeyParticipantLabel(participant) : null
  }
  const goalieName = (attempt: HockeyShootoutAttemptRecord) => {
    if (!attempt.goalieId) return 'Empty net'
    if (attempt.side === 'opponent') return participantName(attempt.goalieId) ?? 'Goalie'
    const goalie = projection.opponentGoalies.find(entry => entry.id === attempt.goalieId)
    return goalie ? hockeyOpponentGoalieLabel(goalie) : 'Opponent goalie'
  }

  const roundRows: HockeyShootoutRoundRow[] = []
  for (const attempt of shootout.attempts) {
    let row = roundRows.find(entry => entry.round === attempt.round)
    if (!row) {
      row = { round: attempt.round, suddenDeath: attempt.round > rounds, attempts: [] }
      roundRows.push(row)
    }
    row.attempts.push({
      eventId: attempt.eventId,
      side: attempt.side,
      shooter: participantName(attempt.shooterParticipantId) ?? attempt.shooterLabel ?? 'Not named',
      goalie: goalieName(attempt),
      outcome: attempt.outcome,
      deciding: attempt.eventId === decidingId,
    })
  }
  for (const row of roundRows) {
    row.attempts.sort((left, right) => Number(right.side === shootout.firstSide) - Number(left.side === shootout.firstSide))
  }

  const shooters: HockeyShootoutShooterLine[] = []
  const goalies: HockeyShootoutGoalieLine[] = []
  for (const participant of setup.participants) {
    const line = lines.participants[participant.id] ?? {}
    if ((line.hky_so_att ?? 0) > 0) {
      shooters.push({ participantId: participant.id, name: hockeyParticipantLabel(participant), attempts: line.hky_so_att!, goals: line.hky_so_g ?? 0 })
    }
    if ((line.hky_so_sa ?? 0) > 0) {
      goalies.push({ participantId: participant.id, name: hockeyParticipantLabel(participant), shotsAgainst: line.hky_so_sa!, saves: line.hky_so_sv ?? 0 })
    }
  }

  return {
    firstSide: shootout.firstSide,
    goals: { ...shootout.goals },
    winner: shootout.winner,
    rounds,
    roundRows,
    shooters,
    goalies,
  }
}

/** Replays the attempts with the tracker's rule and returns the one that settled it. */
function decidingAttemptId(
  firstSide: HockeySide,
  attempts: readonly HockeyShootoutAttemptRecord[],
  rounds: number
): string | null {
  const goals = { tracked: 0, opponent: 0 }
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index]
    if (attempt.outcome === 'goal') goals[attempt.side] += 1
    const prefix = {
      startedEventId: '',
      firstSide,
      attempts: attempts.slice(0, index + 1),
      goals: { ...goals },
      nextSide: null,
      round: 1,
      suddenDeath: false,
      winner: null,
    }
    refreshHockeyShootout(prefix, rounds)
    if (prefix.winner) return attempt.eventId
  }
  return null
}
