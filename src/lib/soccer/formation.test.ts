import { describe, expect, it } from 'vitest'
import {
  SOCCER_FORMATION_TEMPLATES,
  applySoccerFormationToRosterDrafts,
  assignSoccerFormationPlayer,
  clearSoccerFormationSlot,
  createSoccerTeamFormation,
  decideSoccerFormationPrefill,
  getSoccerFormationTemplate,
  parseSoccerTeamFormation,
  prepareSoccerFormationForSave,
  soccerFormationTemplatesForCount,
  switchSoccerFormationTemplate,
  unavailableSoccerFormationPlayerIds,
  type SoccerFormationParticipantDraft,
} from './formation'

const PLAYER_1 = '11111111-1111-4111-8111-111111111111'
const PLAYER_2 = '22222222-2222-4222-8222-222222222222'
const PLAYER_3 = '33333333-3333-4333-8333-333333333333'

describe('soccer formation catalog', () => {
  it('defines the approved templates in deterministic order', () => {
    expect(SOCCER_FORMATION_TEMPLATES.map(template => template.id)).toEqual([
      '11v11-4-3-3',
      '11v11-4-4-2',
      '11v11-3-4-3',
      '9v9-3-3-2',
      '9v9-3-2-3',
      '9v9-2-3-3',
      '7v7-2-3-1',
      '7v7-3-2-1',
      '7v7-2-2-2',
    ])
    expect(soccerFormationTemplatesForCount(9).map(template => template.id)).toEqual([
      '9v9-3-3-2',
      '9v9-3-2-3',
      '9v9-2-3-3',
    ])
    expect(getSoccerFormationTemplate('unknown')).toBeNull()
  })

  it('keeps every template internally valid and immutable', () => {
    for (const template of SOCCER_FORMATION_TEMPLATES) {
      expect(template.slots).toHaveLength(template.playerCount)
      expect(template.slots.filter(slot => slot.roleGroup === 'goalkeeper')).toHaveLength(1)
      expect(new Set(template.slots.map(slot => slot.id)).size).toBe(template.slots.length)
      expect(new Set(template.slots.map(slot => `${slot.x}:${slot.y}`)).size).toBe(template.slots.length)
      expect(Object.isFrozen(template)).toBe(true)
      expect(Object.isFrozen(template.slots)).toBe(true)
      for (const slot of template.slots) {
        expect(slot.roleGroup).not.toBe('custom')
        expect(Number.isFinite(slot.x)).toBe(true)
        expect(Number.isFinite(slot.y)).toBe(true)
        expect(slot.x).toBeGreaterThanOrEqual(0)
        expect(slot.x).toBeLessThanOrEqual(1)
        expect(slot.y).toBeGreaterThanOrEqual(0)
        expect(slot.y).toBeLessThanOrEqual(1)
        expect(Object.isFrozen(slot)).toBe(true)
      }
    }
  })
})

describe('soccer formation schema and transitions', () => {
  it('round-trips partial formations and normalizes assignment order', () => {
    expect(parseSoccerTeamFormation({
      assignments: { st: PLAYER_2, gk: PLAYER_1 },
      templateId: '7v7-2-3-1',
      version: 1,
    })).toEqual({
      ok: true,
      value: {
        version: 1,
        templateId: '7v7-2-3-1',
        assignments: { gk: PLAYER_1, st: PLAYER_2 },
      },
    })
    expect(parseSoccerTeamFormation({
      version: 1,
      templateId: '7v7-2-3-1',
      assignments: {},
    })).toMatchObject({ ok: true })
  })

  it('rejects unknown keys, templates, slots, ids, and duplicate players', () => {
    const valid = {
      version: 1,
      templateId: '7v7-2-3-1',
      assignments: { gk: PLAYER_1 },
    }
    expect(parseSoccerTeamFormation({ ...valid, extra: true })).toMatchObject({ ok: false })
    expect(parseSoccerTeamFormation({ ...valid, templateId: '7v7-custom' })).toMatchObject({ ok: false })
    expect(parseSoccerTeamFormation({ ...valid, assignments: { rb: PLAYER_1 } })).toMatchObject({ ok: false })
    expect(parseSoccerTeamFormation({ ...valid, assignments: { gk: 'player-1' } })).toMatchObject({ ok: false })
    expect(parseSoccerTeamFormation({
      ...valid,
      assignments: { gk: PLAYER_1, st: PLAYER_1.toUpperCase() },
    })).toMatchObject({ ok: false })
  })

  it('moves duplicate assignments, clears clone-safely, and preserves exact shared slots', () => {
    const original = {
      ...createSoccerTeamFormation('7v7-2-3-1'),
      assignments: { gk: PLAYER_1, lcb: PLAYER_2, st: PLAYER_3 },
    }
    const moved = assignSoccerFormationPlayer(original, 'st', PLAYER_2)
    expect(moved.assignments).toEqual({ gk: PLAYER_1, st: PLAYER_2 })
    expect(original.assignments).toEqual({ gk: PLAYER_1, lcb: PLAYER_2, st: PLAYER_3 })

    const cleared = clearSoccerFormationSlot(original, 'gk')
    expect(cleared.assignments).toEqual({ lcb: PLAYER_2, st: PLAYER_3 })
    expect(original.assignments.gk).toBe(PLAYER_1)

    const switched = switchSoccerFormationTemplate(original, '7v7-3-2-1')
    expect(switched).toEqual({
      version: 1,
      templateId: '7v7-3-2-1',
      assignments: { gk: PLAYER_1, lcb: PLAYER_2, st: PLAYER_3 },
    })
    expect(switchSoccerFormationTemplate(original, '7v7-2-2-2').assignments).toEqual({
      gk: PLAYER_1,
      lcb: PLAYER_2,
    })
  })

  it('reports stale players and removes them only from an explicit save candidate', () => {
    const formation = {
      ...createSoccerTeamFormation('7v7-2-3-1'),
      assignments: { gk: PLAYER_1, st: PLAYER_2 },
    }
    expect(unavailableSoccerFormationPlayerIds(formation, [PLAYER_1])).toEqual([PLAYER_2])
    expect(prepareSoccerFormationForSave(formation, [PLAYER_1])).toEqual({
      version: 1,
      templateId: '7v7-2-3-1',
      assignments: { gk: PLAYER_1 },
    })
    expect(formation.assignments).toEqual({ gk: PLAYER_1, st: PLAYER_2 })
  })
})

describe('soccer formation setup application', () => {
  const drafts: SoccerFormationParticipantDraft[] = [
    {
      playerId: PLAYER_1,
      selected: false,
      initialStatus: 'bench',
      initialRole: { group: 'midfielder', label: null },
    },
    {
      playerId: PLAYER_2,
      selected: false,
      initialStatus: 'bench',
      initialRole: { group: 'forward', label: null },
    },
  ]

  it('maps valid slots to broad starter roles without leaking tactical labels', () => {
    const result = applySoccerFormationToRosterDrafts(drafts, {
      version: 1,
      templateId: '7v7-2-3-1',
      assignments: { gk: PLAYER_1, st: PLAYER_3 },
    }, 7)

    expect(result.status).toBe('applied')
    expect(result.unavailablePlayerIds).toEqual([PLAYER_3])
    expect(result.drafts).toEqual([
      expect.objectContaining({
        playerId: PLAYER_1,
        selected: true,
        initialStatus: 'starter',
        initialRole: { group: 'goalkeeper', label: null },
      }),
      expect.objectContaining({
        playerId: PLAYER_2,
        selected: true,
        initialStatus: 'bench',
        initialRole: { group: 'forward', label: null },
      }),
    ])
    expect(JSON.stringify(result.drafts)).not.toContain('GK')
    expect(drafts[0].selected).toBe(false)
  })

  it('fails closed without partial application for mismatch or malformed data', () => {
    const formation = {
      version: 1,
      templateId: '7v7-2-3-1',
      assignments: { gk: PLAYER_1 },
    }
    expect(applySoccerFormationToRosterDrafts(drafts, formation, 9)).toMatchObject({
      status: 'count_mismatch',
      drafts,
    })
    expect(applySoccerFormationToRosterDrafts(drafts, {
      ...formation,
      assignments: { gk: PLAYER_1, st: PLAYER_1 },
    }, 7)).toMatchObject({
      status: 'invalid',
      drafts,
    })
  })

  it('waits for coherent inputs and never reapplies over saved or edited drafts', () => {
    const ready = {
      hasSourceTeam: true,
      alreadyResolved: false,
      hadSavedParticipants: false,
      userEdited: false,
      rosterReady: true,
      settingsSettled: true,
      rosterDraftsReady: true,
    }
    expect(decideSoccerFormationPrefill(ready)).toBe('apply')
    expect(decideSoccerFormationPrefill({ ...ready, rosterReady: false })).toBe('wait')
    expect(decideSoccerFormationPrefill({ ...ready, settingsSettled: false })).toBe('wait')
    expect(decideSoccerFormationPrefill({ ...ready, rosterDraftsReady: false })).toBe('wait')
    expect(decideSoccerFormationPrefill({ ...ready, alreadyResolved: true })).toBe('resolved')
    expect(decideSoccerFormationPrefill({ ...ready, hadSavedParticipants: true })).toBe('skip_existing')
    expect(decideSoccerFormationPrefill({ ...ready, userEdited: true })).toBe('skip_edited')
    expect(decideSoccerFormationPrefill({ ...ready, hasSourceTeam: false })).toBe('skip_no_team')
  })
})
