import { describe, expect, it } from 'vitest'
import { isValidRemotePlayerUuid, sanitizePlayerIdMapForCloud } from './uuidValidation'

describe('isValidRemotePlayerUuid', () => {
  it('accepts canonical UUID strings', () => {
    expect(isValidRemotePlayerUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isValidRemotePlayerUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it('rejects local pseudo-ids, empty, and malformed values', () => {
    expect(isValidRemotePlayerUuid('__team_home__')).toBe(false)
    expect(isValidRemotePlayerUuid('')).toBe(false)
    expect(isValidRemotePlayerUuid(null)).toBe(false)
    expect(isValidRemotePlayerUuid(undefined)).toBe(false)
    expect(isValidRemotePlayerUuid('not-a-uuid')).toBe(false)
    expect(isValidRemotePlayerUuid(' 550e8400-e29b-41d4-a716-446655440000 ')).toBe(true)
  })
})

describe('sanitizePlayerIdMapForCloud', () => {
  it('keeps only entries whose remote ids are UUIDs', () => {
    const remote = '550e8400-e29b-41d4-a716-446655440000'
    expect(
      sanitizePlayerIdMapForCloud({
        p1: remote,
        __team_home__: '__team_home__',
        p2: 'local-id',
      })
    ).toEqual({ p1: remote })
  })

  it('returns empty map when nothing is cloud-safe', () => {
    expect(sanitizePlayerIdMapForCloud({ a: '__team_opp__' })).toEqual({})
  })
})
