import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/scripts/verify_soccer_v1_binding_compatibility.sql'
  ),
  'utf8'
).toLowerCase()

describe('Soccer v1 binding runtime verification script', () => {
  it('runs as the owner of one non-final personal Soccer binding and rolls back', () => {
    expect(sql).toMatch(/\bbegin\s*;/)
    expect(sql).toContain("'request.jwt.claim.sub'")
    expect(sql).toContain("'request.jwt.claims'")
    expect(sql).toContain('set local role authenticated')
    expect(sql.match(/game\.cloud_scope = 'personal'/g)).toHaveLength(2)
    expect(sql.match(/game\.status <> 'final'/g)).toHaveLength(2)
    expect(sql.match(/game\.client_local_game_id is not null/g)).toHaveLength(2)
    expect(sql).toMatch(/\brollback\s*;/)
  })

  it('reconstructs every participant field consumed by the permanent wrapper', () => {
    for (const field of [
      'client_participant_id',
      'client_player_id',
      'source_player_id',
      'kind',
      'display_name',
      'jersey_number',
      'snapshot',
    ]) {
      expect(sql).toContain(`'${field}'`)
    }
  })

  it('calls the exact eight-argument v1 contract and checks structural identity', () => {
    expect(sql).toMatch(
      /public\.bind_soccer_event_game\s*\(\s*target\.client_local_game_id\s*,\s*null\s*,\s*null\s*,\s*target\.tracked_team_name\s*,\s*target\.opponent_name\s*,\s*target\.tournament_name\s*,\s*target\.game_date\s*,\s*target\.participants\s*\)/
    )
    expect(sql).toContain("(binding->>'game_id')::uuid = id as same_game_id")
    expect(sql).toContain(
      "binding->'participant_id_map' = expected_participant_id_map"
    )
  })
})
