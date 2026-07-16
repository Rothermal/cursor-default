import { describe, expect, it } from 'vitest'
import {
  buildTeamInviteUrl,
  normalizeTeamInviteToken,
  teamInvitePath,
} from './teamInviteLinks'

const TOKEN = 'a'.repeat(64)

describe('teamInviteLinks', () => {
  it('normalizes valid URL-safe tokens', () => {
    expect(normalizeTeamInviteToken(`  ${TOKEN.toUpperCase()}  `)).toBe(TOKEN)
    expect(normalizeTeamInviteToken('short')).toBeNull()
    expect(normalizeTeamInviteToken('g'.repeat(64))).toBeNull()
    expect(normalizeTeamInviteToken(null)).toBeNull()
  })

  it('builds HashRouter paths and deployed URLs', () => {
    expect(teamInvitePath(TOKEN)).toBe(`/invite/${TOKEN}`)
    expect(
      buildTeamInviteUrl(TOKEN, {
        origin: 'https://rothermal.github.io',
        pathname: '/cursor-default/',
      })
    ).toBe(`https://rothermal.github.io/cursor-default/#/invite/${TOKEN}`)
  })
})
