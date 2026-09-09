import type { AppAccessStatus } from '../lib/appAccess'

interface AppAccessGateProps {
  status: AppAccessStatus | 'unavailable'
  email: string | null
  error?: string | null
  checking: boolean
  onRefresh: () => void
  onSignOut: () => void
}

const copy: Record<AppAccessGateProps['status'], { title: string; message: string }> = {
  pending: {
    title: 'Access pending',
    message: 'Your account is waiting for approval. Check again after an administrator activates it.',
  },
  suspended: {
    title: 'Account suspended',
    message: 'This account cannot use StatKeeper right now. Contact an administrator for help.',
  },
  unavailable: {
    title: 'Access unavailable',
    message: 'StatKeeper could not verify this account. Try again before continuing.',
  },
  active: {
    title: 'Access active',
    message: 'Your account is ready.',
  },
}

export default function AppAccessGate({
  status,
  email,
  error,
  checking,
  onRefresh,
  onSignOut,
}: AppAccessGateProps) {
  const content = copy[status]

  return (
    <main className="min-h-screen bg-canvas flex items-center justify-center px-4 py-8">
      <section className="w-full max-w-md bg-surface border border-line rounded-lg p-6 space-y-5 shadow-sm">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-content-muted">StatKeeper account</p>
          <h1 className="text-2xl font-bold text-content">{content.title}</h1>
          <p className="text-sm text-content-muted">{content.message}</p>
          {email && <p className="text-sm font-medium text-content break-all">{email}</p>}
        </div>

        {error && status === 'unavailable' && (
          <p className="text-sm text-danger-content bg-danger border border-danger-line rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onSignOut}
            className="btn-secondary"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={checking}
            className="btn-primary disabled:opacity-100 disabled:bg-control-disabled disabled:text-content-disabled"
          >
            {checking ? 'Checking...' : 'Check again'}
          </button>
        </div>
      </section>
    </main>
  )
}
