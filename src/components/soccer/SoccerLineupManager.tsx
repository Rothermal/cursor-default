import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw, X } from 'lucide-react'
import type { GameState } from '../../types'
import { useModalFocus } from '../../hooks/useModalFocus'
import { applySoccerLineupTransition, previewSoccerLineupTransition, type SoccerLiveResult } from '../../lib/soccer/live'
import { currentSoccerTargetLineup } from '../../lib/soccer/targetLineup'
import { soccerLineupEntryUnavailable, soccerLineupPreset } from '../../lib/soccer/lineupManager'
import type { SoccerLineupTransitionSource, SoccerRole, SoccerRoleGroup } from '../../lib/soccer/types'

const roles: Array<[SoccerRoleGroup, string]> = [['forward', 'FWD'], ['midfielder', 'MID'], ['defender', 'DEF'], ['goalkeeper', 'GK'], ['custom', 'CUSTOM']]
const sourceNames = { manual: 'Current lineup', opening_lineup: 'Opening Lineup', team_default: 'Team Default' }

export default function SoccerLineupManager({ state, recorderUserId, initialParticipantId, busy, onApply, onClose }: {
  state: GameState; recorderUserId: string | null; initialParticipantId: string | null; busy: boolean
  onApply: (result: SoccerLiveResult) => boolean; onClose: () => void
}) {
  const [base, setBase] = useState(state)
  const projection = base.sportGameState?.sportId === 'soccer' ? base.sportGameState.projection : null
  const [target, setTarget] = useState(() => projection ? currentSoccerTargetLineup(projection) : [])
  const [benchRoles, setBenchRoles] = useState<Record<string, SoccerRole>>({})
  const [source, setSource] = useState<SoccerLineupTransitionSource>('manual')
  const [unavailable, setUnavailable] = useState<Array<{ participantId: string; name: string; reason: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmShort, setConfirmShort] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef<HTMLSelectElement>(null)
  useModalFocus({ enabled: true, dialogRef, initialFocusRef: focusRef, onClose })
  if (!projection) return null
  const preview = previewSoccerLineupTransition(base, target, source)
  const latestProjection = state.sportGameState?.sportId === 'soccer' ? state.sportGameState.projection : null
  const blocked = busy || !latestProjection || latestProjection.clock.running || state.cloudSync.gameStatus === 'final'
  const participants = Object.values(projection.participants).sort((a, b) =>
    (a.number ?? '').localeCompare(b.number ?? '', undefined, { numeric: true }) || a.displayName.localeCompare(b.displayName))
  const targetIds = new Set(target.map(entry => entry.participantId))
  const reset = () => {
    if (state.sportGameState?.sportId !== 'soccer') return
    setBase(state); setTarget(currentSoccerTargetLineup(state.sportGameState.projection)); setSource('manual')
    setUnavailable([]); setError(null); setConfirmShort(false)
    setBenchRoles({})
  }
  const preset = (nextSource: SoccerLineupTransitionSource) => {
    const value = soccerLineupPreset(base, nextSource)
    if (!value) return
    setTarget(value.onField); setUnavailable(value.unavailable); setSource(nextSource); setError(null); setConfirmShort(false)
    setBenchRoles({})
  }
  const changeRole = (id: string, role: SoccerRole) => {
    setBenchRoles(current => ({ ...current, [id]: role }))
    setTarget(current => current.map(entry => entry.participantId === id ? { ...entry, role } : entry))
    setConfirmShort(false); setError(null)
  }
  const apply = () => {
    if (!preview.ok || blocked) return
    const result = applySoccerLineupTransition(state, preview.preview, { recorderUserId })
    if (!result.ok) { setError(result.message); setConfirmShort(false); return }
    if (target.length < projection.currentRules.maxOnFieldPlayers && !confirmShort) { setConfirmShort(true); return }
    if (onApply(result)) onClose()
  }
  const names = (ids: string[]) => ids.map(id => projection.participants[id]?.displayName ?? id).join(', ')
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 sm:p-3">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="lineup-manager-title" tabIndex={-1}
      className="flex h-[100dvh] w-full max-w-3xl flex-col bg-white text-slate-900 sm:h-[94dvh] sm:rounded-lg">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 id="lineup-manager-title" className="text-lg font-bold">Manage Lineup</h2>
        <button type="button" onClick={onClose} title="Close" aria-label="Close lineup manager" className="grid h-11 w-11 place-items-center"><X size={20} /></button>
      </header>
      <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-200 p-3">
        <button type="button" disabled={blocked} onClick={() => preset('opening_lineup')} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40">Opening Lineup</button>
        {soccerLineupPreset(base, 'team_default') && <button type="button" disabled={blocked} onClick={() => preset('team_default')} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40">Team Default</button>}
        <button type="button" onClick={reset} disabled={busy} title="Reset to current lineup" aria-label="Reset to current lineup" className="grid h-9 w-9 place-items-center rounded-md border border-slate-300"><RotateCcw size={17} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          {[true, false].map(onField => <section key={String(onField)} className="min-w-0">
            <h3 className="sticky top-0 z-10 border-b border-slate-300 bg-white py-2 text-xs font-bold">{onField ? `ON FIELD ${target.length}/${projection.currentRules.maxOnFieldPlayers}` : `BENCH ${participants.length - target.length}`}</h3>
            {participants.filter(p => targetIds.has(p.participantId) === onField).map(p => {
              const role = target.find(entry => entry.participantId === p.participantId)?.role ?? benchRoles[p.participantId] ?? p.role
              const reason = soccerLineupEntryUnavailable(projection, p.participantId)
              return <div key={p.participantId} className="min-w-0 border-b border-slate-200 py-2">
                <button type="button" disabled={blocked || (!onField && !!reason)}
                  aria-label={`${onField ? 'Move to bench' : 'Move on field'}: ${p.number ?? ''} ${p.displayName}`}
                  title={reason ?? p.displayName}
                  onClick={() => { setBenchRoles(current => ({ ...current, [p.participantId]: role })); setTarget(current => onField ? current.filter(e => e.participantId !== p.participantId) : [...current, { participantId: p.participantId, role: structuredClone(role) }]); setConfirmShort(false); setError(null) }}
                  className="flex h-10 w-full min-w-0 items-center gap-1 text-left text-xs disabled:opacity-40">
                  <span className="w-6 shrink-0 truncate font-bold">{p.number ?? '-'}</span><span className="min-w-0 flex-1 truncate font-semibold">{p.displayName}</span>
                  {onField ? <ArrowRight size={15} className="shrink-0" /> : <ArrowLeft size={15} className="shrink-0" />}
                </button>
                <>
                  <select ref={p.participantId === initialParticipantId ? focusRef : undefined} aria-label={`${onField ? 'Role' : 'Entry role'} for ${p.displayName}`} value={role.group} disabled={blocked || (!onField && !!reason)}
                    onChange={event => changeRole(p.participantId, { group: event.target.value as SoccerRoleGroup, label: event.target.value === 'custom' ? role.label ?? '' : null })}
                    className="h-9 w-full min-w-0 rounded border border-slate-300 bg-white px-1 text-xs">
                    {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {role.group === 'custom' && <input aria-label={`Custom role for ${p.displayName}`} value={role.label ?? ''} disabled={blocked} onChange={event => changeRole(p.participantId, { ...role, label: event.target.value })} className="mt-1 h-9 w-full min-w-0 rounded border border-slate-300 px-1 text-xs" />}
                </>
                {!onField && <p className="truncate text-[11px] text-slate-500" title={reason ?? 'Role on entry'}>{reason ?? 'Role on entry'}</p>}
              </div>
            })}
          </section>)}
        </div>
        {unavailable.length > 0 && <div className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-2 text-xs text-amber-900">{unavailable.map(item => <p key={item.participantId}>Unavailable in preset: {item.name} ({item.reason})</p>)}</div>}
        <div className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-xs" aria-live="polite">
          <p className="font-semibold">{sourceNames[source]}</p>
          {preview.ok ? <>
            <p>Entering: {names(preview.preview.analysis.diff.enteringParticipantIds) || 'None'}</p>
            {preview.preview.analysis.diff.enteringParticipantIds.length > 0 && <p>Entry roles: {target.filter(entry => preview.preview.analysis.diff.enteringParticipantIds.includes(entry.participantId)).map(entry => `${projection.participants[entry.participantId].displayName}: ${entry.role.label ?? entry.role.group}`).join(', ')}</p>}
            <p>Leaving: {names(preview.preview.analysis.diff.leavingParticipantIds) || 'None'}</p>
            <p>Role changes: {preview.preview.analysis.diff.roleChanges.map(c => `${projection.participants[c.participantId].displayName}: ${c.from.label ?? c.from.group} to ${c.to.label ?? c.to.group}`).join(', ') || 'None'}</p>
            <p>Subs {projection.substitutionCount + preview.preview.analysis.diff.substitutionCountDelta}/{projection.currentRules.substitutionLimit ?? '-'} · Windows {projection.substitutionWindowCount + preview.preview.analysis.diff.substitutionWindowCountDelta}/{projection.currentRules.substitutionWindowLimit ?? '-'}{preview.preview.payload.halftime ? ' · Halftime' : ''}</p>
          </> : <p className="text-amber-800">{preview.message}</p>}
        </div>
      </div>
      <footer className="shrink-0 space-y-2 border-t border-slate-200 bg-white p-3">
        {latestProjection?.clock.running && <p role="status" className="text-sm text-amber-800">Pause clock to manage lineup</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {confirmShort && <p role="alert" className="text-sm font-semibold text-amber-800">Play short-handed with {target.length} of {projection.currentRules.maxOnFieldPlayers} players?</p>}
        <div className="flex gap-2"><button type="button" onClick={confirmShort ? () => setConfirmShort(false) : onClose} className="min-h-11 flex-1 rounded-md border border-slate-300 px-2 text-sm font-semibold">{confirmShort ? 'Keep Editing' : 'Cancel'}</button>
          <button type="button" disabled={blocked || !preview.ok} onClick={apply} className="min-h-11 flex-1 rounded-md bg-emerald-700 px-2 text-sm font-bold text-white disabled:opacity-40">{confirmShort ? 'Confirm Short-handed' : 'Apply Lineup'}</button></div>
      </footer>
    </div>
  </div>
}
