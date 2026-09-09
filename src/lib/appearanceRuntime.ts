export type Theme = 'light' | 'dark'
export interface AppearanceSnapshot { theme: Theme; error: string | null }
export interface AppearanceRuntime {
  getSnapshot: () => AppearanceSnapshot
  subscribe: (listener: () => void) => () => void
  setTheme: (theme: Theme) => void
}
declare global { interface Window { statkeeperAppearance?: AppearanceRuntime } }

const fallbackSnapshot: AppearanceSnapshot = { theme: 'light', error: 'Appearance controls are unavailable. Reload to retry.' }
const fallbackRuntime: AppearanceRuntime = {
  getSnapshot: () => fallbackSnapshot,
  subscribe: () => () => {},
  setTheme: () => {},
}

export function resolveAppearanceRuntime(runtime?: AppearanceRuntime): AppearanceRuntime {
  return runtime ?? fallbackRuntime
}
