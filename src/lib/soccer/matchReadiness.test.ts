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

  it('wires the S19B formation editor to a positively loaded active roster', () => {
    const teams = source('src/pages/Teams.tsx')
    const panel = source('src/components/settings/SoccerTeamSettingsPanel.tsx')
    const editor = source('src/components/soccer/SoccerFormationEditor.tsx')

    expect(teams).toContain(".eq('is_active', true)")
    expect(teams).toContain('setRosterLoadedTeamId(null)')
    expect(teams).toContain('setRosterLoadedTeamId(selectedTeamId)')
    expect(teams).toContain('rosterReady={rosterLoadedTeamId === selectedTeam.id}')
    expect(panel).toContain("const [activeTab, setActiveTab] = useState<'rules' | 'formation'>('rules')")
    expect(panel).toContain("const formationNeedsCleanup = sharedWritable && activeTab === 'formation'")
    expect(panel).toContain('prepareSoccerTeamSettingsSave(draft, {')
    expect(panel).toContain('rosterReady,')
    expect(panel).toContain('setDraft(current => copySoccerTeamRules(current, parsed.value))')
    expect(panel).toContain('title="Clear Formation"')
    expect(panel).toContain('aria-controls={`${tabGroupId}-rules-panel`}')
    expect(panel).toContain("event.key === 'ArrowRight'")
    expect(editor).toContain('role="list" aria-label="Formation slots"')
    expect(editor).toContain('disabled={pickerDisabled}')
    expect(editor).toContain('moved from ${previousSlot.label} to ${slot.label}.')
  })

  it('loads roster positions before creating fresh cloud-team participant drafts', () => {
    const setup = source('src/pages/SoccerPlayerSetup.tsx')

    expect(setup).toContain(".select('player_id,jersey_number,position,players!inner(id,first_name,last_name)')")
    expect(setup).toContain('parseSoccerRosterRole(row.position)')
    expect(setup).toContain('if (state.players.length > 0 && hadSavedSelection.current)')
    expect(setup).toContain('setRosterLoadAttempt(attempt => attempt + 1)')
    expect(setup).toContain("!cloudRosterLoaded.current && state.players.length === 0")
    expect(setup).toContain('initialRole: rosterRolesByPlayerId.current[player.id]')
  })

  it('applies a coherent team formation once without overwriting recorder edits', () => {
    const setup = source('src/pages/SoccerPlayerSetup.tsx')

    expect(setup).toContain('useSoccerTeamSettings(setup?.sourceTeamId ?? null)')
    expect(setup).toContain('const formationPrefillResolved = useRef(false)')
    expect(setup).toContain('const userEditedDrafts = useRef(false)')
    expect(setup).toContain('const [rosterReady, setRosterReady] = useState(!setup?.sourceTeamId)')
    expect(setup).toContain('decideSoccerFormationPrefill({')
    expect(setup).toContain('userEdited: userEditedDrafts.current,')
    expect(setup).toContain('rosterDraftsReady: state.players.every')
    expect(setup).toContain('applySoccerFormationToRosterDrafts(')
    expect(setup).toContain('setup.rulesSnapshot.maxOnFieldPlayers')
    expect(setup.match(/formationPrefillResolved\.current = true/g)).toHaveLength(3)
    expect(setup.match(/userEditedDrafts\.current = true/g)).toHaveLength(3)
    expect(setup.match(/setDrafts\(/g)).toHaveLength(5)
    expect(setup).toContain("result.status === 'count_mismatch' || result.status === 'invalid'")
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

  it('keeps Soccer event actor selection local and role-ordered', () => {
    const tracker = source('src/pages/SoccerGameTracker.tsx')
    const timeline = source('src/components/soccer/SoccerTimeline.tsx')
    const editor = source('src/components/soccer/SoccerLocatedEventEditor.tsx')
    const shotDialog = source('src/components/soccer/SoccerShotCaptureDialog.tsx')
    const incidentDialog = source('src/components/soccer/SoccerIncidentCaptureDialog.tsx')

    expect(tracker).not.toContain('PlayerChip')
    expect(tracker).not.toContain('selectedParticipantId')
    expect(timeline).not.toContain('selectedParticipantId')
    expect(editor).not.toContain('selectedParticipantId')
    expect(shotDialog).not.toContain('selectedParticipantId')
    expect(incidentDialog).not.toContain('selectedParticipantId')
    expect(shotDialog).toContain('sortSoccerActorParticipants(')
    expect(incidentDialog).toContain('sortSoccerActorParticipants(')
    expect(shotDialog).toContain(
      '}, [allParticipants, initialRoles, initializationDraft, mode, onField, periodTimings])'
    )
    expect(incidentDialog).toContain(
      '}, [initialRoles, initializationDraft, mode, participants, periodTimings, projection])'
    )
    expect(shotDialog).not.toContain(
      '}, [initialRoles, initializationDraft, mode, moment, onField, periodTimings, selectableParticipants])'
    )
    expect(incidentDialog).not.toContain(
      '}, [eligibleParticipants, initializationDraft, periodTimings, projection])'
    )
  })

  it('routes team-event review labels through the shared presentation helper', () => {
    const timeline = source('src/components/soccer/SoccerTimeline.tsx')
    const tracker = source('src/pages/SoccerGameTracker.tsx')
    const fieldReview = source('src/components/soccer-summary/SoccerFieldReview.tsx')
    const eventTitleFn = timeline.slice(
      timeline.indexOf('function eventTitle('),
      timeline.indexOf('function eventDetail(')
    )
    const markerBuilder = fieldReview.slice(
      fieldReview.indexOf('const markers: SoccerFieldMarker[]'),
      fieldReview.indexOf('useEffect(')
    )

    expect(eventTitleFn).toContain(
      'soccerTeamEventReviewPresentation(event).kindLabel'
    )
    expect(eventTitleFn).not.toMatch(/'soccer\.team_event':/)
    expect(tracker).toContain('soccerTeamEventReviewPresentation(event).label')
    expect(markerBuilder).toContain('item.participantLabel')
  })

  it('keeps restart capture one-shot and preserves optional team-event actors', () => {
    const tracker = source('src/pages/SoccerGameTracker.tsx')
    const dialog = source('src/components/soccer/SoccerIncidentCaptureDialog.tsx')
    const field = source('src/components/soccer/SoccerField.tsx')
    const fieldTabStart = tracker.indexOf(") : mainTab === 'field' ? (")
    const fieldTab = tracker.slice(
      fieldTabStart,
      tracker.indexOf(") : mainTab === 'lineup' ? (", fieldTabStart)
    )
    const setCaptureSideFn = tracker.slice(
      tracker.indexOf('const setCaptureSide ='),
      tracker.indexOf('const setCaptureMode =')
    )
    const setCaptureModeFn = tracker.slice(
      tracker.indexOf('const setCaptureMode ='),
      tracker.indexOf('const openIncident =')
    )
    const openIncidentFn = tracker.slice(
      tracker.indexOf('const openIncident ='),
      tracker.indexOf('const editFieldEvent =')
    )
    const moreActionsButton = fieldTab.slice(
      fieldTab.indexOf('onClick={() => {', fieldTab.indexOf('Substitution')),
      fieldTab.indexOf('</button>', fieldTab.indexOf('aria-label="More match actions"'))
    )

    expect(tracker).toContain('const [restartArmed, setRestartArmed] = useState(false)')
    expect(tracker).toContain("mainTab !== 'field'")
    expect(tracker).toContain('suggestSoccerRestartKind(')
    expect(tracker).toContain(
      "openIncident('team_event', location, 'live', undefined, suggestedKind ?? 'corner')"
    )
    expect(fieldTab).toContain('activeCaptureLabel={restartArmed ? \'Restart capture\' : undefined}')
    expect(fieldTab).toContain('label="Restart"')
    expect(fieldTab).not.toContain('label="Team"')
    expect(fieldTab).toContain('role="status" aria-live="polite"')
    expect(setCaptureSideFn).toContain('setRestartArmed(false)')
    expect(setCaptureModeFn).toContain('setRestartArmed(false)')
    expect(openIncidentFn).toContain('setRestartArmed(false)')
    expect(fieldTab).toContain('onCluster={eventIds => {')
    expect(fieldTab).toContain('setClusterEventIds(eventIds)')
    expect(moreActionsButton).toContain('setRestartArmed(false)')
    expect(moreActionsButton).toContain('setActionsOpen(true)')
    expect(field).toContain('activeCaptureLabel?: string')
    expect(dialog).toContain("mode === 'live' && draft.kind === 'team_event'")
    expect(dialog).toContain("{ value: 'throw_in', label: 'Throw-in' }")
    expect(dialog).toContain("{ value: 'goal_kick', label: 'Goal kick' }")
    expect(dialog).toContain("kind === 'offside' ? 'Offside player' : 'Taker'")
    expect(dialog).toContain("mainActorRole(draft.kind, teamEventKind)")
    expect(dialog).toContain("teamEventKind === 'offside' ? 'offside_player' : 'taker'")
    expect(dialog).toContain('actors,')
    expect(dialog).not.toContain("teamEventKind === 'corner' ? [] : actors")
    expect(dialog).not.toContain('function cornerLocation(')
  })

  it('blocks healthy Soccer history from becoming incomplete while allowing recovery', () => {
    const tracker = source('src/pages/SoccerGameTracker.tsx')

    expect(tracker).toContain('if (inspection.complete && !result.inspection.complete)')
    expect(tracker).toContain("setError('That change would leave the match history incomplete.')")
  })

  it('keeps Timeline correction drafts stable across live clock renders', () => {
    const editor = source('src/components/soccer/SoccerLocatedEventEditor.tsx')
    const shotDialog = source('src/components/soccer/SoccerShotCaptureDialog.tsx')
    const incidentDialog = source('src/components/soccer/SoccerIncidentCaptureDialog.tsx')

    expect(editor).toContain('const shotDraft = useMemo<SoccerCaptureDraft | null>')
    expect(editor).toContain('const incidentDraft = useMemo<SoccerIncidentDraft | null>')
    expect(editor).toContain('draft={shotDraft}')
    expect(editor).toContain('draft={incidentDraft}')
    expect(editor.match(/}, \[event\]\)/g)).toHaveLength(2)
    expect(editor).not.toContain('draft={{')
    expect(shotDialog).toContain('const initializationDraft = useStableSoccerCorrectionDraft(draft)')
    expect(incidentDialog).toContain('const initializationDraft = useStableSoccerCorrectionDraft(draft)')
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

  it('exposes substitution through a scalable Field action row', () => {
    const tracker = source('src/pages/SoccerGameTracker.tsx')
    const fieldTabStart = tracker.indexOf(") : mainTab === 'field' ? (")
    const fieldTab = tracker.slice(fieldTabStart, tracker.indexOf(") : mainTab === 'lineup' ? (", fieldTabStart))
    const quickCapture = fieldTab.indexOf('aria-label="Quick capture"')
    const matchActions = fieldTab.indexOf('aria-label="Field match actions"')
    const markerFilters = fieldTab.indexOf('Marker filters')

    expect(matchActions).toBeGreaterThan(quickCapture)
    expect(markerFilters).toBeGreaterThan(matchActions)
    expect(fieldTab).toContain("onClick={() => openDialog('substitution')}")
    expect(fieldTab).toContain('disabled={!substitutionActionEnabled}')
    expect(fieldTab).toContain('aria-label="More match actions"')
    expect(fieldTab.split('<QuickCaptureButton').length - 1).toBe(4)
    expect(fieldTab).toContain('role="group" aria-label="Quick capture"')
    expect(fieldTab).toContain('role="group" aria-label="Field match actions"')
  })

  it('counter-rotates screen-upright marker glyphs when the field is flipped', () => {
    const field = source('src/components/soccer/SoccerField.tsx')
    const markerStart = field.indexOf('<SoccerMarker\n')
    const markerEnd = field.indexOf('/>', markerStart)
    const clusterStart = field.indexOf('<SoccerMarkerCluster\n')
    const clusterEnd = field.indexOf('/>', clusterStart)
    const offsideStart = field.indexOf("marker.kind === 'offside'")
    const offsideEnd = field.indexOf('</g>', offsideStart)

    expect(field.slice(markerStart, markerEnd)).toContain('flipped={flipped}')
    expect(field.slice(clusterStart, clusterEnd)).toContain('flipped={flipped}')
    expect(field.slice(offsideStart, offsideEnd)).toContain('transform={uprightMarkerGlyphTransform(flipped, x, y)}')
    expect(field.match(/transform=\{uprightMarkerGlyphTransform\(flipped, x, y\)\}/g)).toHaveLength(3)
    expect(field).toContain('return flipped ? `rotate(180 ${x} ${y})` : undefined')
  })
})
