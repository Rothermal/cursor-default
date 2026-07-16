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

/** True when a failed fetch targets the Supabase Data API and should be inspected for access denials. */
export function shouldInspectDataApiAccessDenial(
  ok: boolean,
  requestUrl: string,
  dataApiPrefix: string | null
): boolean {
  return !ok && Boolean(dataApiPrefix && requestUrl.startsWith(dataApiPrefix))
}

/**
 * Shared fetch wrapper for the Supabase client: on Data API failures, emit
 * `APP_ACCESS_DENIED_EVENT` when the body contains an access-denial code.
 */
export function createAppAccessAwareFetch(
  dataApiPrefix: string | null,
  fetchImpl: typeof fetch = fetch
): typeof fetch {
  return async function appAccessAwareFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const response = await fetchImpl(input, init)
    const requestUrl = input instanceof Request ? input.url : String(input)

    if (shouldInspectDataApiAccessDenial(response.ok, requestUrl, dataApiPrefix)) {
      try {
        const denial = appAccessDenialFromText(await response.clone().text())
        if (denial) dispatchAppAccessDenied(denial)
      } catch {
        return response
      }
    }

    return response
  }
}
