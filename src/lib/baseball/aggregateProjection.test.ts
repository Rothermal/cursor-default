import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { adjustBaseballScore, baseballSportState, endBaseballGame, initializeBaseballEventGame,
  proposeBaseballMovements, recordBaseballPlateAppearance, reopenBaseballGame, setBaseballPitcherDecisions,
  startBaseballGame, substituteBaseball } from './commands'
import { baseballDecisionsView, baseballEmptyDecisions } from './decisions'
import { editBaseballPlay, previewBaseballEdit } from './corrections'
import { baseballActiveEvents } from './units'
import { aggregateBaseballMatches, projectBaseballCanonicalAggregateSource } from './aggregateProjection'
import { baseballAggregateRates, emptyBaseballAggregatePlayer } from './aggregateStats'
import { AGGREGATE_PLAYER, AGGREGATE_TEAM, aggregateUuid, baseballAggregateSource, finishedAggregateState } from './aggregateTestFixtures'
import { undoBaseballPlay } from './recentPlays'
import { replayBaseballAggregateAppearances } from './projector'
import { ballInPlay, baseballSetup, ctx, expectOk, pitch, projection, startedGame, strikeout, walk } from './testFixtures'
import type { BaseballCanonicalAggregateSource } from './aggregateTypes'

const playerScope = { type: 'career' as const, playerId: AGGREGATE_PLAYER }
function match(source: BaseballCanonicalAggregateSource) {
  const result = projectBaseballCanonicalAggregateSource(source)
  if (!result.ok) throw new Error(result.exclusion.message)
  return result.match
}
const fromState = (state: GameState) => match(baseballAggregateSource(finishedAggregateState(state)))
const player = (state: GameState, index = 1) => fromState(state).players.find(p => p.playerId === aggregateUuid(100 + index))!

describe('BSB-7A canonical replay aggregates', () => {
  it('counts starters/zero-outs pitchers but not unused bench or roster position text', () => {
    const state = startedGame()
    expect(player(state).stats).toMatchObject({ bsb_gp: 1, bsb_gs: 1, bsb_p_gp: 1, bsb_p_gs: 1, bsb_p_outs: 0 })
    expect(player(state, 10).stats.bsb_gp).toBe(0)
    expect(baseballAggregateRates(player(state, 10))).toMatchObject({ avg: null, obp: null, slg: null, ops: null, whip: null, fpct: null })
  })
  it('counts scoreless courtesy runners without inventing batting lines', () => {
    let state = walk(startedGame(baseballSetup({ trackedSide: 'away' })))
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'courtesy_runner', incomingId: 't10', outgoingId: 't1' }, ctx()))
    expect(player(state, 10).stats).toMatchObject({ bsb_gp: 1, bsb_gs: 0, bsb_running_gp: 1, bsb_pa: 0, bsb_r: 0 })
  })
  it('excludes a pregame replacement from GP and credits the actual starting pitcher', () => {
    let state = expectOk(initializeBaseballEventGame({ ...createInitialState(), sport: startedGame().sport }, baseballSetup()))
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't1' }, ctx()))
    state = expectOk(startBaseballGame(state, ctx()))
    expect(player(state).stats).toMatchObject({ bsb_gp: 0, bsb_gs: 0, bsb_p_gp: 0 })
    expect(player(state, 10).stats).toMatchObject({ bsb_gp: 1, bsb_gs: 1, bsb_p_gs: 1 })
  })
  it('counts a non-batting DH pitcher and a zero-pitch reliever', () => {
    const setup = baseballSetup({ rules: { battingOrderFormat: 'designated_hitter' } })
    setup.trackedLineup.battingOrder[0] = 't10'
    let state = startedGame(setup)
    expect(player(state).stats).toMatchObject({ bsb_b_gp: 0, bsb_p_gp: 1, bsb_gp: 1 })
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't11', outgoingId: 't1' }, ctx()))
    expect(player(state, 11).stats).toMatchObject({ bsb_p_gp: 1, bsb_p_gs: 0, bsb_p_outs: 0, bsb_gp: 1 })
  })
  it('does not double-count a starter returning to pitch', () => {
    let state = startedGame()
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't1' }, ctx()))
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't1', outgoingId: 't10' }, ctx()))
    expect(player(state).stats).toMatchObject({ bsb_gp: 1, bsb_gs: 1, bsb_p_gp: 1, bsb_p_gs: 1 })
  })
  it('uses live replay counts, not cached totals, and preserves removed history', () => {
    let state = ballInPlay(startedGame(baseballSetup({ trackedSide: 'away' })), 'home_run')
    state = expectOk(undoBaseballPlay(state, ctx().occurredAt!))
    const source = baseballAggregateSource(finishedAggregateState(state))
    const result = match(source)
    expect(result.players[0].stats.bsb_h).toBe(0)
    expect(result.teamTotals.tracked.runs).toBe(0)
    expect((source.canonicalSnapshot as { eventStream: { events: unknown[] } }).eventStream.events.length).toBeGreaterThan(2)
  })
  it('replays an actual revisioned score correction through the canonical builder', () => {
    let state = expectOk(adjustBaseballScore(startedGame(), 'tracked', 4, 'Original score', ctx()))
    const event = baseballActiveEvents(state).find(e => e.eventType === 'baseball.score_adjustment')!
    const edit = { eventId: event.id, payload: { ...event.payload, delta: 2, reason: 'Corrected score' }, location: event.location, actors: event.actors }
    const names = { tracked: 'Aces', opponent: 'Visitors' }
    const preview = previewBaseballEdit(state, edit, names)
    if (!preview.ok) throw new Error(preview.message)
    state = expectOk(editBaseballPlay(state, preview.preview, edit, names, { now: ctx().occurredAt!, confirmed: true }))
    expect(baseballActiveEvents(state).find(e => e.id === event.id)!.revision).toBe(2)
    expect(fromState(state).teamTotals.tracked.runs).toBe(2)
    expect(fromState(state).players.reduce((n, p) => n + p.stats.bsb_r, 0)).toBe(0)
  })
  it('keeps official score adjustments out of attributed player runs and team LOB out of player stats', () => {
    let state = walk(startedGame(baseballSetup({ trackedSide: 'away' })))
    state = expectOk(adjustBaseballScore(state, 'tracked', 4, 'Official correction', ctx()))
    const result = fromState(state)
    expect(result.teamTotals.tracked).toMatchObject({ runs: 4, hits: 0 })
    expect(result.players.reduce((n, p) => n + p.stats.bsb_r, 0)).toBe(0)
    expect(result.players[0].stats).not.toHaveProperty('bsb_lob')
  })
  it.each(Array.from({ length: 15 }, (_, i) => i + 1))('supports frozen regulation basis %i', basis => {
    const result = fromState(strikeout(startedGame(baseballSetup({ rules: { scheduledInnings: basis } }))))
    const line = result.players[0]
    expect(line.pitchingBases[basis]).toEqual({ outs: 1, er: 0, k: 1 })
    expect(baseballAggregateRates(line).pitchingBases[basis]).toEqual({ era: 0, strikeoutsPerBasis: 3 * basis, outs: 1 })
  })
  it('pools outs before IP formatting and keeps ERA numerators in separate bases', () => {
    const a = fromState(strikeout(startedGame(baseballSetup({ rules: { scheduledInnings: 6 } }))))
    const b = match(baseballAggregateSource(finishedAggregateState(strikeout(startedGame(baseballSetup({ rules: { scheduledInnings: 9 } })))), 2))
    const aggregate = aggregateBaseballMatches(playerScope, 'baseball', [a, b])
    const rates = baseballAggregateRates(aggregate.players[0])
    expect(rates.inningsPitched).toBe('0.2')
    expect(Object.keys(rates.pitchingBases)).toEqual(['6', '9'])
    expect(rates.whip).toBe(0)
  })
  it('pools AVG/OBP/SLG/OPS from raw counts and does not double-count IBB', () => {
    const row = emptyBaseballAggregatePlayer(AGGREGATE_PLAYER, 'Player', null)
    Object.assign(row.stats, { bsb_ab: 10, bsb_h: 4, bsb_bb: 3, bsb_ibb: 2, bsb_hbp: 1, bsb_sf: 2, bsb_tb: 7,
      bsb_f_po: 3, bsb_f_a: 2, bsb_f_e: 1 })
    expect(baseballAggregateRates(row)).toMatchObject({ avg: .4, obp: .5, slg: .7, ops: 1.2, totalChances: 6, fpct: 5 / 6 })
  })
  it('pools actual canonical batting games and preserves all catalog counters', () => {
    const a = fromState(ballInPlay(startedGame(baseballSetup({ trackedSide: 'away' })), 'home_run'))
    const b = match(baseballAggregateSource(finishedAggregateState(ballInPlay(startedGame(baseballSetup({ trackedSide: 'away' })), 'out', { fielders: [6, 3] })), 2))
    const result = aggregateBaseballMatches(playerScope, 'baseball', [a, b])
    expect(result.players[0].stats).toMatchObject({ bsb_gp: 2, bsb_pa: 2, bsb_ab: 2, bsb_h: 1, bsb_hr: 1, bsb_tb: 4 })
    expect(baseballAggregateRates(result.players[0])).toMatchObject({ avg: .5, obp: .5, slg: 2, ops: 2.5 })
  })
  it('separates all three variants without classifying healthy alternatives as corrupt', () => {
    const a = fromState(startedGame())
    const b = match(baseballAggregateSource(finishedAggregateState(startedGame(baseballSetup({ profile: 'nfhs_softball_fastpitch' }))), 2))
    const c = match(baseballAggregateSource(finishedAggregateState(startedGame(baseballSetup({ profile: 'softball_slowpitch' }))), 3))
    const result = aggregateBaseballMatches(playerScope, 'baseball', [a, b, c])
    expect(result.games).toHaveLength(1)
    expect(result.filteredVariantCount).toBe(2)
    expect(result.quality).toBe('complete')
  })
  it('requires exact personal participant keys/nulls but permits team mapper aliases and converged identities', () => {
    const source = baseballAggregateSource()
    source.participantSourceMap!.t1 = null
    const result = match(source)
    expect(result.teamTotals.tracked.runs).toBe(0)
    expect(result.unlinked).toContainEqual({ participantId: 't1', displayName: 'Player 1', appeared: true })
    delete source.participantSourceMap!.t2
    expect(projectBaseballCanonicalAggregateSource(source)).toMatchObject({ ok: false, exclusion: { kind: 'invalid_identity' } })
    const setup = baseballSetup()
    setup.sourceTeamId = AGGREGATE_TEAM
    const team = baseballAggregateSource(finishedAggregateState(startedGame(setup)))
    team.participantSourceMap!['player-t1'] = AGGREGATE_PLAYER
    team.participantSourceMap![aggregateUuid(999)] = AGGREGATE_PLAYER
    team.participantSourceMap!.t2 = AGGREGATE_PLAYER
    expect(match(team).players[0].stats.bsb_gp).toBe(1)
    team.participantSourceMap!['player-t1'] = aggregateUuid(900)
    expect(projectBaseballCanonicalAggregateSource(team)).toMatchObject({ ok: false, exclusion: { kind: 'invalid_identity' } })
  })
  it('does not compare raw pin fingerprints to hashes of merge-resolved maps', () => {
    const source = baseballAggregateSource()
    source.participantMapFingerprint = 'b'.repeat(32)
    source.participantSourceMap!.t1 = aggregateUuid(800)
    expect(match(source).players[0].playerId).toBe(aggregateUuid(800))
    source.identityStatus = 'invalid'; source.identityDiagnostic = 'unauthorized'; source.participantSourceMap = null
    expect(projectBaseballCanonicalAggregateSource(source)).toMatchObject({ ok: false, exclusion: { kind: 'invalid_identity' } })
  })
  it('deduplicates equivalent sources and rejects collisions in either arrival order', () => {
    const first = match(baseballAggregateSource())
    const other = structuredClone(first)
    other.sourceId = aggregateUuid(999)
    for (const rows of [[first, other], [other, first]]) {
      const result = aggregateBaseballMatches(playerScope, 'baseball', rows)
      expect(result.games).toHaveLength(0)
      expect(result.quality).toBe('partial')
    }
    expect(aggregateBaseballMatches(playerScope, 'baseball', [first, structuredClone(first)]).games).toHaveLength(1)
  })
  it('rejects ineligible outcomes and a canonical snapshot belonging to another game', () => {
    const source = baseballAggregateSource(finishedAggregateState())
    source.game.id = aggregateUuid(888)
    expect(projectBaseballCanonicalAggregateSource(source).ok).toBe(false)
    const forfeit = baseballAggregateSource(expectOk(endBaseballGame(startedGame(), 'forfeit', ctx(), { forfeitWinner: 'tracked', note: 'No opponent' })))
    expect(projectBaseballCanonicalAggregateSource(forfeit)).toMatchObject({ ok: false, exclusion: { kind: 'ineligible_source' } })
  })
  it.each(['teamId', 'seasonId'] as const)('rejects an otherwise healthy canonical setup/cloud %s mismatch', field => {
    const setup = baseballSetup()
    setup.sourceTeamId = AGGREGATE_TEAM
    setup.sourceSeasonId = aggregateUuid(700)
    const source = baseballAggregateSource(finishedAggregateState(startedGame(setup)))
    expect(projectBaseballCanonicalAggregateSource(source).ok).toBe(true)
    source.game[field] = aggregateUuid(701)
    expect(projectBaseballCanonicalAggregateSource(source)).toMatchObject({
      ok: false, exclusion: { kind: 'malformed_source', message: 'The Baseball setup and cloud scope disagree.' },
    })
  })
})

describe('BSB-7A pitch and decision coverage', () => {
  it('uses complete pitcher-games only for pitch ratios, including unlocated recorded pitches', () => {
    let state = pitch(startedGame(), { result: 'called_strike' })
    state = strikeout(state)
    state = expectOk(recordBaseballPlateAppearance(state, { result: 'walk', finalBalls: 4, finalStrikes: 1,
      movements: proposeBaseballMovements(projection(state), 'walk') }, ctx()))
    const row = player(state)
    expect(row.stats.bsb_p_pitches).toBeGreaterThan(3)
    expect(row.pitchCountLowerBoundGames).toBe(1)
    expect(row.pitchCoverage).toMatchObject({ includedGames: 0, excludedGames: 1, recordedPitches: 0 })
    expect(baseballAggregateRates(row).strikePercentage).toBeNull()
  })
  it.each(['intentional_walk', 'catcher_interference'] as const)('keeps exempt Quick PA %s exact', result => {
    let state = startedGame()
    state = expectOk(recordBaseballPlateAppearance(state, { result, movements: proposeBaseballMovements(projection(state), result === 'intentional_walk' ? 'walk' : result) }, ctx()))
    const row = player(state)
    expect(row.pitchCountLowerBoundGames).toBe(0)
    expect(row.pitchCoverage).toMatchObject({ includedGames: 1, excludedGames: 0 })
  })
  it('marks only the affected batter lower bound and keeps ordinary PA/AB totals', () => {
    let state = startedGame(baseballSetup({ trackedSide: 'away' }))
    state = expectOk(recordBaseballPlateAppearance(state, { result: 'in_play', inPlay: { result: 'out', battedBallType: 'ground', fielders: [6, 3], errorBy: null, insideThePark: false },
      movements: proposeBaseballMovements(projection(state), 'out', [6, 3]) }, ctx()))
    expect(player(state).pitchesSeenLowerBoundGames).toBe(1)
    expect(player(state).stats).toMatchObject({ bsb_pa: 1, bsb_ab: 1 })
    expect(player(state, 2).pitchesSeenLowerBoundGames).toBe(0)
  })
  it('credits known first-pitch observations to the original pitcher across a mid-PA change', () => {
    let state = pitch(startedGame(), { result: 'called_strike' })
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't1' }, ctx()))
    state = pitch(state, { result: 'ball' })
    expect(player(state).pitchCoverage).toMatchObject({ firstPitchObservations: 1, firstPitchStrikes: 1, unlocatedPitches: 1 })
    expect(player(state, 10).pitchCoverage).toMatchObject({ firstPitchObservations: 0, recordedPitches: 1 })
    expect(baseballAggregateRates(player(state, 10)).firstPitchStrikePercentage).toBeNull()
  })
  it('recognizes a real initial pitch at a frozen 1-1 starting count', () => {
    const state = pitch(startedGame(baseballSetup({ rules: { startingBalls: 1, startingStrikes: 1 } })), { result: 'called_strike' })
    expect(player(state).pitchCoverage).toMatchObject({ firstPitchObservations: 1, firstPitchStrikes: 1 })
  })
  it('excludes the whole converged player-game ratio when one pitcher contribution is incomplete', () => {
    let state = pitch(startedGame(), { result: 'called_strike' })
    state = strikeout(state)
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't1' }, ctx()))
    state = expectOk(recordBaseballPlateAppearance(state, { result: 'walk', movements: proposeBaseballMovements(projection(state), 'walk') }, ctx()))
    const source = baseballAggregateSource(finishedAggregateState(state))
    source.participantSourceMap!.t10 = source.participantSourceMap!.t1
    expect(match(source).players[0].pitchCoverage).toMatchObject({ excludedGames: 1, includedGames: 0, recordedPitches: 0 })
    expect(match(source).players[0].stats.bsb_p_gp).toBe(1)
  })
  it('distinguishes absent, reviewed-empty and valid explicit awards and drops old epochs', () => {
    let state = expectOk(adjustBaseballScore(startedGame(), 'tracked', 1, 'Official score', ctx()))
    state = expectOk(endBaseballGame(state, 'time_limit', ctx()))
    expect(match(baseballAggregateSource(state)).decisions.absent).toBe(1)
    state = expectOk(setBaseballPitcherDecisions(state, baseballEmptyDecisions(), ctx()))
    expect(match(baseballAggregateSource(state)).decisions.reviewedEmpty).toBe(1)
    const decisions = baseballEmptyDecisions(); decisions.tracked.win = 't1'
    state = expectOk(setBaseballPitcherDecisions(state, decisions, ctx()))
    expect(match(baseballAggregateSource(state)).players[0].stats.bsb_p_w).toBe(1)
    state = expectOk(reopenBaseballGame(state, 'Correct score', ctx()))
    state = expectOk(endBaseballGame(state, 'time_limit', ctx()))
    const republished = match(baseballAggregateSource(state))
    expect(republished.decisions.absent).toBe(1)
    expect(republished.players[0].stats.bsb_p_w).toBe(0)
    expect(baseballSportState(state)!.projection.status).toBe('final')
  })
  it('does not fall back to older valid awards when the newest decisions need review', () => {
    let state = expectOk(adjustBaseballScore(startedGame(), 'tracked', 1, 'Official score', ctx()))
    state = expectOk(endBaseballGame(state, 'time_limit', ctx()))
    const valid = baseballEmptyDecisions(); valid.tracked.win = 't1'
    state = expectOk(setBaseballPitcherDecisions(state, valid, ctx()))
    const invalid = baseballEmptyDecisions(); invalid.tracked.win = 't2'
    state = expectOk(setBaseballPitcherDecisions(state, invalid, ctx()))
    let result = match(baseballAggregateSource(state))
    expect(result.decisions.reviewNeeded).toBe(1)
    expect(result.players.reduce((n, p) => n + p.stats.bsb_p_w, 0)).toBe(0)
    state = expectOk(undoBaseballPlay(state, ctx().occurredAt!))
    result = match(baseballAggregateSource(state))
    expect(result.players[0].stats.bsb_p_w).toBe(1)
  })
  it('requires actual pitching appearance when a pregame-replaced pitcher has explicit decisions', () => {
    let state = expectOk(initializeBaseballEventGame({ ...createInitialState(), sport: startedGame().sport }, baseballSetup()))
    state = expectOk(substituteBaseball(state, 'tracked', { kind: 'defensive', position: 1, incomingId: 't10', outgoingId: 't1' }, ctx()))
    state = expectOk(startBaseballGame(state, ctx()))
    state = expectOk(adjustBaseballScore(state, 'tracked', 1, 'Official score', ctx()))
    state = expectOk(endBaseballGame(state, 'time_limit', ctx()))
    const decisions = baseballEmptyDecisions()
    decisions.tracked.win = 't1'
    state = expectOk(setBaseballPitcherDecisions(state, decisions, ctx()))
    const sport = baseballSportState(state)!
    const events = baseballActiveEvents(state)
    const legacyView = baseballDecisionsView(sport, events)
    expect(legacyView.current?.decisions.tracked.win).toBe('t1')
    expect(legacyView.pitchers.tracked).toContain('t1')
    expect(legacyView.issues).toEqual([])
    expect(replayBaseballAggregateAppearances(sport.setup, events).pitching.has('t1')).toBe(false)

    const result = match(baseballAggregateSource(state))
    expect(result.decisions).toMatchObject({ reviewNeeded: 1, valid: 0 })
    expect(result.players.find(p => p.playerId === aggregateUuid(110))!.decisions.reviewNeeded).toBe(1)
    for (const id of ['bsb_p_w', 'bsb_p_l', 'bsb_p_sv', 'bsb_p_hld']) {
      expect(result.players.reduce((total, row) => total + row.stats[id], 0)).toBe(0)
    }
  })
})
