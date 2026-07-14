import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  loadSettingsFromStorage,
  SETTINGS_STORAGE_KEY,
  type AppSettings,
} from '../lib/settingsStorage'

interface SettingsContextType {
  settings: AppSettings
  isSportEnabled: (sportId: string) => boolean
  toggleSport: (sportId: string) => void
  setSportEnabled: (sportId: string, enabled: boolean) => void
  setReboundPromptAfterMissEnabled: (enabled: boolean) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettingsFromStorage)

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
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

  const setReboundPromptAfterMissEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({
      ...prev,
      courtCapture: {
        ...prev.courtCapture,
        reboundPromptAfterMiss: enabled,
      },
    }))
  }, [])

  return (
    <SettingsContext.Provider
      value={{
        settings,
        isSportEnabled,
        toggleSport,
        setSportEnabled,
        setReboundPromptAfterMissEnabled,
      }}
    >
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
