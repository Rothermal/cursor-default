import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { atomicJSON, readJSON, acquireLock } from './storage.mjs'
import { PHASES } from './engine.mjs'

export class StopRequested extends Error {
  constructor(message, details = {}) { super(message); this.name = 'StopRequested'; Object.assign(this, details) }
}
export function readSwitch(root) {
  const file = path.join(root, 'control.json')
  if (!fs.existsSync(file)) return { version: 1, enabled: false, epoch: 'unconfigured' }
  const value = readJSON(file)
  if (value.version !== 1 || typeof value.enabled !== 'boolean' || typeof value.epoch !== 'string' || !value.epoch) throw Error('Invalid orchestration control.json; execution blocked')
  return value
}
export function setSwitch(root, enabled) {
  const unlock = acquireLock(path.join(root, 'control.lock'))
  try {
    // Disable also repairs an unreadable switch: safety must not depend on policy.
    const previous = enabled ? readSwitch(root) : null
    const value = { version: 1, enabled, epoch: enabled && previous.epoch !== 'unconfigured' ? previous.epoch : randomUUID(), updatedAt: new Date().toISOString() }
    atomicJSON(path.join(root, 'control.json'), value)
    return value
  } finally { unlock() }
}
export function readStop(directory) {
  const file = path.join(directory, 'stop.json')
  if (!fs.existsSync(file)) return null
  const value = readJSON(file)
  if (value.version !== 1 || typeof value.requestId !== 'string' || !value.requestId || typeof value.reason !== 'string') throw Error('Invalid run stop request; execution blocked')
  return value
}
export function requestStop(directory, reason) {
  const request = { version: 1, requestId: randomUUID(), reason, requestedAt: new Date().toISOString() }
  atomicJSON(path.join(directory, 'stop.json'), request)
  return request
}
export function markStopped(s, details) {
  const resumePhase = s.phase === 'STOPPED' ? s.stop.resumePhase : s.phase
  const at = new Date().toISOString()
  s.stop = { resumePhase, reason: details.reason, requestId: details.requestId ?? null, epoch: details.epoch ?? s.controlEpoch,
    stoppedAt: at, cleanupIncomplete: Boolean(s.stop?.cleanupIncomplete || details.cleanupIncomplete) }
  s.history.push({ from: s.phase, to: 'STOPPED', reason: details.reason, at, headSha: s.headSha })
  s.phase = 'STOPPED'; s.reason = details.reason; s.updatedAt = at
  s.remoteAuthorized = false
  // Keep inFlight for commit recovery and partial Developer work on explicit resume.
}
export function resumeState(s, control, request, { confirmCleanup = false } = {}) {
  if (!control.enabled) throw Error('Orchestration is disabled; enable it before resuming')
  if (s.phase !== 'STOPPED' && s.controlEpoch === control.epoch && (request?.requestId ?? null) === (s.acceptedStopRequest ?? null)) throw Error('Run is not stopped')
  if (s.phase !== 'STOPPED') markStopped(s, { reason: request?.reason || 'Repository disabled since last execution', requestId: request?.requestId, epoch: control.epoch })
  if (s.stop.cleanupIncomplete && !confirmCleanup) throw Error('Child cleanup was not confirmed; inspect remaining processes, then resume with --confirm-cleanup')
  if (!PHASES.has(s.stop.resumePhase) || s.stop.resumePhase === 'STOPPED') throw Error('Invalid stopped phase; inspect saved state')
  const at = new Date().toISOString(), next = s.stop.resumePhase
  s.history.push({ from: 'STOPPED', to: next, reason: 'Explicit resume; execution not started', at, headSha: s.headSha })
  s.phase = next; s.reason = 'Explicitly resumed; use run to continue'; s.updatedAt = at
  s.controlEpoch = control.epoch; s.acceptedStopRequest = request?.requestId ?? null
  s.stop = { ...s.stop, resumedAt: at, cleanupIncomplete: false, ...(confirmCleanup ? { cleanupConfirmedAt: at } : {}) }
  s.remoteAuthorized = false
}

// A separate command writes a durable request; only the lock owner checkpoints
// active state. The helper never kills a persisted PID, which could be reused.
export async function stopRun(root, id, reason = 'Stopped by user', { waitMs = 10000 } = {}) {
  const directory = path.join(root, id), file = path.join(directory, 'task.json'), lock = path.join(directory, 'run.lock')
  if (!fs.existsSync(file) && !fs.existsSync(lock)) throw Error(`Unknown run: ${id}`)
  const request = requestStop(directory, reason), deadline = Date.now() + waitMs
  do {
    let unlock
    try { unlock = acquireLock(lock) } catch (e) { if (e.code !== 'EEXIST') throw e }
    if (unlock) {
      try {
        if (!fs.existsSync(file)) return { id, confirmed: false, requestId: request.requestId, reason: 'Initialization stopped before a checkpoint; inspect remaining processes and partial worktree.' }
        const s = readJSON(file)
        markStopped(s, { reason, requestId: request.requestId, epoch: readSwitch(root).epoch })
        atomicJSON(file, s)
        return { id, confirmed: !s.stop.cleanupIncomplete, requestId: request.requestId, cleanupIncomplete: s.stop.cleanupIncomplete }
      } finally { unlock() }
    }
    await delay(100)
  } while (Date.now() < deadline)
  return { id, confirmed: false, requestId: request.requestId, reason: 'Request saved; runner/child cleanup not yet confirmed. Inspect status and run.lock.' }
}
export async function disableRepository(root, options) {
  const control = setSwitch(root, false)
  const ids = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && /^[a-z0-9][a-z0-9-]{0,47}$/.test(e.name) &&
    (fs.existsSync(path.join(root, e.name, 'task.json')) || fs.existsSync(path.join(root, e.name, 'run.lock')))).map(e => e.name)
  const results = await Promise.all(ids.map(id => stopRun(root, id, 'Repository orchestration disabled', options)))
  return { control, runs: results }
}

export class RunControl {
  constructor(root, directory, state) {
    this.root = root; this.directory = directory; this.epoch = state.controlEpoch; this.acceptedStopRequest = state.acceptedStopRequest ?? null
    this.controller = new AbortController(); this.signal = this.controller.signal
    this.timer = setInterval(() => { try { this.check() } catch { /* abort is surfaced by the active await */ } }, 100)
    this.timer.unref()
    this.handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
      if (this.signal.aborted) return
      let request
      try { request = requestStop(directory, `Interrupted by ${signal}`) } catch { /* still cancel on filesystem failure */ }
      this.cancel(new StopRequested(`Interrupted by ${signal}`, { requestId: request?.requestId, epoch: this.epoch }))
    }]))
    for (const [signal, handler] of Object.entries(this.handlers)) process.on(signal, handler)
  }
  cancel(error) { if (!this.signal.aborted) this.controller.abort(error) }
  check() {
    if (this.signal.aborted) throw this.signal.reason
    try {
      const control = readSwitch(this.root), request = readStop(this.directory)
      if (!control.enabled || control.epoch !== this.epoch || (request?.requestId ?? null) !== this.acceptedStopRequest) {
        throw new StopRequested(request?.reason || 'Repository orchestration disabled', { requestId: request?.requestId, epoch: control.epoch })
      }
    } catch (e) {
      const error = e instanceof StopRequested ? e : new StopRequested(`Cannot verify stop controls: ${e.message}`, { epoch: this.epoch })
      this.cancel(error); throw error
    }
  }
  async wait(ms) { this.check(); await delay(ms, undefined, { signal: this.signal }).catch(e => { throw this.signal.aborted ? this.signal.reason : e }); this.check() }
  dispose() { clearInterval(this.timer); for (const [signal, handler] of Object.entries(this.handlers)) process.removeListener(signal, handler) }
}
