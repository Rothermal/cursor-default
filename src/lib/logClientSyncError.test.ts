import { describe, expect, it } from 'vitest'
import { isPersistedSyncLastErrorNetworkish } from './logClientSyncError'

describe('isPersistedSyncLastErrorNetworkish', () => {
  it('matches common transport / offline failure messages', () => {
    expect(isPersistedSyncLastErrorNetworkish('NetworkError when attempting to fetch')).toBe(true)
    expect(isPersistedSyncLastErrorNetworkish('Device is offline')).toBe(true)
    expect(isPersistedSyncLastErrorNetworkish('TypeError: Failed to fetch')).toBe(true)
    expect(isPersistedSyncLastErrorNetworkish('fetch failed')).toBe(true)
    expect(isPersistedSyncLastErrorNetworkish('Request timeout after 30s')).toBe(true)
  })

  it('does not treat application or auth failures as networkish', () => {
    expect(isPersistedSyncLastErrorNetworkish('JWT expired')).toBe(false)
    expect(isPersistedSyncLastErrorNetworkish('duplicate key value violates unique constraint')).toBe(
      false
    )
    expect(isPersistedSyncLastErrorNetworkish('')).toBe(false)
  })
})
