import { Check, Copy, RefreshCw, Save, Settings2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../ConfirmDialog'
import { useSettings } from '../../context/SettingsContext'
import { useSoccerTeamSettings } from '../../hooks/useSoccerTeamSettings'
import { loadTeamSportSettings } from '../../lib/sportSettingsCloud'
import {
  applySoccerFormationTemplateToTeamSettings,
  copySoccerTeamRules,
  parseSoccerTeamSettings,
  prepareSoccerTeamSettingsSave,
  resolveSoccerOverrideEditorRules,
  resolveSoccerSettingsHierarchy,
  soccerTeamSettingsFingerprint,
  type SoccerTeamSettings,
} from '../../lib/soccer/settings'
import {
  unavailableSoccerFormationPlayerIds,
  type SoccerFormationTemplateId,
} from '../../lib/soccer/formation'
import { unavailableSoccerLineupDefaultPlayerIds } from '../../lib/soccer/lineupDefaults'
import SoccerFormationEditor, {
  type SoccerFormationRosterPlayer,
} from '../soccer/SoccerFormationEditor'
import type { SoccerLineupDefaultsRosterPlayer } from '../../lib/soccer/lineupDefaultsEditor'
import SoccerLineupDefaultsEditor from '../soccer/SoccerLineupDefaultsEditor'
import SoccerRulesOverrideEditor from '../soccer/SoccerRulesOverrideEditor'

export interface SoccerTeamSettingsCopyOption {
  id: string
  name: string
}

type SoccerTeamSettingsTabId = 'rules' | 'formation' | 'lineup'

export default function SoccerTeamSettingsPanel({
  teamId,
  teamName,
  mayEdit,
  copyOptions,
  roster,
  rosterReady,
  rosterLoading,
  completeMembershipPlayerIds,
  completeMembershipReady,
  onAuditChange,
}: {
  teamId: string
  teamName: string
  mayEdit: boolean
  copyOptions: SoccerTeamSettingsCopyOption[]
  roster: readonly (SoccerFormationRosterPlayer & SoccerLineupDefaultsRosterPlayer)[]
  rosterReady: boolean
  rosterLoading: boolean
  completeMembershipPlayerIds: readonly string[]
  completeMembershipReady: boolean
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
  const [activeTab, setActiveTab] = useState<SoccerTeamSettingsTabId>('rules')
  const [confirmClearFormation, setConfirmClearFormation] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const tabGroupId = useId()
  const rulesTabRef = useRef<HTMLButtonElement>(null)
  const formationTabRef = useRef<HTMLButtonElement>(null)
  const lineupTabRef = useRef<HTMLButtonElement>(null)
  const tabDefinitions = [
    {
      identity: 'rules',
      label: 'Rules',
      ref: rulesTabRef,
      tabId: `${tabGroupId}-rules-tab`,
      panelId: `${tabGroupId}-rules-panel`,
      selected: activeTab === 'rules',
      cleanupMode: 'none',
    },
    {
      identity: 'formation',
      label: 'Formation',
      ref: formationTabRef,
      tabId: `${tabGroupId}-formation-tab`,
      panelId: `${tabGroupId}-formation-panel`,
      selected: activeTab === 'formation',
      cleanupMode: 'formation',
    },
    {
      identity: 'lineup',
      label: 'Lineup Defaults',
      ref: lineupTabRef,
      tabId: `${tabGroupId}-lineup-tab`,
      panelId: `${tabGroupId}-lineup-panel`,
      selected: activeTab === 'lineup',
      cleanupMode: 'lineup',
    },
  ] as const
  const tabDefinitionsByIdentity = Object.fromEntries(
    tabDefinitions.map(tab => [tab.identity, tab])
  ) as Record<SoccerTeamSettingsTabId, (typeof tabDefinitions)[number]>
  const activeTabDefinition = tabDefinitionsByIdentity[activeTab]
  const previousSavedFingerprint = useRef(
    soccerTeamSettingsFingerprint(team.settings)
  )
  const dirty = soccerTeamSettingsFingerprint(draft) !==
    soccerTeamSettingsFingerprint(team.settings)
  const sharedWritable = mayEdit &&
    (team.status === 'synced' || team.status === 'missing')
  const inherited = useMemo(
    () => resolveSoccerSettingsHierarchy({
      personalDefaults: soccerSettings.rules,
    }),
    [soccerSettings.rules]
  )
  const resolvedDraftRules = useMemo(
    () => resolveSoccerOverrideEditorRules(inherited.rules, draft.rules).rules,
    [draft.rules, inherited.rules]
  )
  const activeRosterIds = useMemo(() => roster.map(player => player.id), [roster])
  const unavailablePlayerIds = useMemo(
    () => rosterReady && draft.formation
      ? unavailableSoccerFormationPlayerIds(draft.formation, activeRosterIds)
      : [],
    [activeRosterIds, draft.formation, rosterReady]
  )
  const formationNeedsCleanup = sharedWritable &&
    activeTabDefinition.cleanupMode === 'formation' &&
    unavailablePlayerIds.length > 0
  const lineupCleanupReady = rosterReady && completeMembershipReady
  const unavailableLineupPlayerIds = useMemo(
    () => lineupCleanupReady
      ? unavailableSoccerLineupDefaultPlayerIds(
          draft.lineupDefaults,
          completeMembershipPlayerIds
        )
      : [],
    [completeMembershipPlayerIds, draft.lineupDefaults, lineupCleanupReady]
  )
  const lineupNeedsCleanup = sharedWritable &&
    activeTabDefinition.cleanupMode === 'lineup' &&
    unavailableLineupPlayerIds.length > 0
  const saveEnabled = dirty || formationNeedsCleanup || lineupNeedsCleanup

  useEffect(() => {
    const previous = previousSavedFingerprint.current
    const next = soccerTeamSettingsFingerprint(team.settings)
    const current = soccerTeamSettingsFingerprint(draft)
    if (current === previous || current === next) {
      if (current !== next) setDraft(structuredClone(team.settings))
      setBaseRevision(team.revision)
    }
    previousSavedFingerprint.current = next
  }, [draft, team.revision, team.settings])

  const handleSave = async () => {
    if (!mayEdit) return
    const prepared = prepareSoccerTeamSettingsSave(
      draft,
      activeTabDefinition.cleanupMode === 'formation'
        ? { mode: 'formation', rosterReady, activePlayerIds: activeRosterIds }
        : activeTabDefinition.cleanupMode === 'lineup'
          ? {
              mode: 'lineup',
              rosterReady,
              completeMembershipReady,
              completeTeamPlayerIds: completeMembershipPlayerIds,
            }
          : { mode: 'none' }
    )
    const candidate = prepared.settings
    if (await team.save(candidate, baseRevision)) {
      setDraft(structuredClone(candidate))
      if (prepared.removedUnavailableCount > 0) {
        const count = prepared.removedUnavailableCount
        setSaveNotice(
          `Saved shared defaults and removed ${count} unavailable ${count === 1 ? 'assignment' : 'assignments'}.`
        )
      } else if (prepared.removedUnavailableLineupDefaultCount > 0) {
        const count = prepared.removedUnavailableLineupDefaultCount
        setSaveNotice(
          `Saved shared defaults and removed ${count} stale lineup ${count === 1 ? 'entry' : 'entries'}.`
        )
      } else {
        setSaveNotice('Shared defaults saved.')
      }
      onAuditChange()
    }
  }

  const handlePlayerCountChange = (count: 7 | 9 | 11) => {
    setSaveNotice(null)
    setDraft(current => ({
      ...current,
      rules: { ...current.rules, maxOnFieldPlayers: count },
    }))
  }

  const handleTemplateSelect = (templateId: SoccerFormationTemplateId) => {
    setSaveNotice(null)
    setDraft(current => applySoccerFormationTemplateToTeamSettings(current, templateId))
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabDefinitions.findIndex(tab => tab.selected)
    let nextIndex = currentIndex
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex + tabDefinitions.length - 1) % tabDefinitions.length
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % tabDefinitions.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = tabDefinitions.length - 1
    } else {
      return
    }
    event.preventDefault()
    const nextTab = tabDefinitions[nextIndex]
    if (!nextTab) return
    setActiveTab(nextTab.identity)
    nextTab.ref.current?.focus()
  }

  const handleCopy = async () => {
    if (!sharedWritable || !copyTeamId) return
    setCopying(true)
    setCopyError(null)
    setSaveNotice(null)
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
      setDraft(current => copySoccerTeamRules(current, null))
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
    const parsed = parseSoccerTeamSettings(
      loaded.record.settings,
      loaded.record.schemaVersion
    )
    if (!parsed.ok) {
      setCopyError('That team has invalid or unsupported soccer defaults.')
      return
    }
    setDraft(current => copySoccerTeamRules(current, parsed.value))
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

      {saveNotice && (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {saveNotice}
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
              setSaveNotice(null)
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

      {editorOpen && (
        <>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1" role="tablist" aria-label="Soccer default settings">
            {tabDefinitions.map(tab => (
              <button
                key={tab.identity}
                ref={tab.ref}
                id={tab.tabId}
                type="button"
                role="tab"
                aria-selected={tab.selected}
                aria-controls={tab.panelId}
                tabIndex={tab.selected ? 0 : -1}
                onClick={() => setActiveTab(tab.identity)}
                onKeyDown={handleTabKeyDown}
                className={`min-h-10 rounded px-1 text-xs font-semibold sm:text-sm ${tab.selected ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'rules' ? (
            <div
              id={tabDefinitionsByIdentity.rules.panelId}
              className="space-y-4"
              role="tabpanel"
              aria-labelledby={tabDefinitionsByIdentity.rules.tabId}
            >
              {sharedWritable && copyOptions.length > 0 && (
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
              <SoccerRulesOverrideEditor
                inherited={inherited.rules}
                inheritedSources={inherited.sources}
                override={draft.rules}
                overrideLabel="Team override"
                readOnly={!sharedWritable}
                onChange={rules => {
                  setSaveNotice(null)
                  setDraft(current => ({ ...current, rules }))
                }}
              />
            </div>
          ) : activeTab === 'formation' ? (
            <div
              id={tabDefinitionsByIdentity.formation.panelId}
              role="tabpanel"
              aria-labelledby={tabDefinitionsByIdentity.formation.tabId}
            >
              <SoccerFormationEditor
                formation={draft.formation}
                playerCount={resolvedDraftRules.maxOnFieldPlayers}
                roster={roster}
                rosterReady={rosterReady}
                rosterLoading={rosterLoading}
                readOnly={!sharedWritable}
                onPlayerCountChange={handlePlayerCountChange}
                onTemplateSelect={handleTemplateSelect}
                onFormationChange={formation => {
                  setSaveNotice(null)
                  setDraft(current => ({ ...current, formation }))
                }}
                onRequestClear={() => setConfirmClearFormation(true)}
              />
              {formationNeedsCleanup && (
                <p role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Saving from this tab will remove {unavailablePlayerIds.length} unavailable {unavailablePlayerIds.length === 1 ? 'assignment' : 'assignments'}.
                </p>
              )}
            </div>
          ) : (
            <div
              id={tabDefinitionsByIdentity.lineup.panelId}
              role="tabpanel"
              aria-labelledby={tabDefinitionsByIdentity.lineup.tabId}
            >
              <SoccerLineupDefaultsEditor
                defaults={draft.lineupDefaults}
                maxOnFieldPlayers={resolvedDraftRules.maxOnFieldPlayers}
                roster={roster}
                rosterReady={rosterReady}
                rosterLoading={rosterLoading}
                stalePlayerCount={unavailableLineupPlayerIds.length}
                stalePlayerCountReady={lineupCleanupReady}
                readOnly={!sharedWritable}
                onChange={lineupDefaults => {
                  setSaveNotice(null)
                  setDraft(current => ({ ...current, lineupDefaults }))
                }}
              />
            </div>
          )}
        </>
      )}

      {editorOpen && mayEdit && (
        <div className="sticky bottom-0 -mx-4 grid grid-cols-1 gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur sm:grid-cols-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!saveEnabled}
            onClick={() => {
              setDraft(structuredClone(team.settings))
              setBaseRevision(team.revision)
              setSaveNotice(null)
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center justify-center gap-2"
            disabled={!saveEnabled || !sharedWritable || team.status === 'saving'}
            onClick={() => void handleSave()}
          >
            {team.status === 'saving' ? (
              <RefreshCw size={17} className="animate-spin" />
            ) : team.status === 'synced' && !saveEnabled ? (
              <Check size={17} />
            ) : (
              <Save size={17} />
            )}
            Save Shared Defaults
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmClearFormation}
        title="Clear Formation"
        message="Remove this team's saved formation? Rules are unchanged, and the change is not shared until you save."
        confirmLabel="Clear Formation"
        onConfirm={() => {
          setDraft(current => ({ ...current, formation: null }))
          setConfirmClearFormation(false)
          setSaveNotice(null)
        }}
        onCancel={() => setConfirmClearFormation(false)}
      />
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
