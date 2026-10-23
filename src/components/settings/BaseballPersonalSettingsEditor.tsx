import { RefreshCw, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { useBaseballPersonalSettings } from '../../hooks/useBaseballPersonalSettings'
import { baseballPersonalSettingsFingerprint, resolveBaseballTeamRules } from '../../lib/baseball/settings'
import BaseballRulesDefaultsFields from './BaseballRulesDefaultsFields'

export default function BaseballPersonalSettingsEditor({ personal }: { personal: ReturnType<typeof useBaseballPersonalSettings> }) {
  const [draft, setDraft] = useState(() => structuredClone(personal.settings))
  const [baseRevision, setBaseRevision] = useState(personal.sync.revision)
  const previous = useRef(baseballPersonalSettingsFingerprint(personal.settings))
  const fingerprint = baseballPersonalSettingsFingerprint(personal.settings)
  const draftFingerprint = baseballPersonalSettingsFingerprint(draft)
  const dirty = fingerprint !== draftFingerprint
  const busy = personal.sync.status === 'checking' || personal.sync.status === 'saving'
  useEffect(() => {
    if (draftFingerprint === previous.current || draftFingerprint === fingerprint) {
      if (draftFingerprint !== fingerprint) setDraft(structuredClone(personal.settings))
      setBaseRevision(personal.sync.revision)
    }
    previous.current = fingerprint
  }, [draftFingerprint, fingerprint, personal.settings, personal.sync.revision])
  const reset = () => { setDraft(structuredClone(personal.settings)); setBaseRevision(personal.sync.revision) }
  const choose = async (cloud: boolean) => {
    const conflict = personal.sync.conflict
    if (!conflict || !await (cloud ? personal.useCloud() : personal.keepDevice())) return
    setDraft(structuredClone(cloud ? conflict.cloud : conflict.device))
    setBaseRevision(cloud ? conflict.cloudRevision : (conflict.cloudRevision ?? 0) + 1)
  }
  return <section className="space-y-3 border-y border-line py-4 text-content">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Personal game defaults</h3><button type="button" title="Refresh personal defaults" aria-label="Refresh personal defaults" className="h-9 w-9 shrink-0 grid place-items-center rounded-md border border-line" disabled={busy} onClick={() => void personal.refresh()}><RefreshCw size={17} className={busy ? 'animate-spin' : ''} /></button></div>
    <p role="status" className="text-xs text-content-muted">{personal.sync.status.replace(/_/g, ' ')}{dirty ? ' · Unsaved changes' : ''}</p>
    {personal.sync.error && <p role="alert" className="text-sm text-danger-content">{personal.sync.error}</p>}
    {personal.sync.conflict && <div role="alert" className="space-y-2 border border-warning-line bg-warning rounded-md p-3 text-warning-content"><p className="text-sm">Personal defaults changed in the cloud. Choose which saved version to keep.</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="btn-secondary" onClick={() => void choose(true)}>Use Cloud</button><button type="button" disabled={busy} className="btn-secondary" onClick={() => void choose(false)}>Keep This Device</button></div></div>}
    <BaseballRulesDefaultsFields value={draft} onChange={setDraft} disabled={busy || Boolean(personal.sync.conflict)} />
    <div className="grid grid-cols-2 gap-2"><button type="button" className="btn-secondary" disabled={busy || !dirty} onClick={reset}>Discard</button><button type="button" className="btn-primary inline-flex items-center justify-center gap-2" disabled={busy || !dirty || Boolean(personal.sync.conflict) || !resolveBaseballTeamRules(draft).ok} onClick={() => void personal.save(draft, baseRevision)}><Save size={17} />Save defaults</button></div>
  </section>
}
