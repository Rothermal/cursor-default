export function isSportWorkspaceAvailable(
  sportId: string,
  enabledInSettings: boolean,
  development = import.meta.env.DEV
): boolean {
  if (sportId === 'soccer') return development
  return enabledInSettings
}
