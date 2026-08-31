import { describe, expect, it } from 'vitest'
import { normalizeBuildId, shortBuildId } from './buildInfo'

describe('build identifier presentation', () => {
  it('accepts deploy-safe identifiers and trims their display', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    expect(normalizeBuildId(` ${sha} `)).toBe(sha)
    expect(shortBuildId(sha)).toBe('0123456789ab')
    expect(shortBuildId('release-6e2')).toBe('release-6e2')
  })

  it('does not display absent, oversized, or unsafe environment values', () => {
    expect(normalizeBuildId(undefined)).toBe('local')
    expect(normalizeBuildId('')).toBe('local')
    expect(normalizeBuildId('secret value')).toBe('local')
    expect(normalizeBuildId('a'.repeat(81))).toBe('local')
  })
})
