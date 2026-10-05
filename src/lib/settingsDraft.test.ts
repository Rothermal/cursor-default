import { describe, expect, it } from 'vitest'
import { hockeySettingsFingerprint as fingerprint } from './hockey/settings'
import type { HockeySettingsV1 } from './hockey/types'
import { createSettingsDraft, editSettingsDraft, syncSettingsDraft } from './settingsDraft'
import { staleSportPersonalSave } from './sportPersonalSettings'

const settings = (profileId: HockeySettingsV1['baseProfile']['profileId'], ruleOverrides: HockeySettingsV1['ruleOverrides'] = {}): HockeySettingsV1 =>
  ({ settingsSchemaVersion: 1, baseProfile: { profileId, profileVersion: 1 }, ruleOverrides })

describe('settings draft base revision (HKY-5C review)', () => {
  it('keeps an unsaved draft on its own revision when focus, online or Refresh brings another device\'s change', () => {
    const cached = settings('usa_hockey_youth')
    let state = createSettingsDraft(cached, 2, fingerprint)
    state = editSettingsDraft(state, settings('ncaa'))
    // Every refresh trigger commits the cloud copy and its revision; the edited draft stays put.
    const otherDevice = settings('recreational', { trapezoid: true })
    state = syncSettingsDraft(state, otherDevice, 3, fingerprint)
    expect(state.draft).toEqual(settings('ncaa'))
    expect(state.baseRevision).toBe(2)
    // Saving that draft is a conflict to resolve, not a write over revision 3.
    const conflict = staleSportPersonalSave(state.draft, state.baseRevision, { settings: otherDevice, revision: 3, lastSyncedAt: 'later' })
    expect(conflict).toEqual({ device: settings('ncaa'), cloud: otherDevice, cloudRevision: 3, cloudUpdatedAt: 'later' })
    // A second refresh with the same copy changes nothing.
    expect(syncSettingsDraft(state, otherDevice, 3, fingerprint)).toBe(state)
  })

  it('adopts the saved copy and its revision while the draft is untouched or matches it', () => {
    let state = createSettingsDraft(settings('usa_hockey_youth'), 2, fingerprint)
    state = syncSettingsDraft(state, settings('nhl_regular'), 3, fingerprint)
    expect(state).toMatchObject({ draft: settings('nhl_regular'), baseRevision: 3 })
    // After a save the draft equals the saved copy, so it takes the new revision.
    state = editSettingsDraft(state, settings('ncaa'))
    state = syncSettingsDraft(state, settings('ncaa'), 4, fingerprint)
    expect(state.baseRevision).toBe(4)
    expect(staleSportPersonalSave(state.draft, state.baseRevision, { settings: settings('ncaa'), revision: 4, lastSyncedAt: null })).toBeNull()
    // A revision bump with identical settings is adopted too.
    expect(syncSettingsDraft(state, settings('ncaa'), 5, fingerprint).baseRevision).toBe(5)
  })
})
