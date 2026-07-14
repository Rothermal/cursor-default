export const SETTINGS_STORAGE_KEY = 'statkeeper_settings'

export interface AppSettings {
  enabledSports: Record<string, boolean>
  courtCapture: {
    reboundPromptAfterMiss: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  enabledSports: {
    basketball: true,
    baseball: false,
    football: false,
    hockey: false,
    soccer: false,
  },
  courtCapture: {
    reboundPromptAfterMiss: false,
  },
}

/** Deep-merge partial stored settings onto defaults (missing nested keys stay default). */
export function mergeStoredSettings(parsed: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    enabledSports: { ...DEFAULT_SETTINGS.enabledSports, ...parsed.enabledSports },
    courtCapture: { ...DEFAULT_SETTINGS.courtCapture, ...parsed.courtCapture },
  }
}

/** Load settings from localStorage; corrupt/missing values fall back to defaults. */
export function loadSettingsFromStorage(): AppSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<AppSettings>
      return mergeStoredSettings(parsed)
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_SETTINGS
}
