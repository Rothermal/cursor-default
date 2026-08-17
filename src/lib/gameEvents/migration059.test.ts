import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/059_basketball_reopen_republication.sql'),
  'utf8'
).replace(/\r\n/g, '\n').toLowerCase()

describe('migration 059 Basketball reopen and republication', () => {
  it('adds only fixed authenticated Basketball history and reopen surfaces', () => {
    expect(sql).toContain(
      'create or replace function public.get_basketball_canonical_publication_history'
    )
    expect(sql).toContain('create or replace function public.reopen_basketball_event_game')
    expect(sql).toMatch(/public\.reopen_event_game\s*\(\s*'basketball'/)
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.reopen_basketball_event_game\s*\(\s*uuid\s*,\s*text\s*\)\s+from\s+public/
    )
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.reopen_basketball_event_game\s*\(\s*uuid\s*,\s*text\s*\)\s+to\s+authenticated/
    )
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.get_basketball_canonical_publication_history\s*\(\s*uuid\s*\)\s+to\s+authenticated/
    )
  })

  it('keeps the shared mutation core private and does not replace Soccer behavior', () => {
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.reopen_event_game\s*\(\s*text\s*,\s*uuid\s*,\s*text\s*\)\s+from\s+public/
    )
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.reopen_event_game/)
    expect(sql).not.toContain('create or replace function public.reopen_event_game')
    expect(sql).not.toContain('create or replace function public.reopen_soccer_event_game')
    expect(sql.match(/create or replace function/g)).toHaveLength(2)
    expect(sql.match(/security definer/g)).toHaveLength(2)
    expect(sql.match(/set search_path = public/g)).toHaveLength(2)
  })

  it('documents reason-required append-only publication history', () => {
    expect(sql).toContain("public.can_manage_event_game('basketball', p_game_id)")
    expect(sql).toContain('publication.invalidation_reason')
    expect(sql).toContain('order by publication.publication_number desc')
    expect(sql).toContain('reason-required basketball reopen wrapper')
    expect(sql).toContain('append-only canonical publication history')
    expect(sql).not.toContain('delete from public.game_event_canonical_publications')
  })
})
