const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { CHECKS } = require('./review.cjs')

function verify(checkout, output, run = spawnSync) {
  fs.mkdirSync(output, { recursive: true })
  const checks = []
  for (const name of CHECKS) {
    if (name !== 'install' && checks[0].status !== 'passed') {
      checks.push({ name, status: 'skipped', exitCode: null })
      continue
    }
    const command = name === 'review-controls' ? 'node' : 'pnpm'
    const args = name === 'install' ? ['install', '--frozen-lockfile']
      : name === 'review-controls' ? ['--test', '.github/codex/review.test.cjs'] : [name]
    const cwd = name === 'review-controls' ? path.resolve(__dirname, '../..') : checkout
    const log = fs.openSync(path.join(output, `${name}.log`), 'w')
    const result = run(command, args, {
      cwd, stdio: ['ignore', log, log], timeout: 12 * 60 * 1000,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    })
    if (result.error) fs.writeSync(log, `${result.error.message}\n`)
    fs.closeSync(log)
    checks.push({ name, status: result.status === 0 ? 'passed' : 'failed', exitCode: result.status })
    console.log(`${name}: ${checks.at(-1).status}`)
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks }, null, 2))
  return checks
}

if (require.main === module) {
  const [checkout, output] = process.argv.slice(2)
  if (!checkout || !output) throw new Error('Usage: node verify.cjs <checkout> <output>')
  verify(checkout, output)
}
module.exports = { verify }
