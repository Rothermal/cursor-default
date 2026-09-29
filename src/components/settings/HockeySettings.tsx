import { Link } from 'react-router-dom'
import { useSettings } from '../../context/SettingsContext'
import { getHockeyEventCreationPolicy } from '../../lib/sportAvailability'

/**
 * Hockey device settings (HKY-2E). The only setting is the owner opt-in for new event
 * games, which is stored on this device and defaults off. Existing event games stay
 * reachable whatever it is set to.
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
            ? 'New Hockey games use the rink tracker on this device. Games stay on this device and do not sync to the cloud yet.'
            : 'Unavailable in this build.'}
        </p>
      </div>
      <Link to="/settings/sports" className="btn-secondary inline-block text-center">
        Back to Sports
      </Link>
    </section>
  )
}
