import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_SETTINGS,
  loadSettingsFromStorage,
  mergeStoredSettings,
  SETTINGS_STORAGE_KEY,
} from './settingsStorage'

describe('mergeStoredSettings', () => {
  it('fills missing nested keys from defaults', () => {
    const merged = mergeStoredSettings({
      enabledSports: { basketball: false },
    })
    expect(merged.enabledSports.basketball).toBe(false)
    expect(merged.enabledSports.baseball).toBe(false)
    expect(merged.basketball.eventTrackerPreviewEnabled).toBe(false)
    expect(merged.basketball.showClockTenths).toBe(true)
    expect(merged.basketball.clockExpirationSoundEnabled).toBe(false)
    expect(merged.basketball.clockExpirationVibrationEnabled).toBe(false)
    expect(merged.courtCapture.reboundPromptAfterMiss).toBe(false)
  })

  it('preserves courtCapture overrides', () => {
    const merged = mergeStoredSettings({
      courtCapture: { reboundPromptAfterMiss: true },
    })
    expect(merged.courtCapture.reboundPromptAfterMiss).toBe(true)
    expect(merged.enabledSports).toEqual(DEFAULT_SETTINGS.enabledSports)
  })

  it('rejects malformed nested settings instead of treating them as enabled', () => {
    const merged = mergeStoredSettings({
      enabledSports: {
        basketball: 1,
        soccer: 'yes',
        futureSport: true,
      },
      courtCapture: {
        reboundPromptAfterMiss: 'yes',
        eventTrackerPreviewEnabled: true,
      },
      basketball: {
        eventTrackerPreviewEnabled: 'true',
        showClockTenths: 'yes',
        clockExpirationSoundEnabled: 1,
        clockExpirationVibrationEnabled: null,
      },
    })

    expect(merged.enabledSports.basketball).toBe(true)
    expect(merged.enabledSports.soccer).toBe(false)
    expect(merged.enabledSports.futureSport).toBe(true)
    expect(merged.basketball.eventTrackerPreviewEnabled).toBe(false)
    expect(merged.basketball.showClockTenths).toBe(true)
    expect(merged.basketball.clockExpirationSoundEnabled).toBe(false)
    expect(merged.basketball.clockExpirationVibrationEnabled).toBe(false)
    expect(merged.courtCapture.reboundPromptAfterMiss).toBe(false)
  })

  it('keeps the Basketball Event preview in its exact device-only namespace', () => {
    const merged = mergeStoredSettings({
      basketball: {
        eventTrackerPreviewEnabled: true,
        showClockTenths: false,
        clockExpirationSoundEnabled: true,
        clockExpirationVibrationEnabled: true,
      },
      courtCapture: {
        reboundPromptAfterMiss: true,
        eventTrackerPreviewEnabled: false,
      },
    })

    expect(merged.basketball.eventTrackerPreviewEnabled).toBe(true)
    expect(merged.basketball).toMatchObject({
      showClockTenths: false,
      clockExpirationSoundEnabled: true,
      clockExpirationVibrationEnabled: true,
    })
    expect(merged.courtCapture).toEqual({ reboundPromptAfterMiss: true })
  })

  it.each([null, [], 'settings', 3])(
    'returns defaults for a non-object stored value: %j',
    stored => {
      expect(mergeStoredSettings(stored)).toEqual(DEFAULT_SETTINGS)
    }
  )
})

describe('loadSettingsFromStorage', () => {
  const original = globalThis.localStorage

  beforeEach(() => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v)
        },
        removeItem: (k: string) => {
          store.delete(k)
        },
        clear: () => store.clear(),
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: original,
    })
  })

  it('returns defaults when nothing saved', () => {
    expect(loadSettingsFromStorage()).toEqual(DEFAULT_SETTINGS)
  })

  it('merges saved JSON over defaults', () => {
    const saved = {
      enabledSports: { hockey: true },
      basketball: {
        eventTrackerPreviewEnabled: true,
        showClockTenths: false,
        clockExpirationSoundEnabled: true,
        clockExpirationVibrationEnabled: true,
      },
      courtCapture: { reboundPromptAfterMiss: true },
    }
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(saved))
    const loaded = loadSettingsFromStorage()
    expect(loaded.enabledSports.hockey).toBe(true)
    expect(loaded.enabledSports.basketball).toBe(true)
    expect(loaded.basketball.eventTrackerPreviewEnabled).toBe(true)
    expect(loaded.basketball.showClockTenths).toBe(false)
    expect(loaded.basketball.clockExpirationSoundEnabled).toBe(true)
    expect(loaded.basketball.clockExpirationVibrationEnabled).toBe(true)
    expect(loaded.courtCapture.reboundPromptAfterMiss).toBe(true)
  })

  it('returns defaults on corrupt JSON', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not-json')
    expect(loadSettingsFromStorage()).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps Soccer disabled for syntactically valid malformed JSON', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ enabledSports: { soccer: 'true' } })
    )
    expect(loadSettingsFromStorage().enabledSports.soccer).toBe(false)
  })
})
