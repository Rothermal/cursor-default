export const PWA_MAX_PRECACHE_ASSET_BYTES = 3 * 1024 * 1024

/** Keep the configured SDK out of the app chunk; every emitted chunk is still precached. */
export function pwaVendorChunk(moduleId: string): 'supabase' | undefined {
  return moduleId.replace(/\\/g, '/').includes('/node_modules/@supabase/') ? 'supabase' : undefined
}
