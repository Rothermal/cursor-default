import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/054_event_platform_publication_constraint.sql'
  ),
  'utf8'
).toLowerCase()

describe('migration 054 event-platform publication constraint', () => {
  it('stages the Soccer and Basketball allow-list without replacing the live check', () => {
    expect(sql).toContain(
      'game_event_canonical_publications_sport_id_event_platform_check'
    )
    expect(sql).toContain("sport_id in ('soccer', 'basketball')")
    expect(sql).toContain('not valid')
    expect(sql).not.toContain('validate constraint')
    expect(sql).not.toContain('drop constraint')
    expect(sql).not.toContain('rename constraint')
  })
})
