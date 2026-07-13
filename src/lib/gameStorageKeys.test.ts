import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GAME_OWNER_KEY,
  GAME_RECORD_KEY_PREFIX,
  GAME_STORAGE_KEY,
  GAMES_MANIFEST_KEY,
  PENDING_SYNC_KEY,
  clearPersistedGameStorage,
  getPendingSyncFlag,
  setPendingSyncFlag,
} from './gameStorageKeys'

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('pending sync flag', () => {
  it('reads and clears the pending sync marker', () => {
    expect(getPendingSyncFlag()).toBe(false)

    setPendingSyncFlag(true)
    expect(localStorage.getItem(PENDING_SYNC_KEY)).toBe('1')
    expect(getPendingSyncFlag()).toBe(true)

    setPendingSyncFlag(false)
    expect(localStorage.getItem(PENDING_SYNC_KEY)).toBeNull()
    expect(getPendingSyncFlag()).toBe(false)
  })

  it('treats non-1 values as not pending', () => {
    localStorage.setItem(PENDING_SYNC_KEY, 'true')
    expect(getPendingSyncFlag()).toBe(false)
  })
})

describe('clearPersistedGameStorage', () => {
  it('removes the manifest, legacy mirror, owner, pending flag, and each parked record', () => {
    localStorage.setItem(
      GAMES_MANIFEST_KEY,
      JSON.stringify({
        version: 1,
        ownerId: 'user-1',
        activeLocalGameId: 'g1',
        gameIds: ['g1', 'g2'],
        summaries: {},
      })
    )
    localStorage.setItem(`${GAME_RECORD_KEY_PREFIX}g1`, '{"localGameId":"g1"}')
    localStorage.setItem(`${GAME_RECORD_KEY_PREFIX}g2`, '{"localGameId":"g2"}')
    localStorage.setItem(GAME_STORAGE_KEY, '{"sport":null}')
    localStorage.setItem(GAME_OWNER_KEY, 'user-1')
    localStorage.setItem(PENDING_SYNC_KEY, '1')
    localStorage.setItem('unrelated_key', 'keep')

    clearPersistedGameStorage()

    expect(localStorage.getItem(GAMES_MANIFEST_KEY)).toBeNull()
    expect(localStorage.getItem(`${GAME_RECORD_KEY_PREFIX}g1`)).toBeNull()
    expect(localStorage.getItem(`${GAME_RECORD_KEY_PREFIX}g2`)).toBeNull()
    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(GAME_OWNER_KEY)).toBeNull()
    expect(localStorage.getItem(PENDING_SYNC_KEY)).toBeNull()
    expect(localStorage.getItem('unrelated_key')).toBe('keep')
  })

  it('still clears legacy keys when the manifest is missing or corrupt', () => {
    localStorage.setItem(GAMES_MANIFEST_KEY, '{not-json')
    localStorage.setItem(GAME_STORAGE_KEY, '{"sport":null}')
    localStorage.setItem(GAME_OWNER_KEY, 'user-1')
    localStorage.setItem(PENDING_SYNC_KEY, '1')

    clearPersistedGameStorage()

    expect(localStorage.getItem(GAME_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(GAME_OWNER_KEY)).toBeNull()
    expect(localStorage.getItem(PENDING_SYNC_KEY)).toBeNull()
  })
})
