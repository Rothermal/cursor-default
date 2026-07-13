import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import {
  linkGoogleIdentity,
  loadCurrentAccountProfile,
  updateCurrentAccountDisplayName,
  validateDisplayName,
} from './accountProfile'
import { consumeOAuthReturnPath } from './oauthReturnPath'

const mock = vi.hoisted(() => ({
  selectData: null as Record<string, unknown> | null,
  selectError: null as { message: string } | null,
  upsertData: null as Record<string, unknown> | null,
  upsertError: null as { message: string } | null,
  upsertRows: [] as Array<Record<string, unknown>>,
  linkIdentityError: null as { message: string } | null,
  linkIdentityCalls: [] as Array<Record<string, unknown>>,
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
    auth: {
      linkIdentity: (args: Record<string, unknown>) => {
        mock.linkIdentityCalls.push(args)
        return Promise.resolve({ data: null, error: mock.linkIdentityError })
      },
    },
  },
}))

vi.mock('./authRedirect', () => ({
  getOAuthRedirectUrl: () => 'http://localhost:5173/',
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
  mock.linkIdentityError = null
  mock.linkIdentityCalls = []
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => {
        values.delete(key)
      },
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
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

describe('linkGoogleIdentity', () => {
  it('starts Google linking with the OAuth redirect and account return path', async () => {
    const result = await linkGoogleIdentity()

    expect(result.error).toBeNull()
    expect(mock.linkIdentityCalls[0]).toEqual({
      provider: 'google',
      options: { redirectTo: 'http://localhost:5173/' },
    })
    expect(consumeOAuthReturnPath()).toBe('/settings/account')
  })

  it('maps manual identity-linking errors and clears the return path', async () => {
    mock.linkIdentityError = {
      message: 'Manual linking is disabled for this project',
    }

    const result = await linkGoogleIdentity()

    expect(result.error).toBe('Google linking is not enabled for this Supabase project yet.')
    expect(consumeOAuthReturnPath()).toBeNull()
  })
})
