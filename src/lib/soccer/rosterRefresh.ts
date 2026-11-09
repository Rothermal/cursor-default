import type { GameState } from '../../types'
import type { RosterRefreshDiff, RosterRefreshParticipant } from '../rosterRefresh'
import { createSoccerUuid } from './id'
import { addSoccerMatchParticipant, updateSoccerParticipantNumbers, type SoccerLiveResult } from './live'
import { parseSoccerRosterRole } from './rosterRole'

/**
 * RTN-3A: Soccer participants in the shared roster refresh shape. Soccer roles
 * are tactical (role changes are their own events), so refresh compares numbers only.
 */
export function soccerRosterRefreshParticipants(state: GameState): RosterRefreshParticipant[] {
  if (state.sportGameState?.sportId !== 'soccer') return []
  return Object.values(state.sportGameState.projection.participants).map(participant => ({
    participantId: participant.participantId,
    playerId: participant.playerId,
    teamSide: 'tracked',
    displayName: participant.displayName,
    number: participant.number,
    position: null,
  }))
}

export type SoccerNumberEditMode = 'live' | 'reopen' | 'not_started'

/** Numbers can change while the match is active; a final or ended match needs Reopen first. */
export function soccerNumberEditMode(state: GameState): SoccerNumberEditMode {
  if (state.sportGameState?.sportId !== 'soccer') return 'not_started'
  if (state.cloudSync.gameStatus === 'final') return 'reopen'
  const status = state.sportGameState.projection.status
  if (status === 'ended' || status === 'suspended') return 'reopen'
  if (status === 'not_started') return 'not_started'
  return 'live'
}

export function soccerRosterTeamId(state: GameState): string | null {
  return state.sportGameState?.sportId === 'soccer' ? state.sportGameState.setup.sourceTeamId : null
}

/** Whether a participant is a team roster player (Soccer roster rows use the player id). */
export function isSoccerRosterParticipant(state: GameState, participantId: string): boolean {
  if (state.sportGameState?.sportId !== 'soccer' || !state.sportGameState.setup.sourceTeamId) return false
  return Boolean(state.sportGameState.projection.participants[participantId]?.playerId)
}

/**
 * Apply a Soccer roster refresh: one number event for every selected change
 * (one Field Undo), then one bench addition per selected roster player.
 * Stops at the first failure and returns the original state.
 */
export function applySoccerRosterRefresh(
  state: GameState,
  options: {
    recorderUserId: string | null
    diff: RosterRefreshDiff
    updateParticipantIds: string[]
    additionPlayerIds: string[]
    nowMs?: number
  }
): SoccerLiveResult {
  let next: SoccerLiveResult | null = null
  const current = () => next?.ok ? next.state : state
  const updates = options.diff.updates.filter(update => options.updateParticipantIds.includes(update.participantId))
  if (updates.length > 0) {
    next = updateSoccerParticipantNumbers(
      state,
      updates.map(update => ({ participantId: update.participantId, number: update.to.number })),
      'roster_refresh',
      { recorderUserId: options.recorderUserId, nowMs: options.nowMs }
    )
    if (!next.ok) return { ...next, state }
  }
  for (const addition of options.diff.additions.filter(item => options.additionPlayerIds.includes(item.playerId))) {
    const result = addSoccerMatchParticipant(current(), {
      id: `soccer-roster:${createSoccerUuid()}`,
      kind: 'player',
      playerId: addition.playerId,
      displayName: addition.name,
      number: addition.number,
      initialStatus: 'bench',
      initialRole: parseSoccerRosterRole(addition.position),
    }, 'bench', { recorderUserId: options.recorderUserId, nowMs: options.nowMs })
    if (!result.ok) return { ...result, state }
    next = result
  }
  return next ?? { ok: false, state, message: 'Nothing selected.' }
}
