import { Link } from 'react-router-dom'
import { useSettings } from '../../context/SettingsContext'
import { getBaseballEventCreationPolicy } from '../../lib/sportAvailability'

/**
 * Baseball device settings (BSB-3D). The only setting is the owner opt-in for new event
 * games, which is stored on this device and defaults off. Existing event games stay
 * reachable whatever it is set to.
 */
export default function BaseballSettings() {
  const { baseballEventTrackerEnabled, setBaseballEventTrackerEnabled } = useSettings()
  const policy = getBaseballEventCreationPolicy(baseballEventTrackerEnabled)

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold text-content">⚾ Baseball settings</h2>
      <div className="space-y-2 border-y border-info-line bg-info px-3 py-3">
        <div className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-content">
          <span id="baseball-event-tracker-label">New event tracker (preview)</span>
          <button
            type="button"
            role="switch"
            aria-checked={baseballEventTrackerEnabled}
            aria-labelledby="baseball-event-tracker-label"
            disabled={!policy.preferenceAvailable}
            onClick={() => setBaseballEventTrackerEnabled(!baseballEventTrackerEnabled)}
            className={`relative h-7 w-12 shrink-0 rounded-full disabled:cursor-not-allowed disabled:bg-control-disabled ${
              baseballEventTrackerEnabled ? 'bg-accent' : 'bg-control'
            }`}
          >
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full shadow transition-transform ${
              baseballEventTrackerEnabled ? 'translate-x-5 bg-accent-content' : 'bg-content'
            }`} />
          </button>
        </div>
        <p className="text-xs text-info-content">
          {policy.preferenceAvailable
            ? 'New Baseball games use the diamond tracker on this device. Games stay on this device and do not sync to the cloud yet.'
            : 'Unavailable in this build.'}
        </p>
      </div>
      <Link to="/settings/sports" className="btn-secondary inline-block text-center">
        Back to Sports
      </Link>
    </section>
  )
}
