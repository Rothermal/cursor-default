import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canRenameSeason,
  decideSeasonRename,
  normalizedSeasonName,
} from './seasonWorkflow'

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

describe('season workflow', () => {
  it('normalizes non-empty season names without inventing a default', () => {
    expect(normalizedSeasonName('  Spring 2027  ')).toBe('Spring 2027')
    expect(normalizedSeasonName('  ')).toBeNull()
  })

  it('limits Season Info rename authority to the season owner', () => {
    expect(canRenameSeason('owner-1', 'owner-1')).toBe(true)
    expect(canRenameSeason('owner-1', 'member-1')).toBe(false)
    expect(canRenameSeason('owner-1', null)).toBe(false)
  })

  it.each([
    {
      label: 'blocks a non-owner',
      draft: 'Fall 2027',
      userId: 'member-1',
      expected: { outcome: 'blocked' },
    },
    {
      label: 'rejects an empty name',
      draft: '   ',
      userId: 'owner-1',
      expected: { outcome: 'invalid' },
    },
    {
      label: 'recognizes the normalized current name',
      draft: '  Spring 2027  ',
      userId: 'owner-1',
      expected: { outcome: 'unchanged', name: 'Spring 2027' },
    },
    {
      label: 'returns a normalized rename',
      draft: '  Fall 2027  ',
      userId: 'owner-1',
      expected: { outcome: 'rename', name: 'Fall 2027' },
    },
  ])('$label', ({ draft, userId, expected }) => {
    expect(decideSeasonRename(
      { ownerId: 'owner-1', name: 'Spring 2027' },
      draft,
      userId
    )).toEqual(expected)
  })

  it('keeps season creation and owner rename discoverable in their primary routes', () => {
    const teams = source('src/pages/Teams.tsx')
    const seasonInfo = source('src/pages/SeasonInfo.tsx')
    const admin = source('src/pages/Admin.tsx')

    expect(teams).toContain("const [newTeamSeason, setNewTeamSeason] = useState('')")
    expect(teams).toContain('Season name')
    expect(teams).toContain('placeholder="Spring 2027"')
    expect(seasonInfo).toContain('canRenameSeason(season.owner_id, user?.id)')
    expect(seasonInfo).toContain('aria-label="Rename season"')
    expect(seasonInfo).toContain('.update({ name: decision.name })')
    expect(admin.match(/normalizedSeasonName\(/g)).toHaveLength(2)
  })
})
