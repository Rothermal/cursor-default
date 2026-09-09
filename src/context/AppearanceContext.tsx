import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

type Theme = 'light' | 'dark'
interface Snapshot { theme: Theme; error: string | null }
interface AppearanceRuntime {
  getSnapshot: () => Snapshot
  subscribe: (listener: () => void) => () => void
  setTheme: (theme: Theme) => void
}
declare global { interface Window { statkeeperAppearance: AppearanceRuntime } }
const AppearanceContext = createContext<(Snapshot & { setTheme: AppearanceRuntime['setTheme'] }) | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const runtime = window.statkeeperAppearance
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
