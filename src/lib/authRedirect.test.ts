import { describe, expect, it } from 'vitest'
import { getOAuthRedirectUrl } from './authRedirect'

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
})
