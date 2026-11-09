import type { GameState } from '../../types'
import type { BasketballMatchEvent } from './types'
import type { RosterRefreshDiff, RosterRefreshParticipant } from '../rosterRefresh'
import {
  addBasketballLateParticipant,
  createBasketballCaptureCommandId,
  updateBasketballParticipantDetails,
  type BasketballStateCommandResult,
} from './commands'

/** Participant ids of active late adds that were picked from the team roster. */
export function basketballRosterLateAddIds(events: readonly unknown[]): Set<string> {
  return new Set(events.flatMap(event => {
    const candidate = event as BasketballMatchEvent | null
    return candidate?.eventType === 'basketball.match_roster_added' &&
      candidate.deletedAt === null &&
      candidate.payload.fromRoster === true
      ? [candidate.payload.participant.id]
      : []
  }))
}

/** Whether a participant is a team roster player (setup roster or a roster late add). */
export function isBasketballRosterParticipant(state: GameState, participantId: string): boolean {
  if (state.sportGameState?.sportId !== 'basketball' || !state.sportGameState.setup.sourceTeamId) return false
  const participant = state.sportGameState.projection.participants[participantId]
  if (!participant || participant.teamSide !== 'tracked' || !participant.playerId) return false
  return state.sportGameState.setup.participants.some(item => item.id === participantId) ||
    basketballRosterLateAddIds(state.eventStream?.events ?? []).has(participantId)
}

/** RTN-2: the game's projected participants in the shared roster refresh shape. */
export function basketballRosterRefreshParticipants(state: GameState): RosterRefreshParticipant[] {
  if (state.sportGameState?.sportId !== 'basketball') return []
  return Object.values(state.sportGameState.projection.participants).map(participant => ({
    participantId: participant.participantId,
    playerId: participant.playerId,
    teamSide: participant.teamSide,
    displayName: participant.displayName,
    number: participant.number,
    position: participant.position,
  }))
}

/**
 * When a game's numbers and positions can change: `live` while a period is
 * open, `correcting` after a "Correct records" reopen (details only, no
 * additions), `reopen` for an ended, suspended or final game.
 */
export type BasketballDetailsEditMode = 'live' | 'correcting' | 'reopen' | 'not_started'

export function basketballDetailsEditMode(state: GameState): BasketballDetailsEditMode {
  if (state.sportGameState?.sportId !== 'basketball') return 'not_started'
  if (state.cloudSync.gameStatus === 'final') return 'reopen'
  const { status, reopenMode, currentPeriodId } = state.sportGameState.projection
  if (status === 'ended' && reopenMode === 'correct_records' && currentPeriodId) return 'correcting'
  if (status === 'ended' || status === 'suspended') return 'reopen'
  if (status === 'not_started' || !currentPeriodId) return 'not_started'
  return 'live'
}

export type BasketballRosterRefreshAvailability =
  /** `correcting`: a "Correct records" reopen; numbers and positions only, no additions. */
  | { kind: 'available'; teamId: string; correcting: boolean }
  | { kind: 'reopen' }
  | { kind: 'not_started' }
  | { kind: 'no_team' }

/** Whether "Refresh from roster" applies: cloud team games only, while details can change. */
export function basketballRosterRefreshAvailability(state: GameState): BasketballRosterRefreshAvailability {
  if (state.sportGameState?.sportId !== 'basketball') return { kind: 'no_team' }
  const teamId = state.sportGameState.setup.sourceTeamId
  if (!teamId) return { kind: 'no_team' }
  const mode = basketballDetailsEditMode(state)
  if (mode === 'reopen' || mode === 'not_started') return { kind: mode }
  return { kind: 'available', teamId, correcting: mode === 'correcting' }
}

/**
 * Apply the selected roster refresh: one details command for every selected
 * number/position change, then one bench late add per selected roster player.
 * Every event shares one captureCommandId, so one Undo reverts the whole
 * refresh. Stops at the first failure and returns the original state.
 */
export function applyBasketballRosterRefresh(
  state: GameState,
  options: {
    recorderUserId: string | null
    diff: RosterRefreshDiff
    updateParticipantIds: string[]
    additionPlayerIds: string[]
    occurredAt?: string
  }
): BasketballStateCommandResult {
  let next = state
  const captureCommandId = createBasketballCaptureCommandId()
  const updates = options.diff.updates.filter(update => options.updateParticipantIds.includes(update.participantId))
  if (updates.length > 0) {
    const result = updateBasketballParticipantDetails(next, {
      recorderUserId: options.recorderUserId,
      source: 'roster_refresh',
      occurredAt: options.occurredAt,
      captureCommandId,
      changes: updates.map(update => ({ participantId: update.participantId, ...update.to })),
    })
    if (!result.ok) return { ...result, state }
    next = result.state
  }
  for (const addition of options.diff.additions.filter(item => options.additionPlayerIds.includes(item.playerId))) {
    const result = addBasketballLateParticipant(next, {
      recorderUserId: options.recorderUserId,
      teamSide: 'tracked',
      displayName: addition.name,
      number: addition.number ?? undefined,
      position: addition.position,
      playerId: addition.playerId,
      fromRoster: true,
      occurredAt: options.occurredAt,
      captureCommandId,
    })
    if (!result.ok) return { ...result, state }
    next = result.state
  }
  return { ok: true, state: next }
}
