import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  GAME_OWNER_KEY,
  GAME_STORAGE_KEY,
  clearGameLocalStorage,
  getStoredGameOwner,
  setStoredGameOwner,
  shouldDiscardStoredGameForUser,
} from './gameStorage'

function installLocalStorageMock(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
}

describe('gameStorage owner', () => {
  beforeEach(() => {
    installLocalStorageMock()
  })

  it('discards stored game when owner differs from signed-in user', () => {
    localStorage.setItem(GAME_STORAGE_KEY, '{"sport":{}}')
    setStoredGameOwner('user-a')
    expect(shouldDiscardStoredGameForUser('user-b')).toBe(true)
    expect(shouldDiscardStoredGameForUser('user-a')).toBe(false)
  })

  it('allows stored game when owner is missing (legacy)', () => {
    localStorage.setItem(GAME_STORAGE_KEY, '{"sport":{}}')
    expect(shouldDiscardStoredGameForUser('user-a')).toBe(false)
  })

  it('clearGameLocalStorage removes owner and game keys', () => {
    localStorage.setItem(GAME_STORAGE_KEY, '{}')
    setStoredGameOwner('user-a')
    clearGameLocalStorage()
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBeNull()
    expect(getStoredGameOwner()).toBeNull()
    expect(localStorage.getItem(GAME_OWNER_KEY)).toBeNull()
  })
})
