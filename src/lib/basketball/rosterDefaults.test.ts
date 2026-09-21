import { describe, expect, it } from 'vitest'
import { parseBasketballLineupDefaults } from './lineupDefaults'
import { BASKETBALL_POSITION_OPTIONS, isValidBasketballPosition, normalizeBasketballPosition } from './positions'
import { DEFAULT_BASKETBALL_TEAM_SETTINGS, parseBasketballTeamSettings, parseBasketballPersonalSettings } from './settings'
import { createBasketballTeamSettingsCacheRecord, validBasketballTeamSettingsCache } from './teamSettingsSync'
import { createBasketballSetupDraft, reconcileBasketballSetupTrackedRoster, parseBasketballSetupDraft, basketballVersion3StartSetupFromDraft } from './setupDraft'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const settings = { ...DEFAULT_BASKETBALL_TEAM_SETTINGS,
  lineupDefaults: { version: 1 as const, starterPlayerIds: [id] } }

describe('Basketball roster defaults', () => {
  it('shares standard positions while preserving custom and unassigned positions', () => {
    expect(BASKETBALL_POSITION_OPTIONS).toEqual(['PG', 'SG', 'SF', 'PF', 'C'])
    expect(normalizeBasketballPosition('  Point forward  ')).toBe('Point forward')
    expect(normalizeBasketballPosition(' ')).toBeNull()
    expect(normalizeBasketballPosition('soccer:forward')).toBe('soccer:forward')
    expect(isValidBasketballPosition('x'.repeat(80))).toBe(true)
    expect(isValidBasketballPosition('x'.repeat(81))).toBe(false)
  })
  it('validates exact starter payloads and canonicalizes identities without sharing arrays', () => {
    const parsed = parseBasketballLineupDefaults(settings.lineupDefaults)!
    expect(parsed).toEqual(settings.lineupDefaults)
    parsed.starterPlayerIds.pop()
    expect(settings.lineupDefaults.starterPlayerIds).toEqual([id])
    expect(parseBasketballLineupDefaults({ version: 1, starterPlayerIds: [id, id.toUpperCase()] })).toBeNull()
    expect(parseBasketballLineupDefaults({ version: 1, starterPlayerIds: ['local-player'] })).toBeNull()
    expect(parseBasketballLineupDefaults({ version: 1, starterPlayerIds: [], extra: true })).toBeNull()
    expect(parseBasketballLineupDefaults({ version: 2, starterPlayerIds: [] })).toBeNull()
    expect(parseBasketballLineupDefaults({ version: 1, starterPlayerIds: Array(6).fill(id) })).toBeNull()
  })
  it('reads old defaults without guessing starters and keeps personal settings separate', () => {
    expect(parseBasketballTeamSettings(DEFAULT_BASKETBALL_TEAM_SETTINGS)).toEqual({ ok: true, value: DEFAULT_BASKETBALL_TEAM_SETTINGS })
    expect(parseBasketballTeamSettings(settings)).toEqual({ ok: true, value: settings })
    expect(parseBasketballPersonalSettings(settings).ok).toBe(false)
  })
  it('requires matching team cache schema and payload while accepting old cache records', () => {
    const old = createBasketballTeamSettingsCacheRecord(DEFAULT_BASKETBALL_TEAM_SETTINGS, { revision: 1, cloudUpdatedAt: null })
    const current = createBasketballTeamSettingsCacheRecord(settings, { revision: 2, cloudUpdatedAt: null })
    expect(old.schemaVersion).toBe(1)
    expect(current.schemaVersion).toBe(2)
    expect(validBasketballTeamSettingsCache(old)).not.toBeNull()
    expect(validBasketballTeamSettingsCache(current)).not.toBeNull()
    expect(validBasketballTeamSettingsCache({ ...current, schemaVersion: 1 })).toBeNull()
    expect(validBasketballTeamSettingsCache({ ...old, schemaVersion: 2 })).toBeNull()
  })
  it('snapshots defaults once and preserves explicit match changes on reconciliation', () => {
    const draft = createBasketballSetupDraft({ accountScope: 'anonymous', source: {
      kind: 'personal', teamName: 'Team', seasonId: null, seasonName: '',
    } })
    const roster = [{ playerId: id, displayName: 'One', number: '2', position: 'PG', initialStatus: 'starter' as const }]
    const seeded = reconcileBasketballSetupTrackedRoster(draft, roster)
    expect(seeded.playerSetup.participants[0]).toMatchObject({ position: 'PG', initialStatus: 'starter' })
    seeded.playerSetup.participants[0].position = 'Point forward'
    const refreshed = reconcileBasketballSetupTrackedRoster(seeded, [{ ...roster[0], position: 'C', initialStatus: 'bench' }])
    expect(refreshed.playerSetup.participants[0]).toMatchObject({ position: 'Point forward', initialStatus: 'starter' })
    expect(basketballVersion3StartSetupFromDraft(refreshed, false)?.participants[0].position).toBe('Point forward')
    expect(draft.playerSetup.participants).toEqual([])
  })
  it('defaults new local players to Bench/Unassigned and rejects invalid persisted positions', () => {
    const draft = createBasketballSetupDraft({ accountScope: 'anonymous', source: {
      kind: 'personal', teamName: 'Team', seasonId: null, seasonName: '',
    } })
    const next = reconcileBasketballSetupTrackedRoster(draft, [{ playerId: id, displayName: 'One', number: null }])
    expect(next.playerSetup.participants[0]).toMatchObject({ position: null, initialStatus: 'bench' })
    expect(parseBasketballSetupDraft(next, 'anonymous').ok).toBe(true)
    delete next.playerSetup.participants[0].position
    expect(parseBasketballSetupDraft(next, 'anonymous').ok).toBe(true)
    next.playerSetup.participants[0].position = 'x'.repeat(81)
    expect(parseBasketballSetupDraft(next, 'anonymous').ok).toBe(false)
  })
})
