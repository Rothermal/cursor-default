export type SettingsSectionId =
  | 'account'
  | 'app'
  | 'sports'
  | 'sport'
  | 'data'
  | 'advanced'

export interface SettingsNavItem {
  id: Exclude<SettingsSectionId, 'sport'>
  label: string
  path: string
}

export const settingsNavItems: SettingsNavItem[] = [
  { id: 'account', label: 'Account', path: '/settings/account' },
  { id: 'app', label: 'App', path: '/settings/app' },
  { id: 'sports', label: 'Sports', path: '/settings/sports' },
  { id: 'data', label: 'Data & Sync', path: '/settings/data' },
  { id: 'advanced', label: 'Advanced', path: '/settings/advanced' },
]

export function settingsPath(section: Exclude<SettingsSectionId, 'sport'>): string {
  return settingsNavItems.find(item => item.id === section)?.path ?? '/settings'
}

export function sportSettingsPath(sportId: string): string {
  return `/settings/sports/${encodeURIComponent(sportId)}`
}

export function resolveSettingsSection(pathname: string): SettingsSectionId {
  if (pathname.startsWith('/settings/account')) return 'account'
  if (pathname.startsWith('/settings/app')) return 'app'
  if (pathname.startsWith('/settings/sports/')) return 'sport'
  if (pathname.startsWith('/settings/sports')) return 'sports'
  if (pathname.startsWith('/settings/data')) return 'data'
  if (pathname.startsWith('/settings/advanced')) return 'advanced'
  return 'account'
}

export function settingsSportIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/settings\/sports\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : null
}
