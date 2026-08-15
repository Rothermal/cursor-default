import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/050_event_platform_team_side_constraint.sql'),
  'utf8'
).toLowerCase()

describe('migration 050 event-platform side staging', () => {
  it('adds the widened side check without validating or dropping the live constraint', () => {
    expect(sql).toContain('add constraint game_events_team_side_event_platform_check')
    expect(sql).toContain("team_side in ('tracked', 'opponent', 'neutral')")
    expect(sql).toContain('not valid')
    expect(sql).not.toContain('validate constraint')
    expect(sql).not.toContain('drop constraint game_events_team_side_check')
  })
})
