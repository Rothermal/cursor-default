import { describe, expect, it } from 'vitest'
import { createInitialCloudSyncState } from '../gameReducer'
import { isFinalBasketballCloudGame } from './cloudPolicy'

describe('Basketball cloud mutation policy', () => {
  it('keeps nonfinal and unbound games editable', () => {
    const cloudSync = createInitialCloudSyncState()
    expect(isFinalBasketballCloudGame({ cloudSync })).toBe(false)
    expect(isFinalBasketballCloudGame({
      cloudSync: { ...cloudSync, gameId: 'game-1', gameStatus: 'in_progress' },
    })).toBe(false)
  })

  it('makes finalized cloud games read-only', () => {
    const cloudSync = createInitialCloudSyncState()
    expect(isFinalBasketballCloudGame({
      cloudSync: { ...cloudSync, gameId: 'game-1', gameStatus: 'final' },
    })).toBe(true)
  })
})
