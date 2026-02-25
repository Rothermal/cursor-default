import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

const STORAGE_KEY = 'statkeeper_settings'

interface Settings {
  enabledSports: Record<string, boolean>
}

const defaultSettings: Settings = {
  enabledSports: {
    basketball: true,
    baseball: false,
    football: false,
    hockey: false,
    soccer: false,
  },
}

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Settings
      return {
        ...defaultSettings,
        ...parsed,
        enabledSports: { ...defaultSettings.enabledSports, ...parsed.enabledSports },
      }
    }
  } catch {
    // ignore parse errors
  }
  return defaultSettings
}

interface SettingsContextType {
  settings: Settings
  isSportEnabled: (sportId: string) => boolean
  toggleSport: (sportId: string) => void
  setSportEnabled: (sportId: string, enabled: boolean) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const isSportEnabled = useCallback(
    (sportId: string) => settings.enabledSports[sportId] ?? false,
    [settings.enabledSports]
  )

  const toggleSport = useCallback((sportId: string) => {
    setSettings(prev => ({
      ...prev,
      enabledSports: {
        ...prev.enabledSports,
        [sportId]: !prev.enabledSports[sportId],
      },
    }))
  }, [])

  const setSportEnabled = useCallback((sportId: string, enabled: boolean) => {
    setSettings(prev => ({
      ...prev,
      enabledSports: {
        ...prev.enabledSports,
        [sportId]: enabled,
      },
    }))
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, isSportEnabled, toggleSport, setSportEnabled }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
