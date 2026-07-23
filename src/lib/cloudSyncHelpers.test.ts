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
