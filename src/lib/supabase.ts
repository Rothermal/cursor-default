import { createClient } from '@supabase/supabase-js'
import { createAppAccessAwareFetch } from './appAccessSignal'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY

const dataApiPrefix = supabaseUrl
  ? `${supabaseUrl.replace(/\/$/, '')}/rest/v1/`
  : null

const appAccessAwareFetch = createAppAccessAwareFetch(dataApiPrefix)

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[StatKeeper] Supabase credentials not found. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env. Running in offline-only mode.'
  )
} else {
  console.log('[StatKeeper] Supabase connected:', supabaseUrl, '| key length:', supabaseKey.length)
}

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
      },
      global: {
        fetch: appAccessAwareFetch,
      },
    })
  : null

export const isSupabaseConfigured = (): boolean => supabase !== null
