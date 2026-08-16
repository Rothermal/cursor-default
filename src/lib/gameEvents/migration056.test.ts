import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), `supabase/migrations/${name}`), 'utf8').toLowerCase()
}

const sql = migration('056_basketball_event_cloud_transport.sql')
const migration053 = migration('053_event_platform_recorder_resolution.sql')
const migration055 = migration('055_event_platform_finalization_recovery.sql')
const signature = String.raw`uuid\s*,\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*date\s*,\s*jsonb\s*,\s*jsonb`

describe('migration 056 Basketball event cloud transport', () => {
  it('adds only the fixed Basketball v4 binding wrapper', () => {
    expect(sql).toContain('create or replace function public.bind_basketball_event_game_v4')
    expect(sql).toMatch(/select\s+public\.bind_event_game_v4\s*\(\s*'basketball'/)
    expect(sql).not.toContain('create or replace function public.bind_event_game_v4')
    expect(sql.match(/create or replace function/g)).toHaveLength(1)
  })

  it('hardens the wrapper and grants only its exact authenticated signature', () => {
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public')
    expect(sql).toMatch(new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+public\\.bind_basketball_event_game_v4\\s*\\(\\s*${signature}\\s*\\)\\s+from\\s+public`
    ))
    expect(sql).toMatch(new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+public\\.bind_basketball_event_game_v4\\s*\\(\\s*${signature}\\s*\\)\\s+to\\s+authenticated`
    ))
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.bind_event_game_v4/)
  })

  it('does not redefine checkpoint contracts in the additive migration', () => {
    expect(sql).not.toContain('create or replace function public.confirm_game_event_stream_checkpoint')
    expect(sql).not.toContain('create or replace function public.is_event_checkpoint_current')
  })

  it('pins the effective sport-filtered checkpoint writer and reader definitions', () => {
    const checkpointWriter = migration055.slice(
      migration055.indexOf('create or replace function public.confirm_game_event_stream_checkpoint'),
      migration055.indexOf('revoke all on function public.confirm_game_event_stream_checkpoint')
    )
    const checkpointReader = migration053.slice(
      migration053.indexOf('create or replace function public.is_event_checkpoint_current'),
      migration053.indexOf('create or replace function public.is_game_event_checkpoint_current')
    )

    expect(checkpointWriter.match(/and event\.sport_id = v_game_sport_id/g)).toHaveLength(2)
    expect(checkpointReader.match(/and event\.sport_id = p_sport_id/g)).toHaveLength(3)
  })
})
