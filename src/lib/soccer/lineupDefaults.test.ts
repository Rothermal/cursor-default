import { describe, expect, it } from 'vitest'
import {
  MAX_SOCCER_TEAM_LINEUP_DEFAULT_STARTERS,
  emptySoccerTeamLineupDefaults,
  parseSoccerTeamLineupDefaults,
  prepareSoccerLineupDefaultsForSave,
  setSoccerLineupDefaultStatus,
  soccerLineupDefaultStatusForPlayer,
  unavailableSoccerLineupDefaultPlayerIds,
} from './lineupDefaults'

const PLAYER_1 = '11111111-1111-4111-8111-111111111111'
const PLAYER_2 = '22222222-2222-4222-8222-222222222222'
const PLAYER_3 = '33333333-3333-4333-8333-333333333333'

describe('soccer team lineup defaults', () => {
  it('creates an empty sparse starter list', () => {
    expect(emptySoccerTeamLineupDefaults()).toEqual({
      version: 1,
      starterPlayerIds: [],
    })
  })

  it('strictly parses, normalizes, and deterministically orders player ids', () => {
    expect(parseSoccerTeamLineupDefaults({
      version: 1,
      starterPlayerIds: [PLAYER_2.toUpperCase(), PLAYER_1],
    })).toEqual({
      ok: true,
      value: {
        version: 1,
        starterPlayerIds: [PLAYER_1, PLAYER_2],
      },
    })
  })

  it('rejects malformed, duplicate, and oversized records', () => {
    expect(parseSoccerTeamLineupDefaults({
      version: 1,
      starterPlayerIds: [],
      status: 'starter',
    })).toMatchObject({ ok: false })
    expect(parseSoccerTeamLineupDefaults({
      version: 2,
      starterPlayerIds: [],
    })).toMatchObject({ ok: false })
    expect(parseSoccerTeamLineupDefaults({
      version: 1,
      starterPlayerIds: 'not-an-array',
    })).toMatchObject({ ok: false })
    expect(parseSoccerTeamLineupDefaults({
      version: 1,
      starterPlayerIds: ['not-a-uuid'],
    })).toMatchObject({ ok: false })
    expect(parseSoccerTeamLineupDefaults({
      version: 1,
      starterPlayerIds: [PLAYER_1, PLAYER_1.toUpperCase()],
    })).toMatchObject({ ok: false })
    expect(parseSoccerTeamLineupDefaults({
      version: 1,
      starterPlayerIds: Array.from(
        { length: MAX_SOCCER_TEAM_LINEUP_DEFAULT_STARTERS + 1 },
        (_, index) => `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
      ),
    })).toMatchObject({ ok: false })
  })

  it('updates one sparse status without mutating the source', () => {
    const current = {
      version: 1 as const,
      starterPlayerIds: [PLAYER_2],
    }
    const withStarter = setSoccerLineupDefaultStatus(current, PLAYER_1, 'starter')
    const withBench = setSoccerLineupDefaultStatus(withStarter, PLAYER_2, 'bench')

    expect(withStarter.starterPlayerIds).toEqual([PLAYER_1, PLAYER_2])
    expect(withBench.starterPlayerIds).toEqual([PLAYER_1])
    expect(soccerLineupDefaultStatusForPlayer(withBench, PLAYER_1)).toBe('starter')
    expect(soccerLineupDefaultStatusForPlayer(withBench, PLAYER_3)).toBe('bench')
    expect(current.starterPlayerIds).toEqual([PLAYER_2])
  })

  it('does not create an oversized or malformed starter list', () => {
    const full = {
      version: 1 as const,
      starterPlayerIds: Array.from(
        { length: MAX_SOCCER_TEAM_LINEUP_DEFAULT_STARTERS },
        (_, index) => `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
      ),
    }

    expect(setSoccerLineupDefaultStatus(full, PLAYER_3, 'starter')).toEqual(full)
    expect(setSoccerLineupDefaultStatus(
      emptySoccerTeamLineupDefaults(),
      'not-a-uuid',
      'starter'
    )).toEqual(emptySoccerTeamLineupDefaults())
  })

  it('retains known inactive members while identifying and cleaning only missing ids', () => {
    const defaults = {
      version: 1 as const,
      starterPlayerIds: [PLAYER_1, PLAYER_2, PLAYER_3],
    }
    const completeMembership = [PLAYER_1, PLAYER_2]

    expect(unavailableSoccerLineupDefaultPlayerIds(
      defaults,
      completeMembership
    )).toEqual([PLAYER_3])
    expect(prepareSoccerLineupDefaultsForSave(
      defaults,
      completeMembership
    )).toEqual({
      version: 1,
      starterPlayerIds: [PLAYER_1, PLAYER_2],
    })
    expect(defaults.starterPlayerIds).toEqual([PLAYER_1, PLAYER_2, PLAYER_3])
  })
})
