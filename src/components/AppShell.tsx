import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { APP_BUILD_ID, APP_BUILD_LABEL } from '../lib/buildInfo'

interface AppShellProps {
  children: ReactNode
}

const FOCUS_ROUTES = new Set(['/game'])

export default function AppShell({ children }: AppShellProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isConfigured, signOut } = useAuth()

  if (FOCUS_ROUTES.has(location.pathname)) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur safe-top">
        <div className="max-w-lg mx-auto px-4 py-2 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-left min-w-0"
          >
            <p className="flex items-center gap-1.5 text-sm font-bold leading-tight text-slate-800">
              <span>StatKeeper</span>
              <span
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                title={`Build ${APP_BUILD_ID}`}
                aria-label={`Build ${APP_BUILD_ID}`}
              >
                {APP_BUILD_LABEL}
              </span>
            </p>
            <p className="text-[11px] text-slate-500 leading-tight truncate">
              {user?.email ?? 'Local mode'}
            </p>
          </button>

          <nav className="flex items-center gap-1 shrink-0" aria-label="Global navigation">
            <Link
              to="/sports"
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Sports
            </Link>
            <Link
              to="/settings"
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Settings
            </Link>
            {isConfigured && user && (
              <button
                type="button"
                onClick={() => { void signOut() }}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Sign out
              </button>
            )}
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}
