import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8').replace(/\r\n/g, '\n')
const sql060 = read('060_basketball_aggregate_sources.sql')
const sql075 = read('075_hockey_aggregate_sources.sql')

function definition(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf('\n$$;\n', start) + 5)
}

/** The database check in supabase/tests/hky6b1 runs 075; these pin what the PR claims about it. */
describe('migration 075 (HKY-6B1)', () => {
  it('re-creates the 060 paging core with only the Hockey sport and completion branch', () => {
    const expected = definition(sql060, '_event_aggregate_publication_page')
      .replace("if p_sport_id not in ('soccer', 'basketball') then", "if p_sport_id not in ('soccer', 'basketball', 'hockey') then")
      .replace(
        `      and public._event_aggregate_snapshot_completed(
        p_sport_id,
        publication.canonical_snapshot
      )`,
        `      and (
        p_sport_id = 'hockey'
        or public._event_aggregate_snapshot_completed(
          p_sport_id,
          publication.canonical_snapshot
        )
      )`
      )
      .replace(
        `        or public._basketball_canonical_snapshot_completed(publication.canonical_snapshot)
      )`,
        `        or public._basketball_canonical_snapshot_completed(publication.canonical_snapshot)
      )
      and (
        p_sport_id <> 'hockey'
        or public._hockey_canonical_snapshot_completed(publication.canonical_snapshot)
      )`
      )
    expect(definition(sql075, '_event_aggregate_publication_page')).toBe(expected)
  })

  it('keeps the private helpers private and grants only the fixed Hockey surfaces', () => {
    const grants = [...sql075.matchAll(/grant execute on function public\.(\w+)\(/g)].map(match => match[1])
    expect(grants.sort()).toEqual([
      'get_hockey_aggregate_capabilities',
      'get_hockey_player_aggregate_publications',
      'get_hockey_scope_aggregate_publications',
    ])
    expect(sql075).toContain('revoke all on function public._hockey_canonical_snapshot_completed(jsonb) from public;')
    expect(sql075).toMatch(/revoke all on function public\._event_aggregate_publication_page\(/)
  })

  it('answers the exact aggregate contract and leaves the release handshake alone', () => {
    const handshake = definition(sql075, 'get_hockey_aggregate_capabilities')
    expect(handshake).toMatch(/'contractVersion', 1,\s*'sportId', 'hockey',\s*'aggregateContractVersion', 1,\s*'migration', 75/)
    expect(handshake).toContain("jsonb_build_object('contractVersion', 0)")
    expect(sql075).not.toContain('get_hockey_release_capabilities(')
  })
})
