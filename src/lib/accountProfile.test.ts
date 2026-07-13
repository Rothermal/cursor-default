import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import {
  loadCurrentAccountProfile,
  updateCurrentAccountDisplayName,
  validateDisplayName,
} from './accountProfile'

const mock = vi.hoisted(() => ({
  selectData: null as Record<string, unknown> | null,
  selectError: null as { message: string } | null,
  upsertData: null as Record<string, unknown> | null,
  upsertError: null as { message: string } | null,
  upsertRows: [] as Array<Record<string, unknown>>,
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mock.selectData, error: mock.selectError }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        mock.upsertRows.push(row)
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: mock.upsertData ?? row,
                error: mock.upsertError,
              }),
          }),
        }
      },
    }),
  },
}))

const user = {
  id: 'user-1',
  email: 'parent@example.com',
  user_metadata: {
    full_name: 'Parent Name',
    avatar_url: 'https://example.com/avatar.png',
  },
} as unknown as User

beforeEach(() => {
  mock.selectData = null
  mock.selectError = null
  mock.upsertData = null
  mock.upsertError = null
  mock.upsertRows = []
})

describe('validateDisplayName', () => {
  it('requires a short non-empty display name', () => {
    expect(validateDisplayName('  ')).toBe('Display name is required.')
    expect(validateDisplayName('A'.repeat(81))).toBe(
      'Display name must be 80 characters or fewer.'
    )
    expect(validateDisplayName('Coach Alex')).toBeNull()
  })
})

describe('loadCurrentAccountProfile', () => {
  it('repairs a missing profile from auth metadata defaults', async () => {
    const result = await loadCurrentAccountProfile(user)

    expect(result.error).toBeNull()
    expect(mock.upsertRows[0]).toEqual({
      id: 'user-1',
      email: 'parent@example.com',
      display_name: 'Parent Name',
      avatar_url: 'https://example.com/avatar.png',
    })
    expect(result.profile?.displayName).toBe('Parent Name')
  })
})

describe('updateCurrentAccountDisplayName', () => {
  it('upserts and returns the submitted display name', async () => {
    const result = await updateCurrentAccountDisplayName(user, '  Coach Taylor  ')

    expect(result.error).toBeNull()
    expect(mock.upsertRows[0]).toEqual({
      id: 'user-1',
      email: 'parent@example.com',
      display_name: 'Coach Taylor',
    })
    expect(result.profile?.displayName).toBe('Coach Taylor')
  })
})
