import { describe, expect, it } from 'vitest'
import { isSportWorkspaceAvailable } from './sportAvailability'

describe('isSportWorkspaceAvailable', () => {
  it('exposes soccer only in development regardless of its stored toggle', () => {
    expect(isSportWorkspaceAvailable('soccer', false, true)).toBe(true)
    expect(isSportWorkspaceAvailable('soccer', true, false)).toBe(false)
  })

  it('keeps normal sports controlled by settings', () => {
    expect(isSportWorkspaceAvailable('basketball', true, false)).toBe(true)
    expect(isSportWorkspaceAvailable('basketball', false, true)).toBe(false)
  })
})
