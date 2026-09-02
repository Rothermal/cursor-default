import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canRenameSeason, normalizedSeasonName } from './seasonWorkflow'

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

  it('keeps season creation and owner rename discoverable in their primary routes', () => {
    const teams = source('src/pages/Teams.tsx')
    const seasonInfo = source('src/pages/SeasonInfo.tsx')

    expect(teams).toContain("const [newTeamSeason, setNewTeamSeason] = useState('')")
    expect(teams).toContain('Season name')
    expect(teams).toContain('placeholder="Spring 2027"')
    expect(seasonInfo).toContain('canRenameSeason(season.owner_id, user?.id)')
    expect(seasonInfo).toContain('aria-label="Rename season"')
    expect(seasonInfo).toContain('.update({ name: nextName })')
  })
})
