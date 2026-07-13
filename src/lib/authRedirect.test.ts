import { describe, expect, it } from 'vitest'
import { getOAuthRedirectUrl, getOAuthReturnError } from './authRedirect'

describe('getOAuthRedirectUrl', () => {
  it('keeps local dev on the app base path', () => {
    expect(getOAuthRedirectUrl({ origin: 'http://localhost:5173', pathname: '/' })).toBe(
      'http://localhost:5173/'
    )
  })

  it('preserves the GitHub Pages project path', () => {
    expect(
      getOAuthRedirectUrl({
        origin: 'https://rothermal.github.io',
        pathname: '/cursor-default/',
      })
    ).toBe('https://rothermal.github.io/cursor-default/')
  })

  it('preserves a GitHub Pages project path without a trailing slash', () => {
    expect(
      getOAuthRedirectUrl({
        origin: 'https://rothermal.github.io',
        pathname: '/cursor-default',
      })
    ).toBe('https://rothermal.github.io/cursor-default')
  })
})

describe('getOAuthReturnError', () => {
  it('reads PKCE OAuth errors from query params', () => {
    expect(
      getOAuthReturnError({
        search: '?error=access_denied&error_description=Login+canceled',
        hash: '',
      })
    ).toBe('Login canceled')
  })

  it('reads implicit OAuth errors from hash params', () => {
    expect(
      getOAuthReturnError({
        search: '',
        hash: '#error=server_error&error_description=Provider+failed',
      })
    ).toBe('Provider failed')
  })

  it('returns null when no OAuth error is present', () => {
    expect(getOAuthReturnError({ search: '', hash: '#/sports' })).toBeNull()
  })
})
