import { isPlainObject } from '../gameEvents/envelope'
import { parseSportSettingsCloudRecord, type SportSettingsCloudRecord, type SportSettingsCloudLoadResult, type SportSettingsCloudWriteResult } from '../sportSettingsCloud'
import type { SportPersonalSettingsAdapter } from '../sportPersonalSettings'
import { validSportPersonalSettingsCache } from '../sportPersonalSettings'
import type { SportSettingsCacheRecord } from '../sportSettingsStorage'
import { createBaseballFeatureClient, exactKeys, invalid, type BaseballFeatureOptions } from './featureClient'
import { baseballPersonalSettingsFingerprint, defaultBaseballPersonalSettings, parseBaseballPersonalSettings, type BaseballPersonalSettingsV1 } from './settings'

type Settings = BaseballPersonalSettingsV1

export function parseBaseballPersonalCloudRecord(value: unknown): SportSettingsCloudRecord<Settings> {
  if (!isPlainObject(value) || !exactKeys(value, ['sportId', 'schemaVersion', 'revision', 'settings', 'updatedAt', 'updatedBy'])) throw invalid('Invalid Baseball settings record.')
  const record = parseSportSettingsCloudRecord<Settings>(value)
  const parsed = parseBaseballPersonalSettings(record?.settings)
  if (!record || record.sportId !== 'baseball' || record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision)
    || !parsed.ok || record.settings === null || record.settings === undefined || !Number.isFinite(Date.parse(record.updatedAt)) || record.updatedBy !== null) throw invalid('Invalid Baseball settings record.')
  return { ...record, settings: parsed.value }
}

export async function loadBaseballPersonalSettings(userId: string, options: BaseballFeatureOptions = {}): Promise<SportSettingsCloudLoadResult<Settings>> {
  const client = createBaseballFeatureClient(userId, options)
  await client.require('personal_settings')
  const data = await client.request('get_baseball_personal_settings', { p_expected_user_id: userId })
  if (!isPlainObject(data)) throw invalid('Invalid Baseball settings response.')
  if (data.status === 'missing' && exactKeys(data, ['status'])) return { status: 'missing' }
  if (data.status !== 'loaded' || !exactKeys(data, ['status', 'record'])) throw invalid('Invalid Baseball settings response.')
  return { status: 'loaded', record: parseBaseballPersonalCloudRecord(data.record) }
}

export async function saveBaseballPersonalSettings(userId: string, expectedRevision: number | null, settings: Settings, options: BaseballFeatureOptions = {}): Promise<SportSettingsCloudWriteResult<Settings>> {
  const parsed = parseBaseballPersonalSettings(settings)
  if (settings === null || settings === undefined || !parsed.ok || expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw invalid('Invalid Baseball settings save.')
  const client = createBaseballFeatureClient(userId, options)
  await client.require('personal_settings')
  const data = await client.request('save_baseball_user_settings_revisioned', { p_expected_user_id: userId, p_expected_revision: expectedRevision, p_settings: parsed.value })
  if (!isPlainObject(data) || !exactKeys(data, ['status', 'record']) || data.status !== 'applied' && data.status !== 'conflict') throw invalid('Invalid Baseball settings save response.')
  if (data.status === 'conflict' && data.record === null) return { status: 'conflict', record: null }
  const record = parseBaseballPersonalCloudRecord(data.record)
  if (data.status === 'applied' && record.revision !== (expectedRevision ?? 0) + 1) throw invalid('Baseball settings revision did not advance.')
  if (data.status === 'applied' && baseballPersonalSettingsFingerprint(record.settings) !== baseballPersonalSettingsFingerprint(parsed.value)) throw invalid('Baseball settings save returned different settings.')
  return { status: data.status, record }
}

/** One adapter belongs to one auth lifetime; old callbacks cannot revive after A -> B -> A. */
export function createBaseballPersonalSettingsAdapter(userId: string | null, options: BaseballFeatureOptions = {}): SportPersonalSettingsAdapter<Settings> {
  const lifetime = userId ? createBaseballFeatureClient(userId, options) : null
  return {
    sportId: 'baseball', label: 'Baseball', schemaVersion: 1,
    defaults: defaultBaseballPersonalSettings,
    parse: value => value == null ? { ok: false, error: 'Saved Baseball settings are missing.' } : parseBaseballPersonalSettings(value),
    save: async (revision, settings) => {
      lifetime?.assertCurrent()
      return userId ? saveBaseballPersonalSettings(userId, revision, settings, options) : { status: 'not_configured' }
    },
  }
}

export function validBaseballPersonalSettingsCache(adapter: SportPersonalSettingsAdapter<Settings>, value: SportSettingsCacheRecord | null): SportSettingsCacheRecord<Settings> | null {
  const parsed = validSportPersonalSettingsCache(adapter, value)
  const validRevision = (revision: number | null) => revision === null || Number.isSafeInteger(revision) && revision > 0
  return parsed && validRevision(parsed.revision) && (!parsed.pending || validRevision(parsed.pending.baseRevision)) ? parsed : null
}
