import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Locks the critical merge/shot-chart remount contract in migration 041.
 * Full RPC behavior is exercised via REGRESSION_TESTING §4a.13 against Supabase.
 */
describe('merge_players_execute shot_chart remount (041)', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/041_merge_preserve_shot_chart.sql'),
    'utf8'
  )

  it('remounts shot_chart onto the survivor before deleting the duplicate player', () => {
    expect(sql).toMatch(/UPDATE\s+public\.shot_chart/i)
    expect(sql).toMatch(/SET\s+player_id\s+=\s+p_survivor_id/i)
    expect(sql).toMatch(/WHERE\s+player_id\s+=\s+p_duplicate_id/i)

    const remountIdx = sql.search(/UPDATE\s+public\.shot_chart/i)
    const deletePlayerIdx = sql.search(/DELETE\s+FROM\s+public\.players\s+WHERE\s+id\s+=\s+p_duplicate_id/i)
    expect(remountIdx).toBeGreaterThan(-1)
    expect(deletePlayerIdx).toBeGreaterThan(remountIdx)
  })

  it('drops duplicate shot_chart rows that collide on the unique key before remount', () => {
    expect(sql).toMatch(/DELETE\s+FROM\s+public\.shot_chart\s+sc_d/i)
    expect(sql).toMatch(/client_shot_id/i)
    expect(sql).toMatch(/recorded_by/i)
  })
})
