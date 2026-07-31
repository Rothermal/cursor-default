import { describe, expect, it } from 'vitest'
import {
  getSeasonFromDate,
  invertPlayerIdMap,
  isMissingGameTeamPlaceholderColumnError,
  isMissingHomeScoreAdjustmentColumnError,
  isMissingHomeTeamScoreColumnError,
  isMissingIsTeamPlaceholderColumnError,
  isMissingLastOpenedColumnError,
  isMissingNotesColumnError,
  isMissingSeasonIdColumnError,
  isMissingSportIdColumnError,
  isMissingShotChartTableError,
  isMissingTeamStatsConfigColumnError,
  isMissingTournamentIdColumnError,
  mapShotRows,
  parsePlayerName,
  parseSeasonTeamStatsConfig,
  findDuplicatePlayerMappings,
  resolveUnmappedPlayer,
} from './cloudSyncHelpers'

describe('cloudSyncHelpers missing-column detectors', () => {
  it('returns false for null/empty errors', () => {
    expect(isMissingLastOpenedColumnError(null)).toBe(false)
    expect(isMissingNotesColumnError({ message: '' })).toBe(false)
    expect(isMissingShotChartTableError({})).toBe(false)
  })

  it('detects last_opened_at / score / tournament / season columns', () => {
    expect(
      isMissingLastOpenedColumnError({ message: "column last_opened_at does not exist" })
    ).toBe(true)
    expect(
      isMissingHomeScoreAdjustmentColumnError({
        message: 'Could not find the column home_score_adjustment',
      })
    ).toBe(true)
    expect(
      isMissingHomeTeamScoreColumnError({ message: 'column home_team_score of relation games' })
    ).toBe(true)
    expect(
      isMissingTournamentIdColumnError({ message: 'column tournament_id does not exist' })
    ).toBe(true)
    expect(isMissingSeasonIdColumnError({ message: 'column season_id does not exist' })).toBe(true)
    expect(isMissingSportIdColumnError({ message: 'column games.sport_id does not exist' })).toBe(true)
  })

  it('detects notes with quoted or column-style messages', () => {
    expect(isMissingNotesColumnError({ message: "Could not find the 'notes' column" })).toBe(true)
    expect(isMissingNotesColumnError({ message: 'column notes does not exist' })).toBe(true)
    expect(isMissingNotesColumnError({ message: 'notes field is required' })).toBe(false)
  })

  it('detects team_stats_config and team placeholder columns', () => {
    expect(
      isMissingTeamStatsConfigColumnError({
        message: 'column team_stats_config does not exist',
      })
    ).toBe(true)
    expect(
      isMissingGameTeamPlaceholderColumnError({
        message: 'column home_team_player_id does not exist',
      })
    ).toBe(true)
    expect(
      isMissingGameTeamPlaceholderColumnError({
        message: 'column opp_team_player_id does not exist',
      })
    ).toBe(true)
    expect(
      isMissingGameTeamPlaceholderColumnError({
        message: 'home_team_player_id constraint failed',
      })
    ).toBe(false)
    expect(
      isMissingIsTeamPlaceholderColumnError({
        message: 'column is_team_placeholder does not exist',
      })
    ).toBe(true)
  })

  it('detects missing shot_chart relation/table', () => {
    expect(
      isMissingShotChartTableError({
        message: 'relation "shot_chart" does not exist',
      })
    ).toBe(true)
    expect(
      isMissingShotChartTableError({
        message: 'Could not find the table public.shot_chart in the schema cache',
      })
    ).toBe(true)
    expect(
      isMissingShotChartTableError({ message: 'permission denied for table shot_chart' })
    ).toBe(false)
  })
})

describe('parsePlayerName', () => {
  it('splits first and remaining parts', () => {
    expect(parsePlayerName('Jane Doe')).toEqual({ firstName: 'Jane', lastName: 'Doe' })
    expect(parsePlayerName('  Mary Ann Smith  ')).toEqual({
      firstName: 'Mary',
      lastName: 'Ann Smith',
    })
  })

  it('uses Player fallback for blank names', () => {
    expect(parsePlayerName('')).toEqual({ firstName: 'Player', lastName: '' })
    expect(parsePlayerName('   ')).toEqual({ firstName: 'Player', lastName: '' })
  })

  it('keeps single-token names as firstName only', () => {
    expect(parsePlayerName('Kobe')).toEqual({ firstName: 'Kobe', lastName: '' })
  })
})

describe('resolveUnmappedPlayer', () => {
  it('reuses an exact name+jersey teammate without touching its jersey', () => {
    expect(resolveUnmappedPlayer({
      candidates: [
        { playerId: 'a', jerseyNumber: '7', isActive: true },
        { playerId: 'b', jerseyNumber: '12', isActive: true },
      ],
      jerseyNumber: '12',
    })).toEqual({ mode: 'reuse_team_match', playerId: 'b', adoptJersey: false })
  })

  it('adopts a jersey onto the lone unnumbered teammate instead of duplicating them', () => {
    expect(resolveUnmappedPlayer({
      candidates: [{ playerId: 'a', jerseyNumber: null, isActive: true }],
      jerseyNumber: '23',
    })).toEqual({ mode: 'reuse_team_match', playerId: 'a', adoptJersey: true })
  })

  it('creates a distinct player when every same-name teammate has a different number', () => {
    expect(resolveUnmappedPlayer({
      candidates: [
        { playerId: 'a', jerseyNumber: '7', isActive: true },
        { playerId: 'b', jerseyNumber: '12', isActive: true },
      ],
      jerseyNumber: '23',
    })).toEqual({ mode: 'create_distinct' })
  })

  it('creates a distinct player when several teammates are unnumbered and ambiguous', () => {
    expect(resolveUnmappedPlayer({
      candidates: [
        { playerId: 'a', jerseyNumber: null, isActive: true },
        { playerId: 'b', jerseyNumber: '', isActive: true },
      ],
      jerseyNumber: '23',
    })).toEqual({ mode: 'create_distinct' })
  })

  it('reuses deterministically when a lone unnumbered local player has no rival claim', () => {
    expect(resolveUnmappedPlayer({
      candidates: [
        { playerId: 'b', jerseyNumber: '12', isActive: true },
        { playerId: 'a', jerseyNumber: '7', isActive: true },
      ],
      jerseyNumber: '  ',
    })).toEqual({ mode: 'reuse_team_match', playerId: 'a', adoptJersey: false })
  })

  it('falls back by name only when no same-name teammate exists', () => {
    expect(resolveUnmappedPlayer({ candidates: [], jerseyNumber: '' }))
      .toEqual({ mode: 'reuse_or_create_owned' })
    expect(resolveUnmappedPlayer({ candidates: [], jerseyNumber: '23' }))
      .toEqual({ mode: 'create_distinct' })
  })

  it('never offers a cloud row another local player already claimed', () => {
    expect(resolveUnmappedPlayer({
      candidates: [
        { playerId: 'a', jerseyNumber: '7', isActive: true },
        { playerId: 'b', jerseyNumber: '12', isActive: true },
      ],
      jerseyNumber: '7',
      claimedPlayerIds: new Set(['a']),
    })).toEqual({ mode: 'create_distinct' })
  })

  it('keeps two unnumbered same-name locals apart across a first sync', () => {
    // Both local "Alex Kim"s are unmapped and unnumbered. Reusing by name alone would
    // collapse them onto one cloud row and lose the second player's stats.
    const candidates = [{ playerId: 'cloud-alex', jerseyNumber: null, isActive: true }]
    const claimedPlayerIds = new Set<string>()

    const first = resolveUnmappedPlayer({ candidates, jerseyNumber: '', claimedPlayerIds })
    expect(first).toEqual({ mode: 'reuse_team_match', playerId: 'cloud-alex', adoptJersey: false })
    claimedPlayerIds.add('cloud-alex')

    expect(resolveUnmappedPlayer({ candidates, jerseyNumber: '', claimedPlayerIds }))
      .toEqual({ mode: 'create_distinct' })
  })

  it('never reactivates a deactivated row on a name-only match', () => {
    // The repro: a deactivated Alex Kim on the cloud roster, and a different Alex Kim
    // late-added with no number. Reusing would reactivate the row and write the new
    // player's stats onto it — the irreversible outcome a split is preferred over.
    expect(resolveUnmappedPlayer({
      candidates: [{ playerId: 'cloud-old', jerseyNumber: null, isActive: false }],
      jerseyNumber: '',
    })).toEqual({ mode: 'create_distinct' })

    // Same for the adopt-a-jersey inference, which is also name-only.
    expect(resolveUnmappedPlayer({
      candidates: [{ playerId: 'cloud-old', jerseyNumber: null, isActive: false }],
      jerseyNumber: '23',
    })).toEqual({ mode: 'create_distinct' })
  })

  it('prefers an active teammate over a deactivated row wearing the same number', () => {
    // Sorted by id, the deactivated row comes first; roster status must still win.
    expect(resolveUnmappedPlayer({
      candidates: [
        { playerId: 'cloud-a-old', jerseyNumber: '23', isActive: false },
        { playerId: 'cloud-b-current', jerseyNumber: '23', isActive: true },
      ],
      jerseyNumber: '23',
    })).toEqual({ mode: 'reuse_team_match', playerId: 'cloud-b-current', adoptJersey: false })
  })

  it('reclaims a deactivated row when the number still matches exactly', () => {
    // A returning player who kept their jersey is the one signal strong enough to
    // reactivate; the caller sets is_active back to true.
    expect(resolveUnmappedPlayer({
      candidates: [{ playerId: 'cloud-old', jerseyNumber: '23', isActive: false }],
      jerseyNumber: '23',
    })).toEqual({ mode: 'reuse_team_match', playerId: 'cloud-old', adoptJersey: false })
  })

  it('converges instead of duplicating an unnumbered player every game', () => {
    // playerIdMap is per game and starts empty, so this runs afresh each game. Once a
    // row exists and is active, later games must reuse it rather than mint another.
    const afterFirstGame = [{ playerId: 'cloud-new', jerseyNumber: null, isActive: true }]
    expect(resolveUnmappedPlayer({ candidates: afterFirstGame, jerseyNumber: '' })).toEqual({
      mode: 'reuse_team_match',
      playerId: 'cloud-new',
      adoptJersey: false,
    })

    // Still converges with the deactivated stranger from the case above alongside it.
    const withDeactivated = [
      { playerId: 'cloud-old', jerseyNumber: null, isActive: false },
      ...afterFirstGame,
    ]
    expect(resolveUnmappedPlayer({ candidates: withDeactivated, jerseyNumber: '' })).toEqual({
      mode: 'reuse_team_match',
      playerId: 'cloud-new',
      adoptJersey: false,
    })
  })

  it('splits rather than guesses when a never-synced player has a new number', () => {
    // Documented trade-off: local "#23" against cloud "#12" is indistinguishable from a
    // same-named teammate. The durable playerIdMap covers this for any player that has
    // synced before; a split identity is recoverable via merge, a wrong merge is not.
    expect(resolveUnmappedPlayer({
      candidates: [{ playerId: 'cloud-john', jerseyNumber: '12', isActive: true }],
      jerseyNumber: '23',
    })).toEqual({ mode: 'create_distinct' })
  })
})

describe('findDuplicatePlayerMappings', () => {
  it('returns nothing for a one-to-one map', () => {
    expect(
      findDuplicatePlayerMappings({ 'local-1': 'cloud-1', 'local-2': 'cloud-2' }, [
        'local-1',
        'local-2',
      ])
    ).toEqual([])
  })

  it('reports locals that share a cloud player in roster order', () => {
    expect(
      findDuplicatePlayerMappings(
        { 'local-1': 'cloud-1', 'local-2': 'cloud-1', 'local-3': 'cloud-3' },
        ['local-1', 'local-2', 'local-3']
      )
    ).toEqual([{ remotePlayerId: 'cloud-1', localPlayerIds: ['local-1', 'local-2'] }])
  })

  it('ignores map entries for players no longer on the roster', () => {
    // The reducer prunes these, but a stale entry must not be reported as a collision
    // the user cannot act on.
    expect(
      findDuplicatePlayerMappings({ 'local-1': 'cloud-1', 'removed': 'cloud-1' }, ['local-1'])
    ).toEqual([])
  })
})

describe('getSeasonFromDate', () => {
  it('returns calendar year for valid ISO dates', () => {
    expect(getSeasonFromDate('2024-11-15')).toBe('2024')
    expect(getSeasonFromDate('2025-01-01T12:00:00.000Z')).toBe('2025')
  })

  it('falls back to current year for invalid dates', () => {
    expect(getSeasonFromDate('not-a-date')).toBe(new Date().getFullYear().toString())
  })
})

describe('parseSeasonTeamStatsConfig', () => {
  it('returns null for null, arrays, and empty objects', () => {
    expect(parseSeasonTeamStatsConfig(null)).toBeNull()
    expect(parseSeasonTeamStatsConfig(undefined)).toBeNull()
    expect(parseSeasonTeamStatsConfig([])).toBeNull()
    expect(parseSeasonTeamStatsConfig({})).toBeNull()
    expect(parseSeasonTeamStatsConfig('x')).toBeNull()
  })

  it('returns non-empty object configs', () => {
    expect(parseSeasonTeamStatsConfig({ trackTeamFouls: true })).toEqual({
      trackTeamFouls: true,
    })
  })
})

describe('invertPlayerIdMap / mapShotRows', () => {
  it('inverts local→remote player maps', () => {
    expect(invertPlayerIdMap({ local1: 'remote1', local2: 'remote2' })).toEqual({
      remote1: 'local1',
      remote2: 'local2',
    })
  })

  it('maps valid rows and drops unmappable player/zone', () => {
    const { shotChart, droppedRows } = mapShotRows(
      [
        {
          player_id: 'r1',
          client_shot_id: 's1',
          x: '1.5',
          y: 2,
          made: true,
          shot_type: '3pt',
          zone: 'three',
          created_at: '2024-01-02T00:00:00.000Z',
        },
        {
          player_id: 'unknown',
          client_shot_id: 's2',
          x: 0,
          y: 0,
          made: false,
          shot_type: '2pt',
          zone: 'paint',
          created_at: '2024-01-02T00:00:00.000Z',
        },
        {
          player_id: 'r1',
          client_shot_id: 's3',
          x: 0,
          y: 0,
          made: false,
          shot_type: '2pt',
          zone: 'not_a_zone',
          created_at: '2024-01-02T00:00:00.000Z',
        },
      ],
      { r1: 'local-1' }
    )

    expect(droppedRows).toBe(2)
    expect(shotChart).toHaveLength(1)
    expect(shotChart[0]).toMatchObject({
      id: 's1',
      x: 1.5,
      y: 2,
      made: true,
      shotType: '3pt',
      zone: 'three',
      playerId: 'local-1',
    })
    expect(shotChart[0].timestamp).toBe(new Date('2024-01-02T00:00:00.000Z').getTime())
  })

  it('coerces non-3pt shot types to 2pt', () => {
    const { shotChart, droppedRows } = mapShotRows(
      [
        {
          player_id: 'r1',
          client_shot_id: 's1',
          x: 0,
          y: 0,
          made: true,
          shot_type: 'free_throw',
          zone: 'restricted',
          created_at: '2024-06-01T00:00:00.000Z',
        },
      ],
      { r1: 'p1' }
    )
    expect(droppedRows).toBe(0)
    expect(shotChart[0].shotType).toBe('2pt')
  })
})
