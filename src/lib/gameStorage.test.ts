import { describe, expect, it } from 'vitest'
import { shouldDiscardStoredGame } from './gameStorage'

describe('shouldDiscardStoredGame', () => {
  it('discards when stored owner differs from current user', () => {
    expect(shouldDiscardStoredGame('user-a', 'user-b')).toBe(true)
  })

  it('keeps when owner matches current user', () => {
    expect(shouldDiscardStoredGame('user-a', 'user-a')).toBe(false)
  })

  it('keeps legacy snapshots without an owner key', () => {
    expect(shouldDiscardStoredGame(null, 'user-a')).toBe(false)
  })

  it('keeps offline mode without a signed-in user', () => {
    expect(shouldDiscardStoredGame('user-a', null)).toBe(false)
    expect(shouldDiscardStoredGame(null, null)).toBe(false)
  })
})
