import { describe, expect, it } from 'vitest'
import { createInitialState } from '../gameReducer'
import { createSoccerSportGameState } from './state'
import { resolveSoccerMatchRules } from './rules'
import { prepareSoccerKickoff } from './kickoff'
import { soccerLineupDraftReducer, soccerLineupManagerBlocked, soccerLineupPreset, soccerLineupSubmitStep, type SoccerLineupDraft } from './lineupManager'
import { applySoccerLineupTransition, previewSoccerLineupTransition, toggleSoccerClock } from './live'
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
