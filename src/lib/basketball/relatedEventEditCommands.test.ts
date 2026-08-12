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
import { captureBasketballDirectStat, captureBasketballStealTurnover } from './directCommands'
import {
  applyBasketballHistoricalRelatedEvent,
  applyBasketballRelatedEventEdit,
  buildBasketballHistoricalRelatedEventDraft,
  buildBasketballRelatedEventEditDraft,
  basketballRelatedEventTargetOptions,
  deriveBasketballRelatedEventEditor,
  previewBasketballHistoricalRelatedEvent,
  previewBasketballRelatedEventEdit,
} from './relatedEventEditCommands'
import { buildBasketballTimelineReview } from './timeline'
import {
  previewBasketballTimelineRemoval,
  removeBasketballTimelineEvents,
} from './timelineCorrections'

const basketball = sports.find(sport => sport.id === 'basketball')!

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
      date: '2026-08-11',
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
  const base = trackedOnlyStartedState()
  const opponent = addBasketballLateParticipant(base, {
    recorderUserId: 'recorder-1',
    teamSide: 'opponent',
    displayName: 'Opponent Nine',
    number: '9',
    occurredAt: '2026-08-11T14:00:10.000Z',
    eventId: '78000000-0000-4000-8000-000000000151',
    participantId: '78000000-0000-4000-8000-000000000152',
    playerId: 'opponent-9',
    captureCommandId: '78000000-0000-4000-8000-000000000159',
  })
  if (!opponent.ok) throw new Error(opponent.message)
  return opponent.state
}

function trackedOnlyStartedState(): GameState {
  const started = prepareBasketballGameStart(setupState(), {
    recorderUserId: 'recorder-1',
    occurredAt: '2026-08-11T14:00:00.000Z',
    eventId: '78000000-0000-4000-8000-000000000001',
    participantIds: [
      '78000000-0000-4000-8000-000000000101',
      '78000000-0000-4000-8000-000000000102',
    ],
  })
  if (!started.ok) throw new Error(started.message)
  return started.state
}

describe('BKE-3D1 related-event editing', () => {
  it('revises a rebound actor/kind and links it to a compatible miss', () => {
    const miss = captureBasketballCourtEvent(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'opponent-9',
      point: { x: 4, y: 10 },
      event: { kind: 'shot', made: false, shotType: '2pt' },
      occurredAt: '2026-08-11T14:01:00.000Z',
      eventIds: ['78000000-0000-4000-8000-000000000201'],
    })
    if (!miss.ok) throw new Error(miss.message)
    const rebound = captureBasketballDirectStat(miss.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      statId: 'oreb',
      occurredAt: '2026-08-11T14:01:10.000Z',
      eventId: '78000000-0000-4000-8000-000000000202',
    })
    if (!rebound.ok) throw new Error(rebound.message)
    const draft = buildBasketballRelatedEventEditDraft(rebound.state, rebound.eventIds[0])
    if (!draft.ok) throw new Error(draft.message)
    const preview = previewBasketballRelatedEventEdit(rebound.state, {
      ...draft.value,
      reboundKind: 'defensive',
      actor: { kind: 'participant', participantId: '78000000-0000-4000-8000-000000000102' },
      relatedEventId: miss.eventIds[0],
    }, 'recorder-1', '2026-08-11T14:02:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballRelatedEventEdit(rebound.state, preview.value)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') throw new Error('Edit failed')
    expect(applied.state.eventStream?.events.find(event =>
      isGameEventEnvelope(event) && event.id === rebound.eventIds[0]
    )).toMatchObject({
      revision: 2,
      payload: { kind: 'defensive', relatedEventId: miss.eventIds[0] },
      actors: [{ participantId: '78000000-0000-4000-8000-000000000102' }],
    })
    expect(applied.state.sportGameState.projection.participants[
      '78000000-0000-4000-8000-000000000102'
    ].stats.dreb).toBe(1)
  })

  it('relinks a turnover to one standalone steal and preserves the old steal total', () => {
    const paired = captureBasketballStealTurnover(startedState(), {
      recorderUserId: 'recorder-1',
      stealerPlayerId: 'player-1',
      turnoverTarget: { kind: 'player', playerId: 'opponent-9' },
      occurredAt: '2026-08-11T14:03:00.000Z',
      eventIds: [
        '78000000-0000-4000-8000-000000000301',
        '78000000-0000-4000-8000-000000000302',
      ],
      captureCommandId: '78000000-0000-4000-8000-000000000309',
    })
    if (!paired.ok) throw new Error(paired.message)
    const standalone = captureBasketballDirectStat(paired.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      statId: 'stl',
      occurredAt: '2026-08-11T14:03:10.000Z',
      eventId: '78000000-0000-4000-8000-000000000303',
    })
    if (!standalone.ok) throw new Error(standalone.message)
    const draft = buildBasketballRelatedEventEditDraft(standalone.state, paired.eventIds[0])
    if (!draft.ok) throw new Error(draft.message)
    const preview = previewBasketballRelatedEventEdit(standalone.state, {
      ...draft.value,
      relatedEventId: standalone.eventIds[0],
    }, 'recorder-1', '2026-08-11T14:04:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.value.affectedEventIds).toEqual(expect.arrayContaining([
      paired.eventIds[1],
      standalone.eventIds[0],
    ]))
    const applied = applyBasketballRelatedEventEdit(standalone.state, preview.value)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') throw new Error('Edit failed')
    const events = applied.state.eventStream?.events.filter(isGameEventEnvelope) ?? []
    expect(events.find(event => event.id === paired.eventIds[1]))
      .toMatchObject({ revision: 2, payload: { relatedEventId: null } })
    expect(events.find(event => event.id === standalone.eventIds[0]))
      .toMatchObject({ revision: 2, payload: { relatedEventId: paired.eventIds[0] } })
    expect(events.find(event => event.id === paired.eventIds[0]))
      .toMatchObject({ payload: { captureCommandId: '78000000-0000-4000-8000-000000000309' } })
    expect(events.find(event => event.id === paired.eventIds[1]))
      .toMatchObject({ payload: { captureCommandId: null } })
    expect(events.find(event => event.id === standalone.eventIds[0]))
      .toMatchObject({ payload: { captureCommandId: '78000000-0000-4000-8000-000000000309' } })
    expect(applied.state.sportGameState.projection.participants[
      '78000000-0000-4000-8000-000000000101'
    ].stats.stl).toBe(1)

    const removalPreview = previewBasketballTimelineRemoval(
      applied.state,
      paired.eventIds[0],
      'capture_group'
    )
    if (!removalPreview.ok) throw new Error(removalPreview.message)
    expect(removalPreview.value.affectedEventIds).toEqual(expect.arrayContaining([
      paired.eventIds[0],
      standalone.eventIds[0],
    ]))
    expect(removalPreview.value.affectedEventIds).not.toContain(paired.eventIds[1])
    const removed = removeBasketballTimelineEvents(applied.state, removalPreview.value)
    if (!removed.ok || removed.state.sportGameState?.sportId !== 'basketball') throw new Error('Removal failed')
    expect(removed.state.eventStream?.events.find(event =>
      isGameEventEnvelope(event) && event.id === paired.eventIds[1]
    )).toMatchObject({ deletedAt: null, payload: { relatedEventId: null, captureCommandId: null } })
    expect(removed.state.sportGameState.projection.participants[
      '78000000-0000-4000-8000-000000000101'
    ].stats.stl).toBe(1)
  })

  it('adds a paired Steal + Turnover atomically to a completed period', () => {
    const ended = endBasketballPeriod(startedState(), {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-11T14:05:00.000Z',
      eventId: '78000000-0000-4000-8000-000000000401',
    })
    if (!ended.ok) throw new Error(ended.message)
    const second = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-11T14:06:00.000Z',
      eventId: '78000000-0000-4000-8000-000000000402',
    })
    if (!second.ok) throw new Error(second.message)
    const draft = buildBasketballHistoricalRelatedEventDraft(second.state, 'basketball.steal_turnover')
    if (!draft.ok) throw new Error(draft.message)
    const preview = previewBasketballHistoricalRelatedEvent(second.state, {
      ...draft.value,
      period: { id: 'regulation-1', order: 1 },
      actor: { kind: 'participant', participantId: '78000000-0000-4000-8000-000000000101' },
      pairedTurnoverActor: { kind: 'participant', participantId: '78000000-0000-4000-8000-000000000152' },
    }, 'recorder-1', '2026-08-11T14:07:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballHistoricalRelatedEvent(second.state, preview.value)
    if (!applied.ok || applied.state.sportGameState?.sportId !== 'basketball') throw new Error('Add failed')
    expect(applied.state.sportGameState.projection.sideStats.tracked.stl).toBe(1)
    expect(applied.state.sportGameState.projection.sideStats.opponent.to).toBe(1)
    expect(buildBasketballTimelineReview(applied.state).eventById.get(draft.value.eventId))
      .toMatchObject({ recordedLater: true, periodLabel: 'Q1' })
  })

  it('rejects a forward steal link while paired historical capture remains available', () => {
    const steal = captureBasketballDirectStat(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      statId: 'stl',
      occurredAt: '2026-08-11T14:08:00.000Z',
      eventId: '78000000-0000-4000-8000-000000000501',
    })
    if (!steal.ok) throw new Error(steal.message)
    const draft = buildBasketballHistoricalRelatedEventDraft(steal.state, 'basketball.turnover')
    if (!draft.ok) throw new Error(draft.message)
    expect(previewBasketballHistoricalRelatedEvent(steal.state, {
      ...draft.value,
      teamSide: 'opponent',
      actor: { kind: 'participant', participantId: '78000000-0000-4000-8000-000000000152' },
      relatedEventId: steal.eventIds[0],
    }, 'recorder-1', '2026-08-11T14:09:00.000Z')).toMatchObject({
      ok: false,
      message: expect.stringContaining('not compatible'),
    })
  })

  it('rejects stale edit drafts without changing state', () => {
    const assist = captureBasketballDirectStat(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      statId: 'ast',
      eventId: '78000000-0000-4000-8000-000000000601',
    })
    if (!assist.ok) throw new Error(assist.message)
    const draft = buildBasketballRelatedEventEditDraft(assist.state, assist.eventIds[0])
    if (!draft.ok) throw new Error(draft.message)
    const changed = captureBasketballDirectStat(assist.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      statId: 'blk',
    })
    if (!changed.ok) throw new Error(changed.message)
    expect(previewBasketballRelatedEventEdit(changed.state, {
      ...draft.value,
      actor: { kind: 'participant', participantId: '78000000-0000-4000-8000-000000000102' },
    }, 'recorder-1')).toMatchObject({ ok: false, message: expect.stringContaining('Timeline changed') })
  })

  it('does not offer a shot already claimed by another assist', () => {
    const shot = captureBasketballCourtEvent(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 12, y: 24 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-11T14:10:00.000Z',
      eventIds: ['78000000-0000-4000-8000-000000000701'],
    })
    if (!shot.ok) throw new Error(shot.message)
    const firstAssist = captureBasketballDirectStat(shot.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      statId: 'ast',
      occurredAt: '2026-08-11T14:10:10.000Z',
      eventId: '78000000-0000-4000-8000-000000000702',
    })
    if (!firstAssist.ok) throw new Error(firstAssist.message)
    const firstDraft = buildBasketballRelatedEventEditDraft(firstAssist.state, firstAssist.eventIds[0])
    if (!firstDraft.ok) throw new Error(firstDraft.message)
    const firstPreview = previewBasketballRelatedEventEdit(firstAssist.state, {
      ...firstDraft.value,
      relatedEventId: shot.eventIds[0],
    }, 'recorder-1', '2026-08-11T14:10:20.000Z')
    if (!firstPreview.ok) throw new Error(firstPreview.message)
    const linked = applyBasketballRelatedEventEdit(firstAssist.state, firstPreview.value)
    if (!linked.ok) throw new Error(linked.message)
    const secondAssist = captureBasketballDirectStat(linked.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      statId: 'ast',
      occurredAt: '2026-08-11T14:10:30.000Z',
      eventId: '78000000-0000-4000-8000-000000000703',
    })
    if (!secondAssist.ok) throw new Error(secondAssist.message)
    const secondDraft = buildBasketballRelatedEventEditDraft(secondAssist.state, secondAssist.eventIds[0])
    if (!secondDraft.ok) throw new Error(secondDraft.message)

    expect(basketballRelatedEventTargetOptions(secondAssist.state, secondDraft.value))
      .toEqual([{ eventId: null, label: 'Standalone' }])
  })

  it('builds every historical family without an opponent participant', () => {
    const state = trackedOnlyStartedState()
    const eventTypes = [
      'basketball.assist',
      'basketball.rebound',
      'basketball.steal',
      'basketball.block',
      'basketball.turnover',
      'basketball.steal_turnover',
    ] as const

    for (const eventType of eventTypes) {
      const draft = buildBasketballHistoricalRelatedEventDraft(state, eventType)
      expect(draft.ok, eventType).toBe(true)
      if (draft.ok && eventType === 'basketball.steal_turnover') {
        expect(draft.value.pairedTurnoverActor).toEqual({ kind: 'unknown', label: 'Unknown player' })
      }
    }
  })

  it('offers clearly labelled relationship targets only from the selected period', () => {
    const firstShot = captureBasketballCourtEvent(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 12, y: 24 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-11T14:11:00.000Z',
      eventIds: ['78000000-0000-4000-8000-000000000801'],
    })
    if (!firstShot.ok) throw new Error(firstShot.message)
    const ended = endBasketballPeriod(firstShot.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-11T14:12:00.000Z',
      eventId: '78000000-0000-4000-8000-000000000802',
    })
    if (!ended.ok) throw new Error(ended.message)
    const second = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-11T14:13:00.000Z',
      eventId: '78000000-0000-4000-8000-000000000803',
    })
    if (!second.ok) throw new Error(second.message)
    const secondShot = captureBasketballCourtEvent(second.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 8, y: 18 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-11T14:14:00.000Z',
      eventIds: ['78000000-0000-4000-8000-000000000804'],
    })
    if (!secondShot.ok) throw new Error(secondShot.message)
    const draft = buildBasketballHistoricalRelatedEventDraft(secondShot.state, 'basketball.assist')
    if (!draft.ok) throw new Error(draft.message)
    const q1Draft = {
      ...draft.value,
      period: { id: 'regulation-1', order: 1 },
      actor: { kind: 'participant' as const, participantId: '78000000-0000-4000-8000-000000000102' },
    }
    const options = basketballRelatedEventTargetOptions(secondShot.state, q1Draft)

    expect(options).toEqual([
      { eventId: null, label: 'Standalone' },
      { eventId: firstShot.eventIds[0], label: 'Q1 - Field goal #1: Made 2PT: Alex One' },
    ])
    expect(previewBasketballHistoricalRelatedEvent(secondShot.state, {
      ...q1Draft,
      relatedEventId: secondShot.eventIds[0],
    }, 'recorder-1')).toMatchObject({ ok: false, message: expect.stringContaining('not compatible') })
  })

  it('keeps an existing cross-period link visible and preserves it on unrelated edits', () => {
    const shot = captureBasketballCourtEvent(startedState(), {
      recorderUserId: 'recorder-1',
      playerId: 'player-1',
      point: { x: 4, y: 10 },
      event: { kind: 'shot', made: true, shotType: '2pt' },
      occurredAt: '2026-08-11T14:30:00.000Z',
      eventIds: ['78000000-0000-4000-8000-000000000901'],
    })
    if (!shot.ok) throw new Error(shot.message)
    const ended = endBasketballPeriod(shot.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-11T14:31:00.000Z',
      eventId: '78000000-0000-4000-8000-000000000902',
    })
    if (!ended.ok) throw new Error(ended.message)
    const q2 = startNextBasketballPeriod(ended.state, {
      recorderUserId: 'recorder-1',
      occurredAt: '2026-08-11T14:32:00.000Z',
      eventId: '78000000-0000-4000-8000-000000000903',
    })
    if (!q2.ok) throw new Error(q2.message)
    const assist = captureBasketballDirectStat(q2.state, {
      recorderUserId: 'recorder-1',
      playerId: 'player-2',
      statId: 'ast',
      occurredAt: '2026-08-11T14:33:00.000Z',
      eventId: '78000000-0000-4000-8000-000000000904',
    })
    if (!assist.ok) throw new Error(assist.message)
    const linked = applyGameEventMutations(assist.state, [{
      type: 'update',
      eventId: assist.eventIds[0],
      changes: { payload: { relatedEventId: shot.eventIds[0], captureCommandId: null } },
    }], '2026-08-11T14:33:10.000Z', gameEventRegistry, gameEventProjectors)
    if (!linked.ok) throw new Error(linked.error.message)
    const draft = buildBasketballRelatedEventEditDraft(linked.state, assist.eventIds[0])
    if (!draft.ok) throw new Error(draft.message)
    const editor = deriveBasketballRelatedEventEditor(linked.state, draft.value)

    expect(editor.draft.relatedEventId).toBe(shot.eventIds[0])
    expect(editor.targetOptions).toEqual(expect.arrayContaining([{
      eventId: shot.eventIds[0],
      label: 'Q1 - Field goal #1: Made 2PT: Alex One',
    }]))
    const preview = previewBasketballRelatedEventEdit(linked.state, {
      ...editor.draft,
      actor: { kind: 'unknown', label: 'Bench assist' },
    }, 'recorder-1', '2026-08-11T14:34:00.000Z')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applyBasketballRelatedEventEdit(linked.state, preview.value)
    if (!applied.ok) throw new Error(applied.message)
    expect(applied.state.eventStream?.events.find(event =>
      isGameEventEnvelope(event) && event.id === assist.eventIds[0]
    )).toMatchObject({ payload: { relatedEventId: shot.eventIds[0] } })
  })
})
