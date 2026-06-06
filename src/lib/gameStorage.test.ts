import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearGameStorage,
  GAME_OWNER_KEY,
  GAME_STORAGE_KEY,
  setGameOwner,
  shouldDiscardStoredGame,
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

beforeEach(() => {
  installLocalStorageMock()
})

afterEach(() => {
  clearGameStorage()
  vi.unstubAllGlobals()
})

describe('shouldDiscardStoredGame', () => {
  it('returns false when no saved game', () => {
    expect(shouldDiscardStoredGame('user-a')).toBe(false)
  })

  it('returns true for legacy saves without an owner tag', () => {
    localStorage.setItem(GAME_STORAGE_KEY, '{"sport":null}')
    expect(shouldDiscardStoredGame('user-a')).toBe(true)
  })

  it('returns true when owner differs from current user', () => {
    localStorage.setItem(GAME_STORAGE_KEY, '{"sport":null}')
    setGameOwner('user-a')
    expect(shouldDiscardStoredGame('user-b')).toBe(true)
  })

  it('returns false when owner matches current user', () => {
    localStorage.setItem(GAME_STORAGE_KEY, '{"sport":null}')
    setGameOwner('user-a')
    expect(shouldDiscardStoredGame('user-a')).toBe(false)
  })
})

describe('clearGameStorage', () => {
  it('removes game, owner, and pending sync keys', () => {
    localStorage.setItem(GAME_STORAGE_KEY, '{}')
    setGameOwner('user-a')
    localStorage.setItem('statkeeper_pending_sync', '1')
    clearGameStorage()
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(GAME_OWNER_KEY)).toBeNull()
    expect(localStorage.getItem('statkeeper_pending_sync')).toBeNull()
  })
})
