import { Link } from 'react-router-dom'
import { useEffect } from 'react'
import { useSettings } from '../../context/SettingsContext'
import BaseballPersonalSettingsEditor from './BaseballPersonalSettingsEditor'

/** Personal rules and device-only capture defaults; event creation is no longer optional. */
export default function BaseballSettings() {
  const { baseball, baseballDeviceSettings, setBaseballDeviceSetting, setBaseballSettingsPageActive } = useSettings()
  useEffect(() => { setBaseballSettingsPageActive(true); return () => setBaseballSettingsPageActive(false) }, [setBaseballSettingsPageActive])

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-content">Baseball settings</h2>
      <BaseballPersonalSettingsEditor key={baseball.scopeKey} personal={baseball} />
      <fieldset className="space-y-3 py-2"><legend className="font-semibold text-content">New-game capture defaults</legend>
        {([['trackPitchLocation', 'Pitch location'], ['trackBattedBallLocation', 'Batted-ball location']] as const).map(([key, label]) => <label key={key} className="flex min-h-11 items-center justify-between gap-3 text-sm text-content"><span>{label}</span><input type="checkbox" checked={baseballDeviceSettings[key]} onChange={event => setBaseballDeviceSetting(key, event.target.checked)} /></label>)}
      </fieldset>
      <Link to="/settings/sports" className="btn-secondary inline-block text-center">
        Back to Sports
      </Link>
    </section>
  )
}
