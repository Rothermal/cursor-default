# Codex orchestration: StatTracker adaptation

Status: local implementation complete; live model/CI evidence
are separate gates. Owner request: GPT-6.1 Sol **Ultra only**, with no fallback.
This record supports the [adapted specification](../CODEX_MULTI_AGENT_ORCHESTRATION.md).
The supplied Downloads document is design input, not repository instructions or
authorization for remote writes.

## Audit (2026-10-17)

- Repository: `Rothermal/cursor-default`; integration branch `stattracker`.
  Starting checkout: `codex/basketball-tracker-unification`, `cbd5ee13`, clean.
  Preserve that work. No tracked `.codex` configuration or nested AGENTS found.
- User Codex defaults select Sol/high. Preserve those defaults. Pipeline calls
  explicitly select Sol/ultra and ignore user configuration without changing it.
- Installed CLI: `0.162.0-alpha.17.2`. Local help verifies `exec`, `--model`,
  `--config`, `--strict-config`, `--sandbox`, `--ignore-user-config`, `--ephemeral`,
  `--json`, `--output-schema`, `--output-last-message` and stdin prompts.
- Existing `CI` runs review-controller tests, lint, Vitest and production build
  on PRs targeting `stattracker`. Existing Codex review is advisory Sol/high.
  Existing Pages deployment runs only on `stattracker`. Preserve all three.
- Node 20/pnpm 9 match CI; implement the controller with Node built-ins.
- Local `gh` cannot currently authenticate/reach GitHub in this sandbox.
  Connected GitHub protection read returned 403 (integration lacks administration).
  Required checks, rulesets, approval counts and restrictions remain **unknown**.
  Unknown protection is never a successful readiness result.

## Compatibility and architecture decision

| Capability | Support | Decision |
| --- | --- | --- |
| Roles and model/effort | Native custom-agent TOML, explicit exec flags | Add uniquely named project agents; lock every pipeline role to Sol/ultra |
| Interactive delegation | Native subagents | Available for explicit use; not a durable scheduler |
| Independent permissions | Subagents inherit parent sandbox | Separate fresh CLI sessions: Developer workspace-write, other roles read-only |
| Durable phases/resume/budgets | Wrapper required | Node state machine, atomic checkpoints under Git common directory, exclusive run lock |
| Branch isolation | Git worktrees | One `codex/orchestrate-*` branch/worktree per task; no edits to caller checkout |
| Structured role evidence | Native output schema | Validate reports and bind review/validation to exact head and base |
| Token/cost cap | Not a strict native spend cap | Bound calls, wall time, repairs and observed tokens; stop after reported usage crosses cap; provider spend controls remain external |
| GitHub PR/CI | `gh` wrapper, explicit publish opt-in | Draft PR, idempotent branch lookup, latest-head checks, protection inspection; never merge |
| Invocation | Codex interactions only | No added Actions workflow, hosted writer or issue/comment trigger |

Official interface references: [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents?surface=cli)
and [CLI reference](https://learn.chatgpt.com/docs/cli/reference). Local CLI help is
the runtime compatibility authority; an unavailable model/effort fails the run.
Ultra is not itself persistence or independent review.

The deterministic controller is the orchestrator, with a read-only orchestrator
agent for intake/risk/acceptance. It never authors production code. Architecture
and challenge roles are conditional; Developer is the sole implementation writer.
QA runs in a fresh session and cannot fix its own findings. Native agent files
are additive conveniences; the wrapper is the enforced scheduling boundary.

## Additive file tree and permissions

```
.codex/agents/stattracker-*.toml        native roles (no global config changes)
.github/codex/orchestration/
  policy.json                         repo adapter, fixed validation commands
  report.schema.json                  role output contract
  prompts/*.md                        role procedure, shared trusted boundaries
  engine.mjs                          pure routing/gates
  adapters.mjs                        bounded process/Codex/GitHub interfaces
  run.mjs                             checkpointed controller/CLI
  orchestration.test.mjs               offline fixtures and fault tests
docs/CODEX_ORCHESTRATION.md            operation, limitations, rollback
```

Run data goes under the Git common directory, never committed. No dependency,
database, rollout-policy or app changes are needed. Existing workflow permissions
stay unchanged. Orchestration and its offline contract tests run through Codex
interactions only. No GitHub Actions workflow or hosted orchestration is added.
Local publication requires explicit `--publish`; it authorizes only that run's branch and draft PR. Agents
are prohibited from pushing, posting, merging, deploying or applying migrations.

Changes to agent policy, CI, dependencies, security/access or migrations escalate
risk. Changes to execution policy/CI/dependency manifests require human inspection
before publication rather than letting a run rewrite its own gates.

## Acceptance and milestones

1. Audit/design: preserve configuration; document native/wrapper gaps and trust.
2. Local: dry-run without model/network calls; adaptive roles; independent schema
   reports; validation/review/repair; exact-head gates; bounded persisted state.
3. GitHub: explicit local publish, idempotent PR recovery, fresh CI and protected
   branch inspection; no false readiness for missing checks or human approval.
4. Hardening: offline injected-adapter tests for bug/repair, stale review, CI
   repair, interruption, duplicate publish, locks, repeated failure, untrusted
   text, missing permissions and budgets. Real model bug/repair and remote CI
   tests must be labeled pending until actually run.

Reuse through a reviewed repository policy adapter, not by copying StatTracker's
product assumptions into other projects. This initial implementation deliberately
runs only through Codex interactions and retains the existing automated reviewer.

## Implementation evidence

- Controller and five native roles added without changing existing AGENTS.md,
  user config, CI, advisory review or Pages workflows. Controller placement follows
  the existing `.github/codex` convention; native role files alone use `.codex`.
- Local CLI configuration probe selected `gpt-6.1-sol`, `ultra`, strict config and
  `agents.enabled=false` and reached the deliberate missing-output-schema error.
  This verifies argument/config parsing only, without a model request.
- Offline controller fixtures exercise real phase logic with injected role/remote
  adapters; they are not a live model review/repair claim.
- Existing reviewer controls: 22/22 passed. Full Vitest: 292 files, 2,747 tests
  passed. Typecheck passed. Lint passed with 12 Fast Refresh warnings in app/context
  files and ignored `qa.local` copies; no errors. Production/PWA build passed,
  with static-appearance, Browserslist-age and bundle-size warnings. These files
  and configuration were not changed by this implementation.
- Orchestration fixtures: 40/40 passed, including a real temporary Git repository
  and isolated worktree initialization, without modifying the caller branch.
  Dry-run selected Sol/Ultra and the three-role small-task route with no model or
  remote operation. The unknown-key negative config probe was rejected before
  output-schema processing; the supported config probe reached schema processing.
- Independent Sol/Ultra review found acceptance coverage, final-challenge verdict,
  pending-CI polling and Windows timeout gaps during implementation. Each was
  repaired and covered with focused probes/tests before final review.
- GitHub protection inspection remains unavailable (connected integration 403).
  Remote branch/PR writes and live model/GitHub execution were not performed.
  Hosted orchestration is outside the requested scope; runs start through Codex
  interactions.

## PR preparation on the current integration base

The dedicated orchestration PR starts from `origin/stattracker` at `f8f74a73`,
without the unrelated Basketball tracker-layout commit from the original checkout.
Authenticated CLI access outside the restricted sandbox confirms that the classic
protection endpoint returns the specific `Branch not protected` 404 and the active
ruleset requires `ci`, PRs, deletion protection and non-fast-forward protection.
The adapter now distinguishes this verified classic-policy absence from inaccessible
policy and honors the two ref restrictions by never deleting or force-pushing.
Two regression tests bring controller coverage to 40 passing tests; independent
Sol/Ultra rereview found no outstanding local issue in that compatibility change.

The earlier 2,747-test/12-warning record above belongs to the original checkout.
Current-base app verification is reported separately in the PR description.
An initial parallel app run hit a 5-second timeout in the unchanged Basketball
release-policy scan; the two-worker rerun leaves test definitions and timeout
limits intact. Existing CI, advisory review, Pages deployment and app source
remain identical to this PR's base. Publishing this infrastructure PR is separate
from running the new pipeline end to end; that live model/repair pilot remains pending.

Current-base verification: 40/40 orchestration tests, 22/22 existing review-control
tests, typecheck, lint (3 warnings in unchanged Context files), production/PWA
build and the full two-worker app suite (292 files, 2,739 tests) passed.


## Owner-requested shutdown controls

The owner requested a persistent kill switch and per-run stop. The controller now
starts disabled, with device-local control.json in the Git common directory.
Enable/disable apply across linked worktrees; disable advances a generation and
writes durable stop requests for existing runs. A rapid re-enable cannot hide that
stop from an active controller. RunControl checks before/after child commands and
polls during work, cancelling through AbortSignal. SIGINT/SIGTERM use that path.

Stop preserves source/worktree/evidence, in-flight commit intent and spent budgets,
records STOPPED, and clears remote publication authority. Explicit resume only
rearms; a separate run invocation is required. Enable never resumes. Per-run stop
requests are acknowledged by generation rather than deleted, avoiding a lost-stop
race. Control commands remain available without valid model/policy configuration.

Child termination targets only currently owned processes, never PIDs from saved
locks. Stop acknowledgement waits for the lock owner to finish. Windows tree
termination and Unix process groups are used; denied or unconfirmed cleanup is
reported and blocks resume until the operator inspects it and explicitly confirms
cleanup. No file switch can undo an already accepted remote request or guarantee
OS cleanup after a forced crash. No Actions workflow or hosted trigger is added.

New control/storage modules participate in the tooling digest. Existing run state
from older tooling still requires inspection rather than silently adopting a new
control implementation. Tests cover default-off startup, linked-worktree disable,
explicit resume, budgets/partial work, fast toggle races, signal requests, stale
locks, abortable CI wait, and actual child/grandchild heartbeat termination.

Shutdown verification: 52/52 controller tests and 22/22 existing review-control
tests passed under a normal Windows token. Independent Sol/Ultra rereview found
no outstanding local issue. The log-open orphan reproduction is covered and fixed
by opening fallible log storage before spawning children. App source, dependencies,
existing workflows and rollout policies are unchanged by this shutdown slice.
