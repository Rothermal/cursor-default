import { describe, expect, it } from 'vitest'
import { TEAM_PLAYER_HOME_ID, TEAM_PLAYER_OPP_ID } from './teamPlayers'
import {
  aggregateStatsByPlayer,
  buildHydratedCloudPlayers,
  buildOptionalGameSelectSuffix,
  detectOptionalGameColumnGaps,
  hasAnyOptionalGameColumnGap,
  hasLoadByIdOptionalGameColumnGap,
  selectLatestLegacyCloudGameCandidate,
  type CloudRosterRow,
} from './cloudSyncHydrate'

function rosterRow(
  overrides: Partial<CloudRosterRow> & Pick<CloudRosterRow, 'player_id'>
): CloudRosterRow {
  return {
    jersey_number: '12',
    is_active: true,
    players: {
      id: overrides.player_id,
      first_name: 'Ada',
      last_name: 'Lovelace',
      created_at: '2026-01-01T00:00:00Z',
    },
    ...overrides,
  }
}

describe('aggregateStatsByPlayer', () => {
  it('groups multiple stats per player and tolerates empty input', () => {
    expect(aggregateStatsByPlayer(null).size).toBe(0)
    expect(aggregateStatsByPlayer(undefined).size).toBe(0)

    const map = aggregateStatsByPlayer([
      { player_id: 'p1', stat_id: 'pts', value: 8 },
      { player_id: 'p1', stat_id: 'reb', value: 3 },
      { player_id: 'p2', stat_id: 'pts', value: 2 },
    ])
    expect(map.get('p1')).toEqual({ pts: 8, reb: 3 })
    expect(map.get('p2')).toEqual({ pts: 2 })
  })
})

describe('buildHydratedCloudPlayers', () => {
  it('keeps inactive roster rows only when they already have game stats', () => {
    const statsByPlayer = aggregateStatsByPlayer([
      { player_id: 'inactive-scored', stat_id: 'pts', value: 5 },
    ])

    const result = buildHydratedCloudPlayers({
      rosterRows: [
        rosterRow({ player_id: 'active', jersey_number: '1' }),
        rosterRow({
          player_id: 'inactive-scored',
          is_active: false,
          jersey_number: '2',
          players: {
            id: 'inactive-scored',
            first_name: 'Inactive',
            last_name: 'Scorer',
            created_at: '2026-01-01T00:00:00Z',
          },
        }),
        rosterRow({
          player_id: 'inactive-bench',
          is_active: false,
          jersey_number: '3',
          players: {
            id: 'inactive-bench',
            first_name: 'Bench',
            last_name: 'Only',
            created_at: '2026-01-01T00:00:00Z',
          },
        }),
      ],
      statsByPlayer,
      homeCloudId: null,
      oppCloudId: null,
      homeTeamName: 'Home',
      opponentName: 'Opp',
      placeholderNameById: new Map(),
    })

    expect(result.rosterPlayers.map(p => p.id)).toEqual(['active', 'inactive-scored'])
    expect(result.rosterPlayers[1]?.stats).toEqual({ pts: 5 })
    expect(result.activePlayerId).toBe('active')
    expect(result.playerIdMap).toEqual({
      active: 'active',
      'inactive-scored': 'inactive-scored',
    })
  })

  it('excludes team placeholder cloud ids from the individual roster and remaps them', () => {
    const homeCloudId = 'cloud-home'
    const oppCloudId = 'cloud-opp'
    const statsByPlayer = aggregateStatsByPlayer([
      { player_id: homeCloudId, stat_id: 'to', value: 2 },
      { player_id: oppCloudId, stat_id: 'to', value: 1 },
      { player_id: 'p1', stat_id: 'pts', value: 10 },
    ])

    const result = buildHydratedCloudPlayers({
      rosterRows: [
        rosterRow({ player_id: homeCloudId }),
        rosterRow({ player_id: 'p1' }),
        rosterRow({ player_id: oppCloudId }),
      ],
      statsByPlayer,
      homeCloudId,
      oppCloudId,
      homeTeamName: 'Rockets',
      opponentName: 'Comets',
      placeholderNameById: new Map([
        [homeCloudId, { first_name: 'Team', last_name: 'Home' }],
        [oppCloudId, { first_name: 'Team', last_name: 'Opp' }],
      ]),
    })

    expect(result.rosterPlayers.map(p => p.id)).toEqual(['p1'])
    expect(result.teamPlayers).toEqual([
      {
        id: TEAM_PLAYER_HOME_ID,
        name: 'Team Home',
        number: '★',
        stats: { to: 2 },
        isTeamPlayer: true,
        teamSide: 'home',
      },
      {
        id: TEAM_PLAYER_OPP_ID,
        name: 'Team Opp',
        number: '★',
        stats: { to: 1 },
        isTeamPlayer: true,
        teamSide: 'opponent',
      },
    ])
    expect(result.players.map(p => p.id)).toEqual([
      TEAM_PLAYER_HOME_ID,
      TEAM_PLAYER_OPP_ID,
      'p1',
    ])
    expect(result.playerIdMap).toEqual({
      p1: 'p1',
      [TEAM_PLAYER_HOME_ID]: homeCloudId,
      [TEAM_PLAYER_OPP_ID]: oppCloudId,
    })
    expect(result.activePlayerId).toBe('p1')
  })

  it('falls back to team/opponent names and prefers team pseudo-players when roster is empty', () => {
    const result = buildHydratedCloudPlayers({
      rosterRows: [],
      statsByPlayer: new Map(),
      homeCloudId: 'cloud-home',
      oppCloudId: 'cloud-opp',
      homeTeamName: 'Rockets',
      opponentName: 'Comets',
      placeholderNameById: new Map(),
    })

    expect(result.teamPlayers[0]?.name).toBe('Rockets')
    expect(result.teamPlayers[1]?.name).toBe('Comets')
    expect(result.activePlayerId).toBe(TEAM_PLAYER_HOME_ID)
  })

  it('uses Player fallback for blank individual names', () => {
    const result = buildHydratedCloudPlayers({
      rosterRows: [
        rosterRow({
          player_id: 'blank',
          players: {
            id: 'blank',
            first_name: '  ',
            last_name: null,
            created_at: '2026-01-01T00:00:00Z',
          },
        }),
      ],
      statsByPlayer: new Map(),
      homeCloudId: null,
      oppCloudId: null,
      homeTeamName: 'Home',
      opponentName: 'Opp',
      placeholderNameById: new Map(),
    })

    expect(result.rosterPlayers[0]?.name).toBe('Player')
  })
})

describe('optional game select fallbacks', () => {
  it('detects missing optional columns from PostgREST errors', () => {
    const gaps = detectOptionalGameColumnGaps({
      message: 'column games.last_opened_at does not exist',
    })
    expect(gaps.lastOpened).toBe(true)
    expect(gaps.homeTeamScore).toBe(false)
    expect(gaps.sportId).toBe(false)
    expect(hasAnyOptionalGameColumnGap(gaps)).toBe(true)
    expect(hasLoadByIdOptionalGameColumnGap(gaps)).toBe(false)
    expect(
      hasAnyOptionalGameColumnGap(detectOptionalGameColumnGaps({ message: 'permission denied' }))
    ).toBe(false)
  })

  it('omits only the missing optional columns from the select suffix', () => {
    const gaps = detectOptionalGameColumnGaps({
      message: 'column games.notes does not exist',
    })
    expect(buildOptionalGameSelectSuffix(gaps)).toBe(
      ',home_team_score,home_score_adjustment,tournament_id,last_opened_at,season_id,sport_id,home_team_player_id,opp_team_player_id,tracked_team_nickname,opponent_nickname'
    )
    expect(buildOptionalGameSelectSuffix(gaps, { includeLastOpened: false })).toBe(
      ',home_team_score,home_score_adjustment,tournament_id,season_id,sport_id,home_team_player_id,opp_team_player_id,tracked_team_nickname,opponent_nickname'
    )
  })

  it('returns an empty suffix when every optional column is missing', () => {
    const gaps = {
      lastOpened: true,
      homeTeamScore: true,
      homeAdj: true,
      tournamentId: true,
      notes: true,
      seasonId: true,
      sportId: true,
      teamPlaceholders: true,
      sideNicknames: true,
    }
    expect(buildOptionalGameSelectSuffix(gaps)).toBe('')
    expect(buildOptionalGameSelectSuffix(gaps, { includeLastOpened: false })).toBe('')
  })
})

describe('legacy cloud authority selection', () => {
  it('uses setup snapshots instead of sport id nullness and preserves the old Soccer exception', () => {
    const rows = [
      { id: 'event-basketball', sport_id: 'basketball' },
      { id: 'old-soccer', sport_id: 'soccer' },
      { id: 'legacy-basketball', sport_id: 'basketball' },
      { id: 'legacy-null', sport_id: null },
    ]

    expect(
      selectLatestLegacyCloudGameCandidate(rows, new Set(['event-basketball']))
    ).toEqual(rows[2])
    expect(
      selectLatestLegacyCloudGameCandidate(
        rows.slice(0, 2),
        new Set(['event-basketball'])
      )
    ).toBeNull()
    expect(selectLatestLegacyCloudGameCandidate([rows[3]], new Set())).toEqual(rows[3])
  })
})
