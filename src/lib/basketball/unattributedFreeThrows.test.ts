import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import { BASKETBALL_TEAM_STATS_DEFAULTS } from '../../config/teamStatsDefaults'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { serializeGameEventForCloud, deserializeGameEventFromCloud } from '../gameEvents/cloud'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { normalizeSportGameState } from '../sportGameState/state'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from '../teamPlayers'
import { completeBasketballMatch, endBasketballPeriod, prepareBasketballGameStart, startNextBasketballPeriod } from './commands'
import { captureBasketballDirectStat } from './directCommands'
import { basketballFreeThrowTripStatuses, captureBasketballFoul, captureBasketballFreeThrowAttempt } from './foulFreeThrowCommands'
import { decrementBasketballDirectStat, restoreLastBasketballCourtUndo, undoLatestBasketballCourtCapture } from './courtCorrections'
import { basketballTripShooter } from './liveActors'
import { applyBasketballFoulFreeThrowChange, basketballFreeThrowShooterOptions, buildBasketballFoulFreeThrowEditDraft, buildBasketballHistoricalFoulFreeThrowDraft, previewBasketballFoulFreeThrowEdit, previewBasketballHistoricalFoulFreeThrow } from './foulFreeThrowEditCommands'
import { applyBasketballShotEdit, buildBasketballShotEditDraft, previewBasketballShotEdit } from './shotEditCommands'
import { basketballPlayerReview, basketballTeamReview } from './summaryDetails'
import { createBasketballCanonicalSnapshot, parseBasketballCanonicalSnapshot } from './finalization'
import { projectBasketballCanonicalAggregateSource } from './aggregateProjection'

const recorder = 'recorder-1'
const id = (value: number) => `af020000-0000-4000-8000-${String(value).padStart(12, '0')}`
const at = (value: number) => new Date(Date.parse('2026-10-26T12:00:00.000Z') + value * 1000).toISOString()

function started(oneAndOne = false): GameState {
  const result = prepareBasketballGameStart({
    ...createInitialState(), sport: sports.find(sport => sport.id === 'basketball')!, gameDataAuthority: 'sport_events',
    gameInfo: { teamName: 'Home', opponentName: 'Away', date: '2026-10-26', tournamentName: '', tournamentId: null },
    players: [
      { id: TEAM_PLAYER_HOME_ID, name: 'Home', number: '', stats: {}, isTeamPlayer: true },
      { id: TEAM_PLAYER_OPP_ID, name: 'Away', number: '', stats: {}, isTeamPlayer: true, teamSide: 'opponent' },
      { id: id(102), name: 'Home Four', number: '4', stats: {} },
    ],
    teamStatsConfig: { ...BASKETBALL_TEAM_STATS_DEFAULTS, hasOneAndOne: oneAndOne, bonusThreshold: 1, doubleBonusThreshold: 10 },
  }, { recorderUserId: recorder, occurredAt: at(0), eventId: id(1), participantIds: [id(101)] })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function sport(state: GameState) {
  if (state.sportGameState?.sportId !== 'basketball') throw new Error('Missing Basketball state')
  return state.sportGameState
}

function shot(state: GameState, made = true, eventId = id(2)) {
  const result = captureBasketballDirectStat(state, {
    recorderUserId: recorder, playerId: TEAM_PLAYER_OPP_ID, statId: made ? 'ft' : 'ft_miss', occurredAt: at(10), eventId,
  })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

function award(oneAndOne = false) {
  const result = captureBasketballFoul(started(oneAndOne), {
    recorderUserId: recorder, teamSide: 'tracked', offender: { kind: 'player', playerId: id(102) },
    class: 'personal', context: 'common', occurredAt: at(1), eventIds: [id(3), id(4)],
    freeThrows: { maximumAttempts: 2, oneAndOne, technical: false, possessionRetained: false },
  })
  if (!result.ok || !result.tripEventId) throw new Error('Award failed')
  return { state: result.state, tripEventId: result.tripEventId }
}

function attempt(state: GameState, tripEventId: string, made: boolean, number: number) {
  return captureBasketballFreeThrowAttempt(state, {
    recorderUserId: recorder, shooterPlayerId: TEAM_PLAYER_OPP_ID, tripEventId, made,
    occurredAt: at(number + 2), eventId: id(10 + number),
  })
}

describe('LCF-2 unattributed opponent free throws', () => {
  it.each([true, false])('records a standalone attempt without an opponent roster: made=%s', made => {
    const before = started()
    const after = shot(before, made)
    expect(sport(after).setup).toEqual(sport(before).setup)
    expect(Object.keys(sport(after).projection.participants)).toHaveLength(1)
    expect(after.players).toHaveLength(before.players.length)
    expect(sport(after).projection.score).toEqual({ tracked: 0, opponent: made ? 1 : 0 })
    expect(sport(after).projection.teamActorStats.opponent[made ? 'ft' : 'ft_miss']).toBe(1)
    expect(sport(after).projection.participants[id(101)].stats.ft).toBe(0)
    expect(after.shotChart).toHaveLength(0)
    expect(after.eventStream!.events[1]).toMatchObject({
      actors: [{ role: 'shooter', kind: 'team', label: 'Away' }],
      location: null, payload: { value: 1, attempt: 'free_throw', freeThrowTripId: null },
    })
  })

  it.each(['ft', 'ft_miss', '2pt', '3pt'] as const)('keeps tracked team %s capture blocked', statId => {
    const state = started()
    expect(captureBasketballDirectStat(state, { recorderUserId: recorder, playerId: TEAM_PLAYER_HOME_ID, statId }))
      .toMatchObject({ ok: false, state, code: 'invalid_actor' })
  })

  it.each(['2pt', '2pt_miss', '3pt', '3pt_miss'] as const)('does not expand unrelated opponent direct shots: %s', statId => {
    expect(captureBasketballDirectStat(started(), { recorderUserId: recorder, playerId: TEAM_PLAYER_OPP_ID, statId }))
      .toMatchObject({ ok: false, code: 'invalid_actor' })
  })

  it('rejects tracked team credit through the generic free-throw shot editor', () => {
    const captured = captureBasketballDirectStat(started(), {
      recorderUserId: recorder, playerId: id(102), statId: 'ft', occurredAt: at(10), eventId: id(2),
    })
    if (!captured.ok) throw new Error(captured.message)
    const state = captured.state
    const draft = buildBasketballShotEditDraft(state, id(2))
    if (!draft.ok) throw new Error(draft.message)
    expect(draft.value.teamSide).toBe('tracked')
    const before = structuredClone(state)
    expect(previewBasketballShotEdit(state, { ...draft.value, shooter: { kind: 'team' } }, recorder, at(20)))
      .toMatchObject({ ok: false, code: 'invalid_actor' })
    expect(state).toEqual(before)
    expect(sport(state).projection.participants[id(101)].stats.ft).toBe(1)
    expect(sport(state).projection.teamActorStats.tracked.ft).toBe(0)
  })

  it('requires a resolved player for a live tracked awarded trip', () => {
    const awarded = captureBasketballFoul(started(), {
      recorderUserId: recorder, teamSide: 'opponent', offender: { kind: 'team' },
      class: 'personal', context: 'shooting', occurredAt: at(1), eventIds: [id(3), id(4)],
      freeThrows: { maximumAttempts: 2, oneAndOne: false, technical: false, possessionRetained: false },
    })
    if (!awarded.ok || !awarded.tripEventId) throw new Error('Tracked award failed')
    const state = awarded.state
    expect(basketballFreeThrowTripStatuses(state)[0].teamSide).toBe('tracked')
    expect(captureBasketballFreeThrowAttempt(state, {
      recorderUserId: recorder, shooterPlayerId: TEAM_PLAYER_HOME_ID,
      tripEventId: awarded.tripEventId, made: true, occurredAt: at(2),
    })).toMatchObject({ ok: false, state, code: 'invalid_actor' })
    expect(sport(state).projection.score.tracked).toBe(0)
    const recorded = captureBasketballFreeThrowAttempt(state, {
      recorderUserId: recorder, shooterPlayerId: id(102), tripEventId: awarded.tripEventId,
      made: true, occurredAt: at(2), eventId: id(5),
    })
    if (!recorded.ok) throw new Error(recorded.message)
    expect(sport(recorded.state).projection.score.tracked).toBe(1)
    expect(sport(recorded.state).projection.participants[id(101)].stats.ft).toBe(1)
    expect(sport(recorded.state).projection.teamActorStats.tracked.ft).toBe(0)
  })

  it('records and closes an awarded trip with explicit team credit and no fabricated shooter', () => {
    const initial = award()
    const first = attempt(initial.state, initial.tripEventId, true, 1)
    if (!first.ok) throw new Error(first.message)
    const status = basketballFreeThrowTripStatuses(first.state)[0]
    expect(status).toMatchObject({ nextAttemptNumber: 2, attempts: [{ shooterPlayerId: TEAM_PLAYER_OPP_ID }] })
    expect(basketballTripShooter(status)).toBe(TEAM_PLAYER_OPP_ID)
    const second = attempt(first.state, initial.tripEventId, false, 2)
    if (!second.ok) throw new Error(second.message)
    expect(second.tripComplete).toBe(true)
    expect(basketballFreeThrowTripStatuses(second.state)[0]).toMatchObject({ open: false, closedReason: 'positions_complete' })
    expect(sport(second.state).projection.score.opponent).toBe(1)
    expect(sport(second.state).projection.sideStats.opponent).toMatchObject({ ft: 1, ft_miss: 1 })
    expect(Object.keys(sport(second.state).projection.participants)).toHaveLength(1)
    expect(attempt(second.state, initial.tripEventId, true, 3).ok).toBe(false)
    expect(captureBasketballFreeThrowAttempt(initial.state, {
      recorderUserId: recorder, shooterPlayerId: id(102), tripEventId: initial.tripEventId, made: true,
    })).toMatchObject({ ok: false, code: 'invalid_actor' })
  })

  it.each([true, false])('preserves one-and-one progress for unattributed first attempt: made=%s', made => {
    const initial = award(true)
    const first = attempt(initial.state, initial.tripEventId, made, 1)
    if (!first.ok) throw new Error(first.message)
    expect(basketballFreeThrowTripStatuses(first.state)[0]).toMatchObject({
      open: made, nextAttemptNumber: made ? 2 : null,
    })
    expect(attempt(first.state, initial.tripEventId, false, 2).ok).toBe(made)
  })

  it('keeps removed awarded positions consumed after reload, and permits explicit restore', () => {
    const initial = award()
    const first = attempt(initial.state, initial.tripEventId, true, 1)
    if (!first.ok) throw new Error(first.message)
    const removed = decrementBasketballDirectStat(first.state, TEAM_PLAYER_OPP_ID, 'ft', at(20))
    if (!removed.ok) throw new Error(removed.message)
    const normalized = { ...removed.state, sportGameState: normalizeSportGameState(removed.state.sportGameState) }
    const reloaded = rebuildGameEventProjection(normalized, gameEventRegistry, gameEventProjectors)
    expect(reloaded.inspection.complete).toBe(true)
    expect(basketballFreeThrowTripStatuses(reloaded.state)[0]).toMatchObject({
      nextAttemptNumber: 2, attempts: [{ attemptNumber: 1, deleted: true, shooterPlayerId: TEAM_PLAYER_OPP_ID }],
    })
    const restored = restoreLastBasketballCourtUndo(reloaded.state, at(21))
    if (!restored.ok) throw new Error(restored.message)
    expect(sport(restored.state).projection.score.opponent).toBe(1)
  })

  it('supports standalone Undo/restore without assigning player credit', () => {
    const made = shot(started())
    const removed = undoLatestBasketballCourtCapture(made, at(20))
    if (!removed.ok) throw new Error(removed.message)
    expect(sport(removed.state).projection.score.opponent).toBe(0)
    const restored = restoreLastBasketballCourtUndo(removed.state, at(21))
    if (!restored.ok) throw new Error(restored.message)
    expect(sport(restored.state).projection.teamActorStats.opponent.ft).toBe(1)
  })

  it('edits, adds recorded-later attempts and rejects stale previews with team attribution', () => {
    let state = shot(started())
    const draft = buildBasketballFoulFreeThrowEditDraft(state, id(2))
    if (!draft.ok) throw new Error(draft.message)
    expect(draft.value.shooter).toEqual({ kind: 'team' })
    const preview = previewBasketballFoulFreeThrowEdit(state, { ...draft.value, made: false }, recorder, at(20))
    if (!preview.ok) throw new Error(preview.message)
    const changed = applyBasketballFoulFreeThrowChange(state, preview.value)
    if (!changed.ok) throw new Error(changed.message)
    expect(sport(changed.state).projection.score.opponent).toBe(0)
    state = changed.state
    const generic = buildBasketballShotEditDraft(state, id(2))
    if (!generic.ok) throw new Error(generic.message)
    const genericPreview = previewBasketballShotEdit(state, { ...generic.value, made: true }, recorder, at(21))
    if (!genericPreview.ok) throw new Error(genericPreview.message)
    const genericEdit = applyBasketballShotEdit(state, genericPreview.value)
    if (!genericEdit.ok) throw new Error(genericEdit.message)
    expect(sport(genericEdit.state).projection.score.opponent).toBe(1)
    state = genericEdit.state
    const added = buildBasketballHistoricalFoulFreeThrowDraft(state, 'basketball.free_throw_attempt')
    if (!added.ok) throw new Error(added.message)
    const addPreview = previewBasketballHistoricalFoulFreeThrow(state, {
      ...added.value, teamSide: 'opponent', shooter: { kind: 'team' }, made: true,
    }, recorder, at(22))
    if (!addPreview.ok) throw new Error(addPreview.message)
    const applied = applyBasketballFoulFreeThrowChange(state, addPreview.value)
    if (!applied.ok) throw new Error(applied.message)
    expect(sport(applied.state).projection.score.opponent).toBe(2)
    expect(applyBasketballFoulFreeThrowChange(applied.state, addPreview.value).ok).toBe(false)
    expect(basketballFreeThrowShooterOptions(state, 'opponent')).toMatchObject([{ label: 'Unattributed', selection: { kind: 'team' } }])
    expect(basketballFreeThrowShooterOptions(state, 'tracked').every(option => option.selection.kind === 'participant')).toBe(true)
  })

  it('defaults historical free-throw addition to opponent when tracked identities are unresolved', () => {
    const state = structuredClone(started())
    sport(state).setup.participants.forEach(participant => { participant.playerId = null })
    const rebuilt = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
    expect(rebuilt.inspection.complete).toBe(true)
    expect(basketballFreeThrowShooterOptions(rebuilt.state, 'tracked')).toEqual([])
    const draft = buildBasketballHistoricalFoulFreeThrowDraft(rebuilt.state, 'basketball.free_throw_attempt')
    if (!draft.ok) throw new Error(draft.message)
    expect(draft.value).toMatchObject({ teamSide: 'opponent', shooter: { kind: 'team' } })
    const preview = previewBasketballHistoricalFoulFreeThrow(rebuilt.state, { ...draft.value, made: true }, recorder, at(20))
    if (!preview.ok) throw new Error(preview.message)
    const added = applyBasketballFoulFreeThrowChange(rebuilt.state, preview.value)
    if (!added.ok) throw new Error(added.message)
    expect(sport(added.state).projection.score).toEqual({ tracked: 0, opponent: 1 })
    expect(sport(added.state).projection.teamActorStats.opponent.ft).toBe(1)
  })

  it('rejects tracked-team and named-unknown attribution in historical free throws', () => {
    const state = shot(started())
    const draft = buildBasketballFoulFreeThrowEditDraft(state, id(2))
    if (!draft.ok) throw new Error(draft.message)
    for (const update of [
      { teamSide: 'tracked' as const, shooter: { kind: 'team' as const } },
      { teamSide: 'opponent' as const, shooter: { kind: 'unknown' as const, label: 'Someone' } },
    ]) expect(previewBasketballFoulFreeThrowEdit(state, { ...draft.value, ...update }, recorder, at(20))).toMatchObject({ ok: false, code: 'invalid_actor' })
  })

  it('round-trips cloud and canonical review with only team totals and no opponent player rows', () => {
    let state = shot(shot(started(), true), false, id(20))
    const inspection = rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors).inspection
    expect(basketballPlayerReview(state, inspection).opponent).toEqual([])
    expect(basketballTeamReview(state, inspection).attribution.unattributed.opponent)
      .toMatchObject({ points: 1, freeThrowsMade: 1, freeThrowsAttempted: 2 })
    const event = state.eventStream!.events[1]
    if (!isGameEventEnvelope(event)) throw new Error('Missing shot')
    const serialized = serializeGameEventForCloud('game-1', recorder, event, {})
    if (!serialized.ok) throw new Error(serialized.diagnostic.message)
    const p = serialized.params
    const deserialized = deserializeGameEventFromCloud({ id: p.p_id, game_id: p.p_game_id, recorded_by: recorder,
      sport_id: p.p_sport_id, event_type: p.p_event_type, schema_version: p.p_schema_version,
      stream_sequence: p.p_stream_sequence, revision: p.p_revision, period_id: p.p_period_id,
      period_order: p.p_period_order, elapsed_ms: p.p_elapsed_ms, occurred_at: p.p_occurred_at,
      team_side: p.p_team_side, location: p.p_location, actors: p.p_actors, payload: p.p_payload,
      event_created_at: p.p_event_created_at, event_updated_at: p.p_event_updated_at, deleted_at: p.p_deleted_at }, {})
    expect(deserialized).toMatchObject({ ok: true, event: { actors: [{ kind: 'team' }] } })
    const periods = sport(state).setup.rulesSnapshot.regulationSegments
    for (let index = 0; index < periods.length; index++) {
      const ended = endBasketballPeriod(state, { recorderUserId: recorder, occurredAt: at(30 + index * 2) })
      if (!ended.ok) throw new Error(ended.message)
      state = ended.state
      if (index < periods.length - 1) {
        const next = startNextBasketballPeriod(state, { recorderUserId: recorder, occurredAt: at(31 + index * 2) })
        if (!next.ok) throw new Error(next.message)
        state = next.state
      }
    }
    const complete = completeBasketballMatch(state, { recorderUserId: recorder, occurredAt: at(50) })
    if (!complete.ok) throw new Error(complete.message)
    const snapshot = parseBasketballCanonicalSnapshot(createBasketballCanonicalSnapshot('game-1', recorder, complete.state))
    const aggregate = projectBasketballCanonicalAggregateSource({ authority: 'canonical', publicationId: 'pub-1',
      publicationNumber: 1, snapshotFingerprint: 'fingerprint', finalizedAt: at(51), active: true,
      game: { id: 'game-1', date: '2026-10-26', status: 'final', cloudScope: 'personal', teamId: null, seasonId: null,
        tournamentId: null, trackedTeamName: 'Home', opponentName: 'Away' }, canonicalSnapshot: snapshot,
      participantSourceMap: { [id(101)]: id(102) }, canManage: true })
    if (!aggregate.ok) throw new Error(aggregate.exclusion.message)
    expect(aggregate.match.score).toEqual({ tracked: 0, opponent: 1 })
    expect(aggregate.match.teamStats.opponent).toMatchObject({ bk_pts: 1, bk_ftm: 1, bk_fta: 2 })
    expect(aggregate.match.players.filter(player => player.teamSide === 'opponent')).toEqual([])
  })
})
