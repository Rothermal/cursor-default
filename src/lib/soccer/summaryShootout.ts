import type { GameEventInspection, GameEventTeamSide } from '../gameEvents/types'
import type {
  SoccerMatchProjection,
  SoccerShootoutKickEvent,
  SoccerShootoutKickOutcome,
} from './types'

export interface SoccerShootoutAttemptReview {
  event: SoccerShootoutKickEvent | null
  eventId: string
  teamSide: GameEventTeamSide
  outcome: SoccerShootoutKickOutcome
  outcomeLabel: string
  kickerKey: string
  kickerLabel: string
  goalkeeperKey: string
  goalkeeperLabel: string
  kickNumber: number
  round: number
  suddenDeath: boolean
  advances: boolean
  scored: boolean
}

export interface SoccerShootoutRoundReview {
  round: number
  label: string
  suddenDeath: boolean
  tracked: SoccerShootoutAttemptReview[]
  opponent: SoccerShootoutAttemptReview[]
}

export interface SoccerShootoutKickerSummary {
  key: string
  teamSide: GameEventTeamSide
  label: string
  attempts: number
  scores: number
  savesAgainst: number
  misses: number
  woodwork: number
  retakes: number
  forfeits: number
}

export interface SoccerShootoutGoalkeeperSummary {
  key: string
  teamSide: GameEventTeamSide
  label: string
  attemptsFaced: number
  saves: number
}

export interface SoccerShootoutReview {
  matchStatus: SoccerMatchProjection['status']
  endReason: SoccerMatchProjection['endReason']
  firstKickingSide: GameEventTeamSide
  initialKicksPerSide: number
  initialProgress: {
    tracked: number
    opponent: number
  }
  score: {
    tracked: number
    opponent: number
  }
  attempts: {
    tracked: number
    opponent: number
  }
  nextSide: GameEventTeamSide
  decided: boolean
  winner: GameEventTeamSide | null
  suddenDeathRound: number | null
  rounds: SoccerShootoutRoundReview[]
  kickers: SoccerShootoutKickerSummary[]
  goalkeepers: SoccerShootoutGoalkeeperSummary[]
}

export function soccerSummaryShootoutReview(
  projection: SoccerMatchProjection,
  inspection: GameEventInspection
): SoccerShootoutReview | null {
  const shootout = projection.shootout
  if (!shootout) return null
  const events = new Map(
    inspection.activeEvents
      .filter((event): event is SoccerShootoutKickEvent =>
        event.eventType === 'soccer.shootout_kick'
      )
      .map(event => [event.id, event])
  )
  const attempts = shootout.kicks.map(kick => {
    const event = events.get(kick.eventId) ?? null
    return {
      event,
      eventId: kick.eventId,
      teamSide: kick.teamSide,
      outcome: kick.outcome,
      outcomeLabel: shootoutOutcomeLabel(kick.outcome),
      kickerKey: kick.kickerKey,
      kickerLabel: shootoutActorLabel(
        projection,
        kick.teamSide,
        kick.kickerKey,
        event?.actors.find(actor => actor.role === 'kicker')?.label
      ),
      goalkeeperKey: kick.goalkeeperKey,
      goalkeeperLabel: shootoutActorLabel(
        projection,
        oppositeSide(kick.teamSide),
        kick.goalkeeperKey,
        event?.actors.find(actor => actor.role === 'goalkeeper')?.label
      ),
      kickNumber: kick.kickNumber,
      round: kick.round,
      suddenDeath: kick.suddenDeath,
      advances: kick.advances,
      scored: kick.scored,
    } satisfies SoccerShootoutAttemptReview
  })

  return {
    matchStatus: projection.status,
    endReason: projection.endReason,
    firstKickingSide: shootout.firstKickingSide,
    initialKicksPerSide: shootout.initialKicksPerSide,
    initialProgress: {
      tracked: Math.min(shootout.attempts.tracked, shootout.initialKicksPerSide),
      opponent: Math.min(shootout.attempts.opponent, shootout.initialKicksPerSide),
    },
    score: { ...shootout.score },
    attempts: { ...shootout.attempts },
    nextSide: shootout.nextSide,
    decided: shootout.decided,
    winner: shootout.winner,
    suddenDeathRound: shootout.suddenDeathRound,
    rounds: pairShootoutRounds(attempts, shootout.initialKicksPerSide),
    kickers: kickerSummaries(attempts),
    goalkeepers: goalkeeperSummaries(attempts),
  }
}

function pairShootoutRounds(
  attempts: SoccerShootoutAttemptReview[],
  initialKicksPerSide: number
): SoccerShootoutRoundReview[] {
  const rounds = new Map<number, SoccerShootoutRoundReview>()
  for (const attempt of attempts) {
    let round = rounds.get(attempt.round)
    if (!round) {
      const suddenDeath = attempt.suddenDeath || attempt.round > initialKicksPerSide
      round = {
        round: attempt.round,
        label: suddenDeath
          ? `Sudden Death ${Math.max(1, attempt.round - initialKicksPerSide)}`
          : `Round ${attempt.round}`,
        suddenDeath,
        tracked: [],
        opponent: [],
      }
      rounds.set(attempt.round, round)
    }
    round[attempt.teamSide].push(attempt)
  }
  return [...rounds.values()].sort((left, right) => left.round - right.round)
}

function kickerSummaries(
  attempts: SoccerShootoutAttemptReview[]
): SoccerShootoutKickerSummary[] {
  const summaries = new Map<string, SoccerShootoutKickerSummary>()
  for (const attempt of attempts) {
    const id = `${attempt.teamSide}:${attempt.kickerKey}`
    let summary = summaries.get(id)
    if (!summary) {
      summary = {
        key: attempt.kickerKey,
        teamSide: attempt.teamSide,
        label: attempt.kickerLabel,
        attempts: 0,
        scores: 0,
        savesAgainst: 0,
        misses: 0,
        woodwork: 0,
        retakes: 0,
        forfeits: 0,
      }
      summaries.set(id, summary)
    }
    if (attempt.advances) summary.attempts += 1
    if (attempt.outcome === 'scored') summary.scores += 1
    if (attempt.outcome === 'saved') summary.savesAgainst += 1
    if (attempt.outcome === 'missed') summary.misses += 1
    if (attempt.outcome === 'woodwork') summary.woodwork += 1
    if (attempt.outcome === 'retake') summary.retakes += 1
    if (attempt.outcome === 'forfeited') summary.forfeits += 1
  }
  return [...summaries.values()].sort(summarySort)
}

function goalkeeperSummaries(
  attempts: SoccerShootoutAttemptReview[]
): SoccerShootoutGoalkeeperSummary[] {
  const summaries = new Map<string, SoccerShootoutGoalkeeperSummary>()
  for (const attempt of attempts) {
    const teamSide = oppositeSide(attempt.teamSide)
    const id = `${teamSide}:${attempt.goalkeeperKey}`
    let summary = summaries.get(id)
    if (!summary) {
      summary = {
        key: attempt.goalkeeperKey,
        teamSide,
        label: attempt.goalkeeperLabel,
        attemptsFaced: 0,
        saves: 0,
      }
      summaries.set(id, summary)
    }
    if (attempt.advances) summary.attemptsFaced += 1
    if (attempt.outcome === 'saved') summary.saves += 1
  }
  return [...summaries.values()].sort(summarySort)
}

function shootoutActorLabel(
  projection: SoccerMatchProjection,
  teamSide: GameEventTeamSide,
  key: string,
  eventLabel: string | undefined
): string {
  if (key.startsWith('participant:')) {
    const participant = projection.participants[key.slice('participant:'.length)]
    if (participant) {
      return participant.number
        ? `#${participant.number} ${participant.displayName}`
        : participant.displayName
    }
  }
  if (key.startsWith('anonymous:')) {
    const slot = key.slice('anonymous:'.length)
    return `${teamSide === 'tracked' ? 'Tracked' : 'Opponent'} slot ${slot}`
  }
  if (eventLabel?.trim()) return eventLabel.trim()
  const separator = key.indexOf(':')
  const fallback = separator >= 0 ? key.slice(separator + 1) : key
  return fallback.trim() || 'Unknown'
}

function shootoutOutcomeLabel(outcome: SoccerShootoutKickOutcome): string {
  if (outcome === 'scored') return 'Scored'
  if (outcome === 'saved') return 'Saved'
  if (outcome === 'missed') return 'Missed'
  if (outcome === 'woodwork') return 'Woodwork'
  if (outcome === 'retake') return 'Retake - did not advance'
  return 'Forfeited'
}

function summarySort<T extends {
  teamSide: GameEventTeamSide
  label: string
  key: string
}>(left: T, right: T): number {
  return sideOrder(left.teamSide) - sideOrder(right.teamSide) ||
    left.label.localeCompare(right.label) ||
    left.key.localeCompare(right.key)
}

function sideOrder(side: GameEventTeamSide): number {
  return side === 'tracked' ? 0 : 1
}

function oppositeSide(side: GameEventTeamSide): GameEventTeamSide {
  return side === 'tracked' ? 'opponent' : 'tracked'
}
