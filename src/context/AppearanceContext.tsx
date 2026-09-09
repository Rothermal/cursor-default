import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

import { resolveAppearanceRuntime, type AppearanceSnapshot, type AppearanceRuntime } from '../lib/appearanceRuntime'
const AppearanceContext = createContext<(AppearanceSnapshot & { setTheme: AppearanceRuntime['setTheme'] }) | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const runtime = resolveAppearanceRuntime(window.statkeeperAppearance)
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  return <AppearanceContext.Provider value={{ ...snapshot, setTheme: runtime.setTheme }}>{children}</AppearanceContext.Provider>
}

// Shared hook intentionally lives with its small provider contract.
// eslint-disable-next-line react-refresh/only-export-components
export function useAppearance() {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('AppearanceProvider is required')
  return context
}
