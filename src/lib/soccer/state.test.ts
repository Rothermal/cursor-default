import { describe, expect, it } from 'vitest'
import { DEFAULT_SOCCER_MATCH_RULES } from './rules'
import {
  createSoccerSportGameState,
  normalizeSoccerMatchSetup,
  normalizeSoccerSportGameState,
  soccerSetupSnapshotForTransport,
  validateSoccerMatchSetup,
} from './state'
import type { SoccerMatchParticipant, SoccerMatchSetupV2 } from './types'

const keeper: SoccerMatchParticipant = {
  id: 'participant-keeper',
  kind: 'player',
  playerId: 'player-keeper',
  displayName: 'Keeper',
  number: '1',
  initialStatus: 'starter',
  initialRole: { group: 'goalkeeper', label: null },
}

function setupV2(): SoccerMatchSetupV2 {
  return {
    version: 2,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSnapshot: structuredClone(DEFAULT_SOCCER_MATCH_RULES),
    participants: [structuredClone(keeper)],
    teamDefaultLineup: {
      version: 1,
      source: 'formation',
      entries: [{
        participantId: keeper.id,
        role: { group: 'goalkeeper', label: null },
      }],
    },
  }
}

describe('Soccer setup version 2', () => {
  it('normalizes setup v1 and state versions 1 and 2 without inventing a preset', () => {
    const current = setupV2()
    const legacySetup = {
      version: 1 as const,
      trackedTeamDesignation: current.trackedTeamDesignation,
      firstPeriodAttackingDirection: current.firstPeriodAttackingDirection,
      sourceTeamId: current.sourceTeamId,
      sourceSeasonId: current.sourceSeasonId,
      rulesSnapshot: current.rulesSnapshot,
      participants: current.participants,
    }

    expect(normalizeSoccerMatchSetup(legacySetup)).toMatchObject({
      version: 2,
      teamDefaultLineup: null,
    })
    for (const version of [1, 2]) {
      expect(normalizeSoccerSportGameState({
        sportId: 'soccer',
        version,
        setup: legacySetup,
      })).toMatchObject({
        version: 3,
        setupSnapshotVersion: 1,
        setup: { version: 2, teamDefaultLineup: null },
      })
    }
  })

  it('preserves an independent frozen preset in current state', () => {
    const input = setupV2()
    const state = createSoccerSportGameState(input)
    input.teamDefaultLineup!.entries[0]!.role.group = 'forward'

    expect(state.setup.teamDefaultLineup).toEqual({
      version: 1,
      source: 'formation',
      entries: [{
        participantId: keeper.id,
        role: { group: 'goalkeeper', label: null },
      }],
    })
    expect(state.setupSnapshotVersion).toBe(2)
  })

  it('rejects unknown fields and invalid preset membership, roles, duplicates, or size', () => {
    expect(validateSoccerMatchSetup({ ...setupV2(), unexpected: true })).toContain('unsupported')

    expect(validateSoccerMatchSetup({
      ...setupV2(),
      sourceTeamId: null,
      sourceSeasonId: null,
    })).toContain('Local Soccer matches')

    const outside = setupV2()
    outside.teamDefaultLineup!.entries[0]!.participantId = 'not-in-match'
    expect(validateSoccerMatchSetup(outside)).toContain('valid match participant')

    const badRole = setupV2()
    badRole.teamDefaultLineup!.entries[0]!.role = { group: 'striker' as never, label: null }
    expect(validateSoccerMatchSetup(badRole)).toContain('valid match participant')

    const extraRoleField = setupV2()
    extraRoleField.teamDefaultLineup!.entries[0]!.role = {
      group: 'goalkeeper',
      label: null,
      unsupported: true,
    }
    expect(validateSoccerMatchSetup(extraRoleField)).toContain('valid match participant')

    const duplicate = setupV2()
    duplicate.teamDefaultLineup!.entries.push(
      structuredClone(duplicate.teamDefaultLineup!.entries[0]!)
    )
    expect(validateSoccerMatchSetup(duplicate)).toContain('unique')

    const oversized = setupV2()
    const second = {
      ...structuredClone(keeper),
      id: 'participant-forward',
      playerId: 'player-forward',
      initialRole: { group: 'forward' as const, label: null },
    }
    oversized.rulesSnapshot.maxOnFieldPlayers = 1
    oversized.participants.push(second)
    oversized.teamDefaultLineup!.entries.push({
      participantId: second.id,
      role: structuredClone(second.initialRole),
    })
    expect(validateSoccerMatchSetup(oversized)).toContain('on-field player limit')
  })

  it('rejects string and unknown state versions without dropping numeric version 2', () => {
    const setup = setupV2()
    expect(normalizeSoccerSportGameState({ sportId: 'soccer', version: '3', setup })).toBeNull()
    expect(normalizeSoccerSportGameState({ sportId: 'soccer', version: 4, setup })).toBeNull()
    expect(normalizeSoccerSportGameState({ sportId: 'soccer', version: 2, setup })).not.toBeNull()
  })

  it('preserves a legacy transport version while allowing local preset metadata', () => {
    const setup = setupV2()
    const legacyTransport = createSoccerSportGameState(setup, { setupSnapshotVersion: 1 })

    expect(normalizeSoccerSportGameState(structuredClone(legacyTransport)))
      .toMatchObject({
        setupSnapshotVersion: 1,
        setup: { teamDefaultLineup: setup.teamDefaultLineup },
      })
    expect(soccerSetupSnapshotForTransport(legacyTransport)).not.toHaveProperty('teamDefaultLineup')
  })
})
