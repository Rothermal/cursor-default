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
