import { describe, expect, it } from 'vitest'
import type { SoccerFormationParticipantDraft } from './formation'
import {
  applySoccerTeamLineupPrefill,
  soccerMatchLineupPresetFromPrefill,
  pruneSoccerMatchLineupPreset,
  soccerTeamLineupPrefillNotice,
} from './teamLineupPrefill'

const PLAYER_1 = '11111111-1111-4111-8111-111111111111'
const PLAYER_2 = '22222222-2222-4222-8222-222222222222'
const PLAYER_3 = '33333333-3333-4333-8333-333333333333'

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

describe('Soccer team lineup prefill', () => {
  it('lets a valid formation win completely over standalone lineup defaults', () => {
    const result = applySoccerTeamLineupPrefill(drafts, {
      formation: {
        version: 1,
        templateId: '7v7-2-3-1',
        assignments: { gk: PLAYER_1 },
      },
      lineupDefaults: { version: 1, starterPlayerIds: [PLAYER_2, PLAYER_3] },
      maxOnFieldPlayers: 7,
    })

    expect(result).toMatchObject({
      source: 'formation',
      formationStatus: 'applied',
      unavailableLineupPlayerIds: [],
    })
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
    expect(soccerTeamLineupPrefillNotice(result, 2)).toEqual({
      tone: 'info',
      message: 'Team formation applied. Review the opening lineup before kickoff.',
    })
  })

  it('freezes only selected starters and clones their resolved match roles', () => {
    const matchDrafts = drafts.map((draft, index) => ({
      ...structuredClone(draft),
      id: `participant-${index + 1}`,
    }))
    const result = applySoccerTeamLineupPrefill(matchDrafts, {
      formation: null,
      lineupDefaults: { version: 1, starterPlayerIds: [PLAYER_2] },
      maxOnFieldPlayers: 7,
    })
    const preset = soccerMatchLineupPresetFromPrefill(result)
    result.drafts[1]!.initialRole.group = 'defender'

    expect(preset).toEqual({
      version: 1,
      source: 'lineup_defaults',
      entries: [{
        participantId: 'participant-2',
        role: { group: 'forward', label: null },
      }],
    })
  })

  it('permanently prunes deselected participants from a cloned preset', () => {
    const preset = {
      version: 1 as const,
      source: 'formation' as const,
      entries: [
        { participantId: 'participant-1', role: { group: 'goalkeeper' as const, label: null } },
        { participantId: 'participant-2', role: { group: 'forward' as const, label: null } },
      ],
    }
    const pruned = pruneSoccerMatchLineupPreset(preset, ['participant-2'])
    preset.entries[1]!.role.group = 'goalkeeper'

    expect(pruned).toEqual({
      version: 1,
      source: 'formation',
      entries: [{
        participantId: 'participant-2',
        role: { group: 'forward', label: null },
      }],
    })
  })

  it('does not freeze an empty Team Default for an unconfigured team', () => {
    const result = applySoccerTeamLineupPrefill(
      drafts.map((draft, index) => ({
        ...structuredClone(draft),
        id: `participant-${index + 1}`,
      })),
      {
        formation: null,
        lineupDefaults: { version: 1, starterPlayerIds: [] },
        maxOnFieldPlayers: 7,
      }
    )

    expect(soccerMatchLineupPresetFromPrefill(result)).toBeNull()
  })

  it('removes a Team Default when none of its participants remain', () => {
    expect(pruneSoccerMatchLineupPreset({
      version: 1,
      source: 'lineup_defaults',
      entries: [{
        participantId: 'participant-1',
        role: { group: 'goalkeeper', label: null },
      }],
    }, ['participant-2'])).toBeNull()
  })

  it('applies active starter ids and preserves roster roles when no formation applies', () => {
    const result = applySoccerTeamLineupPrefill(drafts, {
      formation: null,
      lineupDefaults: { version: 1, starterPlayerIds: [PLAYER_2, PLAYER_3] },
      maxOnFieldPlayers: 7,
    })

    expect(result).toMatchObject({
      source: 'lineup_defaults',
      formationStatus: 'no_formation',
      unavailableLineupPlayerIds: [PLAYER_3],
    })
    expect(result.drafts).toEqual([
      expect.objectContaining({
        playerId: PLAYER_1,
        selected: true,
        initialStatus: 'bench',
        initialRole: { group: 'midfielder', label: null },
      }),
      expect.objectContaining({
        playerId: PLAYER_2,
        selected: true,
        initialStatus: 'starter',
        initialRole: { group: 'forward', label: null },
      }),
    ])
    expect(drafts.every(draft => !draft.selected && draft.initialStatus === 'bench')).toBe(true)
    expect(soccerTeamLineupPrefillNotice(result, 2)).toEqual({
      tone: 'warning',
      message: 'Team lineup defaults applied. Review the opening lineup before kickoff. 1 saved starter is unavailable for this match.',
    })
  })

  it('falls back wholesale when a formation assignment is unavailable', () => {
    const result = applySoccerTeamLineupPrefill(drafts, {
      formation: {
        version: 1,
        templateId: '7v7-2-3-1',
        assignments: { gk: PLAYER_1, st: PLAYER_3 },
      },
      lineupDefaults: { version: 1, starterPlayerIds: [PLAYER_2] },
      maxOnFieldPlayers: 7,
    })

    expect(result).toMatchObject({
      source: 'lineup_defaults',
      formationStatus: 'unavailable_assignments',
      formationError: 'The saved team formation includes 1 unavailable player.',
      unavailableFormationPlayerIds: [PLAYER_3],
    })
    expect(result.drafts.map(draft => draft.initialStatus)).toEqual(['bench', 'starter'])
    expect(result.drafts.map(draft => draft.initialRole.group)).toEqual([
      'midfielder',
      'forward',
    ])
    expect(soccerTeamLineupPrefillNotice(result, 1)).toEqual({
      tone: 'warning',
      message: 'The saved team formation includes 1 unavailable player. Team lineup defaults were used instead. Repair the shared formation in Team Manage.',
    })
  })

  it('falls back atomically for a mismatched formation and keeps empty defaults all-Bench', () => {
    const mismatched = applySoccerTeamLineupPrefill(drafts, {
      formation: {
        version: 1,
        templateId: '7v7-2-3-1',
        assignments: { gk: PLAYER_1 },
      },
      lineupDefaults: { version: 1, starterPlayerIds: [PLAYER_2] },
      maxOnFieldPlayers: 9,
    })
    expect(mismatched).toMatchObject({
      source: 'lineup_defaults',
      formationStatus: 'count_mismatch',
    })
    expect(mismatched.drafts.map(draft => draft.initialStatus)).toEqual(['bench', 'starter'])
    expect(mismatched.drafts.map(draft => draft.initialRole.group)).toEqual([
      'midfielder',
      'forward',
    ])
    expect(soccerTeamLineupPrefillNotice(mismatched, 1)).toEqual({
      tone: 'warning',
      message: 'The saved 7-player formation does not match this 9-player match. Team lineup defaults were used instead. Repair the shared formation in Team Manage.',
    })
    expect(soccerTeamLineupPrefillNotice(mismatched, 0)).toEqual({
      tone: 'warning',
      message: 'The saved 7-player formation does not match this 9-player match. Roster role defaults were used instead. Repair the shared formation in Team Manage.',
    })

    const empty = applySoccerTeamLineupPrefill(drafts, {
      formation: null,
      lineupDefaults: { version: 1, starterPlayerIds: [] },
      maxOnFieldPlayers: 7,
    })
    expect(empty.drafts.map(draft => draft.initialStatus)).toEqual(['bench', 'bench'])
    expect(empty.drafts.every(draft => draft.selected)).toBe(true)
    expect(soccerTeamLineupPrefillNotice(empty, 0)).toBeNull()
  })
})
