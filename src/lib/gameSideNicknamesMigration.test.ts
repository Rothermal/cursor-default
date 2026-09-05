import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/066_game_side_nicknames.sql'),
  'utf8'
).replace(/\r\n/g, '\n').toLowerCase()

describe('migration 066 game side nicknames', () => {
  it('adds independent optional labels for both sides of every sport', () => {
    expect(sql).toContain('add column if not exists tracked_team_nickname text')
    expect(sql).toContain('add column if not exists opponent_nickname text')
    expect(sql).not.toContain("sport_id =")
  })

  it('rejects blank or oversized persisted labels', () => {
    expect(sql).toContain(
      'char_length(trim(tracked_team_nickname)) between 1 and 100'
    )
    expect(sql).toContain(
      'char_length(trim(opponent_nickname)) between 1 and 100'
    )
    expect(sql).toContain(
      'validate constraint games_tracked_team_nickname_length_check'
    )
    expect(sql).toContain(
      'validate constraint games_opponent_nickname_length_check'
    )
  })
})
