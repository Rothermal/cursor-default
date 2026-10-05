import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { setBaseballPitcherDecisions, type BaseballCommandContext, type BaseballCommandResult, baseballSportState } from './commands'
import { replayBaseballDecisionTrail, replayBaseballLineupHistory, type BaseballDecisionStep } from './projector'
import { baseballPersonLabel } from './trackerView'
import type {
  BaseballPitcherDecisions,
  BaseballPitcherDecisionsPayload,
  BaseballSideDecisions,
  BaseballSportGameState,
  BaseballTeamSide,
} from './types'
import { baseballActiveEvents, baseballDecisionEpochId } from './units'

/**
 * Pitcher decisions (BSB-5D). The recorder sets W, L, SV and holds after the game is final;
 * the app suggests W, L and SV in simplified official-scoring form and the recorder's choice
 * always wins. Decisions belong to one completed-game epoch (the game end they were made
 * for): reopening ends the epoch, so they stop counting while the event stays in history.
 */

const SIDES: readonly BaseballTeamSide[] = ['tracked', 'opponent']

export function baseballEmptySideDecisions(): BaseballSideDecisions {
  return { win: null, loss: null, save: null, holds: [] }
}

export function baseballEmptyDecisions(): BaseballPitcherDecisions {
  return { tracked: baseballEmptySideDecisions(), opponent: baseballEmptySideDecisions() }
}

export interface BaseballDecisionSuggestion {
  decisions: BaseballPitcherDecisions
  /** Why a decision was left blank, for the sheet. */
  notes: string[]
}

export interface BaseballDecisionsView {
  /** The game is final, so decisions can be set for this epoch. */
  canSet: boolean
  epochId: string | null
  /** The winning side, or null for a tie or a game without a winner. */
  winner: BaseballTeamSide | null
  /** The newest decisions recorded for this epoch, or null. */
  current: { eventId: string; decisions: BaseballPitcherDecisions } | null
  /** Why the stored decisions no longer fit the game ("Check decisions"). */
  issues: string[]
  suggestion: BaseballDecisionSuggestion
  /** Pitchers who appeared for each side, in the order they took the mound. */
  pitchers: Record<BaseballTeamSide, string[]>
}

/** Everything the Summary needs about decisions, read from the active events. */
export function baseballDecisionsView(sport: BaseballSportGameState, events: readonly GameEvent[]): BaseballDecisionsView {
  const epochId = sport.projection.status === 'final' ? baseballDecisionEpochId(events) : null
  const pitchers = replayBaseballLineupHistory(sport.setup, events).pitchers
  const winner = baseballDecisionWinner(sport)
  let current: BaseballDecisionsView['current'] = null
  if (epochId) {
    for (const event of events) {
      if (event.eventType !== 'baseball.pitcher_decisions') continue
      const payload = event.payload as unknown as BaseballPitcherDecisionsPayload
      // Capture order: the newest decisions in the epoch win as a whole.
      if (payload.epochId === epochId) current = { eventId: event.id, decisions: payload.decisions }
    }
  }
  return {
    canSet: epochId !== null,
    epochId,
    winner,
    current,
    issues: current ? baseballDecisionIssues(sport, events, current.decisions) : [],
    suggestion: epochId ? baseballSuggestDecisions(sport, events) : { decisions: baseballEmptyDecisions(), notes: [] },
    pitchers,
  }
}

/** A winner who can have pitching decisions: not a tie, a forfeit or an unfinished game. */
function baseballDecisionWinner(sport: BaseballSportGameState): BaseballTeamSide | null {
  const result = sport.projection.result
  if (sport.projection.status !== 'final' || !result || result.outcome === 'forfeit') return null
  return result.winner === 'tracked' || result.winner === 'opponent' ? result.winner : null
}

/**
 * Checks decisions against the game as it is now: each pitcher pitched for that side, W and L
 * on opposite sides with W for the winner, SV only for the winner and not the W pitcher, and
 * holds never the W, L or SV pitcher. Empty when they fit.
 */
export function baseballDecisionIssues(
  sport: BaseballSportGameState,
  events: readonly GameEvent[],
  decisions: BaseballPitcherDecisions
): string[] {
  const issues: string[] = []
  const pitchers = replayBaseballLineupHistory(sport.setup, events).pitchers
  const name = (id: string) => decisionName(sport, id)
  const winner = baseballDecisionWinner(sport)
  for (const side of SIDES) {
    const chosen = decisions[side]
    const ids = [chosen.win, chosen.loss, chosen.save, ...chosen.holds].filter((id): id is string => id !== null)
    for (const id of new Set(ids)) {
      if (!pitchers[side].includes(id)) issues.push(`${name(id)} did not pitch for this team.`)
    }
    if (!winner && (chosen.win || chosen.loss || chosen.save)) {
      issues.push('This game has no winner, so no one gets a W, L or SV.')
      continue
    }
    if (chosen.win && side !== winner) issues.push('The W goes to a pitcher on the winning team.')
    if (chosen.loss && side === winner) issues.push('The L goes to a pitcher on the losing team.')
    if (chosen.save && side !== winner) issues.push('The SV goes to a pitcher on the winning team.')
    if (chosen.save && chosen.save === chosen.win) issues.push(`${name(chosen.save)} cannot get both the W and the SV.`)
    for (const id of chosen.holds) {
      if (id === chosen.win || id === chosen.loss || id === chosen.save) {
        issues.push(`${name(id)} cannot get a hold and a W, L or SV.`)
      }
    }
  }
  return [...new Set(issues)]
}

/**
 * The suggested W, L and SV (plan section 4.4), from the same replay that builds the score.
 * W is the winners' pitcher of record when they took the lead for good, unless that is a
 * starter short of the minimum innings; L is the pitcher charged with the go-ahead run; SV
 * follows Official Baseball Rules 9.19 for the pitcher who finished the game. Holds are never
 * suggested. Anything the replay cannot establish stays blank with a note.
 */
export function baseballSuggestDecisions(sport: BaseballSportGameState, events: readonly GameEvent[]): BaseballDecisionSuggestion {
  const decisions = baseballEmptyDecisions()
  const notes: string[] = []
  const winner = baseballDecisionWinner(sport)
  if (!winner) {
    if (sport.projection.status === 'final') notes.push('Nothing is suggested for a tie or a forfeit.')
    return { decisions, notes }
  }
  const loser: BaseballTeamSide = winner === 'tracked' ? 'opponent' : 'tracked'
  const trail = replayBaseballDecisionTrail(sport.setup, events)
  if (trail.incomplete) {
    notes.push('The play history has a problem, so nothing is suggested.')
    return { decisions, notes }
  }
  const lead = (score: Record<BaseballTeamSide, number>) => score[winner] - score[loser]
  const steps = trail.steps
  // The step that gave the winners the lead they never gave back.
  let goAhead = -1
  steps.forEach((step, index) => {
    if (lead(step.scoreBefore) <= 0 && lead(step.scoreAfter) > 0) goAhead = index
  })
  const pitchers = replayBaseballLineupHistory(sport.setup, events).pitchers
  const name = (id: string) => baseballPersonLabel(sport, id).name

  if (goAhead < 0 || steps[goAhead].runs.length === 0) {
    notes.push('The winning lead came from a score adjustment, so W and L are left for you.')
  } else {
    const step = steps[goAhead]
    const win = step.pitchersBefore[winner]
    const starter = pitchers[winner][0]
    const minimumInnings = Math.floor((5 * sport.setup.rulesSnapshot.scheduledInnings) / 9)
    const starterOuts = sport.projection.pitchingLines[starter]?.outs ?? 0
    if (win === starter && starterOuts < minimumInnings * 3) {
      notes.push(`${name(starter)} started but pitched fewer than ${minimumInnings} innings, so choose the W among the relievers.`)
    } else {
      decisions[winner].win = win
    }
    // The go-ahead run is the winners' run that first put them ahead of the losers' score then.
    const runIndex = step.scoreBefore[loser] - step.scoreBefore[winner]
    const loss = step.runs.filter(run => run.side === winner)[runIndex]?.pitcherId ?? null
    if (loss) decisions[loser].loss = loss
    else notes.push('The go-ahead run could not be traced to a pitcher, so choose the L.')
  }

  const save = suggestSave(sport, steps, winner, loser, decisions[winner].win, pitchers[winner][0])
  if (save.pitcherId) decisions[winner].save = save.pitcherId
  if (save.note) notes.push(save.note)
  return { decisions, notes }
}

function suggestSave(
  sport: BaseballSportGameState,
  steps: readonly BaseballDecisionStep[],
  winner: BaseballTeamSide,
  loser: BaseballTeamSide,
  winId: string | null,
  starterId: string | undefined
): { pitcherId: string | null; note: string | null } {
  const none = { pitcherId: null, note: null }
  const closer = sport.projection.lineups[winner].pitcherId
  // The SV can never go to the W pitcher, so with W open it stays open too.
  if (!winId) return none
  if (!closer || closer === winId || closer === starterId) return none
  if (sport.setup.rulesSnapshot.variant !== 'baseball') {
    return { pitcherId: null, note: 'Softball save rules differ, so choose any SV by hand.' }
  }
  const unclear = { pitcherId: null, note: 'The replay cannot tell whether the last pitcher earned a save, so choose any SV by hand.' }
  if (sport.projection.warnings.length > 0) return unclear
  const entry = steps.findIndex(step => step.pitcherId === closer && step.fieldingSide === winner)
  if (entry < 0) return none
  const entryStep = steps[entry]
  if (entryStep.eventType === 'baseball.plate_appearance') return unclear
  const after = steps.slice(entry)
  if (after.some(step => step.eventType === 'baseball.score_adjustment')) return unclear
  const lead = (score: Record<BaseballTeamSide, number>) => score[winner] - score[loser]
  const entryLead = lead(entryStep.scoreBefore)
  // The winners led from the moment the closer entered to the end.
  if (entryLead <= 0 || after.some(step => lead(step.scoreAfter) <= 0)) return none
  const outs = sport.projection.pitchingLines[closer]?.outs ?? 0
  if (outs < 1) return none
  const eligible =
    (entryLead <= 3 && outs >= 3) ||
    entryLead <= entryStep.runnersOnBefore + 2 ||
    outs >= 9
  return eligible ? { pitcherId: closer, note: null } : none
}

/** Checks the decisions against the game, then records them for the current epoch. */
export function saveBaseballPitcherDecisions(
  state: GameState,
  decisions: BaseballPitcherDecisions,
  context: BaseballCommandContext
): BaseballCommandResult {
  const sport = baseballSportState(state)
  if (!sport) return { ok: false, state, code: 'not_baseball', message: 'The active sport is not Baseball.' }
  const issues = baseballDecisionIssues(sport, baseballActiveEvents(state), decisions)
  if (issues.length > 0) return { ok: false, state, code: 'rejected', message: issues[0] }
  return setBaseballPitcherDecisions(state, decisions, context)
}

/** "W: #21 Lee · L: Starting pitcher · SV: #9 Kim · HLD: #4 Diaz", one side per line. */
export function baseballDecisionLabels(
  sport: BaseballSportGameState,
  decisions: BaseballPitcherDecisions
): Record<BaseballTeamSide, string[]> {
  const name = (id: string) => decisionName(sport, id)
  const side = (chosen: BaseballSideDecisions) => [
    ...(chosen.win ? [`W: ${name(chosen.win)}`] : []),
    ...(chosen.loss ? [`L: ${name(chosen.loss)}`] : []),
    ...(chosen.save ? [`SV: ${name(chosen.save)}`] : []),
    ...(chosen.holds.length ? [`HLD: ${chosen.holds.map(name).join(', ')}`] : []),
  ]
  return { tracked: side(decisions.tracked), opponent: side(decisions.opponent) }
}

/** A stored id whose pitcher a correction removed (an opponent reliever) has no label left. */
function decisionName(sport: BaseballSportGameState, id: string): string {
  const label = baseballPersonLabel(sport, id)
  return label.short === '?' && label.name === 'Unknown player' ? 'A pitcher no longer in this game' : label.name
}

/** The decision letters for one pitcher, for the box score ("W", "SV", "HLD"). */
export function baseballPitcherDecisionMarks(decisions: BaseballPitcherDecisions | null, side: BaseballTeamSide, pitcherId: string): string[] {
  if (!decisions) return []
  const chosen = decisions[side]
  return [
    ...(chosen.win === pitcherId ? ['W'] : []),
    ...(chosen.loss === pitcherId ? ['L'] : []),
    ...(chosen.save === pitcherId ? ['SV'] : []),
    ...(chosen.holds.includes(pitcherId) ? ['HLD'] : []),
  ]
}
