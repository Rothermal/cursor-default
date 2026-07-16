import { supabase } from './supabase'

export type AppAccessStatus = 'active' | 'pending' | 'suspended'
export type AppRole = 'user' | 'app_admin'

export interface AppAccess {
  status: AppAccessStatus
  appRole: AppRole
  updatedAt: string | null
}

export interface AccountAccessRow extends AppAccess {
  userId: string
  displayName: string
  email: string | null
}

interface AppAccessRpcRow {
  status?: unknown
  app_role?: unknown
  updated_at?: unknown
}

interface AccountAccessRpcRow extends AppAccessRpcRow {
  user_id?: unknown
  display_name?: unknown
  email?: unknown
}

interface SupabaseLikeError {
  code?: string
  message?: string
}

export const migrationFallbackAccess: AppAccess = {
  status: 'active',
  appRole: 'user',
  updatedAt: null,
}

function isAppAccessStatus(value: unknown): value is AppAccessStatus {
  return value === 'active' || value === 'pending' || value === 'suspended'
}

function isAppRole(value: unknown): value is AppRole {
  return value === 'user' || value === 'app_admin'
}

export function parseAppAccess(value: unknown): AppAccess | null {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') return null

  const candidate = row as AppAccessRpcRow
  if (!isAppAccessStatus(candidate.status) || !isAppRole(candidate.app_role)) return null

  return {
    status: candidate.status,
    appRole: candidate.app_role,
    updatedAt: typeof candidate.updated_at === 'string' ? candidate.updated_at : null,
  }
}

export function isMissingAppAccessRpcError(error: SupabaseLikeError | null): boolean {
  if (!error) return false
  const message = error.message?.toLowerCase() ?? ''
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    (message.includes('get_my_app_access') && message.includes('not') && message.includes('find'))
  )
}

export async function loadCurrentAppAccess(): Promise<{
  access: AppAccess | null
  error: string | null
}> {
  if (!supabase) return { access: migrationFallbackAccess, error: null }

  const { data, error } = await supabase.rpc('get_my_app_access')
  if (isMissingAppAccessRpcError(error)) {
    return { access: migrationFallbackAccess, error: null }
  }
  if (error) return { access: null, error: error.message }

  const access = parseAppAccess(data)
  return access
    ? { access, error: null }
    : { access: null, error: 'Account access could not be verified.' }
}

export function parseAccountAccessRows(value: unknown): AccountAccessRow[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const row = raw as AccountAccessRpcRow
    const access = parseAppAccess(row)
    if (
      !access ||
      typeof row.user_id !== 'string' ||
      typeof row.display_name !== 'string'
    ) return []

    return [{
      ...access,
      userId: row.user_id,
      displayName: row.display_name,
      email: typeof row.email === 'string' ? row.email : null,
    }]
  })
}

export async function listAccountAccess(search: string): Promise<{
  accounts: AccountAccessRow[]
  error: string | null
}> {
  if (!supabase) return { accounts: [], error: 'Supabase not configured' }

  const { data, error } = await supabase.rpc('list_account_access', {
    p_search: search.trim() || null,
  })
  if (error) return { accounts: [], error: error.message }
  return { accounts: parseAccountAccessRows(data), error: null }
}

export async function updateAccountAccess(
  userId: string,
  status: AppAccessStatus,
  appRole: AppRole
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' }

  const { error } = await supabase.rpc('set_account_access', {
    p_user_id: userId,
    p_status: status,
    p_app_role: appRole,
  })
  return { error: error?.message ?? null }
}
