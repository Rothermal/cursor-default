export type AppAccessDenial =
  | 'APP_ACCESS_PENDING'
  | 'APP_ACCESS_SUSPENDED'
  | 'APP_ACCESS_UNAVAILABLE'

export const APP_ACCESS_DENIED_EVENT = 'statkeeper:app-access-denied'

const accessDenials: AppAccessDenial[] = [
  'APP_ACCESS_PENDING',
  'APP_ACCESS_SUSPENDED',
  'APP_ACCESS_UNAVAILABLE',
]

export function appAccessDenialFromText(value: string): AppAccessDenial | null {
  return accessDenials.find(code => value.includes(code)) ?? null
}

export function dispatchAppAccessDenied(denial: AppAccessDenial): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AppAccessDenial>(APP_ACCESS_DENIED_EVENT, {
    detail: denial,
  }))
}
