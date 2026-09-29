import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import { createInitialState, gameReducer } from '../gameReducer'
import { cloudSyncRouteForState } from '../gameSyncFingerprint'
import { recordHockeyPlay, recordHockeyShot } from './captureCommands'
import { hockeySportState } from './live'
import { normalizeHockeyMatchSetup } from './setup'
import {
  addHockeyDraftPlayers,
  buildHockeyMatchSetup,
  createHockeyEventGameState,
  createHockeySetupDraft,
  hockeySetupTeamGate,
  hockeyDraftOverrides,
  hockeyDraftRules,
  hockeyDraftRulesSource,
  parseHockeyJerseyList,
  removeHockeyDraftEntry,
  setHockeyDraftGoalie,
  setHockeyDraftProfile,
  setHockeyDraftRoster,
  setHockeyEntryDressed,
  setHockeyEntryDressedAs,
  toggleHockeyDraftStarter,
  type HockeySetupDraft,
  type HockeySetupRosterPlayer,
} from './setupBuilder'
import { ctx } from './testFixtures'

const hockey = sports.find(sport => sport.id === 'hockey')!
const NO_SOURCE = { teamId: null, seasonId: null }

const roster: HockeySetupRosterPlayer[] = [
  { playerId: 'p-d', displayName: 'Dana', number: '4', position: 'd' },
  { playerId: 'p-g', displayName: 'Gus', number: '30', position: 'G' },
  { playerId: 'p-c', displayName: 'Cam', number: '9', position: 'C' },
  { playerId: 'p-lw', displayName: 'Lee', number: '11', position: 'LW' },
  { playerId: 'p-rw', displayName: 'Ray', number: '17', position: 'RW' },
  { playerId: 'p-d2', displayName: 'Dee', number: '2', position: 'D' },
  { playerId: 'p-x', displayName: 'Xan', number: null, position: null },
]

const idOf = (draft: HockeySetupDraft, playerId: string) => draft.entries.find(entry => entry.playerId === playerId)!.id

/** A draft with Gus in goal and five skaters starting. */
function readyDraft(): HockeySetupDraft {
  let draft = createHockeySetupDraft(roster)
  draft = setHockeyDraftGoalie(draft, idOf(draft, 'p-g'))
  for (const playerId of ['p-c', 'p-lw', 'p-rw', 'p-d', 'p-d2']) draft = toggleHockeyDraftStarter(draft, idOf(draft, playerId))
  return draft
}

describe('HKY-2E setup draft', () => {
  it('dresses a team roster in actor order, goalies as goalies, and picks no starters', () => {
    const draft = createHockeySetupDraft(roster)
    expect(draft.entries.map(entry => entry.displayName)).toEqual(['Cam', 'Lee', 'Ray', 'Dee', 'Dana', 'Gus', 'Xan'])
    expect(draft.entries.map(entry => entry.dressedAs)).toEqual(['skater', 'skater', 'skater', 'skater', 'skater', 'goalie', 'skater'])
    expect(draft.entries.every(entry => entry.dressed)).toBe(true)
    expect(draft.entries.find(entry => entry.playerId === 'p-d')!.position).toBe('D')
    expect(draft.goalieId).toBeNull()
    expect(draft.starterIds).toEqual([])
  })

  it('limits starters to the skaters per side and dresses a goalie picked as a skater', () => {
    let draft = readyDraft()
    expect(draft.starterIds).toHaveLength(5)
    const extra = toggleHockeyDraftStarter(draft, idOf(draft, 'p-x'))
    expect(extra).toBe(draft)
    draft = toggleHockeyDraftStarter(draft, idOf(draft, 'p-d2'))
    expect(draft.starterIds).toHaveLength(4)

    const gusAsSkater = toggleHockeyDraftStarter(draft, idOf(draft, 'p-g'))
    const gus = gusAsSkater.entries.find(entry => entry.playerId === 'p-g')!
    expect(gus.dressedAs).toBe('skater')
    expect(gusAsSkater.goalieId).toBeNull()
    expect(gusAsSkater.starterIds).toContain(gus.id)
  })

  it('removes lineup picks when a player is undressed, re-dressed or removed', () => {
    const draft = readyDraft()
    const cam = idOf(draft, 'p-c')
    const gus = idOf(draft, 'p-g')
    expect(setHockeyEntryDressed(draft, cam, false).starterIds).not.toContain(cam)
    expect(setHockeyEntryDressedAs(draft, cam, 'goalie').starterIds).not.toContain(cam)
    expect(setHockeyEntryDressed(draft, gus, false).goalieId).toBeNull()
    expect(removeHockeyDraftEntry(draft, gus).goalieId).toBeNull()
    expect(setHockeyDraftGoalie(draft, cam).starterIds).not.toContain(cam)
  })

  it('clears every pick when the roster is replaced', () => {
    const replaced = setHockeyDraftRoster(readyDraft(), roster.slice(0, 2))
    expect(replaced.entries).toHaveLength(2)
    expect(replaced.goalieId).toBeNull()
    expect(replaced.starterIds).toEqual([])
  })

  it('adds quick local players by jersey number', () => {
    expect(parseHockeyJerseyList('1, #7 9,,9  12')).toEqual(['1', '7', '9', '12'])
    const draft = addHockeyDraftPlayers(createHockeySetupDraft(), [
      { displayName: '', number: '7', position: null },
      { displayName: 'Goalie Gil', number: '1', position: 'g' },
      { displayName: ' ', number: '', position: null },
    ])
    expect(draft.entries.map(entry => [entry.displayName, entry.playerId, entry.dressedAs])).toEqual([
      ['#7', null, 'skater'],
      ['Goalie Gil', null, 'goalie'],
    ])
  })

  it('records period length and clock model as match overrides only when they differ', () => {
    const draft = createHockeySetupDraft()
    expect(hockeyDraftOverrides({ ...draft, periodLengthMinutes: 15, clockModel: 'anchored' })).toEqual({})
    const changed = { ...draft, periodLengthMinutes: 12, clockModel: 'none' as const }
    const rules = hockeyDraftRules(changed)
    expect(rules.regulation).toEqual({ periods: 3, periodLengthMs: 12 * 60_000 })
    expect(rules.clockModel).toBe('none')
    expect(rules.clock).toBeNull()
    const source = hockeyDraftRulesSource(changed)
    expect([source.regulation, source.clockModel, source.clock, source.overtime]).toEqual(['match', 'match', 'match', 'built_in'])
  })

  it('drops overrides and extra starters when the profile changes', () => {
    const draft = { ...readyDraft(), periodLengthMinutes: 10 }
    const nhl = setHockeyDraftProfile(draft, 'nhl_regular')
    expect(nhl.periodLengthMinutes).toBeNull()
    expect(hockeyDraftRules(nhl).regulation.periodLengthMs).toBe(20 * 60_000)
    expect(nhl.starterIds).toHaveLength(5)
  })
})

describe('HKY-2E building the setup', () => {
  it('rejects missing picks and out-of-range periods with form messages', () => {
    expect(buildHockeyMatchSetup(createHockeySetupDraft(roster), NO_SOURCE)).toEqual({ ok: false, message: 'Choose a starting goalie.' })
    const draft = readyDraft()
    expect(buildHockeyMatchSetup(toggleHockeyDraftStarter(draft, idOf(draft, 'p-c')), NO_SOURCE))
      .toEqual({ ok: false, message: 'Choose 5 starting skaters.' })
    expect(buildHockeyMatchSetup({ ...draft, periodLengthMinutes: 0 }, NO_SOURCE).ok).toBe(false)
    expect(buildHockeyMatchSetup({ ...draft, periodLengthMinutes: 12.5 }, NO_SOURCE).ok).toBe(false)
  })

  it('freezes only dressed players into a setup that passes the strict parser', () => {
    let draft = readyDraft()
    draft = setHockeyEntryDressed(draft, idOf(draft, 'p-x'), false)
    draft = { ...draft, opponentName: '  Wolves ', opponentGoalieNumber: '#35', trackedTeam: 'away', firstPeriodAttackingDirection: 'right_to_left' }
    const built = buildHockeyMatchSetup(draft, { teamId: 'team-1', seasonId: 'season-1' })
    if (!built.ok) throw new Error(built.message)
    const setup = built.setup
    expect(normalizeHockeyMatchSetup(setup)).toEqual(setup)
    expect(setup.participants).toHaveLength(6)
    expect(setup.participants.some(participant => participant.playerId === 'p-x')).toBe(false)
    expect(setup).toMatchObject({
      trackedTeam: 'away',
      opponentName: 'Wolves',
      sourceTeamId: 'team-1',
      sourceSeasonId: 'season-1',
      firstPeriodAttackingDirection: 'right_to_left',
      opponentGoalie: { label: '#35', number: '35' },
    })
    expect(setup.openingLineup.goalieParticipantId).toBe(idOf(draft, 'p-g'))
  })

  it('starts period 1 paused in a local game that survives hydration', () => {
    const built = buildHockeyMatchSetup(readyDraft(), NO_SOURCE)
    if (!built.ok) throw new Error(built.message)
    const created = createHockeyEventGameState({
      sport: hockey,
      setup: built.setup,
      teamName: ' ',
      opponentName: 'Wolves',
      date: '2026-09-29',
      context: ctx(0),
    })
    if (!created.ok) throw new Error(created.message)
    const sport = hockeySportState(created.state)!
    expect(created.state.gameInfo).toMatchObject({ teamName: 'Home', opponentName: 'Wolves', date: '2026-09-29' })
    expect(created.state.players.map(player => player.id).sort()).toEqual(['p-c', 'p-d', 'p-d2', 'p-g', 'p-lw', 'p-rw', 'p-x'])
    expect(sport.projection.status).toBe('in_progress')
    expect(sport.projection.activePeriodId).toBe('regulation-1')
    expect(sport.projection.clock?.running).toBe(false)
    expect(cloudSyncRouteForState(created.state)).toBe('unsupported')
    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: created.state })
    expect(hockeySportState(hydrated)?.setup).toEqual(built.setup)
  })
})

describe('HKY-2E local roster stats (PR #444 review)', () => {
  it('projects a local player\'s goal and hit into their player row, through hydration', () => {
    let draft = addHockeyDraftPlayers(createHockeySetupDraft(), ['30', '2', '3', '4', '5', '6'].map(number => ({ displayName: '', number, position: null })))
    draft = setHockeyDraftGoalie(draft, draft.entries[0].id)
    for (const entry of draft.entries.slice(1)) draft = toggleHockeyDraftStarter(draft, entry.id)
    const built = buildHockeyMatchSetup(draft, NO_SOURCE)
    if (!built.ok) throw new Error(built.message)
    expect(built.setup.participants.every(participant => participant.playerId === null)).toBe(true)
    const created = createHockeyEventGameState({ sport: hockey, setup: built.setup, teamName: 'Home', opponentName: 'Wolves', date: '2026-09-29', context: ctx(0) })
    if (!created.ok) throw new Error(created.message)
    const shooter = draft.entries[1].id
    const goal = recordHockeyShot(created.state, { side: 'tracked', outcome: 'goal', shooter: { participantId: shooter } }, ctx(10))
    if (!goal.ok) throw new Error(goal.message)
    const hit = recordHockeyPlay(goal.state, { kind: 'hit', side: 'tracked', player: { participantId: shooter } }, ctx(20))
    if (!hit.ok) throw new Error(hit.message)

    const hydrated = gameReducer(createInitialState(), { type: 'HYDRATE_STATE', state: hit.state })
    for (const state of [hit.state, hydrated]) {
      expect(hockeySportState(state)?.projection.score.tracked).toBe(1)
      const row = state.players.find(player => player.id === shooter)
      expect(row?.stats).toMatchObject({ hky_g: 1, hky_hit: 1 })
    }
  })
})

describe('HKY-2E selected team gate (PR #444 review)', () => {
  const teams = [{ id: 'team-1', seasonId: 'season-1' }]
  const ready = { selectedTeamId: 'team-1', teamsStatus: 'ready' as const, teams, rosterStatus: 'ready' as const, rosterTeamId: 'team-1' }

  it('lets a local roster start and freezes a resolved team with its season', () => {
    expect(hockeySetupTeamGate({ ...ready, selectedTeamId: '', teamsStatus: 'error', rosterStatus: 'idle', rosterTeamId: null }))
      .toEqual({ ok: true, source: { teamId: null, seasonId: null } })
    expect(hockeySetupTeamGate(ready)).toEqual({ ok: true, source: { teamId: 'team-1', seasonId: 'season-1' } })
  })

  it('never turns a selected team into a local setup while its metadata is late or failed', () => {
    expect(hockeySetupTeamGate({ ...ready, teamsStatus: 'loading', teams: [] }).ok).toBe(false)
    expect(hockeySetupTeamGate({ ...ready, teamsStatus: 'error', teams: [] }))
      .toEqual({ ok: false, message: 'Your teams could not load. Retry, or choose Local roster.' })
  })

  it('rejects a team outside the Hockey list and a roster from another or unfinished load', () => {
    expect(hockeySetupTeamGate({ ...ready, selectedTeamId: 'soccer-team' }).ok).toBe(false)
    expect(hockeySetupTeamGate({ ...ready, rosterTeamId: 'team-2' }).ok).toBe(false)
    expect(hockeySetupTeamGate({ ...ready, rosterStatus: 'loading', rosterTeamId: null }).ok).toBe(false)
    expect(hockeySetupTeamGate({ ...ready, rosterStatus: 'error', rosterTeamId: null }))
      .toEqual({ ok: false, message: 'The roster could not load. Retry, or choose Local roster.' })
  })
})

