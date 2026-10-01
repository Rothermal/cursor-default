import { describe, expect, it } from 'vitest'
import type { GameState } from '../../types'
import type { GameEvent } from '../gameEvents/types'
import { createInitialState, gameReducer } from '../gameReducer'
import {
  changeHockeyGoalie,
  recordHockeyPenalties,
  recordHockeyPlay,
  recordHockeyShot,
  recordHockeyTimeout,
} from './captureCommands'
import { endHockeyPeriod, startHockeyClock, startHockeyGame, startNextHockeyPeriod } from './live'
import { restoreHockeyCapture, undoHockeyCapture } from './recentEvents'
import { at, CLOCKLESS, ctx, expectOk, hockeySetup, initializedHockeyGame } from './testFixtures'
import {
  activeHockeyTimelineFilterCount,
  DEFAULT_HOCKEY_TIMELINE_FILTERS,
  filterHockeyTimelineRows,
  groupHockeyTimelineByPeriod,
  hockeyTimeline,
  hockeyTimelinePeriods,
  type HockeyTimelineFilters,
} from './timeline'
import { hockeyParticipantLabel } from './captureCommands'
import { hockeyTimelineEventFields } from './timelineDetail'

const LABELS = { tracked: 'Blades', opponent: 'Rivals' }

function filters(overrides: Partial<HockeyTimelineFilters>): HockeyTimelineFilters {
  return { ...DEFAULT_HOCKEY_TIMELINE_FILTERS, ...overrides }
}

/** A clockless game with one of each family across two periods. */
function clocklessGame(): GameState {
  let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup({ rules: CLOCKLESS })), ctx(0)))
  state = expectOk(recordHockeyShot(state, {
    side: 'tracked',
    outcome: 'goal',
    shooter: { participantId: 'p2' },
    assists: [{ participantId: 'p3' }],
    strength: 'ev',
  }, ctx(1)))
  state = expectOk(recordHockeyShot(state, { side: 'opponent', outcome: 'saved', shooter: { label: '#9' } }, ctx(2)))
  state = expectOk(recordHockeyPlay(state, { kind: 'hit', side: 'tracked', player: { participantId: 'p5' } }, ctx(3)))
  state = expectOk(recordHockeyPenalties(state, {
    penalties: [
      { side: 'tracked', class: 'minor', infraction: 'tripping', offenderKind: 'player', offender: { participantId: 'p4' } },
      { side: 'opponent', class: 'minor', infraction: 'roughing', offenderKind: 'player', offender: { label: '#12' } },
    ],
    coincidental: true,
    captureCommandId: '00000000-0000-4000-8000-000000000001',
  }, ctx(4)))
  state = expectOk(endHockeyPeriod(state, {}, ctx(5)))
  state = expectOk(startNextHockeyPeriod(state, ctx(6)))
  state = expectOk(changeHockeyGoalie(state, { side: 'tracked', inParticipantId: 'p30' }, ctx(7)))
  return expectOk(recordHockeyTimeout(state, { side: 'opponent' }, ctx(8)))
}

describe('Hockey Timeline rows', () => {
  it('lists every event by period, oldest first, with families, sides, players and strength', () => {
    const { rows, historyMessage } = hockeyTimeline(clocklessGame(), LABELS)
    expect(historyMessage).toBeNull()
    expect(rows.map(row => [row.periodLabel, row.label])).toEqual([
      ['Period 1', 'opening lineup'],
      ['Period 1', 'period started'],
      ['Period 1', 'Blades goal by Player 2'],
      ['Period 1', 'Rivals saved by #9'],
      ['Period 1', 'Blades hit by Player 5'],
      ['Period 1', 'Blades minor, tripping (2 min) on Player 4 + Rivals minor, roughing (2 min) on #12'],
      ['Period 1', 'period ended'],
      ['Period 2', 'period started'],
      ['Period 2', 'Blades goalie change'],
      ['Period 2', 'Rivals timeout'],
    ])
    const goal = rows[2]
    expect(goal).toMatchObject({
      families: ['goals', 'shots'],
      sides: ['tracked'],
      participantIds: ['p2', 'p3'],
      strength: 'ev',
      capture: true,
      removed: false,
      revised: false,
      recordedLater: false,
      displayMs: null,
      diagnostic: null,
    })
    // The tracked goalie stamped on an opponent shot counts as named on it.
    expect(rows[3].participantIds).toEqual(['p1'])
    // A coincidental pair is one row with both sides.
    expect(rows[5]).toMatchObject({ families: ['penalties'], sides: ['tracked', 'opponent'], participantIds: ['p4'] })
    expect(rows[8]).toMatchObject({ families: ['goalies'], participantIds: ['p30'] })
    expect(rows[0]).toMatchObject({ families: ['game_flow'], capture: false })
    // Freshly captured events are at revision 1 and carry no badge.
    expect(rows.some(row => row.revised)).toBe(false)
  })

  it('filters by family, side, period and player, and groups by period', () => {
    const { rows } = hockeyTimeline(clocklessGame(), LABELS)
    const labels = (f: Partial<HockeyTimelineFilters>) => filterHockeyTimelineRows(rows, filters(f)).map(row => row.label)
    expect(labels({ families: ['goals'] })).toEqual(['Blades goal by Player 2'])
    expect(labels({ families: ['shots'] })).toEqual(['Blades goal by Player 2', 'Rivals saved by #9'])
    expect(labels({ families: ['physical', 'team'] })).toEqual(['Blades hit by Player 5', 'Rivals timeout'])
    expect(labels({ side: 'opponent' })).toEqual([
      'Rivals saved by #9',
      'Blades minor, tripping (2 min) on Player 4 + Rivals minor, roughing (2 min) on #12',
      'Rivals timeout',
    ])
    expect(labels({ periodId: 'regulation-2' })).toEqual(['period started', 'Blades goalie change', 'Rivals timeout'])
    expect(labels({ participantId: 'p3' })).toEqual(['Blades goal by Player 2'])
    expect(hockeyTimelinePeriods(rows)).toEqual([
      { id: 'regulation-1', label: 'Period 1' },
      { id: 'regulation-2', label: 'Period 2' },
    ])
    expect(groupHockeyTimelineByPeriod(rows).map(group => [group.label, group.rows.length])).toEqual([['Period 1', 7], ['Period 2', 3]])
    expect(activeHockeyTimelineFilterCount(DEFAULT_HOCKEY_TIMELINE_FILTERS)).toBe(0)
    expect(activeHockeyTimelineFilterCount(filters({ side: 'tracked', showRemoved: true }))).toBe(2)
  })

  it('hides removed rows by default and marks Undo and Restore as revised', () => {
    const state = undoHockeyCapture(clocklessGame(), at(9))
    if (!state.ok) throw new Error(state.message)
    let { rows } = hockeyTimeline(state.state, LABELS)
    const removed = rows.find(row => row.label === 'Rivals timeout')!
    expect(removed).toMatchObject({ removed: true, revised: true })
    expect(filterHockeyTimelineRows(rows, DEFAULT_HOCKEY_TIMELINE_FILTERS).some(row => row.removed)).toBe(false)
    expect(filterHockeyTimelineRows(rows, filters({ showRemoved: true })).slice(-1)[0]).toBe(removed)

    const restored = expectOk(restoreHockeyCapture(state.state, at(10)))
    rows = hockeyTimeline(restored, LABELS).rows
    expect(rows.slice(-1)[0]).toMatchObject({ label: 'Rivals timeout', removed: false, revised: true })
  })

  it('shows the clock as the rules display it', () => {
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0)))
    state = expectOk(startHockeyClock(state, ctx(10)))
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved' }, ctx(70)))
    const shot = hockeyTimeline(state, LABELS).rows.find(row => row.label === 'Blades saved')!
    // USA Hockey youth: 15-minute periods counting down, so a shot 1:00 in shows 14:00.
    expect(shot.displayMs).toBe(840_000)
    expect(shot.events[0].elapsedMs).toBe(60_000)
  })

  it('marks the row where a stored history stops replaying', () => {
    const state = clocklessGame()
    // Corrupt the Period 2 start: the events after it no longer belong to the current period.
    const events = (state.eventStream!.events as GameEvent[]).map(event =>
      event.eventType === 'hockey.period_started' && event.period.id === 'regulation-2'
        ? { ...event, deletedAt: at(20), revision: event.revision + 1 }
        : event
    )
    const broken: GameState = { ...state, eventStream: { ...state.eventStream!, events } }
    const { rows, historyMessage } = hockeyTimeline(broken, LABELS)
    expect(historyMessage).toBeNull()
    const failing = rows.filter(row => row.diagnostic)
    expect(failing.map(row => row.label)).toEqual(['Blades goalie change'])
    expect(failing[0].diagnostic).toMatch(/current period|match is not in progress|period/i)
  })

  it('keeps count-down times for rows after the point where replay stops', () => {
    let state = expectOk(startHockeyGame(initializedHockeyGame(hockeySetup()), ctx(0)))
    state = expectOk(endHockeyPeriod(state, { reason: 'Test' }, ctx(5)))
    state = expectOk(startNextHockeyPeriod(state, ctx(10)))
    state = expectOk(startHockeyClock(state, ctx(20)))
    state = expectOk(recordHockeyShot(state, { side: 'tracked', outcome: 'saved' }, ctx(80)))
    const shotBefore = hockeyTimeline(state, LABELS).rows.find(row => row.label === 'Blades saved')!
    expect(shotBefore.displayMs).toBe(840_000)

    const events = (state.eventStream!.events as GameEvent[]).map(event =>
      event.eventType === 'hockey.period_started' && event.period.id === 'regulation-2'
        ? { ...event, deletedAt: at(90), revision: event.revision + 1 }
        : event
    )
    const broken: GameState = { ...state, eventStream: { ...state.eventStream!, events } }
    const { rows } = hockeyTimeline(broken, LABELS)
    expect(rows.some(row => row.diagnostic)).toBe(true)
    // Period 2 is missing from the stopped replay; the rules still give its length.
    expect(rows.find(row => row.label === 'Blades saved')!.displayMs).toBe(840_000)
  })

  it('shows every recorded field in the detail, with ids as names', () => {
    let state = clocklessGame()
    state = expectOk(changeHockeyGoalie(state, {
      side: 'opponent',
      inParticipantId: 'opp-2',
      newOpponentGoalie: { id: 'opp-2', label: 'Backup', number: '1' },
    }, ctx(9)))
    const timeline = hockeyTimeline(state, LABELS)
    const field = (label: string, fields: Array<{ label: string; value: string }>) => fields.find(entry => entry.label === label)?.value

    const lineup = hockeyTimelineEventFields(timeline.rows[0].events[0], timeline.names)
    expect(field('Goalie', lineup)).toBe('#1 Player 1')
    expect(field('Skaters', lineup)).toBe('#2 Player 2, #3 Player 3, #4 Player 4, #5 Player 5, #6 Player 6')
    expect(field('Opponent goalie', lineup)).toBe('#35')

    const change = hockeyTimelineEventFields(timeline.rows.slice(-1)[0].events[0], timeline.names)
    expect(field('Goalie in', change)).toBe('#1 Backup')
    // Undo keeps the historical label: removed goalie changes still name their goalie.
    const undone = undoHockeyCapture(state, at(10))
    if (!undone.ok) throw new Error(undone.message)
    expect(hockeyTimeline(undone.state, LABELS).names['opp-2']).toBe('#1 Backup')

    // Setup names a number-only player "#7"; the label shows the number once.
    expect(hockeyParticipantLabel({ ...hockeySetup().participants[0], number: '7', displayName: '#7' })).toBe('#7')

    const goal = hockeyTimelineEventFields(timeline.rows[2].events[0], timeline.names)
    expect(goal).toEqual(expect.arrayContaining([
      { label: 'Shooter', value: '#2 Player 2' },
      { label: 'Assist', value: '#3 Player 3' },
      { label: 'Goalie', value: '#35' },
      { label: 'Strength', value: 'Even strength' },
    ]))
  })

  it('survives hydration unchanged', () => {
    const state = clocklessGame()
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: JSON.parse(JSON.stringify(state)) as GameState })
    expect(hockeyTimeline(hydrated, LABELS)).toEqual(hockeyTimeline(state, LABELS))
  })
})
