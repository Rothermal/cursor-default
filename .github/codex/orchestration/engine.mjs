import { createHash } from 'node:crypto'

export const MODEL = 'gpt-6.1-sol'
export const EFFORT = 'ultra'
export const TERMINAL = new Set(['READY_FOR_HUMAN_REVIEW', 'BLOCKED', 'NEEDS_HUMAN_DECISION', 'BUDGET_EXHAUSTED', 'FAILED', 'STOPPED'])
export const PHASES = new Set(['INTAKE', 'TRIAGE', 'PLAN', 'CHALLENGE', 'IMPLEMENT', 'LOCAL_VALIDATE', 'REVIEW', 'REPAIR', 'FINAL_CHALLENGE', 'PR_UPDATE', 'CI_WAIT', 'CI_REPAIR', ...TERMINAL])

export function assertPolicy(p) {
  if (p.version !== 1 || p.model !== MODEL || p.effort !== EFFORT) throw Error('Only gpt-6.1-sol / ultra is permitted')
  for (const key of ['repairs', 'calls', 'minutes', 'tokens', 'commandMinutes']) {
    if (!Number.isSafeInteger(p.limits[key]) || p.limits[key] < 1) throw Error(`Invalid limit: ${key}`)
  }
  if (!p.checks?.length || !p.expectedChecks?.length) throw Error('Validation and expected CI checks must be configured')
  for (const command of p.checks) if (!Array.isArray(command) || !command.length || command.some(x => typeof x !== 'string' || !x)) throw Error('Invalid check command')
  return p
}

export function riskFor(text, files = [], proposed = 'small') {
  if (!['small', 'medium', 'high'].includes(proposed)) throw Error('Invalid classification')
  const high = /auth|permission|payment|migrat|destruct|secret|security|dependenc|public.api|supabase|cloud.sync|fingerprint|quarantine|rollout/i.test(text) ||
    files.some(f => /^(supabase\/|\.github\/|\.codex\/|.*(?:package\.json|pnpm-lock\.yaml|AGENTS\.md)$)|(?:auth|permission|cloudSync|gameSyncFingerprint)/i.test(f))
  return high ? 'high' : proposed
}

export function rolesFor(risk) {
  if (!['small', 'medium', 'high'].includes(risk)) throw Error('Invalid classification')
  return ['orchestrator', ...(risk !== 'small' ? ['architect'] : []), ...(risk === 'high' ? ['challenger'] : []), 'developer', 'reviewer']
}

export function policyChanged(files) {
  return files.some(f => /^(?:\.github\/|\.codex\/|\.agents\/)|(?:^|\/)(?:AGENTS\.md|package\.json|(?:pnpm-lock|pnpm-workspace)\.yaml|(?:package-lock|tsconfig[^/]*)\.json|yarn\.lock|\.npmrc|\.?pnpmfile\.cjs|\.gitignore|\.gitattributes|\.gitmodules|\.nvmrc|\.node-version|.*\.config\.[^/]+)$/.test(f))
}

export function validateReport(r, head, base) {
  if (!r || r.headSha !== head || r.baseSha !== base) throw Error('Report does not match current head/base')
  if (!['small', 'medium', 'high'].includes(r.classification) || typeof r.complete !== 'boolean' || typeof r.summary !== 'string' || !r.summary.trim() || typeof r.plan !== 'string' ||
      !['pass', 'changes', 'incomplete'].includes(r.verdict) || !Array.isArray(r.acceptance) || !Array.isArray(r.findings)) throw Error('Malformed role report')
  if (r.acceptance.some(a => typeof a.criterion !== 'string' || !a.criterion.trim() || typeof a.evidence !== 'string' || !a.evidence.trim() || !['passed', 'failed', 'manual'].includes(a.status))) throw Error('Malformed acceptance evidence')
  const ids = new Set()
  for (const f of r.findings) {
    if (!f.id || ids.has(f.id) || !['P0', 'P1', 'P2'].includes(f.priority) || typeof f.blocking !== 'boolean' ||
        typeof f.file !== 'string' || !Number.isSafeInteger(f.line) || f.line < 1 || !f.evidence?.trim() ||
        !['open', 'resolved', 'superseded'].includes(f.status) || typeof f.disposition !== 'string') throw Error('Malformed finding')
    ids.add(f.id)
  }
  return r
}

export function reviewPasses(r, head, base, previous = []) {
  validateReport(r, head, base)
  return r.complete && r.verdict === 'pass' && r.acceptance.length > 0 && r.acceptance.every(a => a.status === 'passed') &&
    r.findings.every(f => f.status !== 'open' || (f.priority === 'P2' && !f.blocking && f.disposition.trim())) &&
    previous.every(f => r.findings.some(n => n.id === f.id && (n.status !== 'open' || (!n.blocking && n.priority === 'P2' && n.disposition.trim()))))
}

export function checksPass(v, head, base, policy) {
  return v?.headSha === head && v?.baseSha === base && v.checks?.length === policy.checks.length &&
    policy.checks.every((cmd, i) => JSON.stringify(v.checks[i].command) === JSON.stringify(cmd) && v.checks[i].exitCode === 0)
}

export function budgetReason(s, now = Date.now()) {
  if (now - Date.parse(s.startedAt) >= s.limits.minutes * 60000) return 'Wall-clock budget exhausted'
  if (s.calls >= s.limits.calls) return 'Agent-call budget exhausted'
  if (s.tokens >= s.limits.tokens) return 'Observed token budget exhausted (not a provider spend cap)'
  return null
}

export function repair(s, evidence, phase = 'REPAIR') {
  const signature = createHash('sha256').update(evidence).digest('hex')
  if (s.lastFailure === signature) return { phase: 'BLOCKED', reason: 'Repeated identical failure; no new evidence' }
  if (s.repairs >= s.limits.repairs) return { phase: 'BUDGET_EXHAUSTED', reason: 'Repair iteration limit reached' }
  s.repairs++
  s.lastFailure = signature
  return { phase, reason: evidence }
}

export function ciVerdict(v, s, p) {
  if (v.headSha !== s.headSha || v.baseSha !== s.baseSha) return { kind: 'stale', reason: 'PR head/base changed; revalidation and rereview required' }
  if (!v.protectionKnown || !v.rulesKnown) return { kind: 'blocked', reason: 'Branch protection/rules could not be inspected' }
  if (v.state !== 'OPEN' || v.baseBranch !== p.baseBranch || !v.isDraft) return { kind: 'blocked', reason: 'Expected an open pipeline-owned draft PR targeting the configured base' }
  if (!Array.isArray(v.checks) || !v.checks.length || p.expectedChecks.some(name => !v.checks.some(c => c.name === name))) return { kind: 'pending', reason: 'Expected CI checks missing' }
  if (v.checks.some(c => ['fail', 'cancel', 'skipping'].includes(c.bucket))) return { kind: 'repair', reason: 'Current-head CI failed, cancelled or skipped' }
  if (v.checks.some(c => c.bucket !== 'pass')) return { kind: 'pending', reason: 'Current-head CI pending' }
  if (!v.requiredChecks?.length || v.requiredChecks.some(c => c.bucket !== 'pass')) return { kind: 'blocked', reason: 'Required checks unavailable or not passed' }
  if (v.reviewDecision === 'REVIEW_REQUIRED' || v.reviewDecision === 'CHANGES_REQUESTED' || v.otherRules || !v.mergeable) return { kind: 'human', reason: 'Human approval or another branch-protection condition remains' }
  return { kind: 'ready', reason: 'Current reviewed commit and inspected gates passed; human review remains separate' }
}
