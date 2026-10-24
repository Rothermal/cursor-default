import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { baseballRulesProfiles } from '../../lib/baseball/profiles'
import { resolveBaseballTeamRules, type BaseballPersonalSettingsV1, type BaseballTeamRuleOverrides } from '../../lib/baseball/settings'
import type { BaseballBattingOrderFormat, BaseballProfileId } from '../../lib/baseball/types'

export default function BaseballRulesDefaultsFields({ value, onChange, disabled = false }: {
  value: BaseballPersonalSettingsV1
  onChange: (settings: BaseballPersonalSettingsV1) => void
  disabled?: boolean
}) {
  const result = resolveBaseballTeamRules(value)
  const rules = result.ok ? result.rules : null
  const patch = (changes: BaseballTeamRuleOverrides) => onChange({ ...value, ruleOverrides: { ...value.ruleOverrides, ...changes } })
  return <fieldset disabled={disabled} className="space-y-3 min-w-0">
    <legend className="font-semibold text-content">Rules</legend>
    <label className="block text-sm font-medium">Rules profile<select className="input-field mt-1 w-full" value={value.baseProfile.profileId} onChange={event => onChange({ ...value, baseProfile: { profileId: event.target.value as BaseballProfileId, profileVersion: 1 } })}>
      {baseballRulesProfiles().map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
    </select></label>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block text-sm font-medium">Innings<input className="input-field mt-1 w-full" type="number" min={1} max={15} value={value.ruleOverrides.scheduledInnings ?? rules?.scheduledInnings ?? ''} onChange={event => patch({ scheduledInnings: Number(event.target.value) })} /></label>
      <label className="block text-sm font-medium">Batting order<select className="input-field mt-1 w-full" value={value.ruleOverrides.battingOrderFormat ?? rules?.battingOrderFormat ?? 'standard'} onChange={event => patch({ battingOrderFormat: event.target.value as BaseballBattingOrderFormat })}>
        <option value="standard">Standard (nine batters)</option><option value="designated_hitter">Designated hitter</option><option value="extra_hitter">Extra hitters</option><option value="continuous">Continuous order</option>
      </select></label>
      {(value.ruleOverrides.battingOrderFormat ?? rules?.battingOrderFormat) === 'extra_hitter' && <label className="block text-sm font-medium">Extra hitters<input className="input-field mt-1 w-full" type="number" min={0} max={5} value={value.ruleOverrides.maxExtraHitters ?? rules?.maxExtraHitters ?? 0} onChange={event => patch({ maxExtraHitters: Number(event.target.value) })} /></label>}
      <label className="block text-sm font-medium">Pitch count limit<input className="input-field mt-1 w-full" type="number" min={1} max={500} placeholder="None" value={Object.prototype.hasOwnProperty.call(value.ruleOverrides, 'pitchCountLimit') ? value.ruleOverrides.pitchCountLimit ?? '' : rules?.pitchCountLimit ?? ''} onChange={event => patch({ pitchCountLimit: event.target.value === '' ? null : Number(event.target.value) })} /></label>
    </div>
    <div className="space-y-2">
      <p className="text-sm font-medium">Run rules</p>
      {(value.ruleOverrides.runRules ?? rules?.runRules ?? []).map((rule, index, entries) => <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
        <span>Lead</span><input aria-label={`Run rule ${index + 1} lead`} className="input-field w-20" type="number" min={1} max={100} value={rule.lead} onChange={event => patch({ runRules: entries.map((entry, i) => i === index ? { ...entry, lead: Number(event.target.value) } : entry) })} />
        <span>after inning</span><input aria-label={`Run rule ${index + 1} inning`} className="input-field w-20" type="number" min={1} max={15} value={rule.afterInning} onChange={event => patch({ runRules: entries.map((entry, i) => i === index ? { ...entry, afterInning: Number(event.target.value) } : entry) })} />
        <button type="button" className="h-9 w-9 grid place-items-center rounded-md border border-line" title="Remove run rule" aria-label={`Remove run rule ${index + 1}`} onClick={() => patch({ runRules: entries.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
      </div>)}
      {(value.ruleOverrides.runRules ?? rules?.runRules ?? []).length < 5 && <button type="button" className="inline-flex items-center gap-2 min-h-9 text-sm text-accent" onClick={() => patch({ runRules: [...(value.ruleOverrides.runRules ?? rules?.runRules ?? []), { afterInning: 4, lead: 10 }] })}><Plus size={16} />Add run rule</button>}
    </div>
    {!result.ok && <p role="alert" className="text-sm text-danger-content">{result.error}</p>}
    {Object.keys(value.ruleOverrides).length > 0 && <button type="button" className="inline-flex items-center gap-2 min-h-9 text-sm text-accent" onClick={() => onChange({ ...value, ruleOverrides: {} })}><RotateCcw size={16} />Use profile rules</button>}
  </fieldset>
}
