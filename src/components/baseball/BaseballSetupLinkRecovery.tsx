import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../../lib/authIdentity'
import { getActiveLocalGameId, getParkedGameRecord } from '../../lib/gameParking'
import { createBaseballLinkIntentStore, type BaseballPersonalLinkIntent } from '../../lib/baseball/personalLinkIntents'
import type { GameState } from '../../types'

/** Cancels a device request, not the underlying cloud link, player, event or game. */
export default function BaseballSetupLinkRecovery({ state }: { state: GameState }) {
  const { user } = useAuth()
  const { activeLocalGameId, flushCloudSync } = useGame()
  const [, refresh] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const identity = user ? captureAuthIdentity(user.id) : null
  const scope = JSON.stringify([identity, activeLocalGameId, state.cloudSync.gameId])
  const latest = useRef(scope)
  latest.current = scope
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const canSettle = () => mounted.current && latest.current === scope && identity && isCurrentAuthIdentity(identity)
  const setup = state.sportGameState?.sportId === 'baseball' ? state.sportGameState.setup : null
  if (!identity || !activeLocalGameId || !setup || setup.sourceTeamId || setup.sourceSeasonId) return null
  const current = () => {
    if (!canSettle() || getActiveLocalGameId(identity.userId) !== activeLocalGameId
      || getParkedGameRecord(activeLocalGameId, identity.userId)?.gameState.cloudSync.gameId !== state.cloudSync.gameId) throw Error('The game or account changed. Open this recording again.')
  }
  let pending: BaseballPersonalLinkIntent[] = [], error: string | null = null
  try {
    current()
    const store = createBaseballLinkIntentStore(localStorage)
    pending = setup.participants.flatMap(player => { const intent = store.read(identity.userId, activeLocalGameId, player.id); return intent ? [intent] : [] })
  } catch (caught) { error = caught instanceof Error ? caught.message : 'Pending player requests are unavailable.' }
  const discard = async (intent: BaseballPersonalLinkIntent) => {
    try {
      current()
      if (!window.confirm('Discard only this device\'s pending player-history request? This will not undo a request already sent or remove cloud links, players, events or the game. Other pending requests can still sync.')) return
      current()
      if (!createBaseballLinkIntentStore(localStorage).discard(intent)) throw Error('The pending request changed. Review it again.')
      refresh(value => value + 1); setBusy(true)
      const result = await flushCloudSync()
      current()
      setNotice(result.ok ? 'Pending request discarded. Events synced.' : 'Pending request discarded. Retry sync for remaining requests.')
    } catch (caught) { if (canSettle()) setNotice(caught instanceof Error ? caught.message : 'The request could not be discarded.') }
    finally { if (canSettle()) setBusy(false) }
  }
  return <section className="space-y-2 border border-warning-line bg-warning rounded-md p-3 text-warning-content">
    <h3 className="text-sm font-semibold">Pending player-history requests</h3>
    {pending.map(intent => <div key={intent.participantId} className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 break-words">{setup.participants.find(player => player.id === intent.participantId)?.displayName ?? 'Player'}</span><button type="button" disabled={busy} title="Discard pending request" aria-label={`Discard pending request for ${setup.participants.find(player => player.id === intent.participantId)?.displayName ?? 'player'}`} className="h-9 w-9 shrink-0 grid place-items-center rounded-md border border-warning-line" onClick={() => void discard(intent)}><Trash2 size={16} /></button></div>)}
    {(error || notice) && <p role="status" className="text-sm">{error ?? notice}</p>}
  </section>
}
