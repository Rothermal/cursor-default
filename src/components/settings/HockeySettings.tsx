import { RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSettings } from '../../context/SettingsContext'
import { useSportPersonalSettings, type SportPersonalSettingsStatus } from '../../hooks/useSportPersonalSettings'
import { hockeySettingsFingerprint, hockeySettingsRules } from '../../lib/hockey/settings'
import { hockeyPersonalSettingsAdapter } from '../../lib/hockey/settingsSync'
import { createSettingsDraft, editSettingsDraft, syncSettingsDraft } from '../../lib/settingsDraft'
import { getHockeyEventCreationPolicy } from '../../lib/sportAvailability'
import HockeyRulesFields from './HockeyRulesFields'

/**
 * Hockey settings. The event tracker opt-in (HKY-2E) is stored on this device and defaults
 * off; existing event games stay reachable whatever it is set to. The personal rules default
 * (HKY-5C) syncs with the account and applies to new games without a team.
 */
export default function HockeySettings() {
  const { hockeyEventTrackerEnabled, setHockeyEventTrackerEnabled } = useSettings()
  const policy = getHockeyEventCreationPolicy(hockeyEventTrackerEnabled)

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold text-content">🏒 Hockey settings</h2>
      <div className="space-y-2 border-y border-info-line bg-info px-3 py-3">
        <div className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-content">
          <span id="hockey-event-tracker-label">New event tracker (preview)</span>
          <button
            type="button"
            role="switch"
            aria-checked={hockeyEventTrackerEnabled}
            aria-labelledby="hockey-event-tracker-label"
            disabled={!policy.preferenceAvailable}
            onClick={() => setHockeyEventTrackerEnabled(!hockeyEventTrackerEnabled)}
            className={`relative h-7 w-12 shrink-0 rounded-full disabled:cursor-not-allowed disabled:bg-control-disabled ${
              hockeyEventTrackerEnabled ? 'bg-accent' : 'bg-control'
            }`}
          >
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full shadow transition-transform ${
              hockeyEventTrackerEnabled ? 'translate-x-5 bg-accent-content' : 'bg-content'
            }`} />
          </button>
        </div>
        <p className="text-xs text-info-content">
          {policy.preferenceAvailable
            ? 'New Hockey games use the rink tracker on this device.'
            : 'Unavailable in this build.'}
        </p>
      </div>
      <PersonalHockeyRules />
      <Link to="/settings/sports" className="btn-secondary inline-block text-center">
        Back to Sports
      </Link>
    </section>
  )
}

function PersonalHockeyRules() {
  const personal = useSportPersonalSettings(hockeyPersonalSettingsAdapter)
  const [state, setState] = useState(() =>
    createSettingsDraft(personal.settings, personal.sync.revision, hockeySettingsFingerprint))
  const draft = state.draft
  const dirty = hockeySettingsFingerprint(draft) !== hockeySettingsFingerprint(personal.settings)
  const busy = personal.sync.status === 'checking' || personal.sync.status === 'saving'
  const conflict = personal.sync.conflict

  // Adopt loaded or saved settings, and their revision, unless there are unsaved edits. An
  // edited draft keeps the revision it started from, so saving it after another device's
  // change becomes a conflict rather than an overwrite.
  useEffect(() => {
    setState(current => syncSettingsDraft(current, personal.settings, personal.sync.revision, hockeySettingsFingerprint))
  }, [personal.settings, personal.sync.revision])

  return (
    <div className="space-y-3 border-b border-line pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-content">Rules for games without a team</h3>
          <p className="text-xs text-content-muted">New games copy these. A team game uses its team's defaults instead.</p>
        </div>
        <button
          type="button"
          onClick={() => void personal.refresh()}
          disabled={busy}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line text-content-muted disabled:bg-control-disabled disabled:text-content-disabled"
          title="Refresh Hockey settings"
          aria-label="Refresh Hockey settings"
        >
          <RefreshCw size={17} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted" aria-live="polite">
        <span>{personalStatusLabel(personal.sync.status)}</span>
        {dirty && <span className="font-semibold text-warning-content">Unsaved changes</span>}
      </div>
      {personal.sync.error && (
        <p role="alert" className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">{personal.sync.error}</p>
      )}
      {conflict && (
        <div role="alert" className="space-y-2 rounded-md border border-warning-line bg-warning p-3">
          <p className="text-sm font-semibold text-warning-content">These settings changed on another device.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={() => {
              personal.useCloud()
              setState(createSettingsDraft(conflict.cloud, conflict.cloudRevision, hockeySettingsFingerprint))
            }}>Use Cloud</button>
            <button type="button" className="btn-secondary text-sm" onClick={() => void personal.keepDevice()}>Keep This Device</button>
          </div>
        </div>
      )}
      <HockeyRulesFields idPrefix="hockey-personal" settings={draft} disabled={busy} onChange={next => setState(current => editSettingsDraft(current, next))} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" disabled={!dirty} onClick={() => setState(createSettingsDraft(personal.settings, personal.sync.revision, hockeySettingsFingerprint))}>
          Discard
        </button>
        <button
          type="button"
          className="btn-primary inline-flex items-center justify-center gap-2"
          disabled={!dirty || busy || !hockeySettingsRules(draft)}
          onClick={() => void personal.save(draft, state.baseRevision)}
        >
          {personal.sync.status === 'saving' ? <RefreshCw size={17} className="animate-spin" /> : <Save size={17} />}
          Save
        </button>
      </div>
    </div>
  )
}

function personalStatusLabel(status: SportPersonalSettingsStatus): string {
  switch (status) {
    case 'local': return 'Saved on this device'
    case 'checking': return 'Checking the cloud copy'
    case 'synced': return 'Synced with your account'
    case 'saving': return 'Saving'
    case 'pending': return 'Saved on this device; syncs when you reconnect'
    case 'conflict': return 'Choose which settings to keep'
    case 'backend_update_required': return 'Backend update required; saved on this device'
    case 'error': return 'Cloud settings unavailable'
  }
}
