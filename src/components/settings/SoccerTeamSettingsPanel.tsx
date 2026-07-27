import { Check, Copy, RefreshCw, Save, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings } from '../../context/SettingsContext'
import { useSoccerTeamSettings } from '../../hooks/useSoccerTeamSettings'
import { loadTeamSportSettings } from '../../lib/sportSettingsCloud'
import {
  parseSoccerTeamSettings,
  resolveSoccerSettingsHierarchy,
  soccerRulesOverrideFingerprint,
  type SoccerTeamSettings,
} from '../../lib/soccer/settings'
import SoccerRulesOverrideEditor from '../soccer/SoccerRulesOverrideEditor'

export interface SoccerTeamSettingsCopyOption {
  id: string
  name: string
}

export default function SoccerTeamSettingsPanel({
  teamId,
  teamName,
  mayEdit,
  copyOptions,
  onAuditChange,
}: {
  teamId: string
  teamName: string
  mayEdit: boolean
  copyOptions: SoccerTeamSettingsCopyOption[]
  onAuditChange: () => void
}) {
  const navigate = useNavigate()
  const { soccerSettings } = useSettings()
  const team = useSoccerTeamSettings(teamId)
  const [draft, setDraft] = useState<SoccerTeamSettings>(() =>
    structuredClone(team.settings)
  )
  const [baseRevision, setBaseRevision] = useState(team.revision)
  const [copyTeamId, setCopyTeamId] = useState('')
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const previousSavedFingerprint = useRef(
    soccerRulesOverrideFingerprint(team.settings.rules)
  )
  const dirty = soccerRulesOverrideFingerprint(draft.rules) !==
    soccerRulesOverrideFingerprint(team.settings.rules)
  const sharedWritable = mayEdit &&
    (team.status === 'synced' || team.status === 'missing')
  const inherited = useMemo(
    () => resolveSoccerSettingsHierarchy({
      personalDefaults: soccerSettings.rules,
    }),
    [soccerSettings.rules]
  )

  useEffect(() => {
    const previous = previousSavedFingerprint.current
    const next = soccerRulesOverrideFingerprint(team.settings.rules)
    const current = soccerRulesOverrideFingerprint(draft.rules)
    if (current === previous || current === next) {
      if (current !== next) setDraft(structuredClone(team.settings))
      setBaseRevision(team.revision)
    }
    previousSavedFingerprint.current = next
  }, [draft.rules, team.revision, team.settings])

  const handleSave = async () => {
    if (!mayEdit) return
    if (await team.save(draft, baseRevision)) {
      onAuditChange()
    }
  }

  const handleCopy = async () => {
    if (!sharedWritable || !copyTeamId) return
    setCopying(true)
    setCopyError(null)
    let loaded
    try {
      loaded = await loadTeamSportSettings(copyTeamId, 'soccer')
    } catch (loadError) {
      setCopying(false)
      setCopyError(
        loadError instanceof Error
          ? loadError.message
          : 'That team default could not be loaded.'
      )
      return
    }
    setCopying(false)
    if (loaded.status === 'missing') {
      setDraft({ rules: {} })
      return
    }
    if (loaded.status !== 'loaded') {
      setCopyError(
        loaded.status === 'backend_update_required' || loaded.status === 'error'
          ? loaded.error
          : 'That team default could not be loaded.'
      )
      return
    }
    const parsed = parseSoccerTeamSettings(loaded.record.settings)
    if (!parsed.ok) {
      setCopyError('That team has invalid or unsupported soccer defaults.')
      return
    }
    setDraft(parsed.value)
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">Soccer Defaults</h2>
          <p className="text-xs text-slate-500">
            Shared by {teamName}. Unset fields inherit each recorder's personal defaults.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void team.refresh()}
          disabled={team.status === 'loading' || team.status === 'saving'}
          className="h-9 w-9 shrink-0 grid place-items-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"
          title="Refresh shared defaults"
          aria-label="Refresh shared defaults"
        >
          <RefreshCw
            size={17}
            className={team.status === 'loading' ? 'animate-spin' : ''}
          />
        </button>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 text-xs text-slate-500"
        aria-live="polite"
      >
        <span>{statusLabel(team.status)}</span>
        {dirty && <span className="font-semibold text-amber-700">Unsaved changes</span>}
        {!mayEdit && (
          <span className="font-semibold text-slate-600">Read only</span>
        )}
      </div>

      {(team.error || copyError) && (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {copyError ?? team.error}
        </p>
      )}

      {team.conflict && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-sm font-semibold text-amber-900">
            Another manager changed these defaults.
          </p>
          <button
            type="button"
            onClick={() => {
              const cloud = team.conflict
              team.useCloud()
              if (cloud) setDraft(structuredClone(cloud))
            }}
            className="btn-secondary w-full text-sm"
          >
            Reload Shared Version
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate('/settings/sports/soccer')}
        className="inline-flex h-9 items-center gap-2 text-sm font-semibold text-blue-700"
      >
        <Settings2 size={16} />
        Personal soccer defaults
      </button>

      <button
        type="button"
        onClick={() => setEditorOpen(open => !open)}
        className="btn-secondary w-full"
        aria-expanded={editorOpen}
      >
        {editorOpen ? 'Close Defaults Editor' : 'Open Defaults Editor'}
      </button>

      {editorOpen && sharedWritable && copyOptions.length > 0 && (
        <div className="border-y border-slate-200 py-3 space-y-2">
          <p className="text-sm font-semibold text-slate-700">Copy from another team</p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select
              value={copyTeamId}
              onChange={event => setCopyTeamId(event.target.value)}
              className="input-field"
              aria-label="Source soccer team"
            >
              <option value="">Choose a soccer team</option>
              {copyOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!copyTeamId || copying}
              className="btn-secondary inline-flex items-center justify-center gap-2 px-3 disabled:opacity-40"
            >
              {copying ? <RefreshCw size={16} className="animate-spin" /> : <Copy size={16} />}
              Copy
            </button>
          </div>
        </div>
      )}

      {editorOpen && (
        <SoccerRulesOverrideEditor
          inherited={inherited.rules}
          inheritedSources={inherited.sources}
          override={draft.rules}
          overrideLabel="Team override"
          readOnly={!sharedWritable}
          onChange={rules => setDraft({ rules })}
        />
      )}

      {editorOpen && mayEdit && (
        <div className="sticky bottom-0 -mx-4 grid grid-cols-1 gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur sm:grid-cols-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!dirty}
            onClick={() => {
              setDraft(structuredClone(team.settings))
              setBaseRevision(team.revision)
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center justify-center gap-2"
            disabled={!dirty || !sharedWritable || team.status === 'saving'}
            onClick={() => void handleSave()}
          >
            {team.status === 'saving' ? (
              <RefreshCw size={17} className="animate-spin" />
            ) : team.status === 'synced' && !dirty ? (
              <Check size={17} />
            ) : (
              <Save size={17} />
            )}
            Save Shared Defaults
          </button>
        </div>
      )}
    </section>
  )
}

function statusLabel(status: ReturnType<typeof useSoccerTeamSettings>['status']): string {
  switch (status) {
    case 'loading': return 'Loading shared defaults'
    case 'saving': return 'Saving shared defaults'
    case 'synced': return 'Shared defaults synced'
    case 'cached': return 'Showing last synced defaults'
    case 'missing': return 'No team overrides saved'
    case 'conflict': return 'Shared settings conflict'
    case 'backend_update_required': return 'Backend update required'
    case 'error': return 'Shared defaults unavailable'
    default: return 'Shared defaults not loaded'
  }
}
