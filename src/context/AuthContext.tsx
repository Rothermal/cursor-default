import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { clearPersistedGameStorage } from '../lib/gameStorageKeys'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { getOAuthRedirectUrl } from '../lib/authRedirect'
import { applyAppAccessDenial, loadCurrentAppAccess, type AppAccess } from '../lib/appAccess'
import {
  APP_ACCESS_DENIED_EVENT,
  type AppAccessDenial,
} from '../lib/appAccessSignal'
import { clearSoccerReleaseCapabilityCache } from '../lib/soccer/releaseCapabilities'
import type { User, Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  appAccess: AppAccess | null
  appAccessLoading: boolean
  appAccessError: string | null
  isConfigured: boolean
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  refreshAppAccess: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [appAccess, setAppAccess] = useState<AppAccess | null>(null)
  const [appAccessLoading, setAppAccessLoading] = useState(false)
  const [appAccessError, setAppAccessError] = useState<string | null>(null)
  const appAccessRequest = useRef(0)
  const capabilityUserId = useRef<string | null>(null)
  const configured = isSupabaseConfigured()

  useEffect(() => {
    const nextUserId = user?.id ?? null
    if (capabilityUserId.current !== nextUserId) {
      clearSoccerReleaseCapabilityCache()
      capabilityUserId.current = nextUserId
    }
  }, [user?.id])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const refreshAppAccess = useCallback(async () => {
    const requestId = ++appAccessRequest.current
    if (!configured || !user) {
      setAppAccess(null)
      setAppAccessError(null)
      setAppAccessLoading(false)
      return
    }

    setAppAccessLoading(true)
    setAppAccessError(null)
    const result = await loadCurrentAppAccess()
    if (requestId !== appAccessRequest.current) return

    setAppAccess(result.access)
    setAppAccessError(result.error)
    setAppAccessLoading(false)
  }, [configured, user])

  useEffect(() => {
    void refreshAppAccess()
  }, [refreshAppAccess])

  useEffect(() => {
    if (!configured || !user || typeof window === 'undefined') return

    const refresh = () => void refreshAppAccess()
    const intervalId = window.setInterval(refresh, 60 * 1000)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [configured, refreshAppAccess, user])

  useEffect(() => {
    if (!configured || !user || typeof window === 'undefined') return

    const handleAccessDenied = (event: Event) => {
      const denial = (event as CustomEvent<AppAccessDenial>).detail
      setAppAccess(previous => applyAppAccessDenial(previous, denial).access)
      setAppAccessError(applyAppAccessDenial(null, denial).error)
      setAppAccessLoading(false)
      void refreshAppAccess()
    }

    window.addEventListener(APP_ACCESS_DENIED_EVENT, handleAccessDenied)
    return () => window.removeEventListener(APP_ACCESS_DENIED_EVENT, handleAccessDenied)
  }, [configured, refreshAppAccess, user])

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    if (!supabase) return { error: 'Supabase not configured' }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    })
    return { error: error?.message ?? null }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase not configured' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return { error: 'Supabase not configured' }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getOAuthRedirectUrl(),
      },
    })
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    ++appAccessRequest.current
    setAppAccess(null)
    setAppAccessError(null)
    setAppAccessLoading(false)
    clearSoccerReleaseCapabilityCache()
    clearPersistedGameStorage()
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        appAccess,
        appAccessLoading,
        appAccessError,
        isConfigured: configured,
        signUp,
        signIn,
        signInWithGoogle,
        refreshAppAccess,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
