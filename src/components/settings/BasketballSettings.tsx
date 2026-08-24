import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Cloud, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useSettings } from '../../context/SettingsContext'
import {
  listBasketballRulesProfiles,
  resolveBasketballRules,
  type BasketballRulesProfileRef,
} from '../../lib/basketball/profiles'
import {
  basketballSettingsFingerprint,
} from '../../lib/basketball/personalSettingsSync'
import {
  DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
  type BasketballPersonalSettingsV1,
} from '../../lib/basketball/settings'
import { settingsPath } from '../../lib/settingsNavigation'
import ConfirmDialog from '../ConfirmDialog'

type BasketballSettingsTab = 'rules' | 'capture' | 'display'

const tabs: Array<{ id: BasketballSettingsTab; label: string }> = [
  { id: 'rules', label: 'Rules' },
  { id: 'capture', label: 'Capture' },
  { id: 'display', label: 'Display' },
]

export default function BasketballSettings() {
  const {
    basketballSettings,
    basketballSettingsSync,
    saveBasketballSettings,
    refreshBasketballSettings,
    useCloudBasketballSettings,
    keepDeviceBasketballSettings,
    setBasketballSettingsPageActive,
  } = useSettings()
  const profiles = useMemo(listBasketballRulesProfiles, [])
  const [draft, setDraft] = useState<BasketballPersonalSettingsV1>(() =>
    structuredClone(basketballSettings)
  )
  const [draftBaseRevision, setDraftBaseRevision] = useState(
    basketballSettingsSync.revision
  )
  const [activeTab, setActiveTab] = useState<BasketballSettingsTab>('rules')
  const [confirmReset, setConfirmReset] = useState(false)
  const previousSavedFingerprint = useRef(
    basketballSettingsFingerprint(basketballSettings)
  )
  const dirty = useMemo(
    () => basketballSettingsFingerprint(draft) !==
      basketballSettingsFingerprint(basketballSettings),
    [basketballSettings, draft]
  )
  const resolved = useMemo(() => resolveBasketballRules(
    draft.baseProfile,
    [{ id: 'personal', overrides: draft.ruleOverrides }]
  ), [draft.baseProfile, draft.ruleOverrides])

  useEffect(() => {
    setBasketballSettingsPageActive(true)
    return () => setBasketballSettingsPageActive(false)
  }, [setBasketballSettingsPageActive])

  useEffect(() => {
    const previous = previousSavedFingerprint.current
    const next = basketballSettingsFingerprint(basketballSettings)
    const current = basketballSettingsFingerprint(draft)
    if (current === previous || current === next) {
      if (current !== next) setDraft(structuredClone(basketballSettings))
      setDraftBaseRevision(basketballSettingsSync.revision)
    }
    previousSavedFingerprint.current = next
  }, [basketballSettings, basketballSettingsSync.revision, draft])

  const chooseProfile = (profileRef: BasketballRulesProfileRef) => {
    setDraft(current => ({
      ...current,
      baseProfile: profileRef,
      ruleOverrides: {},
    }))
  }

  const setPersonalFoulLimit = (limit: number) => {
    const profile = profiles.find(item =>
      item.profileId === draft.baseProfile.profileId &&
      item.profileVersion === draft.baseProfile.profileVersion
    )
    if (!profile) return
    setDraft(current => {
      const overrides = { ...current.ruleOverrides }
      if (limit === profile.rules.personalFoulLimit) delete overrides.personalFoulLimit
      else overrides.personalFoulLimit = limit
      return { ...current, ruleOverrides: overrides }
    })
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    } else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1
    else return

    event.preventDefault()
    const nextTab = tabs[nextIndex]
    setActiveTab(nextTab.id)
    requestAnimationFrame(() => {
      document.getElementById(`basketball-settings-tab-${nextTab.id}`)?.focus()
    })
  }

  const resetActiveTab = () => {
    setDraft(current => {
      const next = structuredClone(current)
      if (activeTab === 'rules') {
        next.baseProfile = structuredClone(DEFAULT_BASKETBALL_PERSONAL_SETTINGS.baseProfile)
        next.ruleOverrides = {}
      } else if (activeTab === 'capture') {
        next.capture = structuredClone(DEFAULT_BASKETBALL_PERSONAL_SETTINGS.capture)
      } else {
        next.display = structuredClone(DEFAULT_BASKETBALL_PERSONAL_SETTINGS.display)
      }
      return next
    })
  }

  const syncBusy = basketballSettingsSync.status === 'checking' ||
    basketballSettingsSync.status === 'saving'

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Basketball</h2>
          <div className="flex items-center gap-2" aria-live="polite">
            <SyncStatus status={basketballSettingsSync.status} />
            {dirty && (
              <span className="text-xs font-semibold text-amber-700">Unsaved changes</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshBasketballSettings()}
          disabled={syncBusy}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"
          title="Refresh cloud settings"
          aria-label="Refresh cloud settings"
        >
          <RefreshCw
            size={17}
            className={basketballSettingsSync.status === 'checking' ? 'animate-spin' : ''}
          />
        </button>
      </div>

      {basketballSettingsSync.error && (
        <p role="alert" className={`rounded-md border px-3 py-2 text-sm ${
          basketballSettingsSync.status === 'backend_update_required' ||
          basketballSettingsSync.status === 'local' ||
          basketballSettingsSync.status === 'synced'
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {basketballSettingsSync.error}
        </p>
      )}

      {basketballSettingsSync.conflict && (
        <div role="alert" className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            Settings changed on another device.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-secondary text-sm px-3"
              onClick={useCloudBasketballSettings}
            >
              Use Cloud
            </button>
            <button
              type="button"
              className="btn-primary text-sm px-3"
              onClick={() => void keepDeviceBasketballSettings()}
            >
              Keep This Device
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto border-b border-slate-200">
        <div className="flex min-w-max" role="tablist" aria-label="Basketball settings sections">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`basketball-settings-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls="basketball-settings-panel"
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={event => handleTabKeyDown(event, index)}
              className={`h-10 px-4 text-sm font-semibold border-b-2 ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div
        id="basketball-settings-panel"
        role="tabpanel"
        aria-labelledby={`basketball-settings-tab-${activeTab}`}
        tabIndex={0}
        className="min-h-[20rem]"
      >
        {activeTab === 'rules' && (
          <div className="space-y-5">
            <div className="space-y-2 border-y border-blue-100 bg-blue-50 px-3 py-3 text-sm">
              <p className="font-semibold text-blue-900">Which rules apply?</p>
              <p className="text-blue-800">
                These personal defaults apply when setting up Basketball event-model games.
                Current legacy games continue to use the team foul, timeout, and bonus rules
                configured for their season.
              </p>
              <Link
                to={settingsPath('data')}
                className="inline-flex min-h-10 items-center gap-2 font-semibold text-blue-700"
              >
                Open Seasons
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              Tracking profile
              <select
                value={`${draft.baseProfile.profileId}@${draft.baseProfile.profileVersion}`}
                onChange={event => {
                  const profile = profiles.find(item =>
                    `${item.profileId}@${item.profileVersion}` === event.target.value
                  )
                  if (profile) chooseProfile({
                    profileId: profile.profileId,
                    profileVersion: profile.profileVersion,
                  })
                }}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-slate-900"
              >
                {profiles.map(profile => (
                  <option
                    key={`${profile.profileId}@${profile.profileVersion}`}
                    value={`${profile.profileId}@${profile.profileVersion}`}
                  >
                    {profile.label} v{profile.profileVersion}
                  </option>
                ))}
              </select>
            </label>

            {resolved.ok ? (
              <>
                <NumberField
                  label="Player foul limit"
                  value={resolved.value.rules.personalFoulLimit}
                  min={1}
                  max={20}
                  onChange={setPersonalFoulLimit}
                />
                <RulesSummary resolution={resolved.value} />
              </>
            ) : (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {resolved.message}
              </p>
            )}
          </div>
        )}

        {activeTab === 'capture' && (
          <Toggle
            label="Missed-shot rebound prompt"
            checked={draft.capture.reboundPromptAfterMiss}
            onChange={reboundPromptAfterMiss => setDraft(current => ({
              ...current,
              capture: { reboundPromptAfterMiss },
            }))}
          />
        )}

        {activeTab === 'display' && (
          <Toggle
            label="Flip court by default"
            checked={draft.display.defaultCourtFlipped}
            onChange={defaultCourtFlipped => setDraft(current => ({
              ...current,
              display: { defaultCourtFlipped },
            }))}
          />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-2">
        <button
          type="button"
          onClick={resetActiveTab}
          className="inline-flex h-10 items-center gap-2 px-2 text-sm font-semibold text-slate-600"
        >
          <RotateCcw size={16} />
          Reset Tab
        </button>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="h-10 px-2 text-sm font-semibold text-slate-600"
        >
          Reset All
        </button>
      </div>

      <div className="sticky bottom-0 -mx-4 grid grid-cols-2 gap-2 border-t border-slate-200 bg-slate-50/95 p-4 backdrop-blur">
        <button
          type="button"
          className="btn-secondary"
          disabled={!dirty}
          onClick={() => {
            setDraft(structuredClone(basketballSettings))
            setDraftBaseRevision(basketballSettingsSync.revision)
          }}
        >
          Discard
        </button>
        <button
          type="button"
          className="btn-primary inline-flex items-center justify-center gap-2"
          disabled={!dirty || basketballSettingsSync.status === 'saving' || !resolved.ok}
          onClick={() => void saveBasketballSettings(draft, draftBaseRevision)}
        >
          {basketballSettingsSync.status === 'saving' ? (
            <RefreshCw size={17} className="animate-spin" />
          ) : basketballSettingsSync.status === 'synced' && !dirty ? (
            <Check size={17} />
          ) : (
            <Save size={17} />
          )}
          Save
        </button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset Basketball Defaults"
        message="Reset all personal Basketball rules, capture, and display preferences? The reset remains unsaved until you choose Save."
        confirmLabel="Reset Defaults"
        cancelLabel="Keep Changes"
        destructive={false}
        onConfirm={() => {
          setDraft(structuredClone(DEFAULT_BASKETBALL_PERSONAL_SETTINGS))
          setConfirmReset(false)
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  )
}

function RulesSummary({ resolution }: {
  resolution: Extract<
    ReturnType<typeof resolveBasketballRules>,
    { ok: true }
  >['value']
}) {
  const { profile, rules, customized } = resolution
  return (
    <div className="divide-y divide-slate-200 border-y border-slate-200">
      <SummaryRow label="Profile" value={`${profile.label} v${profile.profileVersion}${customized ? ' · Customized' : ''}`} />
      <SummaryRow
        label="Regulation"
        value={rules.regulationSegments.map(segment =>
          `${segment.label} (${Math.round(segment.durationMs / 60_000)} min)`
        ).join(', ')}
      />
      <SummaryRow
        label="Overtime"
        value={`${rules.overtimeTemplate.label}, ${Math.round(rules.overtimeTemplate.durationMs / 60_000)} min`}
      />
      <SummaryRow
        label="Foul windows"
        value={rules.foulWindows.map(window => {
          if (window.bonusThreshold === null) return `${window.label}: no bonus`
          return `${window.label}: bonus at ${window.bonusThreshold}`
        }).join(' · ')}
      />
      <SummaryRow
        label="Timeout pools"
        value={rules.timeoutPools.map(pool =>
          `${pool.label}: ${pool.totalLimit === null ? 'unlimited' : pool.totalLimit}`
        ).join(' · ')}
      />
      <div className="py-3">
        <p className="text-xs font-semibold uppercase text-slate-500">Sources</p>
        <p className="mt-1 text-sm text-slate-700">{profile.effectiveRulesLabel}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {profile.sourceUrls.map((url, index) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-blue-700 underline"
            >
              Source {index + 1}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3 text-sm">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className="min-w-0 text-slate-800">{value}</span>
    </div>
  )
}

function SyncStatus({ status }: {
  status: ReturnType<typeof useSettings>['basketballSettingsSync']['status']
}) {
  const labels = {
    local: 'Saved on this device',
    checking: 'Checking cloud settings',
    synced: 'Synced',
    saving: 'Saving',
    pending: 'Saved locally, cloud pending',
    conflict: 'Cloud conflict',
    backend_update_required: 'Local only',
    error: 'Cloud unavailable',
  } as const
  return (
    <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-slate-500">
      <Cloud size={13} />
      {labels[status]}
    </span>
  )
}

function Toggle({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-slate-700">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-slate-300'
        }`}
      >
        <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : ''
        }`} />
      </button>
    </label>
  )
}

function NumberField({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={event => {
          const next = Number(event.target.value)
          if (Number.isInteger(next)) onChange(Math.max(min, Math.min(max, next)))
        }}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5"
      />
    </label>
  )
}
