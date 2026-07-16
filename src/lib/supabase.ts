import { createClient } from '@supabase/supabase-js'
import { appAccessDenialFromText, dispatchAppAccessDenied } from './appAccessSignal'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY

const dataApiPrefix = supabaseUrl
  ? `${supabaseUrl.replace(/\/$/, '')}/rest/v1/`
  : null

async function appAccessAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init)
  const requestUrl = input instanceof Request ? input.url : String(input)

  if (!response.ok && dataApiPrefix && requestUrl.startsWith(dataApiPrefix)) {
    try {
      const denial = appAccessDenialFromText(await response.clone().text())
      if (denial) dispatchAppAccessDenied(denial)
    } catch {
      return response
    }
  }

  return response
}

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
