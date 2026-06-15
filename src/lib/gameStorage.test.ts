import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GAME_OWNER_STORAGE_KEY,
  GAME_STORAGE_KEY,
  clearPersistedGameState,
  isPersistedGameOwnedBy,
  writeGameOwnerId,
} from './gameStorage'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
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
})

afterEach(() => {
  clearPersistedGameState()
  vi.unstubAllGlobals()
})

describe('isPersistedGameOwnedBy', () => {
  it('allows any snapshot when auth is not configured', () => {
    writeGameOwnerId('user-a')
    expect(isPersistedGameOwnedBy('user-b', false)).toBe(true)
  })

  it('allows load when no owner was stored yet (legacy)', () => {
    expect(isPersistedGameOwnedBy('user-a', true)).toBe(true)
  })

  it('rejects snapshot owned by another user', () => {
    writeGameOwnerId('user-a')
    expect(isPersistedGameOwnedBy('user-b', true)).toBe(false)
  })

  it('accepts snapshot for the matching owner', () => {
    writeGameOwnerId('user-a')
    expect(isPersistedGameOwnedBy('user-a', true)).toBe(true)
  })
})

describe('clearPersistedGameState', () => {
  it('removes game and owner keys', () => {
    localStorage.setItem(GAME_STORAGE_KEY, '{}')
    writeGameOwnerId('user-a')
    clearPersistedGameState()
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(GAME_OWNER_STORAGE_KEY)).toBeNull()
  })
})
