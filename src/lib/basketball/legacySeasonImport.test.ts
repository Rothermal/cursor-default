import { describe, expect, it } from 'vitest'
import { previewBasketballLegacySeasonImport } from './legacySeasonImport'

const nfhs = { profileId: 'nfhs' as const, profileVersion: 1 }

describe('Basketball legacy season import', () => {
  it('maps provable legacy values into a complete reviewed structural override', () => {
    const result = previewBasketballLegacySeasonImport({
      periodsPerGame: 4,
      periodLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeLabel: 'OT',
      overtimeFoulsReset: false,
      timeoutsPerPeriod: 2,
      timeoutsPerOvertime: 1,
    }, nfhs)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.settings.baseProfile).toEqual(nfhs)
    expect(result.settings.ruleOverrides.regulationSegments?.[0]).toMatchObject({
      id: 'regulation-1',
      label: 'Q1',
      foulWindowId: 'legacy-foul-1',
    })
    expect(result.settings.ruleOverrides.foulWindows?.[0]).toMatchObject({
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
    })
    expect(result.settings.ruleOverrides.timeoutPools?.[0]).toMatchObject({
      totalLimit: 2,
      fullLimit: null,
      shortLimit: null,
    })
    expect(result.settings.ruleOverrides.overtimeTemplate).toMatchObject({
      foulPolicy: { mode: 'shared_overtimes' },
      timeoutPolicy: { mode: 'new_each', pool: { totalLimit: 1 } },
    })
  })

  it('uses explicit legacy defaults without inferring a governing profile', () => {
    const nfhsResult = previewBasketballLegacySeasonImport(null, nfhs)
    const nbaResult = previewBasketballLegacySeasonImport(null, {
      profileId: 'nba',
      profileVersion: 1,
    })
    expect(nfhsResult.ok).toBe(true)
    expect(nbaResult.ok).toBe(true)
    if (!nfhsResult.ok || !nbaResult.ok) throw new Error('Import preview failed.')
    expect(nfhsResult.settings.baseProfile).toEqual(nfhs)
    expect(nbaResult.settings.baseProfile).toEqual({ profileId: 'nba', profileVersion: 1 })
    expect(nfhsResult.settings.ruleOverrides.regulationSegments?.[0].durationMs).not.toBe(
      nbaResult.settings.ruleOverrides.regulationSegments?.[0].durationMs
    )
    expect(nfhsResult.legacyDefaultedFields).toContain('periodsPerGame')
  })

  it('keeps eight legacy periods distinct with independent foul and timeout windows', () => {
    const result = previewBasketballLegacySeasonImport({
      periodsPerGame: 8,
      periodLabels: Array.from({ length: 8 }, (_, index) => `P${index + 1}`),
    }, { profileId: 'youth_equal_play', profileVersion: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.settings.ruleOverrides.regulationSegments).toHaveLength(8)
    expect(result.settings.ruleOverrides.foulWindows).toHaveLength(8)
    expect(result.settings.ruleOverrides.timeoutPools).toHaveLength(8)
  })

  it('rejects invalid legacy values instead of silently importing them', () => {
    expect(previewBasketballLegacySeasonImport({
      periodsPerGame: 4,
      periodLabels: ['Q1'],
    }, nfhs)).toMatchObject({ ok: false })
    expect(previewBasketballLegacySeasonImport({
      bonusThreshold: 10,
      doubleBonusThreshold: 5,
    }, nfhs)).toMatchObject({ ok: false })
    expect(previewBasketballLegacySeasonImport({}, {
      profileId: 'nfhs',
      profileVersion: 99,
    })).toMatchObject({ ok: false })
  })

  it('returns cloned settings on repeated previews', () => {
    const first = previewBasketballLegacySeasonImport({}, nfhs)
    const second = previewBasketballLegacySeasonImport({}, nfhs)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('Import preview failed.')
    expect(first.settings).toEqual(second.settings)
    expect(first.settings).not.toBe(second.settings)
  })
})
