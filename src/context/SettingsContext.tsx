import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  loadSettingsFromStorage,
  SETTINGS_STORAGE_KEY,
  type AppSettings,
} from '../lib/settingsStorage'
import { useSoccerPersonalSettings } from '../hooks/useSoccerPersonalSettings'
import type { SoccerPersonalSettings } from '../lib/soccer/settings'
import type { SoccerSettingsSyncState } from '../hooks/useSoccerPersonalSettings'

interface SettingsContextType {
  settings: AppSettings
  isSportEnabled: (sportId: string) => boolean
  toggleSport: (sportId: string) => void
  setSportEnabled: (sportId: string, enabled: boolean) => void
  setReboundPromptAfterMissEnabled: (enabled: boolean) => void
  soccerSettings: SoccerPersonalSettings
  soccerSettingsSync: SoccerSettingsSyncState
  saveSoccerSettings: (
    settings: SoccerPersonalSettings,
    expectedRevision?: number | null
  ) => Promise<boolean>
  refreshSoccerSettings: () => Promise<void>
  useCloudSoccerSettings: () => void
  keepDeviceSoccerSettings: () => Promise<void>
  setSoccerSettingsPageActive: (active: boolean) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettingsFromStorage)
  const [soccerSettingsPageActive, setSoccerSettingsPageActive] = useState(false)
  const soccer = useSoccerPersonalSettings(
    Boolean(settings.enabledSports.soccer) || soccerSettingsPageActive
  )

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
        soccerSettings: soccer.settings,
        soccerSettingsSync: soccer.sync,
        saveSoccerSettings: soccer.save,
        refreshSoccerSettings: soccer.refresh,
        useCloudSoccerSettings: soccer.useCloud,
        keepDeviceSoccerSettings: soccer.keepDevice,
        setSoccerSettingsPageActive,
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
