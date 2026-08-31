const LOCAL_BUILD_ID = 'local'
const SAFE_BUILD_ID = /^[A-Za-z0-9._-]{1,80}$/

export function normalizeBuildId(value: unknown): string {
  if (typeof value !== 'string') return LOCAL_BUILD_ID
  const candidate = value.trim()
  return SAFE_BUILD_ID.test(candidate) ? candidate : LOCAL_BUILD_ID
}

export function shortBuildId(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value
}

export const APP_BUILD_ID = normalizeBuildId(import.meta.env.VITE_APP_BUILD_ID)
export const APP_BUILD_LABEL = shortBuildId(APP_BUILD_ID)
