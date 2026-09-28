import { describe, expect, it } from 'vitest'
import { baseballPositionLabel, baseballPositionSortKey, normalizeBaseballPosition } from './positions'
import {
  defaultBaseballTeamSettings,
  parseBaseballTeamSettings,
  pruneBaseballLineupDefaults,
  resolveBaseballTeamRules,
  staleBaseballLineupPlayerIds,
  type BaseballTeamSettingsV1,
} from './settings'
import { parseCloudBaseballTeamSettings, validBaseballTeamSettingsCache } from './teamSettingsSync'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function settings(patch: Partial<BaseballTeamSettingsV1> = {}): BaseballTeamSettingsV1 {
  return { ...defaultBaseballTeamSettings(), ...patch }
}

describe('Baseball roster positions', () => {
  it('normalizes standard codes, keeps custom text and treats blank as Unassigned', () => {
    expect(normalizeBaseballPosition(' ss ')).toBe('SS')
    expect(normalizeBaseballPosition('flex')).toBe('FLEX')
    expect(normalizeBaseballPosition('Utility')).toBe('Utility')
    expect(normalizeBaseballPosition('  ')).toBeNull()
    expect(normalizeBaseballPosition(null)).toBeNull()
  })

  it('labels and sorts positions in scorebook order, then custom, then Unassigned', () => {
    expect(baseballPositionLabel('SS')).toBe('SS · Shortstop')
    expect(baseballPositionLabel('Utility')).toBe('Utility')
    expect(baseballPositionLabel(null)).toBe('Unassigned')
    const sorted = ['Utility', null, 'CF', 'P', 'DH'].sort((a, b) => baseballPositionSortKey(a) - baseballPositionSortKey(b))
    expect(sorted).toEqual(['P', 'CF', 'DH', 'Utility', null])
  })
})

describe('Baseball team settings', () => {
  it('treats missing settings as the default profile with an empty lineup', () => {
    const parsed = parseBaseballTeamSettings(null)
    expect(parsed).toEqual({ ok: true, value: defaultBaseballTeamSettings() })
    if (parsed.ok) {
      expect(parsed.value.lineupDefaults).toEqual({ version: 1, battingOrder: [], defense: {} })
    }
  })

  it('parses a complete payload and lower-cases ids', () => {
    const parsed = parseBaseballTeamSettings({
      settingsSchemaVersion: 1,
      baseProfile: { profileId: 'youth_baseball', profileVersion: 1 },
      ruleOverrides: { scheduledInnings: 6, runRules: [{ afterInning: 4, lead: 10 }], pitchCountLimit: null },
      lineupDefaults: { version: 1, battingOrder: [A.toUpperCase(), B], defense: { 6: A, 1: B } },
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.lineupDefaults.battingOrder).toEqual([A, B])
    expect(Object.keys(parsed.value.lineupDefaults.defense)).toEqual(['1', '6'])
  })

  it.each([
    ['unknown key', { ...settings(), extra: true }],
    ['unknown profile', settings({ baseProfile: { profileId: 'cricket' as never, profileVersion: 1 } })],
    ['wrong profile version', settings({ baseProfile: { profileId: 'mlb', profileVersion: 2 as never } })],
    ['unsupported override', settings({ ruleOverrides: { balks: false } as never })],
    ['innings out of range', settings({ ruleOverrides: { scheduledInnings: 16 } })],
    ['duplicate batter', settings({ lineupDefaults: { version: 1, battingOrder: [A, A], defense: {} } })],
    ['player at two positions', settings({ lineupDefaults: { version: 1, battingOrder: [], defense: { 1: A, 2: A } } })],
    ['position 11', settings({ lineupDefaults: { version: 1, battingOrder: [], defense: { 11: A } } })],
    ['non-UUID player', settings({ lineupDefaults: { version: 1, battingOrder: ['player-1'], defense: {} } })],
  ])('rejects %s', (_label, value) => {
    expect(parseBaseballTeamSettings(value).ok).toBe(false)
  })

  it('resolves profile rules with team overrides and keeps the placed runner after regulation', () => {
    const resolved = resolveBaseballTeamRules(settings({
      baseProfile: { profileId: 'nfhs_baseball', profileVersion: 1 },
      ruleOverrides: { scheduledInnings: 9, battingOrderFormat: 'standard' },
    }))
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.rules.scheduledInnings).toBe(9)
    expect(resolved.rules.battingOrderFormat).toBe('standard')
    if (resolved.rules.placedRunnerFromInning !== null) {
      expect(resolved.rules.placedRunnerFromInning).toBeGreaterThan(9)
    }
  })

  it('flags and prunes players who left the roster only on request', () => {
    const lineup = { version: 1 as const, battingOrder: [A, B, C], defense: { '1': C, '6': A } }
    const active = new Set([A, B])
    expect(staleBaseballLineupPlayerIds(lineup, active)).toEqual([C])
    expect(pruneBaseballLineupDefaults(lineup, active)).toEqual({ version: 1, battingOrder: [A, B], defense: { '6': A } })
    expect(lineup.battingOrder).toEqual([A, B, C])
  })

  it('accepts only Baseball schema-1 cloud and cache records', () => {
    const record = { sportId: 'baseball', schemaVersion: 1, revision: 3, settings: settings(), updatedAt: 'now', updatedBy: null }
    expect(parseCloudBaseballTeamSettings(record)?.revision).toBe(3)
    expect(parseCloudBaseballTeamSettings({ ...record, sportId: 'basketball' })).toBeNull()
    expect(parseCloudBaseballTeamSettings({ ...record, schemaVersion: 2 })).toBeNull()
    expect(parseCloudBaseballTeamSettings({ ...record, settings: { nope: true } })).toBeNull()
    const cache = { version: 1 as const, sportId: 'baseball', schemaVersion: 1, revision: 3, settings: settings(), pending: null, cloudUpdatedAt: null, cachedAt: 'now' }
    expect(validBaseballTeamSettingsCache(cache)?.settings).toEqual(settings())
    expect(validBaseballTeamSettingsCache({ ...cache, sportId: 'soccer' })).toBeNull()
  })
})
