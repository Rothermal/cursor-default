export const PWA_MAX_PRECACHE_ASSET_BYTES = 3 * 1024 * 1024
export const PWA_PRECACHE_WARNING_RATIO = 0.9

export function pwaPrecacheHeadroomWarning(fileName: string, bytes: number): string | null {
  if (bytes < PWA_MAX_PRECACHE_ASSET_BYTES * PWA_PRECACHE_WARNING_RATIO) return null
  const remaining = PWA_MAX_PRECACHE_ASSET_BYTES - bytes
  const usage = (bytes / PWA_MAX_PRECACHE_ASSET_BYTES * 100).toFixed(1)
  const headroom = remaining >= 0 ? `${remaining} bytes remain` : `${-remaining} bytes over the limit`
  return `${fileName}: ${bytes} bytes (${usage}% of the ${PWA_MAX_PRECACHE_ASSET_BYTES}-byte PWA precache limit); ${headroom}. Plan route-level code splitting before further bundle growth. The hard precache limit remains enforced.`
}

/** Keep the configured SDK out of the app chunk; every emitted chunk is still precached. */
export function pwaVendorChunk(moduleId: string): 'supabase' | undefined {
  return moduleId.replace(/\\/g, '/').includes('/node_modules/@supabase/') ? 'supabase' : undefined
}
