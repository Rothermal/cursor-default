import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PWA_MAX_PRECACHE_ASSET_BYTES, PWA_PRECACHE_WARNING_RATIO, pwaPrecacheHeadroomWarning, pwaPrecacheWarningAnnotation, pwaVendorChunk } from './pwaBuildPolicy'

describe('configured production PWA bundle policy', () => {
  it.each([
    '/repo/node_modules/@supabase/supabase-js/dist/module/index.js',
    '/repo/node_modules/.pnpm/@supabase+auth-js@2/node_modules/@supabase/auth-js/dist/module/index.js',
    'C:\\repo\\node_modules\\@supabase\\postgrest-js\\dist\\index.js',
  ])('splits SDK modules for %s', id => {
    expect(pwaVendorChunk(id)).toBe('supabase')
  })
  it.each(['/repo/src/lib/supabase.ts', '/repo/node_modules/react/index.js', '/repo/src/@supabase/example.ts'])('leaves non-SDK placement unchanged for %s', id => {
    expect(pwaVendorChunk(id)).toBeUndefined()
  })
  it('wires the existing budget, split and offline policy into the build config', () => {
    const config = readFileSync('vite.config.ts', 'utf8')
    expect(PWA_MAX_PRECACHE_ASSET_BYTES).toBe(3 * 1024 * 1024)
    expect(config).toContain('manualChunks: pwaVendorChunk')
    expect(config).toContain('maximumFileSizeToCacheInBytes: PWA_MAX_PRECACHE_ASSET_BYTES')
    expect(config).toContain("globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']")
    expect(config).toContain("registerType: 'prompt'")
  })
  it('wires public placeholders into PR CI without production secrets', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(ci).toContain('VITE_SUPABASE_URL: https://example.supabase.co')
    expect(ci).toContain('VITE_SUPABASE_ANON_KEY: ci-public-placeholder-key')
    expect(ci).not.toContain('secrets.VITE_SUPABASE')
  })
  it('does not warn below the 90% early-warning threshold', () => {
    expect(PWA_PRECACHE_WARNING_RATIO).toBe(0.9)
    expect(pwaPrecacheHeadroomWarning('assets/index.js', Math.floor(PWA_MAX_PRECACHE_ASSET_BYTES * 0.9))).toBeNull()
  })
  it('warns at the first whole byte reaching 90% without changing the hard limit', () => {
    const bytes = Math.ceil(PWA_MAX_PRECACHE_ASSET_BYTES * 0.9)
    const warning = pwaPrecacheHeadroomWarning('assets/index.js', bytes)
    expect(warning).toContain('assets/index.js')
    expect(warning).toContain('(90.0%')
    expect(warning).toContain(`${PWA_MAX_PRECACHE_ASSET_BYTES - bytes} bytes remain`)
    expect(warning).toContain('hard precache limit remains enforced')
    expect(PWA_MAX_PRECACHE_ASSET_BYTES).toBe(3 * 1024 * 1024)
  })
  it('reports measured configured-build headroom in bytes', () => {
    expect(pwaPrecacheHeadroomWarning('assets/index.js', 2_997_025)).toContain('148703 bytes remain')
  })
  it.each([0, 1])('still warns at or over the hard limit by %s bytes', over => {
    const warning = pwaPrecacheHeadroomWarning('assets/index.js', PWA_MAX_PRECACHE_ASSET_BYTES + over)
    expect(warning).toContain(over === 0 ? '0 bytes remain' : '1 bytes over the limit')
  })
  it.each([undefined, '', 'false', '1'])('does not emit an Actions annotation when GITHUB_ACTIONS is %s', githubActions => {
    expect(pwaPrecacheWarningAnnotation('Headroom warning', githubActions)).toBeNull()
  })
  it('formats the headroom warning as an Actions warning annotation', () => {
    const warning = pwaPrecacheHeadroomWarning('assets/index.js', PWA_MAX_PRECACHE_ASSET_BYTES)!
    expect(pwaPrecacheWarningAnnotation(warning, 'true')).toBe(`::warning title=PWA precache headroom::${warning.replace(/%/g, '%25')}`)
  })
  it('escapes command data so a message cannot inject additional workflow commands', () => {
    expect(pwaPrecacheWarningAnnotation('95.3%\r\n::error::not a command\n%0A', 'true')).toBe(
      '::warning title=PWA precache headroom::95.3%25%0D%0A::error::not a command%0A%250A',
    )
  })
})
