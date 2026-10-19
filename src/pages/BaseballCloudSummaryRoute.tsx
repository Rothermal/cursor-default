import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isCurrentAuthUser } from '../lib/authIdentity'
import { resolveBaseballCloudSummaryRoute } from '../lib/baseball/summaryRoute'
import { gameInfoPath } from '../lib/teamInfo'
import BaseballSummary from './BaseballSummary'

export default function BaseballCloudSummaryRoute(props: { gameId: string; requestedSport: string | null; children: ReactNode }) {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const teamId = params.get('teamId')
  // The keyed lifetime also cancels A -> B -> A, not just different account ids.
  return <Inspection key={`${user?.id ?? ''}:${props.gameId}:${props.requestedSport ?? ''}:${teamId ?? ''}`} {...props} teamId={teamId} userId={user?.id ?? null} />
}

function Inspection({ gameId, requestedSport, userId, teamId, children }: {
  gameId: string; requestedSport: string | null; userId: string | null; teamId: string | null; children: ReactNode
}) {
  const [result, setResult] = useState<'baseball' | 'other' | 'legacy' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    const assertCurrent = () => {
      if (!active || !isCurrentAuthUser(userId)) throw new Error('The game review request changed.')
      if (!userId) throw new Error('Sign in to review this cloud game.')
    }
    void resolveBaseballCloudSummaryRoute(gameId, requestedSport, undefined, assertCurrent).then(next => {
      assertCurrent()
      setResult(next)
    }).catch(caught => {
      if (active && isCurrentAuthUser(userId)) setError(caught instanceof Error ? caught.message : 'Game authority could not load.')
    })
    return () => { active = false }
  }, [gameId, requestedSport, userId, retry])
  if (result === 'baseball' && isCurrentAuthUser(userId)) return <BaseballSummary />
  // Legacy Summary reads the active game, not this URL. Its existing Game Info/open path
  // must establish the requested legacy identity before any aggregate Summary is shown.
  if (result === 'legacy' && isCurrentAuthUser(userId)) return <Navigate to={gameInfoPath(gameId, teamId)} replace />
  if (result === 'other' && isCurrentAuthUser(userId)) return children
  return <main className="mx-auto max-w-2xl space-y-3 px-4 py-6">
    {error ? <><p role="alert" className="text-danger-content">{error}</p><button type="button" className="btn-secondary" onClick={() => { setError(null); setResult(null); setRetry(value => value + 1) }}>Try again</button></>
      : <p className="animate-pulse text-sm text-content-muted">Loading game authority...</p>}
    <Link className="btn-secondary inline-block" to={requestedSport === 'baseball' ? '/games?sport=baseball' : '/games'}>Back to Cloud Games</Link>
  </main>
}
