import { describe, expect, it } from 'vitest'
import {
  parseSoccerRosterRole,
  serializeSoccerRosterRole,
  soccerRosterRoleLabel,
} from './rosterRole'

describe('Soccer roster default roles', () => {
  it('round-trips the four team-scoped role groups', () => {
    for (const group of ['goalkeeper', 'defender', 'midfielder', 'forward'] as const) {
      const stored = serializeSoccerRosterRole(group)
      expect(stored).toBe(`soccer:${group}`)
      expect(parseSoccerRosterRole(stored)).toEqual({ group, label: null })
    }
  })

  it('fails closed to Midfielder for legacy, null, and malformed values', () => {
    expect(parseSoccerRosterRole(null)).toEqual({ group: 'midfielder', label: null })
    expect(parseSoccerRosterRole('Goalkeeper')).toEqual({ group: 'midfielder', label: null })
    expect(parseSoccerRosterRole('soccer:custom')).toEqual({ group: 'midfielder', label: null })
    expect(soccerRosterRoleLabel('unexpected')).toBe('Midfielder')
  })
})
