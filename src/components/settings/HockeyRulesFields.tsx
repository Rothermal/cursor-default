import { hockeyRulesProfiles } from '../../lib/hockey/profiles'
import { hockeySettingsRules, hockeySettingsWithProfile, hockeySettingsWithRules } from '../../lib/hockey/settings'
import type { HockeyMatchRules, HockeyProfileId, HockeySettingsV1 } from '../../lib/hockey/types'

type ClockChoice = 'stop_time' | 'running' | 'none'

const CLOCK_OPTIONS: { value: ClockChoice; label: string }[] = [
  { value: 'stop_time', label: 'Stop time' },
  { value: 'running', label: 'Running' },
  { value: 'none', label: 'No clock' },
]

/**
 * Hockey rules defaults shared by personal Settings and Team Manage (HKY-5C): the profile,
 * periods, period length and clock. Values equal to the profile store no override, so
 * choosing the profile's value again removes it. New games copy these; started games keep
 * their own frozen rules.
 */
export default function HockeyRulesFields<T extends HockeySettingsV1>({
  idPrefix,
  settings,
  disabled,
  onChange,
}: {
  idPrefix: string
  settings: T
  disabled: boolean
  onChange: (settings: T) => void
}) {
  const rules = hockeySettingsRules(settings)
  const profiles = hockeyRulesProfiles()
  const profile = profiles.find(entry => entry.id === settings.baseProfile.profileId)
  const customized = Object.keys(settings.ruleOverrides).length > 0
  const change = (next: HockeyMatchRules) => onChange(hockeySettingsWithRules(settings, next))
  const clock: ClockChoice = !rules || rules.clockModel === 'none' ? 'none' : rules.clock?.mode ?? 'stop_time'

  const setClock = (value: ClockChoice) => {
    if (!rules) return
    change(value === 'none'
      ? { ...rules, clockModel: 'none', clock: null }
      : { ...rules, clockModel: 'anchored', clock: { display: rules.clock?.display ?? 'count_down', mode: value } })
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm text-content" htmlFor={`${idPrefix}-profile`}>
        <span className="font-medium">Rules profile</span>
        <select
          id={`${idPrefix}-profile`}
          className="input-field w-full"
          value={settings.baseProfile.profileId}
          disabled={disabled}
          onChange={event => onChange(hockeySettingsWithProfile(settings, event.target.value as HockeyProfileId))}
        >
          {profiles.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      {profile && <p className="text-xs text-content-muted">{profile.description}</p>}
      {rules ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-sm text-content">
              <span className="font-medium">Periods</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={5}
                className="input-field w-full"
                disabled={disabled}
                value={rules.regulation.periods}
                onChange={event => {
                  const periods = Number(event.target.value)
                  if (Number.isInteger(periods) && periods >= 1 && periods <= 5) {
                    change({ ...rules, regulation: { ...rules.regulation, periods } })
                  }
                }}
              />
            </label>
            <label className="block space-y-1 text-sm text-content">
              <span className="font-medium">Period length (min)</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                className="input-field w-full"
                disabled={disabled}
                value={Math.round(rules.regulation.periodLengthMs / 60_000)}
                onChange={event => {
                  const minutes = Number(event.target.value)
                  if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 60) {
                    change({ ...rules, regulation: { ...rules.regulation, periodLengthMs: minutes * 60_000 } })
                  }
                }}
              />
            </label>
          </div>
          <div className="text-sm font-medium text-content">
            <p>Clock</p>
            <div className="mt-1 grid grid-cols-3 overflow-hidden rounded-md border border-line-strong" role="group" aria-label="Clock">
              {CLOCK_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={clock === option.value}
                  className={`min-h-10 px-2 text-sm disabled:cursor-not-allowed ${clock === option.value ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
                  onClick={() => setClock(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-content-muted">
            {rules.skatersPerSide} skaters a side
            {rules.overtime ? `, ${Math.round(rules.overtime.lengthMs / 60_000)}-minute overtime` : ', no overtime'}
            {rules.shootout ? ', shootout' : ''}
            {rules.tiesAllowed ? ', ties allowed' : ''}. Other rules follow the profile.
          </p>
        </>
      ) : (
        <p role="alert" className="text-sm text-warning-content">These rules are not valid for the profile. Use the profile rules to continue.</p>
      )}
      {customized && !disabled && (
        <button
          type="button"
          className="text-sm font-semibold text-info-content"
          onClick={() => onChange({ ...settings, ruleOverrides: {} })}
        >
          Use profile rules
        </button>
      )}
    </div>
  )
}
