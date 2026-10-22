import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PWA_MAX_PRECACHE_ASSET_BYTES, pwaVendorChunk } from './pwaBuildPolicy'

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
  it('preserves the existing size budget and precaches the split chunks', () => {
    const config = readFileSync('vite.config.ts', 'utf8')
    expect(PWA_MAX_PRECACHE_ASSET_BYTES).toBe(3 * 1024 * 1024)
    expect(config).toContain('manualChunks: pwaVendorChunk')
    expect(config).toContain('maximumFileSizeToCacheInBytes: PWA_MAX_PRECACHE_ASSET_BYTES')
    expect(config).toContain("globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']")
    expect(config).toContain("registerType: 'prompt'")
  })
  it('makes PR CI include the SDK branch without production secrets', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(ci).toContain('VITE_SUPABASE_URL: https://example.supabase.co')
    expect(ci).toContain('VITE_SUPABASE_ANON_KEY: ci-public-placeholder-key')
    expect(ci).not.toContain('secrets.VITE_SUPABASE')
  })
})
