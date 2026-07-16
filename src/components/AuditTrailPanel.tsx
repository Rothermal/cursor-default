import { useEffect, useState } from 'react'
import { formatAuditEvent, parseAuditEvents, type AuditEvent } from '../lib/auditTrail'
import { supabase } from '../lib/supabase'

interface AuditTrailPanelProps {
  teamId?: string
  refreshKey?: number
  title?: string
}

export default function AuditTrailPanel({
  teamId,
  refreshKey = 0,
  title = 'Access activity',
}: AuditTrailPanelProps) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    const client = supabase
    let cancelled = false
    const loadEvents = async () => {
      setLoading(true)
      setError(null)
      const { data, error: rpcError } = await client.rpc('get_access_audit_events', {
        p_team_id: teamId ?? null,
        p_limit: teamId ? 50 : 100,
      })
      if (cancelled) return

      if (rpcError) {
        setEvents([])
        setError(rpcError.message)
      } else {
        setEvents(parseAuditEvents(data))
      }
      setLoading(false)
    }

    void loadEvents()
    return () => {
      cancelled = true
    }
  }, [refreshKey, teamId])

  return (
    <section className="space-y-3" aria-labelledby={`audit-heading-${teamId ?? 'global'}`}>
      <div>
        <h2
          id={`audit-heading-${teamId ?? 'global'}`}
          className="text-lg font-semibold text-slate-800"
        >
          {title}
        </h2>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500 animate-pulse py-3">Loading activity...</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-slate-500 py-3">No access activity recorded yet.</p>
      ) : (
        <ol className="border-y border-slate-200 max-h-96 overflow-y-auto">
          {events.map(event => (
            <li key={event.id} className="py-3 border-b border-slate-100 last:border-b-0">
              <p className="text-sm text-slate-700">{formatAuditEvent(event)}</p>
              <p className="text-xs text-slate-500 mt-1">
                {new Date(event.createdAt).toLocaleString()}
                {!teamId && event.teamName ? ` - ${event.teamName}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
