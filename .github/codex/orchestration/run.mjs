import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertPolicy, MODEL, EFFORT, PHASES, TERMINAL, riskFor, rolesFor, policyChanged, validateReport, reviewPasses, checksPass, budgetReason, repair, ciVerdict } from './engine.mjs'
import { TOOLING, LocalAdapter, atomicJSON, readJSON, execute } from './adapters.mjs'
import { acquireLock } from './storage.mjs'
import { readSwitch, setSwitch, readStop, stopRun, disableRepository, RunControl, StopRequested, markStopped, resumeState } from './control.mjs'
export { acquireLock } from './storage.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
export function toolingDigest(policy) {
  const files = ['run.mjs', 'engine.mjs', 'adapters.mjs', 'control.mjs', 'storage.mjs', 'report.schema.json', ...fs.readdirSync(path.join(TOOLING, 'prompts')).sort().map(f => `prompts/${f}`)]
  return hash(JSON.stringify(policy) + files.map(f => fs.readFileSync(path.join(TOOLING, f), 'utf8')).join('\n'))
}
export function newState(id, task, policy, baseSha, worktree, now = new Date().toISOString()) {
  assertPolicy(policy)
  return { version: 1, id, task, repository: policy.repository, model: MODEL, effort: EFFORT,
    baseSha, headSha: baseSha, branch: `codex/orchestrate-${id}`, worktree,
    phase: 'INTAKE', classification: riskFor(task), reason: 'New run',
    startedAt: now, updatedAt: now, limits: { ...policy.limits }, calls: 0, tokens: 0,
    usageObserved: false, repairs: 0, reports: [], findings: [], acceptance: [],
    remoteAuthorized: false, history: [], toolingDigest: toolingDigest(policy), inFlight: null, controlEpoch: null, acceptedStopRequest: null }
}

function coverage(r, criteria) {
  return r.acceptance.length === criteria.length && new Set(r.acceptance.map(a => a.criterion)).size === criteria.length && criteria.every(c => r.acceptance.some(a => a.criterion === c))
}
function blocking(r) { return r.findings.some(f => f.status === 'open' && (f.blocking || f.priority !== 'P2')) }
function acceptance(s) { return s.acceptance.map(a => a.criterion) }

export function prBody(s) {
  return `## Summary\n\n${s.reports.find(r => r.role === 'orchestrator')?.report.summary || s.id}\n\n` +
    `## Architecture and acceptance\n\n${s.plan || ''}\n\n${acceptance(s).map(c => `- ${c}`).join('\n')}\n\n` +
    `## Validation\n\nReviewed head: ${s.headSha}\nBase: ${s.baseSha}\n\n` +
    s.validation.checks.map(c => `- ${c.command.join(' ')}: exit ${c.exitCode}`).join('\n') +
    `\n\n## Risks and human review\n\n${s.review.summary}\n\nClassification: ${s.classification}. ` +
    `No live Supabase, device, PWA or release signoff is implied. This PR remains draft; no automatic merge.\n`
}

// An injected adapter permits deterministic offline fault tests of the real loop.
export async function drive(s, p, io, save = () => {}, { maxSteps = 1000 } = {}) {
  assertPolicy(p)
  if (s.version !== 1 || s.model !== MODEL || s.effort !== EFFORT || s.repository !== p.repository || s.toolingDigest !== toolingDigest(p) || !PHASES.has(s.phase)) throw Error('State/policy/tooling mismatch; inspect rather than silently upgrading a run')
  function move(phase, reason) {
    s.history.push({ from: s.phase, to: phase, reason, at: new Date().toISOString(), headSha: s.headSha })
    s.phase = phase; s.reason = reason; s.updatedAt = new Date().toISOString(); s.inFlight = null; save()
  }
  function budget() {
    const reason = budgetReason(s)
    if (reason) { move('BUDGET_EXHAUSTED', reason); return true }
    return false
  }
  async function role(name) {
    if (budget()) return null
    s.calls++; s.inFlight = { role: name, phase: s.phase, headSha: s.headSha }; save()
    const context = { task: s.task, headSha: s.headSha, baseSha: s.baseSha, classification: s.classification,
      acceptance: s.acceptance, plan: s.plan || '', findings: s.findings, validation: s.validation || null,
      ci: s.ci || null, priorReports: s.reports.map(r => ({ role: r.role, report: r.report })), requiredContext: p.context }
    const { report } = await io.role(name, context)
    validateReport(report, s.headSha, s.baseSha)
    if (await io.current() !== s.headSha) throw Error('Agent changed HEAD; controller is the sole commit owner')
    s.reports.push({ role: name, headSha: s.headSha, report, at: new Date().toISOString() })
    const oldRisk = s.classification
    const severity = { small: 0, medium: 1, high: 2 }
    if (severity[report.classification] > severity[s.classification]) s.classification = report.classification
    if (oldRisk !== s.classification) s.routing = { invoked: rolesFor(s.classification), reason: `${name} raised risk`, skipped: ['architect', 'challenger'].filter(x => !rolesFor(s.classification).includes(x)) }
    s.inFlight = null; save()
    if (budget()) return null
    return report
  }
  function retry(evidence, phase) { const next = repair(s, evidence, phase); move(next.phase, next.reason) }
  for (let step = 0; step < maxSteps && !TERMINAL.has(s.phase); step++) {
    if (budget()) break
    const current = await io.current()
    if (current !== s.headSha && s.inFlight?.phase === 'COMMIT' && io.recoverCommit && await io.recoverCommit(s.headSha)) {
      s.headSha = current
      move(s.inFlight.nextPhase, 'Recovered controller commit after interrupted checkpoint')
    }
    if (current !== s.headSha) { move('NEEDS_HUMAN_DECISION', 'Worktree HEAD changed outside the controller'); break }
    if (!['IMPLEMENT', 'REPAIR', 'CI_REPAIR'].includes(s.phase) && await io.dirty()) {
      move('NEEDS_HUMAN_DECISION', 'Unexpected uncommitted changes outside an implementation phase'); break
    }
    switch (s.phase) {
      case 'INTAKE': move('TRIAGE', 'Task and fixed model policy recorded'); break
      case 'TRIAGE': {
        const r = await role('orchestrator'); if (!r) break
        if (!r.complete || !r.acceptance.length) { move('NEEDS_HUMAN_DECISION', r.summary); break }
        s.classification = riskFor(s.task, [], r.classification)
        s.acceptance = r.acceptance; s.plan = r.plan
        if (new Set(acceptance(s)).size !== s.acceptance.length) throw Error('Duplicate intake acceptance criteria')
        s.routing = { invoked: rolesFor(s.classification), reason: r.summary, skipped: ['architect', 'challenger'].filter(x => !rolesFor(s.classification).includes(x)) }
        move(s.classification === 'small' ? 'IMPLEMENT' : 'PLAN', `Adaptive routing: ${s.classification}; ${r.summary}`); break
      }
      case 'PLAN': {
        const r = await role('architect'); if (!r) break
        if (!r.complete || r.verdict !== 'pass' || blocking(r)) { move('NEEDS_HUMAN_DECISION', r.summary); break }
        // Intake criteria cannot disappear. Architecture may add explicit criteria.
        const names = new Set(acceptance(s))
        for (const a of r.acceptance) if (!names.has(a.criterion)) { s.acceptance.push(a); names.add(a.criterion) }
        s.plan = r.plan
        move(s.classification === 'high' ? 'CHALLENGE' : 'IMPLEMENT', 'Architecture plan recorded'); break
      }
      case 'CHALLENGE': {
        const r = await role('challenger'); if (!r) break
        s.findings = r.findings
        if (!r.complete || r.verdict !== 'pass' || blocking(r)) { move('NEEDS_HUMAN_DECISION', `Blocking architecture challenge: ${r.summary}`); break }
        move('IMPLEMENT', 'Architecture challenge complete'); break
      }
      case 'IMPLEMENT': case 'REPAIR': case 'CI_REPAIR': {
        const riskBefore = s.classification
        const r = await role('developer'); if (!r) break
        if (!r.complete) { move('NEEDS_HUMAN_DECISION', r.summary); break }
        const files = await io.changedFiles()
        // Stop before executing modified package scripts or loading changed policy.
        if (policyChanged(files)) { move('NEEDS_HUMAN_DECISION', 'Execution policy, CI, agent instructions or dependency configuration changed; inspect partial work before validation/publication'); break }
        s.classification = riskFor(s.task, files, s.classification)
        s.review = null; s.validation = null
        s.inFlight = { phase: 'COMMIT', headSha: s.headSha, nextPhase: s.classification !== riskBefore ? 'PLAN' : 'LOCAL_VALIDATE' }; save()
        s.headSha = await io.commit()
        if (s.classification !== riskBefore) {
          s.routing = { invoked: rolesFor(s.classification), reason: 'Implementation raised risk', skipped: [] }
          move('PLAN', 'Source paths escalated risk; architecture/challenge required'); break
        }
        move('LOCAL_VALIDATE', 'Implementation committed by controller'); break
      }
      case 'LOCAL_VALIDATE': {
        s.validation = await io.validate(); save()
        if (budget()) break
        if (await io.current() !== s.headSha || await io.dirty()) { move('NEEDS_HUMAN_DECISION', 'Validation mutated source or HEAD'); break }
        if (!checksPass(s.validation, s.headSha, s.baseSha, p)) {
          retry(JSON.stringify(s.validation.checks.filter(c => c.exitCode !== 0).map(c => ({ command: c.command, exitCode: c.exitCode, evidenceDigest: c.evidenceDigest }))), 'REPAIR'); break
        }
        move('REVIEW', 'All fixed local validation commands passed'); break
      }
      case 'REVIEW': {
        const previous = [...s.findings], riskBefore = s.classification
        const r = await role('reviewer'); if (!r) break
        if (!coverage(r, acceptance(s))) { move('NEEDS_HUMAN_DECISION', 'Independent review omitted or altered acceptance criteria'); break }
        s.findings = r.findings; s.review = r
        if (!r.complete || r.verdict === 'incomplete') { move('BLOCKED', 'Independent review incomplete: ' + r.summary); break }
        if (!reviewPasses(r, s.headSha, s.baseSha, previous)) { retry(JSON.stringify(r.findings), 'REPAIR'); break }
        if (riskBefore !== s.classification) { move('PLAN', 'Independent review raised risk; complete required architecture/challenge'); break }
        move(s.classification === 'high' ? 'FINAL_CHALLENGE' : 'PR_UPDATE', 'Independent exact-head review passed'); break
      }
      case 'FINAL_CHALLENGE': {
        const r = await role('challenger'); if (!r) break
        if (!r.complete || r.verdict === 'incomplete' || !coverage(r, acceptance(s)) || r.acceptance.some(a => a.status === 'manual')) { move('BLOCKED', 'Final challenge incomplete or acceptance not verified'); break }
        if (blocking(r)) { s.findings = [...s.findings, ...r.findings]; retry(JSON.stringify(r.findings), 'REPAIR'); break }
        if (r.verdict !== 'pass' || r.acceptance.some(a => a.status !== 'passed')) { move('NEEDS_HUMAN_DECISION', 'Final challenge disagrees without a concrete repair finding'); break }
        move('PR_UPDATE', 'Final adversarial challenge passed'); break
      }
      case 'PR_UPDATE': {
        if (!checksPass(s.validation, s.headSha, s.baseSha, p) || !s.review || !coverage(s.review, acceptance(s)) || !reviewPasses(s.review, s.headSha, s.baseSha, s.findings)) throw Error('Publication requires fresh complete validation/review')
        if (!s.remoteAuthorized) { s.reason = 'Local review complete. Explicit --publish required for branch/draft PR writes.'; save(); return s }
        if (budget()) break
        s.inFlight = { phase: 'PR_UPDATE', headSha: s.headSha }; save()
        s.pr = await io.publish(prBody(s)); save()
        if (budget()) break
        move('CI_WAIT', 'Draft PR created/updated idempotently'); break
      }
      case 'CI_WAIT': {
        s.ci = await io.ci(); save()
        if (budget()) break
        const verdict = ciVerdict(s.ci, s, p)
        if (verdict.kind === 'pending') {
          s.reason = verdict.reason; save()
          if (io.wait) { await io.wait(); break }
          return s
        }
        if (verdict.kind === 'stale') { move('NEEDS_HUMAN_DECISION', verdict.reason + '; start a new run against the new base'); break }
        if (verdict.kind === 'repair') { retry(JSON.stringify(s.ci.checks.filter(c => c.bucket !== 'pass').map(c => ({ name: c.name, bucket: c.bucket }))), 'CI_REPAIR'); break }
        move(verdict.kind === 'ready' ? 'READY_FOR_HUMAN_REVIEW' : verdict.kind === 'human' ? 'NEEDS_HUMAN_DECISION' : 'BLOCKED', verdict.reason); break
      }
      default: throw Error(`Unsupported phase ${s.phase}`)
    }
  }
  return s
}

async function gitAt(cwd, args, control) {
  control?.check()
  const r = await execute('git', args, { cwd, signal: control?.signal })
  if (r.exitCode !== 0) throw Error(`git ${args[0]} failed: ${r.output}`)
  control?.check()
  return r.stdout.trim()
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv, opts = {}
  const allowed = new Set(['--id', '--task', '--base', '--publish', '--confirm-cleanup'])
  for (let i = 0; i < rest.length; i++) {
    if (!allowed.has(rest[i]) || rest[i] in opts) throw Error('Unknown/duplicate option')
    const key = rest[i]; opts[key] = ['--publish', '--confirm-cleanup'].includes(key) ? true : rest[++i]
    if (!opts[key] || (typeof opts[key] === 'string' && opts[key].startsWith('--'))) throw Error(`Missing value: ${key}`)
  }
  if (opts['--publish'] && command !== 'run') throw Error('--publish is only permitted with run')
  if (opts['--confirm-cleanup'] && command !== 'resume') throw Error('--confirm-cleanup is only permitted with resume')
  if (command === 'dry-run') {
    const policy = assertPolicy(readJSON(path.join(TOOLING, 'policy.json')))
    if (!opts['--task']) throw Error('dry-run requires --task <file>')
    const task = fs.readFileSync(opts['--task'], 'utf8')
    console.log(JSON.stringify({ model: MODEL, effort: EFFORT, classification: riskFor(task), roles: rolesFor(riskFor(task)), limits: policy.limits, checks: policy.checks, remoteWrites: false, note: 'No model, git mutation or network call. Model intake may raise risk.' }, null, 2))
    return
  }
  if (command === 'help' || !command) {
    console.log('node .github/codex/orchestration/run.mjs <command>\nenable | disable | control-status\ndry-run --task task.md\nstart --id <slug> --task task.md [--base <ref>]\nrun --id <slug> [--publish]\nstop --id <slug>\nresume --id <slug> [--confirm-cleanup]\nstatus --id <slug>\nDisabled by default. Enable never restarts runs. Resume only rearms; run explicitly to continue. No automatic merge.')
    return
  }
  if (!['enable', 'disable', 'control-status', 'start', 'run', 'status', 'stop', 'resume'].includes(command)) throw Error('Unknown command; use help')
  const root = await gitAt(process.cwd(), ['rev-parse', '--show-toplevel'])
  const common = await gitAt(root, ['rev-parse', '--git-common-dir'])
  const controlRoot = path.join(path.resolve(root, common), 'codex-orchestration')
  if (['enable', 'disable', 'control-status'].includes(command)) {
    if (Object.keys(opts).length) throw Error(`${command} does not accept run options`)
    const result = command === 'disable' ? await disableRepository(controlRoot)
      : command === 'enable' ? setSwitch(controlRoot, true) : readSwitch(controlRoot)
    console.log(JSON.stringify(result, null, 2))
    if (result.runs?.some(r => !r.confirmed)) process.exitCode = 1
    return
  }
  const id = opts['--id']
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id || '')) throw Error('id must be a lowercase slug (1-48 characters)')
  const directory = path.join(controlRoot, id)
  const file = path.join(directory, 'task.json')
  if (command === 'stop') {
    const result = await stopRun(controlRoot, id)
    console.log(JSON.stringify(result, null, 2)); if (!result.confirmed) process.exitCode = 1
    return
  }
  const control = readSwitch(controlRoot)
  if (command === 'status') {
    const s = readJSON(file), request = readStop(directory)
    console.log(JSON.stringify({ ...s, enabled: control.enabled, requiresResume: s.phase === 'STOPPED' || s.controlEpoch !== control.epoch || (request?.requestId ?? null) !== (s.acceptedStopRequest ?? null) }, null, 2)); return
  }
  if (!control.enabled) throw Error('Orchestration is disabled. Use enable explicitly; stopped runs still require resume.')
  const policy = assertPolicy(readJSON(path.join(TOOLING, 'policy.json')))
  const unlock = acquireLock(path.join(directory, 'run.lock'))
  let runtime
  try {
    if (command === 'resume') {
      const s = readJSON(file)
      resumeState(s, control, readStop(directory), { confirmCleanup: opts['--confirm-cleanup'] === true })
      atomicJSON(file, s)
      console.log(`Run ${id} rearmed. No execution started. Use run --id ${id} to continue; --publish must be granted again.`)
      return
    }
    if (command === 'start') {
      if (!opts['--task']) throw Error('start requires --task <file>')
      if (fs.existsSync(file)) throw Error('Run already exists; resume with run')
      if (readStop(directory)) throw Error('Run initialization was stopped; inspect it and use a new run ID')
      runtime = new RunControl(controlRoot, directory, { controlEpoch: control.epoch })
      runtime.check()
      const base = opts['--base'] || policy.baseBranch
      if (base.startsWith('-')) throw Error('Invalid base ref')
      const baseSha = await gitAt(root, ['rev-parse', '--verify', `${base}^{commit}`], runtime)
      const worktree = path.join(directory, 'worktree')
      const s = newState(id, fs.readFileSync(opts['--task'], 'utf8'), policy, baseSha, worktree)
      s.controlEpoch = control.epoch
      // Persist intent first; interrupted worktree creation can be inspected safely.
      s.phase = 'BLOCKED'; s.reason = 'Worktree creation not yet confirmed'; atomicJSON(file, s)
      await gitAt(root, ['worktree', 'add', '-b', s.branch, worktree, baseSha], runtime)
      s.phase = 'INTAKE'; s.reason = 'Worktree initialized; install frozen dependencies there before run'
      atomicJSON(file, s)
      console.log(`Created ${file}\nWorktree: ${worktree}`)
      return
    }
    const s = readJSON(file)
    const request = readStop(directory)
    if (s.phase === 'STOPPED' || s.controlEpoch !== control.epoch || (request?.requestId ?? null) !== (s.acceptedStopRequest ?? null)) {
      if (s.phase !== 'STOPPED') { markStopped(s, { reason: request?.reason || 'Stopped since last execution; explicit resume required', epoch: control.epoch, requestId: request?.requestId }); atomicJSON(file, s) }
      throw new StopRequested('Run is stopped; explicit resume required', { alreadyStopped: true })
    }
    runtime = new RunControl(controlRoot, directory, s)
    runtime.check()
    if (s.phase === 'READY_FOR_HUMAN_REVIEW') s.phase = 'CI_WAIT'
    if (opts['--publish']) s.remoteAuthorized = true
    const save = () => atomicJSON(file, s)
    save()
    const io = new LocalAdapter(policy, directory, s, save, runtime)
    await drive(s, policy, io, save)
    console.log(`${s.phase}: ${s.reason}\nState: ${file}${s.pr ? `\nPR: ${s.pr.url}` : ''}`)
    if (['FAILED', 'BLOCKED', 'BUDGET_EXHAUSTED', 'NEEDS_HUMAN_DECISION'].includes(s.phase)) process.exitCode = 1
  } catch (error) {
    if (error.cleanupIncomplete && !(error instanceof StopRequested)) error = new StopRequested(`Child cleanup not confirmed: ${error.message}`, { cleanupIncomplete: true })
    if (fs.existsSync(file)) {
      const s = readJSON(file)
      if (error instanceof StopRequested) {
        if (!error.alreadyStopped) { markStopped(s, { reason: error.message, ...error }); atomicJSON(file, s) }
        console.log(`STOPPED: ${error.message}${error.cleanupIncomplete ? '; child cleanup not confirmed. Inspect processes before resume --confirm-cleanup.' : ''}`)
        process.exitCode = 130
        return
      }
      // Retain phase for bounded retry. In-flight call was already charged.
      s.lastError = String(error.message).slice(0, 1000); s.updatedAt = new Date().toISOString()
      s.errors = (s.errors || 0) + 1
      if (s.errors >= 3) { s.phase = 'BLOCKED'; s.reason = 'Three infrastructure failures; inspect lastError before starting a new run' }
      atomicJSON(file, s)
    }
    throw error
  } finally { runtime?.dispose(); unlock() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
