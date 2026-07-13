interface LocationParts {
  origin: string
  pathname: string
}

export function getOAuthRedirectUrl(location: LocationParts = window.location): string {
  return `${location.origin}${location.pathname}`
}
