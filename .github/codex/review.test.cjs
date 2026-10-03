const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { CHECKS, eligible, isCurrent, marker, prepare, formatReport, publish } = require('./review.cjs')
const { verify } = require('./verify.cjs')

const sha = 'a'.repeat(40)
const base = 'b'.repeat(40)
const metadata = { repository: 'Rothermal/cursor-default', number: 465, headSha: sha, baseSha: base }
const results = { checks: CHECKS.map(name => ({ name, status: 'passed', exitCode: 0 })) }
const cleanReport = 'No actionable findings. Source traces verified.\n\n## Verdict: No further changes needed'

function makePr(overrides = {}) {
  return { number: 465, state: 'open', draft: false, title: 'Example', body: 'Test',
    user: { login: 'Rothermal' }, base: { ref: 'stattracker', sha: base, repo: { full_name: metadata.repository } },
    head: { sha, repo: { full_name: metadata.repository } }, ...overrides }
}

function fixture(pr = makePr(), comments = []) {
  const calls = []
  const outputs = {}
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pr }), listReviews: 'reviews', listReviewComments: 'inline' },
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }) },
      issues: { listComments: 'comments', createComment: async value => calls.push(['create', value]),
        updateComment: async value => calls.push(['update', value]) },
    },
    paginate: async method => method === 'comments' ? comments : [],
  }
  return { github, calls, outputs, context: { repo: { owner: 'Rothermal', repo: 'cursor-default' },
    actor: 'Rothermal', sha: base, runId: 123 },
  core: { info() {}, setOutput: (key, value) => { outputs[key] = value } } }
}

test('only ready, same-repository PRs on stattracker are eligible', () => {
  assert.equal(eligible(makePr(), metadata.repository), true)
  for (const pr of [makePr({ draft: true }), makePr({ state: 'closed' }),
    makePr({ base: { ref: 'main' } }), makePr({ head: { sha, repo: { full_name: 'attacker/fork' } } }),
    makePr({ head: { sha: 'not-a-sha', repo: { full_name: metadata.repository } } })]) {
    assert.equal(eligible(pr, metadata.repository), false)
  }
})

test('head and base changes both invalidate a completed review', () => {
  assert.equal(isCurrent(makePr(), metadata), true)
  const changedHead = makePr()
  changedHead.head.sha = 'c'.repeat(40)
  assert.equal(isCurrent(changedHead, metadata), false)
  const changedBase = makePr()
  changedBase.base.sha = 'c'.repeat(40)
  assert.equal(isCurrent(changedBase, metadata), false)
})

test('publisher rejects empty, excessive and unrecognized verdicts', () => {
  for (const report of ['', 'Short', 'x'.repeat(55001), 'There are no issues. No verdict provided.',
    `${cleanReport}\n## Verdict: Review incomplete`, cleanReport.replace('No further changes needed', 'Looks fine')]) {
    assert.throws(() => formatReport(report, results, metadata, 'https://example.com'))
  }
})

test('a passed gate keeps a clean verdict and identifies exact model and SHA', () => {
  const body = formatReport(cleanReport, results, metadata, 'https://example.com')
  assert.ok(body.includes(marker(metadata)))
  assert.ok(body.includes('Model: `gpt-6.1-sol` | Reasoning: `high`'))
  assert.ok(body.includes('## Verdict: No further changes needed'))
  for (const name of CHECKS) assert.ok(body.includes(`| ${name} | passed |`))
})

test('each failed or skipped gate prevents a clean or ready-to-merge verdict', () => {
  for (const name of CHECKS) {
    for (const status of ['failed', 'skipped']) {
      const failed = { checks: results.checks.map(check => check.name === name ? { ...check, status } : check) }
      for (const report of [cleanReport, cleanReport.replace('No further changes needed', 'Ready to merge, with non-blocking issues')]) {
        const body = formatReport(report, failed, metadata, 'https://example.com')
        assert.ok(body.includes('## Verdict: Review incomplete'))
        assert.ok(body.includes('not a merge approval'))
      }
    }
  }
})

test('missing verification and unknown statuses fail closed', () => {
  assert.throws(() => formatReport(cleanReport, {}, metadata, 'https://example.com'))
  assert.throws(() => formatReport(cleanReport, { checks: [{ name: 'install', status: 'unknown' }] }, metadata, 'https://example.com'))
})

test('proved blocking findings retain their verdict even with a failed gate', () => {
  const body = formatReport(cleanReport.replace('No further changes needed', 'Needs additional updates'),
    { checks: results.checks.map(check => ({ ...check, status: 'failed' })) }, metadata, 'https://example.com')
  assert.ok(body.includes('## Verdict: Needs additional updates'))
})

test('quoted or generated mentions cannot notify accounts', () => {
  const body = formatReport(`Verified @Rothermal and @everyone text.\n${cleanReport}`, results, metadata, 'https://example.com')
  assert.equal(body.includes('@Rothermal'), false)
  assert.ok(body.includes('@\u200bRothermal'))
})

test('prepare paginates context and emits an exact-head snapshot', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const f = fixture()
  const methods = []
  f.github.paginate = async method => { methods.push(method); return [] }
  await prepare({ ...f, directory, number: 465 })
  assert.deepEqual(methods, ['comments', 'reviews', 'inline'])
  assert.equal(f.outputs.should_review, 'true')
  assert.equal(f.outputs.head_sha, sha)
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'))).toolingSha, base)
})

test('prepare rejects malformed manual numbers before any API request', async () => {
  for (const number of ['0', '-1', '123;echo hi', '1.5', '', '9007199254740992']) {
    await assert.rejects(prepare({ ...fixture(), number, directory: 'unused' }), /positive PR number/)
  }
})

test('already reviewed snapshots skip automatic runs but force permits rereview', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const comments = [{ id: 7, user: { login: 'github-actions[bot]' }, body: marker(metadata) }]
  const f = fixture(makePr(), comments)
  await prepare({ ...f, number: 465, directory })
  assert.equal(f.outputs.should_review, 'false')
  await prepare({ ...f, number: 465, directory, force: true })
  assert.equal(f.outputs.should_review, 'true')
})

test('both PR author and triggering actor require write access', async () => {
  for (const denied of ['Rothermal', 'contributor']) {
    const f = fixture(makePr({ user: { login: 'contributor' } }))
    f.github.rest.repos.getCollaboratorPermissionLevel = async ({ username }) => ({
      data: { permission: username === denied ? 'read' : 'write' },
    })
    await prepare({ ...f, number: 465, directory: 'unused' })
    assert.equal(f.outputs.should_review, 'false')
  }
})

test('bots and removed collaborators cannot trigger secret-bearing reviews', async () => {
  const bot = fixture(makePr({ user: { login: 'dependabot[bot]' } }))
  await prepare({ ...bot, number: 465, directory: 'unused' })
  assert.equal(bot.outputs.should_review, 'false')
  const removed = fixture()
  removed.github.rest.repos.getCollaboratorPermissionLevel = async () => { throw Object.assign(new Error(), { status: 404 }) }
  await prepare({ ...removed, number: 465, directory: 'unused' })
  assert.equal(removed.outputs.should_review, 'false')
})

test('publication skips stale, closed, draft or retargeted PRs', async () => {
  const changed = makePr()
  changed.head.sha = 'c'.repeat(40)
  const changedBase = makePr()
  changedBase.base.sha = 'c'.repeat(40)
  for (const pr of [changed, changedBase, makePr({ state: 'closed' }), makePr({ draft: true }), makePr({ base: { ref: 'main' } })]) {
    const f = fixture(pr)
    await publish({ ...f, metadata, report: cleanReport, results })
    assert.equal(f.calls.length, 0)
  }
})

test('publication creates a non-empty comment for the reviewed head', async () => {
  const f = fixture()
  await publish({ ...f, metadata, report: cleanReport, results })
  assert.equal(f.calls[0][0], 'create')
  assert.equal(f.calls[0][1].issue_number, 465)
  assert.ok(f.calls[0][1].body.includes('actions/runs/123'))
})

test('manual rereviews update only a matching comment owned by the Actions bot', async () => {
  for (const username of ['github-actions[bot]', 'Rothermal']) {
    const f = fixture(makePr(), [{ id: 7, user: { login: username }, body: marker(metadata) }])
    await publish({ ...f, metadata, report: cleanReport, results })
    assert.equal(f.calls[0][0], username === 'github-actions[bot]' ? 'update' : 'create')
  }
})

test('publication rejects cross-repository metadata and empty reports', async () => {
  const f = fixture()
  await assert.rejects(publish({ ...f, metadata: { ...metadata, repository: 'other/repo' }, report: cleanReport, results }))
  await assert.rejects(publish({ ...f, metadata, report: '', results }))
  assert.equal(f.calls.length, 0)
})

test('verification runs independent gates even after a test failure', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-verify-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const commands = []
  const checks = verify('candidate', directory, (command, args, options) => {
    commands.push([command, args])
    assert.equal(options.cwd, 'candidate')
    assert.equal(options.env.CI, 'true')
    fs.writeSync(options.stdio[1], 'verification output\n')
    return { status: args[0] === 'test' ? 1 : 0 }
  })
  assert.equal(commands.length, 6)
  assert.deepEqual(commands[0], ['pnpm', ['install', '--frozen-lockfile']])
  assert.deepEqual(commands[1], ['node', ['--test', '.github/codex/review.test.cjs']])
  assert.equal(checks.find(check => check.name === 'test').status, 'failed')
  assert.equal(checks.find(check => check.name === 'build').status, 'passed')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'results.json'))).checks, checks)
  assert.equal(fs.readFileSync(path.join(directory, 'test.log'), 'utf8'), 'verification output\n')
})

test('install failure skips dependent gates and records timeout errors', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-verify-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let runs = 0
  const checks = verify('candidate', directory, () => {
    runs++
    return { status: null, error: new Error('Timed out') }
  })
  assert.equal(runs, 1)
  assert.equal(checks[0].status, 'failed')
  assert.ok(checks.slice(1).every(check => check.status === 'skipped'))
  assert.equal(fs.readFileSync(path.join(directory, 'install.log'), 'utf8'), 'Timed out\n')
})

test('a quoted marker in another bot comment cannot suppress a new review', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const f = fixture(makePr(), [{ user: { login: 'github-actions[bot]' }, body: `Earlier discussion:\n${marker(metadata)}` }])
  await prepare({ ...f, number: 465, directory })
  assert.equal(f.outputs.should_review, 'true')
})
