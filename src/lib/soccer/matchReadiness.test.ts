import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
}

describe('Soccer match-readiness wiring', () => {
  it('stores team-scoped role defaults only for Soccer rosters', () => {
    const teams = source('src/pages/Teams.tsx')

    expect(teams).toContain("const isSoccerTeam = selectedTeam?.seasons.sport === 'soccer'")
    expect(teams).toContain("...(isSoccerTeam ? { position } : {})")
    expect(teams).toContain(".update(isSoccerTeam ? { jersey_number, position } : { jersey_number })")
    expect(teams).toContain('SOCCER_ROSTER_ROLE_OPTIONS.map')
  })

  it('loads roster positions before creating fresh cloud-team participant drafts', () => {
    const setup = source('src/pages/SoccerPlayerSetup.tsx')

    expect(setup).toContain(".select('player_id,jersey_number,position,players!inner(id,first_name,last_name)')")
    expect(setup).toContain('parseSoccerRosterRole(row.position)')
    expect(setup).toContain('if (setup?.sourceTeamId && !cloudRosterLoaded.current) return')
    expect(setup).toContain('initialRole: rosterRolesByPlayerId.current[player.id]')
  })

  it('places the pitch and quick capture before collapsed marker filters', () => {
    const tracker = source('src/pages/SoccerGameTracker.tsx')
    const fieldTabStart = tracker.indexOf(") : mainTab === 'field' ? (")
    const fieldTab = tracker.slice(fieldTabStart, tracker.indexOf(") : mainTab === 'lineup' ? (", fieldTabStart))
    const field = fieldTab.indexOf('<SoccerField')
    const quickCapture = fieldTab.indexOf('aria-label="Quick capture"')
    const markerFilters = fieldTab.indexOf('Marker filters')

    expect(field).toBeGreaterThan(-1)
    expect(quickCapture).toBeGreaterThan(field)
    expect(markerFilters).toBeGreaterThan(quickCapture)
    expect(fieldTab.slice(quickCapture, markerFilters)).toContain('<details')
    expect(fieldTab).toContain("setMarkerFamilyFilter('shots')")
    expect(fieldTab).toContain("setMarkerSideFilter('opponent')")
    expect(fieldTab).toContain("setMarkerScope('match')")
  })
})
