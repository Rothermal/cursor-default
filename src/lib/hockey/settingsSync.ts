import type { SportPersonalSettingsAdapter } from '../sportPersonalSettings'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import { saveHockeyTeamSettings, saveHockeyUserSettings } from '../sportSettingsCloud'
import type { SportSettingsCacheRecord } from '../sportSettingsStorage'
import type { SportTeamSettingsAdapter } from '../sportTeamSettings'
import {
  defaultHockeySettings,
  defaultHockeyTeamSettings,
  parseHockeySettings,
  parseHockeyTeamSettings,
  type HockeyTeamSettingsV1,
} from './settings'
import { HOCKEY_SETTINGS_SCHEMA_VERSION, type HockeySettingsV1 } from './types'

/** HKY-5C personal Hockey rules default, saved through `save_hockey_user_settings_revisioned`. */
export const hockeyPersonalSettingsAdapter: SportPersonalSettingsAdapter<HockeySettingsV1> = {
  sportId: 'hockey',
  label: 'Hockey',
  schemaVersion: HOCKEY_SETTINGS_SCHEMA_VERSION,
  defaults: defaultHockeySettings,
  parse: value => {
    const parsed = parseHockeySettings(value)
    return parsed.ok ? parsed : { ok: false, error: `Hockey settings are invalid: ${parsed.error}.` }
  },
  save: (expectedRevision, settings) => saveHockeyUserSettings(expectedRevision, settings),
}

export function parseCloudHockeyTeamSettings(
  record: SportSettingsCloudRecord
): SportSettingsCloudRecord<HockeyTeamSettingsV1> | null {
  if (record.sportId !== 'hockey' || record.schemaVersion !== HOCKEY_SETTINGS_SCHEMA_VERSION) return null
  const parsed = parseHockeyTeamSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function validHockeyTeamSettingsCache(
  record: SportSettingsCacheRecord | null
): SportSettingsCacheRecord<HockeyTeamSettingsV1> | null {
  if (!record || record.sportId !== 'hockey' || record.schemaVersion !== HOCKEY_SETTINGS_SCHEMA_VERSION) return null
  const parsed = parseHockeyTeamSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

/** HKY-5C team rules and lineup defaults, saved by owners and admins only. */
export const hockeyTeamSettingsAdapter: SportTeamSettingsAdapter<HockeyTeamSettingsV1> = {
  sportId: 'hockey',
  label: 'Hockey',
  schemaVersion: () => HOCKEY_SETTINGS_SCHEMA_VERSION,
  defaults: defaultHockeyTeamSettings,
  parse: value => {
    const parsed = parseHockeyTeamSettings(value)
    return parsed.ok ? parsed : { ok: false, error: `Hockey team defaults are invalid: ${parsed.error}.` }
  },
  parseCloud: parseCloudHockeyTeamSettings,
  validCache: validHockeyTeamSettingsCache,
  save: (teamId, expectedRevision, settings) => saveHockeyTeamSettings(teamId, expectedRevision, settings),
}
