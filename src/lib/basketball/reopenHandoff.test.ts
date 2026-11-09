import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { makeAnchoredCanonicalAggregateSource } from './aggregateTestFixtures'
import { evaluateBasketballAnchoredFinalization } from './anchoredFinalization'
import {
  basketballCanonicalAuthorityState,
  type BasketballCanonicalPublication,
} from './finalization'
import { applyBasketballReopenHandoff, type BasketballReopenHandoff } from './reopenHandoff'
import { buildBasketballHistoricalShotDraft } from './shotEditCommands'
import { basketballLineupCorrectionDraft } from './lineupCorrectionCommands'
import { basketballTimelineCorrectionsEnabled } from './timeline'
import { basketballCloudParticipants } from './cloudSync'
import { getBasketballCommandContext, updateBasketballParticipantDetails } from './commands'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import {
  applyBasketballRosterRefresh,
  basketballDetailsEditMode,
  basketballRosterRefreshParticipants,
} from './rosterRefresh'
import { diffGameRoster } from '../rosterRefresh'

const basketball = sports.find(sport => sport.id === 'basketball')!
const recorderId = 'aggregate-recorder'

describe('BKE-6D4 anchored finalization and reopen handoff', () => {
  it('accepts a terminal paused abandoned source without regulation-completion blockers', () => {
    const state = authorityState()
    expect(evaluateBasketballAnchoredFinalization(state)).toEqual({
      applicable: true,
      blockers: [],
    })
  })

  it('keeps Correct records terminal and enables only Timeline correction authority', () => {
    const initial = authorityState()
    const applied = applyBasketballReopenHandoff(
      initial,
      recorderId,
      'anchored-game-1',
      handoff('correct_records')
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.state.sportGameState?.sportId).toBe('basketball')
    if (applied.state.sportGameState?.sportId !== 'basketball') return
    expect(applied.state.sportGameState.projection).toMatchObject({
      status: 'ended',
      reopenMode: 'correct_records',
      endReason: 'abandoned',
    })
    expect(basketballTimelineCorrectionsEnabled(applied.state, true)).toBe(true)
    expect(buildBasketballHistoricalShotDraft(applied.state).ok).toBe(true)
    const substitution = applied.state.eventStream?.events.find(event => (
      isGameEventEnvelope(event) && event.eventType === 'basketball.substitution'
    ))
    if (!substitution || !isGameEventEnvelope(substitution)) {
      throw new Error('Anchored fixture substitution is unavailable.')
    }
    expect(basketballLineupCorrectionDraft(applied.state, substitution.id).ok).toBe(true)

    const repeated = applyBasketballReopenHandoff(
      applied.state,
      recorderId,
      'anchored-game-1',
      handoff('correct_records')
    )
    expect(repeated.ok).toBe(true)
    if (!repeated.ok) return
    expect(repeated.changed).toBe(false)
    expect(repeated.state.eventStream?.events.filter(event => (
      typeof event === 'object' && event !== null &&
      'eventType' in event && event.eventType === 'basketball.match_reopened'
    ))).toHaveLength(1)
  })

  it('RTN-2: fixes a number and position under Correct records without resuming the game', () => {
    const final = authorityState()
    expect(basketballDetailsEditMode(final)).toBe('reopen')
    const applied = applyBasketballReopenHandoff(final, recorderId, 'anchored-game-1', handoff('correct_records'))
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') throw new Error('reopen failed')
    const state = applied.state
    const sportState = applied.state.sportGameState
    expect(basketballDetailsEditMode(state)).toBe('correcting')
    const target = Object.values(sportState.projection.participants)
      .find(participant => participant.teamSide === 'tracked' && participant.playerId)
    if (!target) throw new Error('Anchored fixture participant is unavailable.')
    const targetId: string = target.participantId
    const setupNumber = sportState.setup.participants.find(item => item.id === targetId)?.number ?? null

    const changed = updateBasketballParticipantDetails(state, {
      recorderUserId: recorderId,
      source: 'manual',
      occurredAt: '2026-08-27T15:06:00.000Z',
      changes: [{ participantId: targetId, number: '77', position: 'C' }],
    })
    if (!changed.ok) throw new Error(changed.message)
    if (changed.state.sportGameState?.sportId !== 'basketball') throw new Error('not basketball')
    const projection = changed.state.sportGameState.projection
    expect(projection).toMatchObject({ status: 'ended', reopenMode: 'correct_records', endReason: 'abandoned' })
    expect(projection.clock?.running ?? false).toBe(false)
    expect(projection.participants[targetId]).toMatchObject({ number: '77', position: 'C' })

    // Live capture stays locked, the stream replays cleanly, and republish is still ready.
    expect(getBasketballCommandContext(changed.state, recorderId).ok).toBe(false)
    const rebuilt = rebuildGameEventProjection(changed.state, gameEventRegistry, gameEventProjectors)
    expect(rebuilt.inspection.complete).toBe(true)
    expect(evaluateBasketballAnchoredFinalization(changed.state)).toEqual({ applicable: true, blockers: [] })
    // Sync keeps the setup number on the participant row; the event carries the fix.
    expect(basketballCloudParticipants(changed.state.sportGameState, changed.state.eventStream?.events ?? [])
      .find(row => row.client_participant_id === targetId)?.jersey_number).toBe(setupNumber)
    const detailsEvent = changed.state.eventStream?.events.find(event => (
      isGameEventEnvelope(event) && event.eventType === 'basketball.participant_details_updated'
    ))
    expect(detailsEvent).toBeDefined()
  })

  it('RTN-2: refuses roster additions under Correct records', () => {
    const applied = applyBasketballReopenHandoff(authorityState(), recorderId, 'anchored-game-1', handoff('correct_records'))
    if (!applied.ok) throw new Error('reopen failed')
    const diff = diffGameRoster(basketballRosterRefreshParticipants(applied.state), [
      { playerId: 'new-roster-player', name: 'New Player', number: '50', position: null, isActive: true },
    ])
    const result = applyBasketballRosterRefresh(applied.state, {
      recorderUserId: recorderId, diff, updateParticipantIds: [], additionPlayerIds: ['new-roster-player'],
      occurredAt: '2026-08-27T15:06:00.000Z',
    })
    expect(result.ok).toBe(false)
  })

  it('restores Resume game at the exact paused clock with lineup review required', () => {
    const applied = applyBasketballReopenHandoff(
      authorityState(),
      recorderId,
      'anchored-game-1',
      handoff('resume_game')
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') return
    const projection = applied.state.sportGameState.projection
    expect(projection).toMatchObject({
      status: 'in_progress',
      reopenMode: 'resume_game',
      currentPeriodId: 'regulation-1',
      clock: { running: false, elapsedMs: 2_468 },
    })
    expect(projection.lineup?.sides.tracked?.boundaryConfirmationRequired).toBe(true)
    expect(projection.completedPeriodIds).not.toContain('regulation-1')
  })

  it('rejects a handoff for a different recorder or cloud binding', () => {
    const state = authorityState()
    expect(applyBasketballReopenHandoff(
      state,
      'different-user',
      'anchored-game-1',
      handoff('correct_records')
    )).toMatchObject({ ok: false, state })
    expect(applyBasketballReopenHandoff(
      state,
      recorderId,
      'different-game',
      handoff('correct_records')
    )).toMatchObject({ ok: false, state })
  })
})

function authorityState() {
  const source = makeAnchoredCanonicalAggregateSource()
  const snapshot = structuredClone(source.canonicalSnapshot)
  const terminal = snapshot.eventStream.events[snapshot.eventStream.events.length - 1]
  if (!isGameEventEnvelope(terminal) || terminal.eventType !== 'basketball.match_ended') {
    throw new Error('Anchored aggregate fixture terminal event is unavailable.')
  }
  terminal.payload = { ...terminal.payload, reason: 'abandoned' }
  const publication: BasketballCanonicalPublication = {
    publicationId: source.publicationId,
    publicationNumber: source.publicationNumber,
    primaryRecorderId: snapshot.primaryRecorderId,
    primaryDisplayName: 'Primary recorder',
    snapshot,
    snapshotFingerprint: source.snapshotFingerprint,
    finalizedBy: recorderId,
    finalizedByDisplayName: 'Primary recorder',
    finalizedAt: source.finalizedAt,
  }
  const base = {
    ...createInitialState(),
    sport: basketball,
    cloudSync: {
      ...createInitialState().cloudSync,
      gameId: snapshot.gameId,
      gameStatus: 'final' as const,
    },
  }
  return basketballCanonicalAuthorityState(base, publication)
}

function handoff(mode: BasketballReopenHandoff['mode']): BasketballReopenHandoff {
  return {
    publicationId: 'publication-anchored-game-1',
    primaryRecorderId: recorderId,
    reason: 'Correct the official record',
    mode,
    reopenedAt: '2026-08-27T15:05:00.000Z',
  }
}
