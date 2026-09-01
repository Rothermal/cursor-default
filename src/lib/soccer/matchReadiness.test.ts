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
    expect(teams).toContain('isSoccerTeam && editingPlayerSoccerRoleDirty ? { position } : {}')
    expect(teams).toContain('setEditingPlayerSoccerRoleDirty(true)')
    expect(teams).toContain('existingPlayerSoccerRole')
    expect(teams).toContain('SOCCER_ROSTER_ROLE_OPTIONS.map')
  })

  it('loads roster positions before creating fresh cloud-team participant drafts', () => {
    const setup = source('src/pages/SoccerPlayerSetup.tsx')

    expect(setup).toContain(".select('player_id,jersey_number,position,players!inner(id,first_name,last_name)')")
    expect(setup).toContain('parseSoccerRosterRole(row.position)')
    expect(setup).toContain('if (state.players.length > 0)')
    expect(setup).toContain('setRosterLoadAttempt(attempt => attempt + 1)')
    expect(setup).toContain("!cloudRosterLoaded.current && state.players.length === 0")
    expect(setup).toContain('initialRole: rosterRolesByPlayerId.current[player.id]')
  })

  it('keeps Soccer merge resolutions strict while preserving untouched raw values', () => {
    const merge = source('src/components/MergePlayerWizard.tsx')

    expect(merge).toContain(".select('id,seasons!inner(sport)')")
    expect(merge).toContain('Could not load roster sports')
    expect(merge).toContain("teamSportsById[row.team_id] === 'soccer'")
    expect(merge).toContain('soccerRosterRoleLabel(row.survivor.position)')
    expect(merge).toContain('value={parseSoccerRosterRole(tpResolutions[i]?.position).group}')
    expect(merge).toContain('serializeSoccerRosterRole(')
  })

  it('normalizes incident actors at every stale-selection boundary', () => {
    const dialog = source('src/components/soccer/SoccerIncidentCaptureDialog.tsx')

    expect(dialog).toContain('const main = normalizeSoccerIncidentActorSelection(')
    expect(dialog).toContain('const initialAttribution = normalizeSoccerIncidentActorSelection(')
    expect(dialog).toContain('const mainSelection = normalizeSoccerIncidentActorSelection(')
  })

  it('blocks healthy Soccer history from becoming incomplete while allowing recovery', () => {
    const tracker = source('src/pages/SoccerGameTracker.tsx')

    expect(tracker).toContain('if (inspection.complete && !result.inspection.complete)')
    expect(tracker).toContain("setError('That change would leave the match history incomplete.')")
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
    expect(fieldTab).toContain('· {markerFilterSummary}')
  })
})
