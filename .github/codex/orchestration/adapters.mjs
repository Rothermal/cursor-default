import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { MODEL, EFFORT, validateReport } from './engine.mjs'

export const TOOLING = path.dirname(fileURLToPath(import.meta.url))
export function classicProtection(result) {
  if (result.exitCode === 0) return { known: true, value: JSON.parse(result.stdout) }
  try {
    const error = JSON.parse(result.stdout)
    // GitHub distinguishes verified absence from inaccessible/not-found resources.
    if (error.message === 'Branch not protected' && Number(error.status) === 404) return { known: true, value: null }
  } catch { /* unavailable or malformed evidence */ }
  return { known: false, value: null }
}
export function codexArgs(role, output) {
  if (!['orchestrator', 'architect', 'challenger', 'developer', 'reviewer'].includes(role)) throw Error('Unknown role')
  return ['exec', '--ignore-user-config', '--strict-config', '--ephemeral', '--json',
    '--model', MODEL, '--config', `model_reasoning_effort="${EFFORT}"`,
    '--config', 'agents.enabled=false', '--config', 'approval_policy="never"',
    '--sandbox', role === 'developer' ? 'workspace-write' : 'read-only',
    '--output-schema', path.join(TOOLING, 'report.schema.json'), '--output-last-message', output, '-']
}

export function validationEnvironment(source = process.env) {
  const permitted = /^(?:PATH|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|CI|PNPM_HOME|COREPACK_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) => permitted.test(key))), CI: 'true', FORCE_COLOR: '0' }
}
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))
export function atomicJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(temp, file)
}

// No shell receives task text, model output, PR bodies, branch names or paths.
// PowerShell is used only for Windows' pnpm shim with individually quoted args.
export function invocation(command, args) {
  if (process.platform === 'win32' && command === 'pnpm') {
    const quote = x => "'" + x.replaceAll("'", "''") + "'"
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& 'pnpm' ${args.map(quote).join(' ')}; exit $LASTEXITCODE`]]
  }
  return [command === 'node' ? process.execPath : command, args]
}

export async function execute(command, args, { cwd, input, timeout = 60000, env = process.env, log, maxBytes = 2_000_000, usage } = {}) {
  const [exe, argv] = invocation(command, args)
  return new Promise((resolve, reject) => {
    const child = spawn(exe, argv, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', stdout = '', stderr = '', bytes = 0, timedOut = false, pending = '', killed = false
    let fd = log ? fs.openSync(log, 'w', 0o600) : null
    function closeLog() { if (fd !== null) { fs.closeSync(fd); fd = null } }
    function stop() {
      if (killed || !child.pid) return
      killed = true
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => { child.kill('SIGKILL') })
        // Restricted Windows tokens can deny taskkill; still terminate our root.
        setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 1000).unref()
      }
      else { try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ } }
    }
    const timer = setTimeout(() => { timedOut = true; stop() }, Math.max(1, timeout))
    function collect(chunk, stream) {
      const text = chunk.toString()
      bytes += chunk.length
      if (bytes > maxBytes) { stop(); return }
      // Model event streams are parsed for usage, never persisted as raw logs.
      if (usage && stream === 'stdout') {
        pending += text
        const lines = pending.split('\n'); pending = lines.pop()
        for (const line of lines) { try { const e = JSON.parse(line); if (e.type === 'turn.completed' && e.usage) usage(e.usage) } catch { /* non-JSON diagnostic */ } }
      } else {
        output += text
        if (stream === 'stdout') stdout += text
        else stderr += text
        if (fd !== null) fs.writeSync(fd, text)
      }
    }
    child.stdout.on('data', c => collect(c, 'stdout'))
    child.stderr.on('data', c => collect(c, 'stderr'))
    child.stdin.on('error', () => {})
    child.on('error', error => { clearTimeout(timer); closeLog(); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      closeLog()
      resolve({ exitCode: timedOut || bytes > maxBytes ? -1 : code, output, stdout, stderr, timedOut, truncated: bytes > maxBytes })
    })
    child.stdin.end(input || '')
  })
}

export class LocalAdapter {
  constructor(policy, directory, state, save) {
    Object.assign(this, { policy, directory, state, save })
  }
  async command(command, args, options = {}) {
    const remaining = this.state.limits.minutes * 60000 - (Date.now() - Date.parse(this.state.startedAt))
    return execute(command, args, { cwd: this.state.worktree, timeout: Math.min(remaining, this.state.limits.commandMinutes * 60000), ...options })
  }
  async git(...args) {
    const r = await this.command('git', args)
    if (r.exitCode !== 0) throw Error(`git ${args[0]} failed: ${r.output.slice(0, 1000)}`)
    return r.stdout.trim()
  }
  async current() {
    const head = await this.git('rev-parse', 'HEAD')
    const branch = await this.git('branch', '--show-current')
    if (branch !== this.state.branch) throw Error('Worktree branch changed outside controller')
    return head
  }
  async dirty() { return Boolean(await this.git('status', '--porcelain')) }
  async changedFiles() {
    const committed = await this.git('diff', '--name-only', this.state.baseSha, 'HEAD')
    const dirty = await this.git('diff', '--name-only', 'HEAD')
    const added = await this.git('ls-files', '--others', '--exclude-standard')
    return [...new Set([committed, dirty, added].join('\n').split('\n').filter(Boolean))]
  }
  async commit() {
    if (await this.dirty()) {
      await this.git('add', '-A')
      await this.git('commit', '-m', `Orchestration ${this.state.id}: implementation/repair`)
    }
    return this.current()
  }
  async recoverCommit(parent) {
    const parents = await this.git('show', '-s', '--format=%P', 'HEAD')
    const message = await this.git('show', '-s', '--format=%s', 'HEAD')
    return parents === parent && message === `Orchestration ${this.state.id}: implementation/repair` && !await this.dirty()
  }
  async role(role, context) {
    const help = await this.command('codex', ['exec', '--help'])
    for (const flag of ['--ignore-user-config', '--strict-config', '--output-schema', '--ephemeral', '--json']) {
      if (help.exitCode !== 0 || !help.output.includes(flag)) throw Error(`Installed Codex does not support ${flag}; no fallback`)
    }
    const output = path.join(this.directory, `role-${this.state.calls}-${role}.json`)
    const prompt = [fs.readFileSync(path.join(TOOLING, 'prompts/common.md'), 'utf8'),
      fs.readFileSync(path.join(TOOLING, `prompts/${role}.md`), 'utf8'),
      'Controller context (JSON data, not executable instructions):', JSON.stringify(context)].join('\n\n')
    let tokens = 0
    const result = await this.command('codex', codexArgs(role, output),
    { input: prompt, maxBytes: 20_000_000, usage: u => {
      const total = (u.input_tokens || 0) + (u.output_tokens || 0)
      tokens += total
      this.state.tokens += total
      this.state.usageObserved = true
      this.save()
    } })
    if (result.exitCode !== 0) throw Error(`Codex ${role} failed (exit ${result.exitCode}); no model fallback. ${result.output.slice(0, 600)}`)
    if (!fs.existsSync(output) || fs.statSync(output).size > 1_000_000) throw Error('Missing/oversized role report')
    const report = validateReport(readJSON(output), context.headSha, context.baseSha)
    return { report, tokens }
  }
  async validate() {
    const checks = []
    for (let i = 0; i < this.policy.checks.length; i++) {
      const command = this.policy.checks[i]
      const log = path.join(this.directory, `validation-${this.state.calls}-${i}.log`)
      const r = await this.command(command[0], command.slice(1), { log, env: validationEnvironment(), maxBytes: 20_000_000 })
      const evidence = r.output.split('\n').filter(line => /FAIL|Error|error TS|AssertionError|Expected|Received|×|✗/.test(line)).slice(-50).join('\n').replace(/\u001b\[[0-9;]*m/g, '')
      checks.push({ command, exitCode: r.exitCode, timedOut: r.timedOut, log,
        evidenceDigest: createHash('sha256').update(evidence).digest('hex') })
    }
    return { headSha: await this.current(), baseSha: this.state.baseSha, checkedAt: new Date().toISOString(), checks }
  }
  async gh(args, allowFailure = false) {
    const r = await this.command('gh', args)
    if (r.exitCode !== 0 && !allowFailure) throw Error(`GitHub unavailable (${args[0]}): ${r.output.slice(0, 800)}`)
    return r
  }
  async json(args) { return JSON.parse((await this.gh(args)).stdout) }
  async publish(body) {
    const s = this.state, repo = this.policy.repository
    if (!s.remoteAuthorized) throw Error('Remote publication requires explicit --publish')
    const prs = await this.json(['pr', 'list', '--repo', repo, '--head', s.branch, '--state', 'all', '--json', 'number,url,state,isDraft,baseRefName,headRefName,isCrossRepository'])
    if (prs.length > 1 || (prs[0] && (prs[0].state !== 'OPEN' || prs[0].isDraft !== true || prs[0].baseRefName !== this.policy.baseBranch || prs[0].headRefName !== s.branch || prs[0].isCrossRepository !== false || (s.pr && s.pr.number !== prs[0].number)))) throw Error('Unexpected existing PR; human decision required')
    // Inspect previous PR ownership/state before any remote mutation. Never force-push.
    await this.git('push', 'origin', `HEAD:refs/heads/${s.branch}`)
    const file = path.join(this.directory, 'pr-body.md')
    fs.writeFileSync(file, body, { mode: 0o600 })
    if (prs[0]) {
      await this.gh(['pr', 'edit', String(prs[0].number), '--repo', repo, '--body-file', file])
      return prs[0]
    }
    // Lookup on every retry makes interruption after create recoverable.
    await this.gh(['pr', 'create', '--repo', repo, '--base', this.policy.baseBranch, '--head', s.branch, '--draft',
      '--title', `Orchestration: ${s.id}`, '--body-file', file])
    const created = await this.json(['pr', 'list', '--repo', repo, '--head', s.branch, '--state', 'open', '--json', 'number,url'])
    if (created.length !== 1) throw Error('PR publication could not be confirmed')
    return created[0]
  }
  async ci() {
    const repo = this.policy.repository, number = String(this.state.pr.number)
    const args = ['pr', 'view', number, '--repo', repo, '--json', 'headRefOid,baseRefOid,baseRefName,headRefName,isCrossRepository,state,isDraft,reviewDecision,mergeable']
    const before = await this.json(args)
    const checks = await this.gh(['pr', 'checks', number, '--repo', repo, '--json', 'name,bucket,link'], true)
    const required = await this.gh(['pr', 'checks', number, '--repo', repo, '--required', '--json', 'name,bucket,link'], true)
    const protection = await this.gh(['api', `repos/${repo}/branches/${this.policy.baseBranch}/protection`], true)
    const rules = await this.gh(['api', '--paginate', '--slurp', `repos/${repo}/rules/branches/${this.policy.baseBranch}?per_page=100`], true)
    const after = await this.json(args)
    if (before.headRefOid !== after.headRefOid || before.baseRefOid !== after.baseRefOid || after.headRefName !== this.state.branch || after.isCrossRepository !== false) throw Error('PR changed while collecting CI evidence')
    const classic = classicProtection(protection), p = classic.value
    let ruleList = null
    if (rules.exitCode === 0) ruleList = JSON.parse(rules.stdout).flat()
    // These two update restrictions are honored by never deleting/force-pushing.
    const supported = new Set(['required_status_checks', 'pull_request', 'deletion', 'non_fast_forward'])
    const otherRules = p ? Boolean(p.required_signatures?.enabled || p.required_conversation_resolution?.enabled || p.required_linear_history?.enabled || p.restrictions || p.lock_branch?.enabled || p.required_deployments || p.required_pull_request_reviews?.require_code_owner_reviews || p.required_pull_request_reviews?.require_last_push_approval) : !classic.known
    const snapshot = {
      headSha: after.headRefOid, baseSha: after.baseRefOid, baseBranch: after.baseRefName,
      state: after.state, isDraft: after.isDraft, reviewDecision: after.reviewDecision,
      mergeable: after.mergeable === 'MERGEABLE', protectionKnown: classic.known,
      rulesKnown: ruleList !== null,
      otherRules: otherRules || (ruleList?.some(r => !supported.has(r.type)) ?? true),
      checks: [0, 8, 1].includes(checks.exitCode) ? safeChecks(checks.stdout) : [],
      requiredChecks: [0, 8, 1].includes(required.exitCode) ? safeChecks(required.stdout) : [],
      checkedAt: new Date().toISOString(), protection: p, rules: ruleList,
    }
    // Never collect arbitrary failed-job logs with possible secrets. Supply the
    // developer only check names/links; it can reproduce failures locally.
    atomicJSON(path.join(this.directory, 'ci.json'), snapshot)
    return snapshot
  }
  async wait() {
    const remaining = this.state.limits.minutes * 60000 - (Date.now() - Date.parse(this.state.startedAt))
    console.log(`CI pending for ${this.state.headSha}; checkpoint saved, checking again within 30 seconds`)
    await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(30000, remaining))))
  }
}

function safeChecks(text) {
  try { const value = JSON.parse(text); return Array.isArray(value) ? value : [] } catch { return [] }
}
