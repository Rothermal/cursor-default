import { describe, expect, it } from 'vitest'
import { activePlayerIdAfterRosterChange } from './activePlayerIdForRoster'
import type { Player } from '../types'

const p = (id: string): Player => ({
  id,
  name: id,
  number: '1',
  stats: {},
})

describe('activePlayerIdAfterRosterChange', () => {
  it('defaults to first player when previous selection is not on the new roster', () => {
    expect(
      activePlayerIdAfterRosterChange('old-local-id', [p('cloud-a'), p('cloud-b')])
    ).toBe('cloud-a')
  })

  it('preserves selection when that player still exists', () => {
    expect(activePlayerIdAfterRosterChange('b', [p('a'), p('b'), p('c')])).toBe('b')
  })

  it('returns null for an empty roster', () => {
    expect(activePlayerIdAfterRosterChange('x', [])).toBe(null)
  })
})
