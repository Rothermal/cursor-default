import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  listAccountAccess,
  updateAccountAccess,
  type AccountAccessRow,
  type AppAccessStatus,
  type AppRole,
} from '../../lib/appAccess'

interface AccountEditorProps {
  account: AccountAccessRow
  currentUserId: string
  saving: boolean
  onSave: (status: AppAccessStatus, appRole: AppRole) => void
}

function AccountEditor({ account, currentUserId, saving, onSave }: AccountEditorProps) {
  const [status, setStatus] = useState(account.status)
  const [appRole, setAppRole] = useState(account.appRole)
  const isCurrentUser = account.userId === currentUserId
  const changed = status !== account.status || appRole !== account.appRole

  useEffect(() => {
    setStatus(account.status)
    setAppRole(account.appRole)
  }, [account.appRole, account.status])

  return (
    <li className="border-b border-line py-4 last:border-b-0 space-y-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-content break-words">{account.displayName}</p>
          {isCurrentUser && (
            <span className="text-xs font-semibold text-content-muted bg-surface-muted rounded px-2 py-0.5">
              Current account
            </span>
          )}
        </div>
        <p className="text-sm text-content-muted break-all">{account.email ?? 'No email available'}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-content-muted">
          Status
          <select
            value={status}
            onChange={event => setStatus(event.target.value as AppAccessStatus)}
            disabled={isCurrentUser}
            className="input-field mt-1 text-sm disabled:bg-surface-muted"
          >
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-content-muted">
          App role
          <select
            value={appRole}
            onChange={event => setAppRole(event.target.value as AppRole)}
            disabled={isCurrentUser}
            className="input-field mt-1 text-sm disabled:bg-surface-muted"
          >
            <option value="user">User</option>
            <option value="app_admin">App admin</option>
          </select>
        </label>
      </div>

      {!isCurrentUser && (
        <button
          type="button"
          onClick={() => onSave(status, appRole)}
          disabled={!changed || saving}
          className="btn-secondary w-full disabled:opacity-100 disabled:bg-control-disabled disabled:text-content-disabled"
        >
          {saving ? 'Saving...' : 'Save access'}
        </button>
      )}
    </li>
  )
}

export default function AppAccessPanel({
  currentUserId,
  onAccessChanged,
}: {
  currentUserId: string
  onAccessChanged?: () => void
}) {
  const [accounts, setAccounts] = useState<AccountAccessRow[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadAccounts = useCallback(async (search: string) => {
    setLoading(true)
    setError(null)
    const result = await listAccountAccess(search)
    setAccounts(result.accounts)
    setError(result.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadAccounts(activeSearch)
  }, [activeSearch, loadAccounts])

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    const nextSearch = searchInput.trim()
    if (nextSearch === activeSearch) {
      void loadAccounts(nextSearch)
    } else {
      setActiveSearch(nextSearch)
    }
  }

  const handleSave = async (
    account: AccountAccessRow,
    status: AppAccessStatus,
    appRole: AppRole
  ) => {
    setSavingId(account.userId)
    setError(null)
    setMessage(null)
    const result = await updateAccountAccess(account.userId, status, appRole)
    setSavingId(null)
    if (result.error) {
      setError(result.error)
      return
    }

    setMessage(`Updated access for ${account.displayName}.`)
    onAccessChanged?.()
    await loadAccounts(activeSearch)
  }

  return (
    <section className="mt-6 space-y-3" aria-labelledby="app-access-heading">
      <div>
        <h2 id="app-access-heading" className="text-lg font-semibold text-content">App access</h2>
        <p className="text-sm text-content-muted">Approve, suspend, or assign app administrators.</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <label className="sr-only" htmlFor="account-access-search">Search accounts</label>
        <input
          id="account-access-search"
          value={searchInput}
          onChange={event => setSearchInput(event.target.value)}
          placeholder="Name or email"
          className="input-field min-w-0"
        />
        <button type="submit" className="btn-secondary shrink-0">Search</button>
      </form>

      {error && (
        <p className="text-sm text-danger-content bg-danger border border-danger-line rounded-md px-3 py-2">{error}</p>
      )}
      {message && (
        <p className="text-sm text-success-content bg-success border border-success-line rounded-md px-3 py-2">
          {message}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-content-muted animate-pulse py-4">Loading accounts...</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-content-muted py-4">No matching accounts.</p>
      ) : (
        <ul className="border-y border-line">
          {accounts.map(account => (
            <AccountEditor
              key={account.userId}
              account={account}
              currentUserId={currentUserId}
              saving={savingId === account.userId}
              onSave={(status, appRole) => void handleSave(account, status, appRole)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
