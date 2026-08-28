export const SETTINGS_STORAGE_KEY = 'statkeeper_settings'

export interface BasketballDeviceSettings {
  eventTrackerPreviewEnabled: boolean
  showClockTenths: boolean
  clockExpirationSoundEnabled: boolean
  clockExpirationVibrationEnabled: boolean
}

export interface AppSettings {
  enabledSports: Record<string, boolean>
  basketball: BasketballDeviceSettings
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
  basketball: {
    eventTrackerPreviewEnabled: false,
    showClockTenths: true,
    clockExpirationSoundEnabled: false,
    clockExpirationVibrationEnabled: false,
  },
  courtCapture: {
    reboundPromptAfterMiss: false,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] =>
      typeof entry[1] === 'boolean'
    )
  )
}

/** Deep-merge partial stored settings onto defaults (missing nested keys stay default). */
export function mergeStoredSettings(parsed: unknown): AppSettings {
  const stored = isRecord(parsed) ? parsed : {}
  const courtCapture = isRecord(stored.courtCapture)
    ? stored.courtCapture
    : {}
  const basketball = isRecord(stored.basketball)
    ? stored.basketball
    : {}

  return {
    enabledSports: {
      ...DEFAULT_SETTINGS.enabledSports,
      ...booleanRecord(stored.enabledSports),
    },
    basketball: {
      eventTrackerPreviewEnabled:
        typeof basketball.eventTrackerPreviewEnabled === 'boolean'
          ? basketball.eventTrackerPreviewEnabled
          : DEFAULT_SETTINGS.basketball.eventTrackerPreviewEnabled,
      showClockTenths:
        typeof basketball.showClockTenths === 'boolean'
          ? basketball.showClockTenths
          : DEFAULT_SETTINGS.basketball.showClockTenths,
      clockExpirationSoundEnabled:
        typeof basketball.clockExpirationSoundEnabled === 'boolean'
          ? basketball.clockExpirationSoundEnabled
          : DEFAULT_SETTINGS.basketball.clockExpirationSoundEnabled,
      clockExpirationVibrationEnabled:
        typeof basketball.clockExpirationVibrationEnabled === 'boolean'
          ? basketball.clockExpirationVibrationEnabled
          : DEFAULT_SETTINGS.basketball.clockExpirationVibrationEnabled,
    },
    courtCapture: {
      reboundPromptAfterMiss:
        typeof courtCapture.reboundPromptAfterMiss === 'boolean'
          ? courtCapture.reboundPromptAfterMiss
          : DEFAULT_SETTINGS.courtCapture.reboundPromptAfterMiss,
    },
  }
}

/** Load settings from localStorage; corrupt/missing values fall back to defaults. */
export function loadSettingsFromStorage(): AppSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      return mergeStoredSettings(parsed)
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_SETTINGS
}
