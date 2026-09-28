import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import { saveBaseballTeamSettings } from '../sportSettingsCloud'
import type { SportSettingsCacheRecord } from '../sportSettingsStorage'
import type { SportTeamSettingsAdapter } from '../sportTeamSettings'
import {
  BASEBALL_SETTINGS_SCHEMA_VERSION,
  defaultBaseballTeamSettings,
  parseBaseballTeamSettings,
  type BaseballTeamSettingsV1,
} from './settings'

export function parseCloudBaseballTeamSettings(
  record: SportSettingsCloudRecord
): SportSettingsCloudRecord<BaseballTeamSettingsV1> | null {
  if (record.sportId !== 'baseball' || record.schemaVersion !== BASEBALL_SETTINGS_SCHEMA_VERSION) return null
  const parsed = parseBaseballTeamSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export function validBaseballTeamSettingsCache(
  record: SportSettingsCacheRecord | null
): SportSettingsCacheRecord<BaseballTeamSettingsV1> | null {
  if (!record || record.sportId !== 'baseball' || record.schemaVersion !== BASEBALL_SETTINGS_SCHEMA_VERSION) return null
  const parsed = parseBaseballTeamSettings(record.settings)
  return parsed.ok ? { ...record, settings: parsed.value } : null
}

export const baseballTeamSettingsAdapter: SportTeamSettingsAdapter<BaseballTeamSettingsV1> = {
  sportId: 'baseball',
  label: 'Baseball',
  schemaVersion: () => BASEBALL_SETTINGS_SCHEMA_VERSION,
  defaults: defaultBaseballTeamSettings,
  parse: value => {
    const parsed = parseBaseballTeamSettings(value)
    return parsed.ok ? { ok: true, value: parsed.value } : parsed
  },
  parseCloud: parseCloudBaseballTeamSettings,
  validCache: validBaseballTeamSettingsCache,
  save: (teamId, expectedRevision, settings) => saveBaseballTeamSettings(teamId, expectedRevision, settings),
}
