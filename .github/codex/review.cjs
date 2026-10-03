const fs = require('node:fs')
const path = require('node:path')

const CHECKS = ['install', 'review-controls', 'typecheck', 'test', 'lint', 'build']
const VERDICTS = [
  'No further changes needed',
  'Ready to merge, with non-blocking issues',
  'Needs additional updates',
  'Review incomplete',
]

function marker(metadata) {
  return `<!-- statkeeper-codex-review:${metadata.headSha}:${metadata.baseSha} -->`
}

function matchingComment(comments, metadata) {
  return comments.find(comment => comment.user?.login === 'github-actions[bot]'
    && comment.body?.startsWith(marker(metadata)))
}

function eligible(pr, repository) {
  return pr.state === 'open' && !pr.draft && pr.base.ref === 'stattracker'
    && pr.base.repo?.full_name === repository && pr.head.repo?.full_name === repository
    && /^[a-f0-9]{40}$/.test(pr.head.sha) && /^[a-f0-9]{40}$/.test(pr.base.sha)
}

function isCurrent(pr, metadata) {
  return eligible(pr, metadata.repository)
    && pr.head.sha === metadata.headSha && pr.base.sha === metadata.baseSha
}

async function hasWriteAccess(github, repo, username) {
  if (!username || username.endsWith('[bot]')) return false
  try {
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
      ...repo, username,
    })
    return ['admin', 'maintain', 'write'].includes(data.permission)
  } catch (error) {
    if (error.status === 404) return false
    throw error
  }
}

async function prepare({ github, context, core, directory, number, force = false }) {
  core.setOutput('should_review', 'false')
  if (!/^[1-9][0-9]*$/.test(String(number)) || !Number.isSafeInteger(Number(number))) {
    throw new Error('A positive PR number is required')
  }
  const repo = context.repo
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: Number(number) })
  if (!eligible(pr, `${repo.owner}/${repo.repo}`)) {
    core.info('Skipping a draft, closed, fork or non-stattracker PR')
    return
  }
  // Both the triggering actor and the code author must be trusted collaborators.
  for (const username of new Set([context.actor, pr.user.login])) {
    if (!await hasWriteAccess(github, repo, username)) {
      core.info('Skipping a PR without trusted author and triggering actor')
      return
    }
  }
  const metadata = {
    repository: `${repo.owner}/${repo.repo}`, number: pr.number,
    headSha: pr.head.sha, baseSha: pr.base.sha, toolingSha: context.sha,
  }
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...repo, issue_number: pr.number, per_page: 100,
  })
  if (!force && matchingComment(comments, metadata)) {
    core.info('This head/base pair already has an automated review')
    return
  }
  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    ...repo, pull_number: pr.number, per_page: 100,
  })
  const inlineComments = await github.paginate(github.rest.pulls.listReviewComments, {
    ...repo, pull_number: pr.number, per_page: 100,
  })
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2))
  fs.writeFileSync(path.join(directory, 'context.json'), JSON.stringify({
    pr: { number: pr.number, title: pr.title, body: pr.body, url: pr.html_url },
    comments, reviews, inlineComments,
  }, null, 2))
  for (const [name, value] of Object.entries({
    should_review: 'true', head_sha: metadata.headSha, base_sha: metadata.baseSha,
    tooling_sha: metadata.toolingSha, number: metadata.number,
  })) core.setOutput(name, String(value))
}

function formatReport(report, results, metadata, runUrl) {
  if (typeof report !== 'string' || report.trim().length < 40 || report.length > 55000) {
    throw new Error('Review output is empty, too short or too large to publish')
  }
  const headings = [...report.matchAll(/^## Verdict: (.+)$/gm)]
  if (headings.length !== 1 || !VERDICTS.includes(headings[0][1].trim())) {
    throw new Error('Review output must contain exactly one recognized verdict')
  }
  const gates = CHECKS.map(name => {
    const result = results.checks?.find(check => check.name === name)
    if (!result || !['passed', 'failed', 'skipped'].includes(result.status)) {
      throw new Error(`Missing or invalid verification result: ${name}`)
    }
    return result
  })
  const passed = gates.every(check => check.status === 'passed')
  let body = report.trim()
  if (!passed && !['Needs additional updates', 'Review incomplete'].includes(headings[0][1].trim())) {
    body = body.replace(/^## Verdict: .+$/m, '## Verdict: Review incomplete')
    body += '\n\nAutomated verification did not fully pass; this is not a merge approval.'
  }
  const table = gates.map(check => `| ${check.name} | ${check.status} |`).join('\n')
  // Prevent generated text or quoted discussion from issuing mention notifications.
  body = body.replace(/@/g, '@\u200b')
  return `${marker(metadata)}\n## Codex Review\n\n`
    + `Head: \`${metadata.headSha}\` | Base: \`${metadata.baseSha}\`\n\n`
    + 'Model: `gpt-6.1-sol` | Reasoning: `high` | Read-only source review\n\n'
    + body + '\n\n### Automated Verification\n\n| Check | Result |\n| --- | --- |\n'
    + table + `\n\n[Workflow run and verification logs](${runUrl})\n`
}

async function publish({ github, context, core, metadata, report, results }) {
  const repo = context.repo
  if (metadata.repository !== `${repo.owner}/${repo.repo}`
    || !Number.isSafeInteger(metadata.number) || metadata.number < 1) {
    throw new Error('Review metadata does not match this repository')
  }
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: metadata.number })
  if (!isCurrent(pr, metadata)) {
    core.info('Not publishing: the PR changed, closed, became draft or was retargeted')
    return
  }
  const runUrl = `https://github.com/${metadata.repository}/actions/runs/${context.runId}`
  const body = formatReport(report, results, metadata, runUrl)
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...repo, issue_number: metadata.number, per_page: 100,
  })
  const existing = matchingComment(comments, metadata)
  if (existing) {
    await github.rest.issues.updateComment({ ...repo, comment_id: existing.id, body })
  } else {
    await github.rest.issues.createComment({ ...repo, issue_number: metadata.number, body })
  }
}

module.exports = { CHECKS, marker, matchingComment, eligible, isCurrent, prepare, formatReport, publish }
