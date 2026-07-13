import type { User } from '@supabase/supabase-js'
import { getOAuthRedirectUrl } from './authRedirect'
import { clearOAuthReturnPath, saveOAuthReturnPath } from './oauthReturnPath'
import { supabase } from './supabase'

export interface AccountProfile {
  id: string
  email: string | null
  displayName: string
  avatarUrl: string | null
}

interface ProfileRow {
  id: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
}

function metadataString(user: User, key: string): string | null {
  const value = user.user_metadata?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function displayNameFallback(user: User): string {
  return (
    metadataString(user, 'display_name') ??
    metadataString(user, 'full_name') ??
    metadataString(user, 'name') ??
    user.email?.split('@')[0] ??
    'StatKeeper user'
  )
}

function rowToProfile(row: ProfileRow, user: User): AccountProfile {
  return {
    id: row.id,
    email: row.email ?? user.email ?? null,
    displayName: row.display_name?.trim() || displayNameFallback(user),
    avatarUrl: row.avatar_url ?? metadataString(user, 'avatar_url') ?? null,
  }
}

function accountErrorMessage(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('manual') && normalized.includes('link')) {
    return 'Google linking is not enabled for this Supabase project yet.'
  }
  if (normalized.includes('identity') && normalized.includes('link')) {
    return 'Google linking could not start. Check the Supabase identity-linking settings.'
  }
  return message
}

export async function loadCurrentAccountProfile(user: User): Promise<{
  profile: AccountProfile | null
  error: string | null
}> {
  if (!supabase) return { profile: null, error: 'Supabase not configured' }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, email, avatar_url')
    .eq('id', user.id)
    .maybeSingle()

  if (error) return { profile: null, error: error.message }

  if (data) {
    return { profile: rowToProfile(data as ProfileRow, user), error: null }
  }

  const repairRow = {
    id: user.id,
    email: user.email ?? null,
    display_name: displayNameFallback(user),
    avatar_url: metadataString(user, 'avatar_url'),
  }

  const { data: repairedData, error: repairError } = await supabase
    .from('profiles')
    .upsert(repairRow, { onConflict: 'id' })
    .select('id, display_name, email, avatar_url')
    .single()

  if (repairError) return { profile: null, error: repairError.message }

  return { profile: rowToProfile(repairedData as ProfileRow, user), error: null }
}

export function validateDisplayName(displayName: string): string | null {
  const trimmed = displayName.trim()
  if (!trimmed) return 'Display name is required.'
  if (trimmed.length > 80) return 'Display name must be 80 characters or fewer.'
  return null
}

export async function updateCurrentAccountDisplayName(
  user: User,
  displayName: string
): Promise<{ profile: AccountProfile | null; error: string | null }> {
  if (!supabase) return { profile: null, error: 'Supabase not configured' }

  const validationError = validateDisplayName(displayName)
  if (validationError) return { profile: null, error: validationError }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      display_name: displayName.trim(),
      email: user.email ?? null,
    }, { onConflict: 'id' })
    .select('id, display_name, email, avatar_url')
    .single()

  if (error) return { profile: null, error: error.message }

  return { profile: rowToProfile(data as ProfileRow, user), error: null }
}

export async function linkGoogleIdentity(): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' }

  saveOAuthReturnPath('/settings/account')

  const { error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: getOAuthRedirectUrl(),
    },
  })

  if (error) {
    clearOAuthReturnPath()
  }

  return { error: error ? accountErrorMessage(error.message) : null }
}
