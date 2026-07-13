interface LocationParts {
  origin: string
  pathname: string
}

interface OAuthErrorLocationParts {
  search: string
  hash: string
}

export function getOAuthRedirectUrl(location: LocationParts = window.location): string {
  return `${location.origin}${location.pathname}`
}

export function getOAuthReturnError(
  location: OAuthErrorLocationParts = window.location
): string | null {
  const candidates = [
    location.search,
    location.hash.startsWith('#') ? location.hash.slice(1) : location.hash,
  ]

  for (const candidate of candidates) {
    const paramsText = candidate.startsWith('?') ? candidate.slice(1) : candidate
    if (!paramsText) continue

    const queryStart = paramsText.indexOf('?')
    const params = new URLSearchParams(queryStart >= 0 ? paramsText.slice(queryStart + 1) : paramsText)
    const error = params.get('error_description') || params.get('error')
    if (error) return error
  }

  return null
}
