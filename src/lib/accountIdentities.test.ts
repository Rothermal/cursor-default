import { describe, expect, it } from 'vitest'
import {
  formatAuthProviderLabel,
  hasAuthProvider,
  normalizeAccountIdentities,
} from './accountIdentities'

describe('normalizeAccountIdentities', () => {
  it('normalizes provider and email from Supabase identity data', () => {
    expect(
      normalizeAccountIdentities([
        {
          id: 'identity-1',
          provider: 'google',
          identity_data: { email: 'parent@example.com' },
          created_at: '2026-07-12T00:00:00Z',
        },
      ])
    ).toEqual([
      {
        id: 'identity-1',
        provider: 'google',
        email: 'parent@example.com',
        createdAt: '2026-07-12T00:00:00Z',
      },
    ])
  })

  it('keeps connected-provider checks case insensitive', () => {
    const identities = normalizeAccountIdentities([{ provider: 'Google' }])

    expect(hasAuthProvider(identities, 'google')).toBe(true)
  })
})

describe('formatAuthProviderLabel', () => {
  it('labels known providers and falls back to the provider id', () => {
    expect(formatAuthProviderLabel('email')).toBe('Email/password')
    expect(formatAuthProviderLabel('google')).toBe('Google')
    expect(formatAuthProviderLabel('github')).toBe('github')
  })
})
