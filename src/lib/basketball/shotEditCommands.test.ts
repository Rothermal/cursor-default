import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState, Player } from '../../types'
import { createInitialState } from '../gameReducer'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { applyGameEventMutations } from '../gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import {
  addBasketballLateParticipant,
  captureBasketballCourtEvent,
  endBasketballPeriod,
  prepareBasketballGameStart,
  startNextBasketballPeriod,
} from './commands'
import { captureBasketballDirectStat } from './directCommands'
import {
  applyBasketballShotEdit,
  applyBasketballHistoricalShot,
  buildBasketballHistoricalShotDraft,
  buildBasketballShotEditDraft,
  basketballShotRelationshipOptionsByKind,
  previewBasketballHistoricalShot,
  previewBasketballShotEdit,
  reconcileBasketballHistoricalShotDraftRelationships,
  reconcileBasketballShotEditDraftRelationships,
} from './shotEditCommands'
import {
  previewBasketballTimelineRemoval,
  removeBasketballTimelineEvents,
} from './timelineCorrections'
import { buildBasketballTimelineReview } from './timeline'

const basketball = sports.find(sport => sport.id === 'basketball')!
const shotId = '76000000-0000-4000-8000-000000000201'
const assistId = '76000000-0000-4000-8000-000000000202'

function player(id: string, name: string, number = ''): Player {
  return { id, name, number, stats: {} }
}

function setupState(): GameState {
  return {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    gameInfo: {
      teamName: 'Aces',
      opponentName: 'Bears',
      tournamentName: '',
      tournamentId: null,
      date: '2026-08-10',
    },
    players: [
      { ...player(TEAM_PLAYER_HOME_ID, 'Aces Team'), isTeamPlayer: true },
      { ...player(TEAM_PLAYER_OPP_ID, 'Bears Team'), isTeamPlayer: true },
      player('player-1', 'Alex One', '4'),
      player('player-2', 'Blake Two', '12'),
    ],
    teamStatsConfig: {
      periodsPerGame: 4,
      periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeLabel: 'OT',
      overtimeFoulsReset: true,
      timeoutsPerPeriod: null,
      timeoutsPerOvertime: null,
    },
  }
}

function startedState(): GameState {
  const started = prepareBasketballGameStart(setupState(), {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-10T14:00:00.000Z',
    eventId: '76000000-0000-4000-8000-000000000001',
    participantIds: [
      '76000000-0000-4000-8000-000000000101',
      '76000000-0000-4000-8000-000000000102',
    ],
  })
  if (!started.ok) throw new Error(started.message)
  const opponent = addBasketballLateParticipant(started.state, {
    recorderUserId: 'recorder-1',
    teamSide: 'opponent',
    displayName: 'Opponent Nine',
    number: '9',
    occurredAt: '2026-08-10T14:00:10.000Z',
    eventId: '76000000-0000-4000-8000-000000000151',
    participantId: '76000000-0000-4000-8000-000000000152',
    playerId: 'opponent-9',
    captureCommandId: '76000000-0000-4000-8000-000000000159',
  })
  if (!opponent.ok) throw new Error(opponent.message)
  return opponent.state
}

function madeShotWithAssist(): GameState {
  const result = captureBasketballCourtEvent(startedState(), {
    recorderUserId: 'recorder-1',
    playerId: 'player-1',
    point: { x: 0, y: 8 },
    event: { kind: 'shot', made: true, shotType: '2pt', assistPlayerId: 'player-2' },
    occurredAt: '2026-08-10T14:01:00.000Z',
    eventIds: [shotId, assistId],
    captureCommandId: '76000000-0000-4000-8000-000000000299',
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('BKE-3C Basketball shot editing', () => {
  it('atomically revises a shot, unlinks an invalid assist, and appends rebound and block facts', () => {
    const state = madeShotWithAssist()
    const draftResult = buildBasketballShotEditDraft(state, shotId)
    if (!draftResult.ok) throw new Error(draftResult.message)
    const draft = {
      ...draftResult.value,
      made: false,
      value: 3 as const,
      location: { x: 24, y: 5 },
      relationships: {
        ...draftResult.value.relationships,
        rebound: {
          mode: 'new' as const,
          teamSide: 'tracked' as const,
          actor: {
            kind: 'participant' as const,
            participantId: '76000000-0000-4000-8000-000000000102',
          },
        },
        block: {
          mode: 'new' as const,
          teamSide: 'opponent' as const,
          actor: {
            kind: 'participant' as const,
            participantId: '76000000-0000-4000-8000-000000000152',
          },
        },
      },
    }
    const preview = previewBasketballShotEdit(
      state,
      draft,
      'recorder-1',
      '2026-08-10T14:02:00.000Z'
    )
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.value.consequenceLines).toEqual(expect.arrayContaining([
      'Shot: made 2-point to missed 3-point.',
      'Assist link will be cleared because it is no longer valid.',
      'Assist by Blake Two will remain as a standalone stat.',
      'Tracked score: 2 to 0.',
    ]))
    expect(preview.value.appendedEventIds).toHaveLength(2)

    const applied = applyBasketballShotEdit(state, preview.value)
    expect(applied.ok).toBe(true)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') return
    expect(applied.highlightEventId).toBe(shotId)
    expect(applied.state.sportGameState.projection.score.tracked).toBe(0)
    expect(applied.state.sportGameState.projection.participants[
      '76000000-0000-4000-8000-000000000101'
    ].stats['3pt_miss']).toBe(1)
    expect(applied.state.sportGameState.projection.participants[
      '76000000-0000-4000-8000-000000000102'
    ].stats.ast).toBe(1)
    expect(applied.state.sportGameState.projection.participants[
      '76000000-0000-4000-8000-000000000102'
    ].stats.oreb).toBe(1)
    expect(applied.state.sportGameState.projection.participants[
      '76000000-0000-4000-8000-000000000152'
    ].stats.blk).toBe(1)
    const events = applied.state.eventStream?.events.filter(isGameEventEnvelope) ?? []
    expect(events.find(event => event.id === shotId)).toMatchObject({
      revision: 2,
      payload: { made: false, value: 3, valueSource: 'court' },
    })
    expect(events.find(event => event.id === assistId)).toMatchObject({
      revision: 2,
      payload: { relatedEventId: null },
    })
  })

  it('explicitly restores a removed relationship without changing the shot', () => {
    const state = madeShotWithAssist()
    const removalPreview = previewBasketballTimelineRemoval(state, assistId)
    if (!removalPreview.ok) throw new Error(removalPreview.message)
    const removed = removeBasketballTimelineEvents(state, removalPreview.value)
    if (!removed.ok) throw new Error(removed.message)
    const draftResult = buildBasketballShotEditDraft(removed.state, shotId)
    if (!draftResult.ok) throw new Error(draftResult.message)
    const draft = {
      ...draftResult.value,
      relationships: {
        ...draftResult.value.relationships,
        assist: { mode: 'event' as const, eventId: assistId },
      },
    }
    const preview = previewBasketballShotEdit(
      removed.state,
      draft,
      'recorder-1',
      '2026-08-10T14:03:00.000Z'
    )
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.value.affectedEventIds).toEqual([assistId])
    const applied = applyBasketballShotEdit(removed.state, preview.value)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.state.eventStream?.events.find(event =>
      isGameEventEnvelope(event) && event.id === assistId
    )).toMatchObject({ revision: 3, deletedAt: null, payload: { relatedEventId: shotId } })
  })

  it('edits an unlocated free throw but rejects location and stale drafts', () => {
    const captured = captureBasketballDirectStat(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      statId: 'ft_miss',
      occurredAt: '2026-08-10T14:04:00.000Z',
      eventId: '76000000-0000-4000-8000-000000000401',
    })
    if (!captured.ok) throw new Error(captured.message)
    const draftResult = buildBasketballShotEditDraft(captured.state, captured.eventIds[0])
    if (!draftResult.ok) throw new Error(draftResult.message)
    expect(previewBasketballShotEdit(captured.state, {
      ...draftResult.value,
      made: true,
    }, 'recorder-1')).toMatchObject({ ok: true })
    expect(previewBasketballShotEdit(captured.state, {
      ...draftResult.value,
      location: { x: 0, y: 8 },
    }, 'recorder-1')).toMatchObject({
      ok: false,
      message: expect.stringContaining('unlocated 1-point'),
    })

    const changed = captureBasketballDirectStat(captured.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      statId: 'ast',
      occurredAt: '2026-08-10T14:04:30.000Z',
    })
    if (!changed.ok) throw new Error(changed.message)
    expect(previewBasketballShotEdit(changed.state, {
      ...draftResult.value,
      made: true,
    }, 'recorder-1')).toMatchObject({
      ok: false,
      message: expect.stringContaining('Timeline changed'),
    })
  })

  it('drops relationship selections invalidated by result or shooter changes', () => {
    const state = madeShotWithAssist()
    const editDraft = buildBasketballShotEditDraft(state, shotId)
    if (!editDraft.ok) throw new Error(editDraft.message)
    const reconciledEdit = reconcileBasketballShotEditDraftRelationships(state, {
      ...editDraft.value,
      shooter: {
        kind: 'participant',
        participantId: '76000000-0000-4000-8000-000000000102',
      },
      relationships: {
        ...editDraft.value.relationships,
        block: {
          mode: 'new',
          teamSide: 'opponent',
          actor: {
            kind: 'participant',
            participantId: '76000000-0000-4000-8000-000000000152',
          },
        },
      },
    })
    expect(reconciledEdit.relationships.assist).toEqual({ mode: 'none' })
    expect(reconciledEdit.relationships.block).toEqual({ mode: 'none' })

    const historicalDraft = buildBasketballHistoricalShotDraft(state)
    if (!historicalDraft.ok) throw new Error(historicalDraft.message)
    const reconciledHistorical = reconcileBasketballHistoricalShotDraftRelationships(state, {
      ...historicalDraft.value,
      shooter: {
        kind: 'participant',
        participantId: '76000000-0000-4000-8000-000000000102',
      },
      relationships: {
        ...historicalDraft.value.relationships,
        assist: {
          mode: 'new',
          teamSide: 'tracked',
          actor: {
            kind: 'participant',
            participantId: '76000000-0000-4000-8000-000000000102',
          },
        },
      },
    })
    expect(reconciledHistorical.relationships.assist).toEqual({ mode: 'none' })
  })

  it('adds a recorded-later field goal and linked assist to a completed period', () => {
    const first = startedState()
    const ended = endBasketballPeriod(first, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-10T14:10:00.000Z',
      eventId: '76000000-0000-4000-8000-000000000501',
    })
    if (!ended.ok) throw new Error(ended.message)
    const second = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-10T14:11:00.000Z',
      eventId: '76000000-0000-4000-8000-000000000502',
    })
    if (!second.ok) throw new Error(second.message)
    const draftResult = buildBasketballHistoricalShotDraft(second.state)
    if (!draftResult.ok) throw new Error(draftResult.message)
    const draft = {
      ...draftResult.value,
      period: { id: 'regulation-1', order: 1 },
      made: true,
      value: 3 as const,
      location: { x: 24, y: 5 },
      relationships: {
        ...draftResult.value.relationships,
        assist: {
          mode: 'new' as const,
          teamSide: 'tracked' as const,
          actor: {
            kind: 'participant' as const,
            participantId: '76000000-0000-4000-8000-000000000102',
          },
        },
      },
    }
    const preview = previewBasketballHistoricalShot(
      second.state,
      draft,
      'recorder-1',
      '2026-08-10T14:12:00.000Z'
    )
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const applied = applyBasketballHistoricalShot(second.state, preview.value)
    expect(applied.ok).toBe(true)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') return
    expect(applied.state.sportGameState.projection.score.tracked).toBe(3)
    expect(buildBasketballTimelineReview(applied.state).eventById.get(draft.eventId)).toMatchObject({
      recordedLater: true,
      periodLabel: 'Q1',
    })
  })

  it('preserves an existing cross-period link but rejects a new one', () => {
    const q1Shot = captureBasketballCourtEvent(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 0, y: 8 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-10T14:20:00.000Z',
      eventIds: ['76000000-0000-4000-8000-000000000601'],
    })
    if (!q1Shot.ok) throw new Error(q1Shot.message)
    const ended = endBasketballPeriod(q1Shot.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-10T14:21:00.000Z',
      eventId: '76000000-0000-4000-8000-000000000602',
    })
    if (!ended.ok) throw new Error(ended.message)
    const q2 = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-10T14:22:00.000Z',
      eventId: '76000000-0000-4000-8000-000000000603',
    })
    if (!q2.ok) throw new Error(q2.message)
    const firstAssist = captureBasketballDirectStat(q2.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      statId: 'ast',
      occurredAt: '2026-08-10T14:23:00.000Z',
      eventId: '76000000-0000-4000-8000-000000000604',
    })
    if (!firstAssist.ok) throw new Error(firstAssist.message)
    const linked = applyGameEventMutations(firstAssist.state, [{
      type: 'update',
      eventId: firstAssist.eventIds[0],
      changes: { payload: { relatedEventId: q1Shot.eventIds[0], captureCommandId: null } },
    }], '2026-08-10T14:23:10.000Z', gameEventRegistry, gameEventProjectors)
    if (!linked.ok) throw new Error(linked.error.message)
    const secondAssist = captureBasketballDirectStat(linked.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      statId: 'ast',
      occurredAt: '2026-08-10T14:24:00.000Z',
      eventId: '76000000-0000-4000-8000-000000000605',
    })
    if (!secondAssist.ok) throw new Error(secondAssist.message)
    const draft = buildBasketballShotEditDraft(secondAssist.state, q1Shot.eventIds[0])
    if (!draft.ok) throw new Error(draft.message)
    const options = basketballShotRelationshipOptionsByKind(secondAssist.state, draft.value)

    expect(options.assist).toEqual(expect.arrayContaining([expect.objectContaining({
      key: `event:${firstAssist.eventIds[0]}`,
      label: expect.stringContaining('Q2, existing cross-period link'),
    })]))
    expect(options.assist.some(option => option.key === `event:${secondAssist.eventIds[0]}`)).toBe(false)
    const preview = previewBasketballShotEdit(secondAssist.state, {
      ...draft.value,
      location: { x: 1, y: 9 },
    }, 'recorder-1', '2026-08-10T14:25:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballShotEdit(secondAssist.state, preview.value)
    if (!applied.ok) throw new Error(applied.message)
    expect(applied.state.eventStream?.events.find(event =>
      isGameEventEnvelope(event) && event.id === firstAssist.eventIds[0]
    )).toMatchObject({ payload: { relatedEventId: q1Shot.eventIds[0] } })
  })

  it('classifies historical value source from the normalized stored location', () => {
    const state = startedState()
    const draftResult = buildBasketballHistoricalShotDraft(state)
    if (!draftResult.ok) throw new Error(draftResult.message)
    const preview = previewBasketballHistoricalShot(state, {
      ...draftResult.value,
      value: 3,
      location: { x: 0, y: -100 },
    }, 'recorder-1', '2026-08-10T14:13:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballHistoricalShot(state, preview.value)
    if (!applied.ok) throw new Error(applied.message)

    expect(applied.state.eventStream?.events.find(event =>
      isGameEventEnvelope(event) && event.id === draftResult.value.eventId
    )).toMatchObject({ payload: { valueSource: 'manual_override' } })
  })
})
