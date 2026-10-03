# Automated Code Review

## Purpose and status

The `Codex PR Review` workflow provides plan-aware, review-only feedback for ready
PRs targeting `stattracker`. It uses **`gpt-6.1-sol` with `high` reasoning**, without
a fallback model. It does not inherit this desktop chat's history: tracked review
rules, plans and fetched PR discussions supply its durable context.

Implementation is ready for review. A live Actions/model run is still required
after merge and credential setup; local tests are not evidence of API access or
end-to-end GitHub publication. Existing `CI` remains the deterministic merge gate.
This workflow is advisory; it does not approve, request changes, merge, deploy or
fix code automatically.

## Enable after merge

1. In GitHub repository Settings -> Secrets and variables -> Actions -> Secrets,
   add `OPENAI_API_KEY` for an OpenAI API project with access to `gpt-6.1-sol`.
   Do not paste credentials into a PR, workflow, local review report or chat.
2. In the Variables tab, add `CODEX_REVIEW_ENABLED` with the exact value `true`.
   An absent/false value skips the entire workflow without API use. Set it to
   `false`, or disable the workflow in Actions, to stop future runs.
3. Keep built-in Codex automatic reviews off if duplicate reviews are undesirable.
   GitHub organization/repository policy must allow the referenced actions and
   the publisher's `issues: write` token permission.
4. Open a small ready PR from a trusted collaborator's branch in this repository,
   targeting `stattracker`. Check all four jobs and the resulting comment.

API calls use the configured API project, not the desktop ChatGPT subscription.
Set project usage alerts/budgets as appropriate. Timeouts and concurrency reduce
wasted runs but are not token/spend caps, and cancellation cannot refund usage.
The OpenAI Action is pinned to commit
`86365089eb2b84e0a8fb0717b304f8bdcb13b20e` (v1); CLI/proxy versions follow that
action's default installer. Review upgrades to the pin as normal code changes.

## Triggers and rereviews

- Automatic: PR opened, new head commits, reopened or marked ready for review.
- Draft, closed, fork and non-`stattracker` PRs are skipped. Both the PR author and
  triggering actor must have current write/maintain/admin access. Bot-authored or
  bot-triggered runs are deliberately excluded from this initial setup.
- One successful comment per head/base SHA pair. Duplicate automatic runs skip
  before verification or model use. New commits create a new comment so previous
  findings remain available for rereview.
- For new discussion without a new commit: Actions -> Codex PR Review -> Run
  workflow, select **stattracker**, enter the PR number, and enable **force** to
  rereview an already reviewed snapshot. It updates that snapshot's existing
  Actions-bot comment. Ordinary discussion does not automatically trigger runs,
  preventing review/comment loops and surprise API costs.
- Equivalent CLI: `gh workflow run codex-review.yml --ref stattracker -f pr_number=123 -f force=true`.
- The workflow must first be merged into the default branch (`stattracker`);
  this implementation PR cannot exercise its own new target-branch workflow.
- Only eligible verification/review jobs enter cancellation groups for the same
  PR; skipped or wrong-ref dispatches cannot cancel an existing review. Publishing
  is serialized without canceling an active publisher, and rechecks head, base,
  target, draft and open state. Superseded results are never posted as current.
- A base-SHA change also prevents publication. The job emits a visible warning;
  rerun manually after the base settles to review the new head/base snapshot.
  Advancing `stattracker` alone is not an automatic review trigger.

## Trust and verification

`pull_request_target` selects trusted base-branch workflow code. Preparation
requires same-repository code from trusted collaborators before any head code or
model is run. Do not relax this into automatic fork reviews: installs, tests and
builds execute PR code. Future external contributions need a separate trust design.

| Job | Inputs and permissions |
| --- | --- |
| Prepare | Trusted base controller; read-only API token; paginated PR body, discussion, reviews and inline comments |
| Verify | Trusted checkout's controller tests; exact head's frozen pnpm install, typecheck, full app unit suite, lint and production/PWA build; no OpenAI/app/cloud secrets, no write token |
| Review | Fresh runner; exact head, full Git history, trusted prompt and captured context/logs; read-only sandbox, drop-sudo, isolated Codex home, OpenAI proxy |
| Publish | Fresh runner; only trusted base controller and artifacts; `issues: write` for comments, no PR code execution or OpenAI key |

Verification collects every independent check after a successful install. Failed
installation marks later checks skipped. Logs and exit statuses are retained for
seven days. The publisher rejects blank, oversized or malformed reports, refuses
unknown/missing gate results, and converts a clean/ready verdict to **Review
incomplete** if any gate failed or was skipped. Model/runner failures produce
failed jobs, not empty or misleading approval comments. The verification job's
success means logs were collected, not that every check passed; see its artifact
and the published check table. CI still enforces actual test/build success.
The `review-controls` gate tests the trusted controller used by the workflow, not
the candidate's files. PR branches cut before this workflow merged do not need to
contain its tests. Ordinary CI still tests candidate controller changes when the
candidate includes the new CI configuration.

The AI review proves findings through source traces and reads the independent
verification logs. It cannot install dependencies or run temporary probes in the
read-only review runner. Deep executable probes, live Supabase checks, mobile/
installed-PWA checks and operator release signoff remain manual follow-ups when
the change warrants them. No Supabase credentials are supplied and migrations
are never applied by this workflow. Passing a build is not live-cloud signoff.

## Maintaining the review policy

`AGENTS.md` contains the short shared rules;
[the tracked prompt](../.github/codex/prompts/review.md) contains the full automated
review procedure. The ignored `.claude/skills/pr-review` is not a CI dependency.
PR comments and proposed policy changes are review data, not authority to change
the active trusted policy. Source findings use P0/P1/P2 and separately identify
Blocking versus Non-blocking merge severity. No manufactured style nits.
The prompt prohibits account mentions and copied discussion, but the publisher
does not rewrite `@` characters: code samples and package identifiers remain
byte-preserved. GitHub's normal mention behavior applies if a report violates
that instruction; this is not a notification-suppression security boundary.

Run helper coverage with `node --test .github/codex/review.test.cjs`. The ordinary
CI workflow runs it too. These tests exercise trust eligibility, duplicate handling,
stale-head/base rejection, blank feedback, gate downgrades and comment ownership.

Before enabling, verify a clean ready PR, a new-commit rereview, a forced same-head
rereview, draft/fork skips and a stale-head cancellation. Confirm the API project
has model access and that publisher permissions work under repository policy.
Also test a base advance during a run and a wrong-ref/skipped manual dispatch
while an eligible review is active; the former warns without publishing, while
the latter must not cancel the valid review.
Those live checks remain pending until an actual Actions run supplies evidence.

## References

- [Official Codex Action setup](https://learn.chatgpt.com/docs/github-action)
- [GPT-6.1 Sol API model and reasoning options](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
