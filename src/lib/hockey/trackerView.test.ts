import { describe, expect, it } from 'vitest'
import { hockeyTrackerMarkers, type HockeyTrackerFilters } from './trackerView'
import { recordHockeyPlay, recordHockeyShot } from './captureCommands'
import { endHockeyPeriod, startHockeyGame, startNextHockeyPeriod } from './live'
import { CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame } from './testFixtures'
import type { GameEvent } from '../gameEvents/types'
import { buildGameSyncFingerprint } from '../gameSyncFingerprint'

function fixture() {
  const setup = hockeySetup({ rules: CLOCKLESS })
  let state = expectOk(startHockeyGame(initializedHockeyGame(setup), ctx(0)))
  state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'goal', location: { x: 0.8, y: 0.4 } }, ctx(1)))
  state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'missed', location: { x: 0.2, y: 0.6 } }, ctx(2)))
  state = expectOk(recordHockeyPlay(state, { side: 'tracked', kind: 'hit', location: { x: 0.5, y: 0.1 } }, ctx(3)))
  state = expectOk(endHockeyPeriod(state, {}, ctx(4)))
  state = expectOk(startNextHockeyPeriod(state, ctx(5)))
  state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved', location: { x: 0.3, y: 0.3 } }, ctx(6)))
  state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved' }, ctx(7)))
  return { state, setup, events: state.eventStream!.events as GameEvent[] }
}

describe('Hockey tracker marker display filters', () => {
  it.each([
    [{ family: 'all', side: 'all', scope: 'match' }, 4],
    [{ family: 'shots', side: 'all', scope: 'match' }, 3],
    [{ family: 'plays', side: 'all', scope: 'match' }, 1],
    [{ family: 'all', side: 'opponent', scope: 'match' }, 1],
    [{ family: 'all', side: 'tracked', scope: 'match' }, 3],
    [{ family: 'shots', side: 'tracked', scope: 'current' }, 1],
    [{ family: 'plays', side: 'tracked', scope: 'current' }, 0],
  ] as Array<[HockeyTrackerFilters, number]>)('filters %j without touching saved facts', (filters, count) => {
    const { state, setup, events } = fixture()
    const before = JSON.stringify(state), fingerprint = buildGameSyncFingerprint(state)
    const markers = hockeyTrackerMarkers(setup, events, 'regulation-2', filters)
    expect(markers).toHaveLength(count)
    for (const marker of markers) {
      const event = events.find(item => item.id === marker.id)!
      expect(marker).toMatchObject({ x: event.location!.x, y: event.location!.y, teamSide: event.teamSide })
    }
    expect(JSON.stringify(state)).toBe(before)
    expect(buildGameSyncFingerprint(state)).toBe(fingerprint)
  })
  it('excludes deleted and unlocated rows and does not invent a current period', () => {
    const { setup, events } = fixture()
    const removedId = events.find(event => event.eventType === 'hockey.shot' && event.teamSide === 'tracked')!.id
    const removed = events.map(event => event.id === removedId ? { ...event, deletedAt: event.updatedAt } : event)
    expect(hockeyTrackerMarkers(setup, removed, null, { family: 'all', side: 'all', scope: 'match' })).toHaveLength(3)
    expect(hockeyTrackerMarkers(setup, removed, null, { family: 'all', side: 'all', scope: 'current' })).toEqual([])
  })
})
