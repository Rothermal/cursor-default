import { describe, expect, it } from 'vitest'
import type { SportSettingsCloudRecord } from '../sportSettingsCloud'
import type { BasketballPersonalSettingsV1 } from './settings'
import {
  basketballSettingsBootstrap,
  basketballSettingsCacheScope,
  basketballSettingsFingerprint,
  createBasketballSettingsCacheRecord,
  reconcileBasketballPersonalSettings,
  validBasketballSettingsCache,
} from './personalSettingsSync'

const now = '2026-08-24T12:00:00.000Z'

function settings(rebound: boolean, flipped = false): BasketballPersonalSettingsV1 {
  return {
    ...basketballSettingsBootstrap(rebound),
    display: { defaultCourtFlipped: flipped },
  }
}

function cloud(
  revision: number,
  value: BasketballPersonalSettingsV1
): SportSettingsCloudRecord<BasketballPersonalSettingsV1> {
  return {
    sportId: 'basketball',
    schemaVersion: 1,
    revision,
    settings: value,
    updatedAt: now,
    updatedBy: null,
  }
}

describe('personal Basketball settings reconciliation', () => {
  it('uses established cloud settings instead of the legacy bootstrap', () => {
    const result = reconcileBasketballPersonalSettings(
      null,
      cloud(2, settings(false, true)),
      settings(true),
      now
    )
    expect(result.action).toBe('use_cloud')
    if (result.action === 'use_cloud') {
      expect(result.settings.capture.reboundPromptAfterMiss).toBe(false)
      expect(result.settings.display.defaultCourtFlipped).toBe(true)
    }
  })

  it('seeds a missing authenticated row from the legacy rebound value', () => {
    expect(reconcileBasketballPersonalSettings(null, null, settings(true))).toMatchObject({
      action: 'upload_local',
      expectedRevision: null,
      settings: { capture: { reboundPromptAfterMiss: true } },
    })
  })

  it('uploads pending edits only from their matching cloud revision', () => {
    const local = createBasketballSettingsCacheRecord(settings(true), {
      revision: 2,
      pending: { baseRevision: 2 },
      cloudUpdatedAt: now,
      now,
    })
    expect(reconcileBasketballPersonalSettings(local, cloud(2, settings(false)), settings(false)).action)
      .toBe('upload_local')
    expect(reconcileBasketballPersonalSettings(local, cloud(3, settings(false)), settings(false)).action)
      .toBe('conflict')
  })

  it('fails closed on unsupported cloud data while retaining coherent local settings', () => {
    const local = createBasketballSettingsCacheRecord(settings(true), {
      revision: 4,
      pending: null,
      cloudUpdatedAt: now,
      now,
    })
    const result = reconcileBasketballPersonalSettings(local, {
      ...cloud(5, settings(false)),
      schemaVersion: 2,
    }, settings(false))
    expect(result).toMatchObject({
      action: 'invalid_cloud',
      revision: 5,
      settings: { capture: { reboundPromptAfterMiss: true } },
    })
  })

  it('fingerprints equivalent settings independently of key order', () => {
    const original = settings(true, true)
    const reordered = reorderObjectKeys(original)
    expect(basketballSettingsFingerprint(original)).toBe(
      basketballSettingsFingerprint(reordered as BasketballPersonalSettingsV1)
    )
  })

  it('keeps anonymous and authenticated cache scopes separate', () => {
    expect(basketballSettingsCacheScope(null)).toEqual({ kind: 'anonymous' })
    expect(basketballSettingsCacheScope('user-1')).toEqual({
      kind: 'user',
      userId: 'user-1',
    })
  })

  it('rejects unsupported or wrong-sport cache records', () => {
    const cache = createBasketballSettingsCacheRecord(settings(true), {
      revision: null,
      pending: null,
      cloudUpdatedAt: null,
      now,
    })
    expect(validBasketballSettingsCache(cache)?.settings.capture.reboundPromptAfterMiss)
      .toBe(true)
    expect(validBasketballSettingsCache({ ...cache, schemaVersion: 2 })).toBeNull()
    expect(validBasketballSettingsCache({ ...cache, sportId: 'soccer' })).toBeNull()
  })
})

function reorderObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderObjectKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reorderObjectKeys(item)])
  )
}
