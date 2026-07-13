const OAUTH_RETURN_PATH_KEY = 'statkeeper_oauth_return_path'

function isSafeHashRoute(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//')
}

export function saveOAuthReturnPath(path: string): void {
  if (typeof window === 'undefined' || !isSafeHashRoute(path)) return
  window.localStorage.setItem(OAUTH_RETURN_PATH_KEY, path)
}

export function consumeOAuthReturnPath(): string | null {
  if (typeof window === 'undefined') return null

  const path = window.localStorage.getItem(OAUTH_RETURN_PATH_KEY)
  window.localStorage.removeItem(OAUTH_RETURN_PATH_KEY)

  return path && isSafeHashRoute(path) ? path : null
}

export function clearOAuthReturnPath(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(OAUTH_RETURN_PATH_KEY)
}
