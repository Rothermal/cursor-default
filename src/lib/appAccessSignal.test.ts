import { describe, expect, it } from 'vitest'
import { appAccessDenialFromText } from './appAccessSignal'

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
