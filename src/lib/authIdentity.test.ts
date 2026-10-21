import { afterEach, describe, expect, it } from 'vitest'
import { captureAuthIdentity, isCurrentAuthIdentity, isCurrentAuthUser, resetCurrentAuthUserIdForTests, setCurrentAuthUserId } from './authIdentity'

afterEach(resetCurrentAuthUserIdForTests)

describe('strict auth identity lifetimes', () => {
  it('preserves permissive legacy initialization but rejects new work before session discovery', () => {
    resetCurrentAuthUserIdForTests()
    expect(isCurrentAuthUser('a')).toBe(true)
    expect(captureAuthIdentity('a')).toBeNull()
  })
  it('invalidates A -> B -> A and sign-out without invalidating same-account token reports', () => {
    setCurrentAuthUserId('a')
    const original = captureAuthIdentity('a')!
    setCurrentAuthUserId('a')
    expect(isCurrentAuthIdentity(original)).toBe(true)
    setCurrentAuthUserId('b')
    setCurrentAuthUserId('a')
    expect(isCurrentAuthIdentity(original)).toBe(false)
    const fresh = captureAuthIdentity('a')!
    setCurrentAuthUserId(null)
    expect(isCurrentAuthIdentity(fresh)).toBe(false)
    expect(captureAuthIdentity('a')).toBeNull()
  })
})
