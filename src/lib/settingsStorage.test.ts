import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_SETTINGS,
  loadSettingsFromStorage,
  mergeStoredSettings,
  SETTINGS_STORAGE_KEY,
  type AppSettings,
} from './settingsStorage'

describe('mergeStoredSettings', () => {
  it('fills missing nested keys from defaults', () => {
    const merged = mergeStoredSettings({
      enabledSports: { basketball: false },
    })
    expect(merged.enabledSports.basketball).toBe(false)
    expect(merged.enabledSports.baseball).toBe(false)
    expect(merged.courtCapture.reboundPromptAfterMiss).toBe(false)
  })

  it('preserves courtCapture overrides', () => {
    const merged = mergeStoredSettings({
      courtCapture: { reboundPromptAfterMiss: true },
    })
    expect(merged.courtCapture.reboundPromptAfterMiss).toBe(true)
    expect(merged.enabledSports).toEqual(DEFAULT_SETTINGS.enabledSports)
  })
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
    const saved: Partial<AppSettings> = {
      enabledSports: { hockey: true },
      courtCapture: { reboundPromptAfterMiss: true },
    }
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(saved))
    const loaded = loadSettingsFromStorage()
    expect(loaded.enabledSports.hockey).toBe(true)
    expect(loaded.enabledSports.basketball).toBe(true)
    expect(loaded.courtCapture.reboundPromptAfterMiss).toBe(true)
  })

  it('returns defaults on corrupt JSON', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not-json')
    expect(loadSettingsFromStorage()).toEqual(DEFAULT_SETTINGS)
  })
})
