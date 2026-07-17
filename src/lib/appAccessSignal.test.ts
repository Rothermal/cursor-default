import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_ACCESS_DENIED_EVENT,
  appAccessDenialFromText,
  createAppAccessAwareFetch,
  shouldInspectDataApiAccessDenial,
} from './appAccessSignal'

describe('appAccessDenialFromText', () => {
  it('recognizes access denials in PostgREST response bodies', () => {
    expect(appAccessDenialFromText('{"message":"APP_ACCESS_PENDING"}'))
      .toBe('APP_ACCESS_PENDING')
    expect(appAccessDenialFromText('{"message":"APP_ACCESS_SUSPENDED"}'))
      .toBe('APP_ACCESS_SUSPENDED')
    expect(appAccessDenialFromText('{"message":"APP_ACCESS_UNAVAILABLE"}'))
      .toBe('APP_ACCESS_UNAVAILABLE')
  })

  it('ignores unrelated Data API errors', () => {
    expect(appAccessDenialFromText('{"message":"Team access denied"}')).toBeNull()
  })
})

describe('shouldInspectDataApiAccessDenial', () => {
  const prefix = 'https://example.supabase.co/rest/v1/'

  it('only inspects failed Data API responses', () => {
    expect(shouldInspectDataApiAccessDenial(false, `${prefix}games`, prefix)).toBe(true)
    expect(shouldInspectDataApiAccessDenial(true, `${prefix}games`, prefix)).toBe(false)
    expect(shouldInspectDataApiAccessDenial(false, 'https://other.example/rest/v1/games', prefix)).toBe(false)
    expect(shouldInspectDataApiAccessDenial(false, `${prefix}games`, null)).toBe(false)
  })
})

describe('createAppAccessAwareFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('dispatches APP_ACCESS_DENIED_EVENT for Data API denial bodies', async () => {
    const prefix = 'https://example.supabase.co/rest/v1/'
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'APP_ACCESS_SUSPENDED' }), { status: 403 })
    )
    const listener = vi.fn()
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        listener(event)
        return true
      },
    })

    const response = await createAppAccessAwareFetch(prefix, fetchImpl)(
      `${prefix}games?select=*`,
      { method: 'GET' }
    )

    expect(response.status).toBe(403)
    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0] as CustomEvent<string>
    expect(event.type).toBe(APP_ACCESS_DENIED_EVENT)
    expect(event.detail).toBe('APP_ACCESS_SUSPENDED')
  })

  it('does not inspect successful responses or non-Data-API URLs', async () => {
    const prefix = 'https://example.supabase.co/rest/v1/'
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/v1/')) {
        return new Response(JSON.stringify({ message: 'APP_ACCESS_PENDING' }), { status: 403 })
      }
      return new Response('{"ok":true}', { status: 200 })
    })
    const listener = vi.fn()
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        listener(event)
        return true
      },
    })

    const awareFetch = createAppAccessAwareFetch(prefix, fetchImpl)
    await awareFetch(`${prefix}games?select=*`)
    await awareFetch('https://example.supabase.co/auth/v1/user')

    expect(listener).not.toHaveBeenCalled()
  })

  it('returns the original response when body cloning fails', async () => {
    const prefix = 'https://example.supabase.co/rest/v1/'
    const broken = {
      ok: false,
      status: 403,
      clone() {
        throw new Error('clone failed')
      },
    } as unknown as Response
    const fetchImpl = vi.fn(async () => broken)
    const listener = vi.fn()
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        listener(event)
        return true
      },
    })

    const response = await createAppAccessAwareFetch(prefix, fetchImpl)(`${prefix}teams`)
    expect(response).toBe(broken)
    expect(listener).not.toHaveBeenCalled()
  })
})
