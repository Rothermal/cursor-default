import { describe, expect, it, vi } from 'vitest'
import * as soccerProjector from './projector'
import { createInitialState } from '../gameReducer'
import { createSoccerSportGameState } from './state'
import { resolveSoccerMatchRules } from './rules'
import { prepareRunningSoccerKickoff as prepareSoccerKickoff } from './runningKickoff.testFixture'
import { soccerLineupDraftReducer, soccerLineupHistoryContext, soccerLineupHistoryDetails, soccerLineupManagerBlocked, soccerLineupPreset, soccerLineupSubmitStep, type SoccerLineupDraft } from './lineupManager'
import { soccerEventMatchesTimelineFilter } from './timeline'
import { soccerSummaryEventMatchesFilter } from './summaryTimeline'
import { applySoccerLineupTransition, previewSoccerLineupTransition, toggleSoccerClock, inspectSoccerHistory, deleteSoccerHistoryEvent } from './live'
import type { SoccerMatchSetup } from './types'

function fixture() {
  const setup: SoccerMatchSetup = {
    version: 2, trackedTeamDesignation: 'home', firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1', sourceSeasonId: null,
    rulesSnapshot: resolveSoccerMatchRules({ gameOverrides: { maxOnFieldPlayers: 2 } }),
    participants: ['keeper', 'defender', 'forward'].map((id, index) => ({
      id, kind: 'anonymous', playerId: null, displayName: id, number: String(index + 1),
      initialStatus: index < 2 ? 'starter' : 'bench', initialRole: { group: index === 0 ? 'goalkeeper' : 'forward', label: null },
    })),
    teamDefaultLineup: { version: 1, source: 'lineup_defaults', entries: [
      { participantId: 'keeper', role: { group: 'goalkeeper', label: null } },
      { participantId: 'forward', role: { group: 'midfielder', label: null } },
    ] },
  }
  const state = { ...createInitialState(), sport: { id: 'soccer', name: 'Soccer', icon: 'S', categories: [], scoreLabel: 'Goals', theme: { bg: '', bgLight: '', text: '', border: '', gradient: '' } }, sportGameState: createSoccerSportGameState(setup) }
  const result = prepareSoccerKickoff({ ...state, gameInfo: { teamName: 'Aces', opponentName: 'Visitors', date: '2026-09-08', tournamentName: '', tournamentId: null } }, setup, { recorderUserId: null, occurredAt: '2026-09-08T12:00:00Z' })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('lineup manager presets', () => {
  it('collects all active and removed details in one pass and counts custom-role relabels', () => {
    const paused = toggleSoccerClock(fixture(), { recorderUserId: null, nowMs: Date.parse('2026-09-08T12:01:00Z') })
    if (!paused.ok) throw new Error(paused.message)
    let state = paused.state
    const target = soccerLineupPreset(state, 'opening_lineup')!.onField
    for (const label of ['Wing', 'Striker', 'Wide']) {
      target[1].role = { group: 'custom', label }
      const preview = previewSoccerLineupTransition(state, target)
      if (!preview.ok) throw new Error(preview.message)
      const result = applySoccerLineupTransition(state, preview.preview, { recorderUserId: null })
      if (!result.ok) throw new Error(result.message)
      state = result.state
    }
    const events = inspectSoccerHistory(state).activeEvents.filter(event => event.eventType === 'soccer.lineup_transition')
    const removed = deleteSoccerHistoryEvent(state, events[2].id)
    if (!removed.ok) throw new Error(removed.message)
    const inspection = inspectSoccerHistory(removed.state)
    const baseline = soccerProjector.projectSoccerMatchEvents(removed.state, inspection.activeEvents)
    const spy = vi.spyOn(soccerProjector, 'projectSoccerMatchEvents')
    try {
      const details = soccerLineupHistoryDetails(removed.state, inspection)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.results[0].value).toEqual(baseline)
      expect(Object.keys(details)).toHaveLength(3)
      for (const event of events) expect(details[event.id]).toContain('0 entering · 0 leaving · 1 role changes')
    } finally { spy.mockRestore() }
    const before = vi.fn((event, projection) => {
      event.payload.onField.length = 0
      projection.participants = {}
    })
    const untrustedRemoved = [
      ...inspection.deletedEvents,
      { ...events[0], eventType: 'soccer.shot', deletedAt: '2026-09-08T12:02:00Z', payload: {} },
      events[0],
    ] as unknown as import('./types').SoccerLineupTransitionEvent[]
    expect(soccerProjector.projectSoccerMatchEvents(removed.state, inspection.activeEvents, {
      removed: untrustedRemoved, before,
    })).toEqual(baseline)
    expect(before).toHaveBeenCalledTimes(3)
    expect(events[0].payload.onField).toHaveLength(2)
  })

  it('reviews and corrects one transition against its preceding lineup after reload', () => {
    const paused = toggleSoccerClock(fixture(), { recorderUserId: null, nowMs: Date.parse('2026-09-08T12:01:00Z') })
    if (!paused.ok) throw new Error(paused.message)
    const preset = soccerLineupPreset(paused.state, 'team_default')!
    const preview = previewSoccerLineupTransition(paused.state, preset.onField, 'team_default')
    if (!preview.ok) throw new Error(preview.message)
    const applied = applySoccerLineupTransition(paused.state, preview.preview, { recorderUserId: null })
    if (!applied.ok) throw new Error(applied.message)
    const state = JSON.parse(JSON.stringify(applied.state)) as typeof applied.state
    const event = state.eventStream.events[state.eventStream.events.length - 1] as import('./types').SoccerLineupTransitionEvent
    const context = soccerLineupHistoryContext(state, event.id)
    if (context?.sportGameState?.sportId !== 'soccer') throw new Error('Missing historical Soccer projection')
    expect(context.sportGameState.projection.participants.defender.status).toBe('on_field')
    expect(state.sportGameState.projection.participants.defender.status).toBe('left')
    expect(soccerLineupHistoryDetails(state, inspectSoccerHistory(state))[event.id]).toBe('Team Default · 1 entering · 1 leaving · 0 role changes')
    expect(soccerEventMatchesTimelineFilter(event, 'lineup')).toBe(true)
    expect(soccerSummaryEventMatchesFilter(event, 'lineup')).toBe(true)
    const target = structuredClone(event.payload.onField)
    target[1].role = { group: 'defender', label: null }
    const correction = previewSoccerLineupTransition(state, target, 'manual', event.id)
    if (!correction.ok) throw new Error(correction.message)
    const corrected = applySoccerLineupTransition(state, correction.preview, { recorderUserId: null })
    if (!corrected.ok) throw new Error(corrected.message)
    expect(corrected.state.eventStream.events).toHaveLength(state.eventStream.events.length)
    expect(corrected.state.sportGameState.projection.participants.forward.role.group).toBe('defender')
  })

  it('preserves preset attribution and vacancy warnings while preparing a bench entry role', () => {
    const draft: SoccerLineupDraft = {
      target: [{ participantId: 'keeper', role: { group: 'goalkeeper', label: null } }],
      source: 'team_default', benchRoles: {}, confirmShort: true,
      unavailable: [{ participantId: 'ejected', name: 'Ejected starter', reason: 'Ejected' }],
    }
    const edited = soccerLineupDraftReducer(draft, {
      type: 'role', participantId: 'forward', role: { group: 'midfielder', label: null },
    })
    expect(edited.target).toBe(draft.target)
    expect(edited.source).toBe('team_default')
    expect(edited.unavailable).toEqual(draft.unavailable)
    expect(edited.confirmShort).toBe(false)
    expect(edited.benchRoles.forward.group).toBe('midfielder')
    const moved = soccerLineupDraftReducer(edited, {
      type: 'move', participantId: 'forward', role: edited.benchRoles.forward,
    })
    expect(moved.source).toBe('manual')
    expect(moved.unavailable).toEqual([])
    expect(moved.target).toHaveLength(2)
  })

  it.each(['role', 'move'] as const)('marks an edited preset manual through %s and persists that source', type => {
    const paused = toggleSoccerClock(fixture(), { recorderUserId: null, nowMs: Date.parse('2026-09-08T12:01:00Z') })
    if (!paused.ok) throw new Error(paused.message)
    const preset = soccerLineupPreset(paused.state, 'opening_lineup')!
    const original: SoccerLineupDraft = { target: [], benchRoles: {}, source: 'manual', unavailable: [], confirmShort: false }
    let draft = soccerLineupDraftReducer(original, { type: 'replace', target: preset.onField, source: 'opening_lineup' })
    expect(draft.source).toBe('opening_lineup')
    draft = soccerLineupDraftReducer(draft, { type, participantId: 'defender', role: { group: 'midfielder', label: null } })
    expect(draft.source).toBe('manual')
    const preview = previewSoccerLineupTransition(paused.state, draft.target, draft.source)
    if (!preview.ok) throw new Error(preview.message)
    const result = applySoccerLineupTransition(paused.state, preview.preview, { recorderUserId: null })
    if (!result.ok) throw new Error(result.message)
    const events = result.state.eventStream.events
    expect(events[events.length - 1]).toMatchObject({ payload: { source: 'manual' } })
    expect(original.target).toEqual([])
  })

  it('replaces rather than supplements drafts and clears confirmation/warnings on edits and reset', () => {
    const preset = soccerLineupPreset(fixture(), 'team_default')!
    const initial: SoccerLineupDraft = { target: [], benchRoles: {}, source: 'manual', unavailable: [], confirmShort: false }
    let draft = soccerLineupDraftReducer(initial, { type: 'replace', target: preset.onField, source: 'team_default', unavailable: [{ participantId: 'absent', name: 'Absent', reason: 'Ejected' }] })
    draft = soccerLineupDraftReducer(draft, { type: 'confirm', value: true })
    draft = soccerLineupDraftReducer(draft, { type: 'move', participantId: 'forward', role: { group: 'forward', label: null } })
    expect(draft).toMatchObject({ source: 'manual', confirmShort: false, unavailable: [] })
    expect(draft.target.map(entry => entry.participantId)).toEqual(['keeper'])
    draft = soccerLineupDraftReducer(draft, { type: 'role', participantId: 'forward', role: { group: 'defender', label: null } })
    expect(draft.target).toHaveLength(1)
    draft = soccerLineupDraftReducer(draft, { type: 'move', participantId: 'forward', role: draft.benchRoles.forward })
    expect(draft.target[1].role.group).toBe('defender')
    draft = soccerLineupDraftReducer(draft, { type: 'replace', target: [preset.onField[0]], source: 'manual' })
    expect(draft).toMatchObject({ target: [preset.onField[0]], benchRoles: {}, unavailable: [], confirmShort: false })
  })

  it('requires short-handed confirmation only for a valid target', () => {
    expect(soccerLineupSubmitStep(false, 1, 2, false)).toBe('blocked')
    expect(soccerLineupSubmitStep(false, 1, 2, true)).toBe('blocked')
    expect(soccerLineupSubmitStep(true, 1, 2, false)).toBe('confirm')
    expect(soccerLineupSubmitStep(true, 1, 2, true)).toBe('apply')
    expect(soccerLineupSubmitStep(true, 2, 2, false)).toBe('apply')
  })

  it('blocks running, final, terminal and externally disabled editors', () => {
    const state = fixture()
    expect(soccerLineupManagerBlocked(state, false)).toBe(true)
    state.sportGameState.projection.clock.running = false
    expect(soccerLineupManagerBlocked(state, false)).toBe(false)
    expect(soccerLineupManagerBlocked(state, true)).toBe(true)
    for (const status of ['ended', 'shootout', 'suspended', 'not_started'] as const) {
      expect(soccerLineupManagerBlocked({ ...state, sportGameState: { ...state.sportGameState, projection: { ...state.sportGameState.projection, status } } }, false)).toBe(true)
    }
    expect(soccerLineupManagerBlocked({ ...state, cloudSync: { ...state.cloudSync, gameStatus: 'final' } }, false)).toBe(true)
  })

  it('keeps opening and frozen team defaults distinct and clone-safe', () => {
    const state = fixture()
    expect(soccerLineupPreset(state, 'opening_lineup')?.onField.map(e => e.participantId)).toEqual(['keeper', 'defender'])
    const preset = soccerLineupPreset(state, 'team_default')!
    expect(preset.onField.map(e => e.participantId)).toEqual(['keeper', 'forward'])
    expect(preset.onField[1].role.group).toBe('midfielder')
    preset.onField[1].role.group = 'defender'
    expect(soccerLineupPreset(state, 'team_default')?.onField[1].role.group).toBe('midfielder')
  })
  it('leaves explicit vacancies for ejected and no-return players without retaining a displaced player', () => {
    const state = fixture()
    state.sportGameState.projection.participants.forward.hasExited = true
    expect(soccerLineupPreset(state, 'team_default')).toMatchObject({
      onField: [{ participantId: 'keeper' }], unavailable: [{ participantId: 'forward', reason: 'Return substitutions disabled' }],
    })
    state.sportGameState.projection.participantDiscipline.forward = { ejected: true, normalYellowCards: 0, shootoutYellowCards: 0, redCards: 1, shootoutRedCards: 0 }
    expect(soccerLineupPreset(state, 'team_default')?.unavailable[0].reason).toBe('Ejected')
  })
  it('omits absent team defaults for old matches', () => {
    const state = fixture()
    if (state.sportGameState.setup.version === 2) state.sportGameState.setup.teamDefaultLineup = null
    expect(soccerLineupPreset(state, 'team_default')).toBeNull()
    expect(soccerLineupPreset(state, 'opening_lineup')?.onField).toHaveLength(2)
  })
})
