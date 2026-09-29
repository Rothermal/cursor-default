import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { createInitialState, gameReducer } from '../gameReducer'
import { activateParkedGame, listParkedGameRecords, parkActiveGame, saveActiveGameState } from '../gameParking'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'
import {
  adjustHockeyScore,
  changeHockeyGoalie,
  hockeyFaceoffTakerDefault,
  recentHockeyOpponentLabels,
  recordHockeyFaceoff,
  recordHockeyPlay,
  recordHockeyShot,
} from './captureCommands'
import { gameEventRegistry } from '../gameEvents/runtime'
import { createHockeyEvent } from './events'
import { endHockeyPeriod, hockeySportState, pauseHockeyClock, startHockeyClock, startHockeyGame, startNextHockeyPeriod } from './live'
import { replayHockeyEvents } from './projector'
import {
  canRestoreHockeyCapture,
  hockeyRecentEvents,
  restoreHockeyCapture,
  undoHockeyCapture,
} from './recentEvents'
import { HOCKEY_FACEOFF_DOTS } from './rinkGeometry'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame, projection } from './testFixtures'
import type { HockeyMatchSetup } from './types'

function started(setup: HockeyMatchSetup = hockeySetup({ rules: CLOCKLESS })): GameState {
  return expectOk(startHockeyGame(initializedHockeyGame(setup), ctx(0)))
}

function events(state: GameState): GameEvent[] {
  return state.eventStream!.events as GameEvent[]
}

function lastEvent(state: GameState): GameEvent {
  const list = events(state)
  return list[list.length - 1]
}

function stats(state: GameState, playerId: string): Record<string, number> {
  return state.players.find(player => player.id === playerId)?.stats ?? {}
}

function rejected(result: { ok: boolean; message?: string }): string {
  if (result.ok) throw new Error('Expected a rejection')
  return result.message!
}

function sportEvents(state: GameState): GameEvent[] {
  return events(state).filter(event => !event.deletedAt)
}

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('hockey faceoffs', () => {
  it('locates a faceoff exactly on its dot in the tracked direction and credits the taker', () => {
    let state = started()
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked', takerParticipantId: 'p2', opponentTakerLabel: '#19' }, ctx(5)))
    const event = lastEvent(state)
    expect(event).toMatchObject({
      eventType: 'hockey.faceoff',
      teamSide: 'neutral',
      location: { x: 0.5, y: 0.5, attackingDirection: 'left_to_right' },
      payload: { dotId: 'center', winner: 'tracked' },
    })
    expect(event.actors.map(actor => actor.role)).toEqual(['taker', 'opponent_taker'])
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'opponent', takerParticipantId: 'p2' }, ctx(6)))
    expect(stats(state, 'player-2')).toMatchObject({ hky_fow: 1, hky_fol: 1 })
    expect(projection(state).faceoffs).toMatchObject({ won: 1, lost: 1 })
    expect(recentHockeyOpponentLabels(events(state))).toEqual(['#19'])
  })

  it('rejects a faceoff whose location is off the dot or in the wrong direction', () => {
    const state = started()
    const period = { id: 'regulation-1', order: 1 }
    const base = {
      eventType: 'hockey.faceoff' as const,
      payload: { captureCommandId: null, dotId: 'center', winner: 'tracked' as const },
      period,
      elapsedMs: null,
      recorderUserId: null,
      sequence: 99,
      occurredAt: at(5),
    }
    const offDot = createHockeyEvent({ ...base, location: { x: 0.51, y: 0.5, attackingDirection: 'left_to_right' } })
    const wrongWay = createHockeyEvent({ ...base, location: { x: 0.5, y: 0.5, attackingDirection: 'right_to_left' } })
    const noLocation = createHockeyEvent({ ...base, location: null })
    const setup = hockeySportState(state)!.setup
    const inspect = (event: unknown) => gameEventRegistry.inspect(event)
    expect(inspect(offDot).ok ? null : inspect(offDot)).toMatchObject({ diagnostic: { message: 'A faceoff is located exactly on its dot.' } })
    expect(inspect(noLocation).ok).toBe(false)
    expect(inspect(wrongWay).ok).toBe(true)
    expect(replayHockeyEvents(setup, [...sportEvents(state), wrongWay as unknown as GameEvent]).diagnostics[0].message)
      .toMatch(/tracked side's direction/)
  })

  it('counts faceoffs by zone from the dot and the period direction', () => {
    let state = started()
    // Period 1: the tracked side attacks left to right, so the right end is offensive.
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'right_end_upper', winner: 'tracked' }, ctx(5)))
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'left_end_lower', winner: 'opponent' }, ctx(6)))
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'left_neutral_upper', winner: 'tracked' }, ctx(7)))
    expect(projection(state).faceoffs.byZone).toEqual({
      offensive: { won: 1, lost: 0 },
      neutral: { won: 1, lost: 0 },
      defensive: { won: 0, lost: 1 },
    })
    // Period 2 swaps ends: the same right-end dot is now defensive.
    state = expectOk(endHockeyPeriod(state, {}, ctx(10)))
    state = expectOk(startNextHockeyPeriod(state, ctx(11)))
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'right_end_upper', winner: 'tracked' }, ctx(12)))
    expect(lastEvent(state).location).toMatchObject({ ...HOCKEY_FACEOFF_DOTS.right_end_upper, attackingDirection: 'right_to_left' })
    expect(projection(state).faceoffs.byZone.defensive).toEqual({ won: 1, lost: 1 })
  })

  it('defaults the taker to the last tracked taker, else the first dressed centre', () => {
    let state = started()
    const setup = hockeySportState(state)!.setup
    expect(hockeyFaceoffTakerDefault(setup, projection(state))).toBe('p2')
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked', takerParticipantId: 'p4' }, ctx(5)))
    expect(hockeyFaceoffTakerDefault(setup, projection(state))).toBe('p4')
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked' }, ctx(6)))
    expect(hockeyFaceoffTakerDefault(setup, projection(state))).toBe('p4')
    const noCentre = hockeySetup({ rules: CLOCKLESS })
    noCentre.participants = noCentre.participants.map(entry => entry.position === 'C' ? { ...entry, position: 'LW' } : entry)
    const fresh = started(noCentre)
    expect(hockeyFaceoffTakerDefault(hockeySportState(fresh)!.setup, projection(fresh))).toBeNull()
  })

  it('only lets a dressed skater take a tracked faceoff', () => {
    const state = started()
    expect(rejected(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked', takerParticipantId: 'p1' }, ctx(5))))
      .toMatch(/Only a skater can take a faceoff/)
  })

  it('stamps the running anchored clock', () => {
    let state = started(hockeySetup())
    state = expectOk(startHockeyClock(state, ctx(1)))
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked' }, ctx(31)))
    expect(lastEvent(state).elapsedMs).toBe(30_000)
  })
})

describe('hockey hits, takeaways and giveaways', () => {
  it('puts a hit on the hitter\'s side and the player hit on the other side', () => {
    let state = started()
    state = expectOk(recordHockeyPlay(state, { kind: 'hit', side: 'tracked', player: { participantId: 'p5' }, hitPlayer: { label: '#8' }, location: { x: 0.3, y: 0.1 } }, ctx(5)))
    expect(lastEvent(state)).toMatchObject({
      eventType: 'hockey.hit',
      teamSide: 'tracked',
      location: { x: 0.3, y: 0.1, attackingDirection: 'left_to_right' },
    })
    state = expectOk(recordHockeyPlay(state, { kind: 'hit', side: 'opponent', player: { label: '#8' }, hitPlayer: { participantId: 'p2' } }, ctx(6)))
    expect(lastEvent(state).location).toBeNull()
    expect(projection(state).hits).toEqual({ tracked: 1, opponent: 1 })
    expect(stats(state, 'player-5')).toMatchObject({ hky_hit: 1 })
    expect(stats(state, 'player-2').hky_hit).toBeUndefined()
    expect(rejected(recordHockeyPlay(state, { kind: 'hit', side: 'tracked', player: { label: '#8' } }, ctx(7))))
      .toMatch(/dressed player/)
    expect(rejected(recordHockeyPlay(state, { kind: 'hit', side: 'opponent', hitPlayer: { label: 'Someone' } }, ctx(7))))
      .toMatch(/dressed player/)
  })

  it('credits takeaways and giveaways to the tracked player and totals each side', () => {
    let state = started()
    state = expectOk(recordHockeyPlay(state, { kind: 'takeaway', side: 'tracked', player: { participantId: 'p3' } }, ctx(5)))
    state = expectOk(recordHockeyPlay(state, { kind: 'giveaway', side: 'tracked', player: { participantId: 'p3' } }, ctx(6)))
    state = expectOk(recordHockeyPlay(state, { kind: 'giveaway', side: 'opponent' }, ctx(7)))
    expect(stats(state, 'player-3')).toMatchObject({ hky_tk: 1, hky_gv: 1 })
    expect(projection(state).takeaways).toEqual({ tracked: 1, opponent: 0 })
    expect(projection(state).giveaways).toEqual({ tracked: 1, opponent: 1 })
    expect(rejected(recordHockeyPlay(state, { kind: 'takeaway', side: 'tracked', hitPlayer: { label: '#2' } }, ctx(8))))
      .toMatch(/Only a hit/)
  })

  it('are refused between periods', () => {
    let state = started()
    state = expectOk(endHockeyPeriod(state, {}, ctx(5)))
    expect(rejected(recordHockeyPlay(state, { kind: 'hit', side: 'tracked' }, ctx(6)))).toMatch(/during a period/)
    expect(rejected(recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked' }, ctx(6)))).toMatch(/during a period/)
  })
})

describe('hockey Recent Events and Undo', () => {
  it('lists capture units newest first with lifecycle rows for context', () => {
    let state = started()
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', shooter: { participantId: 'p2' } }, ctx(5)))
    state = expectOk(recordHockeyFaceoff(state, { dotId: 'center', winner: 'opponent', takerParticipantId: 'p2' }, ctx(6)))
    const rows = hockeyRecentEvents(state)
    expect(rows.map(row => [row.label, row.capture, row.undoable])).toEqual([
      ['Tracked faceoff loss by Player 2', true, true],
      ['Tracked saved by Player 2', true, false],
      ['period started', false, false],
      ['opening lineup', false, false],
    ])
    expect(rows[0].periodLabel).toBe('Period 1')
  })

  it('groups events sharing a capture command into one unit', () => {
    const state = started()
    const period = { id: 'regulation-1', order: 1 }
    const shared = '5f1f1111-1111-4111-8111-111111111111'
    const make = (kind: 'hockey.hit' | 'hockey.takeaway', sequence: number) => createHockeyEvent({
      eventType: kind,
      payload: { captureCommandId: shared },
      period,
      elapsedMs: null,
      recorderUserId: null,
      sequence,
      occurredAt: at(5),
      teamSide: 'tracked',
    }) as unknown as GameEvent
    const grouped = { ...state, eventStream: { ...state.eventStream!, events: [...events(state), make('hockey.hit', 10), make('hockey.takeaway', 11)] } }
    const [unit] = hockeyRecentEvents(grouped)
    expect(unit).toMatchObject({ label: 'Tracked hit + Tracked takeaway', undoable: true })
    expect(unit.eventIds).toHaveLength(2)
    const undone = expectOk(undoHockeyCapture(grouped, at(6)))
    expect(events(undone).filter(event => event.deletedAt)).toHaveLength(2)
  })

  it.each([
    ['shot', (state: GameState) => recordHockeyShot(state, { side: 'tracked', outcome: 'goal', shooter: { participantId: 'p2' } }, ctx(5))],
    ['goalie change', (state: GameState) => changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(5))],
    ['score adjustment', (state: GameState) => adjustHockeyScore(state, { side: 'opponent', delta: 1, reason: 'Missed goal' }, ctx(5))],
    ['faceoff', (state: GameState) => recordHockeyFaceoff(state, { dotId: 'center', winner: 'tracked', takerParticipantId: 'p2' }, ctx(5))],
    ['hit', (state: GameState) => recordHockeyPlay(state, { kind: 'hit', side: 'tracked', player: { participantId: 'p5' } }, ctx(5))],
    ['takeaway', (state: GameState) => recordHockeyPlay(state, { kind: 'takeaway', side: 'opponent' }, ctx(5))],
    ['giveaway', (state: GameState) => recordHockeyPlay(state, { kind: 'giveaway', side: 'tracked', player: { participantId: 'p3' } }, ctx(5))],
  ])('undoes and restores a %s', (_name, record) => {
    const before = started()
    const after = expectOk(record(before))
    const undone = expectOk(undoHockeyCapture(after, at(6)))
    expect(projection(undone)).toEqual(projection(before))
    expect(undone.players).toEqual(before.players)
    expect(canRestoreHockeyCapture(undone)).toBe(true)
    const restored = expectOk(restoreHockeyCapture(undone, at(7)))
    expect(projection(restored)).toEqual(projection(after))
    expect(restored.players).toEqual(after.players)
    expect(hockeySportState(restored)!.capturePreferences.lastUndo).toBeNull()
  })

  it('refuses Undo behind a lifecycle or clock event', () => {
    let state = started(hockeySetup())
    state = expectOk(recordHockeyPlay(state, { kind: 'hit', side: 'tracked' }, ctx(5)))
    state = expectOk(startHockeyClock(state, ctx(6)))
    expect(hockeyRecentEvents(state).some(row => row.undoable)).toBe(false)
    expect(rejected(undoHockeyCapture(state, at(7)))).toMatch(/game flow/)
    state = expectOk(pauseHockeyClock(state, ctx(8)))
    expect(rejected(undoHockeyCapture(state, at(9)))).toMatch(/game flow/)
  })

  it('drops the restore receipt at the next capture, and only Undo removes the newest unit', () => {
    let state = started()
    state = expectOk(recordHockeyPlay(state, { kind: 'hit', side: 'tracked' }, ctx(5)))
    state = expectOk(recordHockeyPlay(state, { kind: 'takeaway', side: 'tracked' }, ctx(6)))
    state = expectOk(undoHockeyCapture(state, at(7)))
    expect(projection(state).takeaways.tracked).toBe(0)
    expect(projection(state).hits.tracked).toBe(1)
    state = expectOk(recordHockeyPlay(state, { kind: 'giveaway', side: 'tracked' }, ctx(8)))
    expect(canRestoreHockeyCapture(state)).toBe(false)
    expect(rejected(restoreHockeyCapture(state, at(9)))).toMatch(/nothing to restore/)
  })

  it('keeps the restore receipt out of fingerprints and across a reload and a park', () => {
    let state = started()
    state = expectOk(recordHockeyPlay(state, { kind: 'hit', side: 'tracked' }, ctx(5)))
    state = expectOk(undoHockeyCapture(state, at(6)))
    const withoutReceipt = { ...state, sportGameState: { ...hockeySportState(state)!, capturePreferences: { rinkFlipped: false, lastUndo: null } } }
    expect(buildGameSyncFingerprint(state)).toBe(buildGameSyncFingerprint(withoutReceipt as GameState))
    const reloaded = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
    expect(canRestoreHockeyCapture(reloaded)).toBe(true)
    saveActiveGameState(reloaded, 'user-1')
    parkActiveGame('user-1')
    const [record] = listParkedGameRecords('user-1')
    const resumed = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: activateParkedGame(record.localGameId, 'user-1')! })
    const restored = expectOk(restoreHockeyCapture(resumed, at(7)))
    expect(projection(restored).hits.tracked).toBe(1)
  })

  it('drops a malformed receipt on reload', () => {
    const state = started()
    const sport = hockeySportState(state)!
    const bad = { ...state, sportGameState: { ...sport, capturePreferences: { rinkFlipped: true, lastUndo: { createdAt: at(1), entries: [{ eventId: 7 }] } } } }
    const reloaded = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(bad)) as GameState })
    expect(hockeySportState(reloaded)!.capturePreferences).toEqual({ rinkFlipped: true, lastUndo: null })
  })
})
