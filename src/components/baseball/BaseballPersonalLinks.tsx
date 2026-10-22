import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { useModalFocus } from '../../hooks/useModalFocus'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../../lib/authIdentity'
import { createBaseballPersonalIdentityClient } from '../../lib/baseball/personalIdentity'
import { createBaseballLinkIntentStore } from '../../lib/baseball/personalLinkIntents'
import { loadBaseballPersonalLinkSheet, prepareBaseballPersonalLinkIntent } from '../../lib/baseball/personalLinkReview'

export default function BaseballPersonalLinks({ gameId, userId, localGameId, onLinked }: {
  gameId: string; userId: string; localGameId: string; onLinked: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [params] = useSearchParams()
  const [reload, setReload] = useState(0)
  const identity = captureAuthIdentity(userId)
  const key = JSON.stringify([identity, gameId, localGameId, params.toString(), open, reload])
  const lifetime = useRef({ key, token: {} })
  if (lifetime.current.key !== key) lifetime.current = { key, token: {} }
  const request = lifetime.current
  const [settled, setSettled] = useState<{ request: object; data: Awaited<ReturnType<typeof loadBaseballPersonalLinkSheet>> | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [participant, setParticipant] = useState('')
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const operation = useRef<AbortController | null>(null)
  const close = () => { operation.current?.abort(); setOpen(false); setBusy(false) }
  useModalFocus({ enabled: open, dialogRef, onClose: close })
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = () => {
    if (!mounted.current || operation.current?.signal.aborted || lifetime.current !== request || !identity || !isCurrentAuthIdentity(identity)) throw Error('The player-link review changed. Open it again.')
  }
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    operation.current = controller
    const guard = () => { current(); if (controller.signal.aborted) throw Error('Player-link review closed.') }
    void loadBaseballPersonalLinkSheet(gameId, userId, guard, controller.signal).then(data => {
      guard(); setSettled({ request, data, error: null }); setBusy(false)
      setParticipant(data.participants.find(row => data.review.participantSourceMap[row.id] === null)?.id ?? data.participants[0]?.id ?? '')
      setTarget(''); setReason('')
    }).catch(error => {
      try { guard() } catch { return }
      setSettled({ request, data: null, error: error instanceof Error ? error.message : 'Player links could not load.' }); setBusy(false)
    })
    return () => { controller.abort(); if (operation.current === controller) operation.current = null }
    // request includes account epoch, game, dialog and explicit review generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])
  const visible = identity && isCurrentAuthIdentity(identity) && settled?.request === request ? settled : null
  const data = visible?.data
  const submit = async (retry: boolean) => {
    if (!data || busy) return
    setBusy(true); setNotice(null)
    try {
      current()
      const store = createBaseballLinkIntentStore(localStorage)
      const intent = retry ? store.read(userId, localGameId, participant) : prepareBaseballPersonalLinkIntent({ userId, localGameId, participantId: participant,
        targetPlayerId: target, review: data.review, participantIds: data.participants.map(row => row.id), reason }, store)
      if (!intent?.reviewed) throw Error('No reviewed pending link for this participant.')
      const result = await createBaseballPersonalIdentityClient(userId, { signal: operation.current?.signal }).link(intent, store)
      current()
      if (!result.acknowledged) throw Error('The link is not confirmed by the current server map. Review again; the pending intent is retained.')
      // A historical receipt is never a lifecycle command. Only refresh current cloud status.
      await onLinked()
      current()
      setNotice('Player-history link confirmed. If the cloud game reopened, open your recording and explicitly Reopen, end, sync and publish a new result. Nothing is republished automatically.')
      setReload(value => value + 1)
    } catch (error) {
      try { current() } catch { return }
      setNotice(error instanceof Error ? error.message : 'The player link could not save. Its pending intent is retained.')
    } finally {
      try { current(); setBusy(false) } catch { /* A different dialog owns its busy state. */ }
    }
  }
  const linked = data?.review.participantSourceMap[participant] ?? null
  return <>
    <button type="button" className="btn-secondary w-full" onClick={() => { setOpen(true); setNotice(null) }}>Review player links</button>
    {open && <div className="fixed inset-0 z-[90] bg-overlay/50 flex items-end sm:items-center justify-center"><section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="baseball-personal-links-title" className="bg-surface-elevated text-content w-full sm:max-w-lg max-h-[85vh] overflow-y-auto p-4 space-y-3">
      <div className="flex items-center gap-2"><h2 id="baseball-personal-links-title" className="font-semibold flex-1">Review player links</h2><button type="button" aria-label="Close player links" title="Close" className="h-9 w-9 flex items-center justify-center" onClick={close}><X size={19} /></button></div>
      {!visible && <p role="status" className="text-sm text-content-muted">Loading personal participants and My Players...</p>}
      {visible?.error && <p role="alert" className="text-sm text-danger-content">{visible.error}</p>}
      {data && <>
        <div className="divide-y divide-line">{data.participants.map(row => <p key={row.id} className="text-sm py-2 break-words">{row.displayName}: {data.review.participantSourceMap[row.id] ? data.players.find(player => player.id === data.review.participantSourceMap[row.id])?.displayName ?? 'Confirmed player link' : 'Unlinked; not included in player history'}</p>)}</div>
        <label className="block text-xs font-semibold text-content-muted">Participant<select className="input-field mt-1" value={participant} disabled={busy} onChange={event => { setParticipant(event.target.value); setTarget('') }}>{data.participants.map(row => <option key={row.id} value={row.id}>{row.displayName}</option>)}</select></label>
        {!linked && <label className="block text-xs font-semibold text-content-muted">My Player<select className="input-field mt-1" value={target} disabled={busy} onChange={event => setTarget(event.target.value)}><option value="">Choose a player</option>{data.players.filter(player => !Object.values(data.review.participantSourceMap).includes(player.id)).map(player => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label>}
        {data.review.activePublicationId && <label className="block text-xs font-semibold text-content-muted">Reason to reopen the published result<textarea className="input-field mt-1" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} rows={3} /></label>}
        <Link to="/teams" className="block text-sm text-accent">My Players</Link>
        <div className="grid grid-cols-2 gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={() => { void submit(true) }}>Retry pending link</button><button type="button" className="btn-primary" disabled={busy || Boolean(linked) || !target || Boolean(data.review.activePublicationId && reason.trim().length < 3)} onClick={() => { void submit(false) }}>{data.review.activePublicationId ? 'Reopen and link' : 'Confirm link'}</button></div>
      </>}
      {notice && <p role="status" className="text-sm text-content-muted">{notice}</p>}
      <button type="button" className="text-sm text-accent underline" disabled={busy} onClick={() => setReload(value => value + 1)}>Refresh review</button>
    </section></div>}
  </>
}
