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
import { resolveBasketballRules } from '../../lib/basketball/profiles'
import {
  basketballSettingsFingerprint,
} from '../../lib/basketball/personalSettingsSync'
import {
  DEFAULT_BASKETBALL_PERSONAL_SETTINGS,
  type BasketballPersonalSettingsV1,
} from '../../lib/basketball/settings'
import { settingsPath } from '../../lib/settingsNavigation'
import { getBasketballEventCreationPolicy } from '../../lib/sportAvailability'
import ConfirmDialog from '../ConfirmDialog'
import BasketballRulesSettingsFields from './BasketballRulesSettingsFields'

type BasketballSettingsTab = 'rules' | 'capture' | 'display' | 'tracker'

const tabs: Array<{ id: BasketballSettingsTab; label: string }> = [
  { id: 'rules', label: 'Rules' },
  { id: 'capture', label: 'Capture' },
  { id: 'display', label: 'Display' },
  { id: 'tracker', label: 'Tracker' },
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
    basketballEventTrackerPreviewEnabled,
    setBasketballEventTrackerPreviewEnabled,
  } = useSettings()
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
  const eventCreationPolicy = getBasketballEventCreationPolicy(
    basketballEventTrackerPreviewEnabled
  )
  const trackerTabActive = activeTab === 'tracker'

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
            {trackerTabActive ? (
              <span className="text-xs text-slate-500">Saved on this device</span>
            ) : (
              <SyncStatus status={basketballSettingsSync.status} />
            )}
            {!trackerTabActive && dirty && (
              <span className="text-xs font-semibold text-amber-700">Unsaved changes</span>
            )}
          </div>
        </div>
        {!trackerTabActive && (
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
        )}
      </div>

      {!trackerTabActive && basketballSettingsSync.error && (
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

      {!trackerTabActive && basketballSettingsSync.conflict && (
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

            <BasketballRulesSettingsFields
              settings={draft}
              layerId="personal"
              profileSourceLabel="Personal profile"
              overrideSourceLabel="Personal override"
              onChange={rules => setDraft(current => ({ ...current, ...rules }))}
            />
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

        {activeTab === 'tracker' && (
          <div className="space-y-3 border-y border-blue-100 bg-blue-50 px-3 py-3">
            <Toggle
              label="New event tracker (preview)"
              checked={basketballEventTrackerPreviewEnabled}
              disabled={!eventCreationPolicy.preferenceAvailable}
              onChange={setBasketballEventTrackerPreviewEnabled}
            />
            {!eventCreationPolicy.preferenceAvailable && (
              <p role="status" className="text-xs font-medium text-blue-800">
                Unavailable in this build
              </p>
            )}
          </div>
        )}
      </div>

      {!trackerTabActive && (
        <>
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
        </>
      )}

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

function Toggle({ label, checked, disabled = false, onChange }: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-slate-700">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
