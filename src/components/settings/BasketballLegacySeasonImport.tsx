import { Download, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { previewBasketballLegacySeasonImport } from '../../lib/basketball/legacySeasonImport'
import {
  listBasketballRulesProfiles,
  type BasketballRulesProfileRef,
} from '../../lib/basketball/profiles'
import type { BasketballTeamSettingsV1 } from '../../lib/basketball/settings'
import { supabase } from '../../lib/supabase'

export default function BasketballLegacySeasonImport({
  seasonId,
  seasonName,
  disabled,
  onApply,
}: {
  seasonId: string
  seasonName: string
  disabled: boolean
  onApply: (settings: BasketballTeamSettingsV1) => void
}) {
  const profiles = useMemo(listBasketballRulesProfiles, [])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [legacyConfig, setLegacyConfig] = useState<unknown>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [fallbackKey, setFallbackKey] = useState('')
  const [confirmedDefaults, setConfirmedDefaults] = useState(false)
  const [confirmedMapping, setConfirmedMapping] = useState(false)

  const fallbackProfile = useMemo<BasketballRulesProfileRef | null>(() => {
    const profile = profiles.find(item =>
      `${item.profileId}@${item.profileVersion}` === fallbackKey
    )
    return profile
      ? { profileId: profile.profileId, profileVersion: profile.profileVersion }
      : null
  }, [fallbackKey, profiles])
  const preview = useMemo(() => (
    loaded && fallbackProfile
      ? previewBasketballLegacySeasonImport(legacyConfig, fallbackProfile)
      : null
  ), [fallbackProfile, legacyConfig, loaded])

  const loadSeason = async () => {
    setLoading(true)
    setError(null)
    setLoaded(false)
    if (!supabase) {
      setError('Cloud access is not configured on this device.')
      setLoading(false)
      return
    }
    const response = await supabase
      .from('seasons')
      .select('team_stats_config')
      .eq('id', seasonId)
      .maybeSingle()
    if (response.error) {
      setError(`Legacy season rules could not be loaded: ${response.error.message}`)
    } else if (!response.data) {
      setError('The selected season is no longer available.')
    } else {
      setLegacyConfig(response.data.team_stats_config)
      setLoaded(true)
      setConfirmedDefaults(false)
      setConfirmedMapping(false)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-3 border-y border-slate-200 py-3">
      <div>
        <p className="text-sm font-semibold text-slate-800">Legacy season rules</p>
        <p className="mt-1 text-xs text-slate-500">
          Review rules from {seasonName} before applying them to this unsaved team draft.
          The season record is never changed.
        </p>
      </div>
      <button
        type="button"
        className="btn-secondary inline-flex w-full items-center justify-center gap-2"
        disabled={loading || (disabled && !open)}
        onClick={() => {
          const nextOpen = !open
          setOpen(nextOpen)
          if (nextOpen && !loaded) void loadSeason()
        }}
      >
        {loading ? <RefreshCw size={17} className="animate-spin" /> : <Download size={17} />}
        {open ? 'Close Legacy Import' : 'Import Legacy Season Rules'}
      </button>

      {open && (
        <div className="space-y-4 bg-slate-50 px-3 py-3">
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {error && (
            <button type="button" className="btn-secondary w-full" onClick={() => void loadSeason()}>
              Retry
            </button>
          )}
          {loaded && (
            <>
              <label className="block text-sm font-medium text-slate-700">
                Modern fallback profile
                <select
                  value={fallbackKey}
                  disabled={disabled}
                  onChange={event => {
                    setFallbackKey(event.target.value)
                    setConfirmedDefaults(false)
                    setConfirmedMapping(false)
                  }}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-slate-900"
                >
                  <option value="">Choose a profile</option>
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
              <p className="text-xs text-slate-500">
                The legacy season does not identify its governing rule set. This choice supplies
                modern-only durations, lineup boundaries, and the player foul limit.
              </p>

              {preview?.ok && (
                <div className="space-y-3 text-sm text-slate-700">
                  <ReviewList title="Legacy values" items={preview.legacySummary} />
                  {preview.legacyDefaultedFields.length > 0 && (
                    <ReviewList
                      title="Legacy runtime defaults used"
                      items={preview.legacyDefaultedFields.map(field => fieldLabel(field))}
                    />
                  )}
                  <ReviewList title="Fallback values" items={preview.fallbackSummary} />
                  <ReviewList title="Mapping" items={preview.mappingSummary} />
                </div>
              )}
              {preview && !preview.ok && (
                <p role="alert" className="text-sm text-red-700">{preview.error}</p>
              )}

              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={confirmedDefaults}
                  onChange={event => setConfirmedDefaults(event.target.checked)}
                  className="mt-1"
                />
                <span>The selected profile should supply the modern-only fields listed above.</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={confirmedMapping}
                  onChange={event => setConfirmedMapping(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  Each legacy period should become an independent foul and timeout window;
                  timeout kinds remain unrestricted within the total cap.
                </span>
              </label>
              <button
                type="button"
                className="btn-primary w-full"
                disabled={disabled || !preview?.ok || !confirmedDefaults || !confirmedMapping}
                onClick={() => {
                  if (!preview?.ok) return
                  onApply(structuredClone(preview.settings))
                  setOpen(false)
                }}
              >
                Apply to Unsaved Draft
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

function fieldLabel(field: string): string {
  switch (field) {
    case 'periodsPerGame': return 'Regulation-period count'
    case 'periodLabels': return 'Period labels'
    case 'bonusThreshold': return 'Bonus threshold'
    case 'doubleBonusThreshold': return 'Double-bonus threshold'
    case 'hasOneAndOne': return '1-and-1 behavior'
    case 'overtimeLabel': return 'Overtime label'
    case 'overtimeFoulsReset': return 'Overtime foul reset behavior'
    case 'timeoutsPerPeriod': return 'Timeouts per period'
    case 'timeoutsPerOvertime': return 'Timeouts per overtime'
    default: return field
  }
}
