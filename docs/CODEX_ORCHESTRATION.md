# StatTracker autonomous orchestration

The opt-in pipeline uses **GPT-6.1 Sol / Ultra for every role**, with no fallback.
It plans, implements in an isolated Git worktree, validates, independently reviews,
repairs and can publish a draft PR and inspect its CI. It never merges. The
[adaptation/audit](PLAN_CODEX_ORCHESTRATION.md) records how the supplied planning
document was conformed to this repo and which capabilities need a wrapper.

The implementation is local-first. The existing Sol/high advisory PR reviewer,
CI, Pages deployment, AGENTS.md, user defaults and existing agent configurations
are preserved. This is not globally enabled automation, and it does not change
ordinary Codex chats' models. Uniquely named `.codex/agents/stattracker-*.toml`
roles are available for explicitly requested native delegation; the controller
launches fresh native `codex exec` sessions to enforce separate sandbox policies.
Native subagents inherit the parent sandbox, so role prose alone is not isolation.

## Quick start

Use Node 20+, Git, pnpm 9 and an authenticated Codex CLI supporting the flags
verified in the audit. `codex exec --help` must list `--ignore-user-config`,
`--strict-config`, `--output-schema`, `--ephemeral` and `--json`. The selected
account/provider must support Sol/Ultra; unsupported options or access fail rather
than silently downgrading. Use local CLI authentication; no key belongs in source.
The pipeline does not inherit user-configured MCP servers or hooks. Do not run
untrusted/fork code in a credential-bearing local session.

First commit/merge this tooling through normal human review. The selected base
must contain the controller tests and repository instructions. From this repo:

```sh
node .github/codex/orchestration/run.mjs dry-run --task .github/codex/orchestration/examples/task.md
node .github/codex/orchestration/run.mjs start --id vite-docs --task .github/codex/orchestration/examples/task.md
```

`dry-run` reads only the task/policy: no model, network, Git mutation or remote
write. Its initial risk classification may be raised by model intake or source
inspection. `start` creates `codex/orchestrate-vite-docs` from local `stattracker`.
Use `--base <reviewed-ref>` to select another explicit starting point; fetch/update
the desired base yourself before starting. It does not copy the caller checkout's
uncommitted changes, switch its branch or discard its work.

State is under `<git-common-dir>/codex-orchestration/vite-docs/`. The command prints
the worktree path. In that worktree, install dependencies with
`pnpm install --frozen-lockfile`, then return to the controller checkout:

```sh
node .github/codex/orchestration/run.mjs run --id vite-docs
node .github/codex/orchestration/run.mjs status --id vite-docs
```

Small tasks use intake coordinator, Developer and independent QA. Medium adds
Architect; high-risk work adds design and final Devil's Advocate challenges.
Routing and skipped roles have recorded rationale. Risk can increase at any role
or after inspecting changed paths. Acceptance criteria cannot disappear between
intake, architecture and independent review. Developer is the sole implementation
writer; the controller owns staging/commits, using your existing Git identity.

All local gates must pass: existing review-controller tests, orchestration tests,
typecheck, lint, full Vitest and build. These commands are frozen in the reviewed
policy. A run stops for inspection before executing any changed policy, CI,
agent instructions, package/dependency manifest or build configuration. This is an
intentional boundary for tasks that change the pipeline itself. Migrations may be
authored for review, but never applied. Supabase/device/PWA/release evidence stays
separate; missing required evidence blocks a clean review.

## Publish and monitor CI

Review the local diff, plan, evidence and draft PR body before granting publication:

```sh
node .github/codex/orchestration/run.mjs run --id vite-docs --publish
```

This explicit opt-in grants only that run's `codex/orchestrate-*` branch push and
draft-PR creation/body update. Authorization persists for its bounded repair loop
and future resumes. No comments, approvals, merge, deployment or repository
settings changes are authorized. Use an authenticated `gh` identity with read
access to branch protection and rules, checks and PR metadata, plus branch/PR
write access. Prefer a repository-scoped GitHub App/fine-grained credential over
broad tokens. Agents do not perform publication; the controller alone invokes it.

The controller inspects existing branch PRs before pushing, uses no force push,
and finds an existing PR on retry instead of creating duplicates. PRs remain
draft to preserve the human review gate and avoid triggering the ready-only
advisory review loop. CI still runs on draft PRs. Inspect all checks and required
checks against the exact reviewed head and base, then recheck the PR snapshot.
Pending CI polls at most every 30 seconds within the same wall-time budget.
Failures enter bounded Developer repair, local validation and fresh QA before
another push. A changed head/base, unreadable protection, unknown rule, missing
check or unfulfilled human approval never becomes READY. Base changes require
a new run against the updated base so acceptance and review are recomputed.

`READY_FOR_HUMAN_REVIEW` means the captured head's inspected gates passed, with
human review still separate. A required human approval produces
`NEEDS_HUMAN_DECISION`. The controller does not approve itself. `status` displays
historical checkpoint evidence; `run` on a previously ready run rechecks remote
freshness. No local check is evidence that GitHub CI ran.

## Persistence, bounds and recovery

Atomic `task.json` checkpoints record head/base, phases, routing, immutable
acceptance, reports, findings, validation and significant decisions in `history`.
Per-call role reports, local validation logs, `ci.json` and `pr-body.md` live beside
it. These files are never committed or automatically uploaded. Keep task text and
reports free of secrets; local logs can contain application output, so inspect
and redact before sharing. Validation inherits a small environment allowlist,
without OpenAI/GitHub/Supabase secrets. This is not a complete hostile-code sandbox:
local CLI credentials and your filesystem still need trusted source and OS controls.

Defaults: five repair iterations, 30 role calls, two hours wall time, 15 minutes
per command and 500,000 observed input/output tokens. Change limits in the reviewed
`policy.json` **before** starting a run. CLI usage events are accumulated when
provided; cached input is included in the input count. Tokens are a post-response
stop threshold, not a strict provider token/cost cap. Usage may be unavailable;
`usageObserved` records that fact. Call/time/repair caps still apply. Use provider
spend limits separately. Nested delegation is disabled in controller sessions.

Normal phase flow:

```text
INTAKE → TRIAGE → PLAN? → CHALLENGE? → IMPLEMENT → LOCAL_VALIDATE → REVIEW
                                      ↑             ↓ failure     ↓ finding
                                      └────────── REPAIR ──────────┘
REVIEW → FINAL_CHALLENGE? → PR_UPDATE → CI_WAIT → READY_FOR_HUMAN_REVIEW
                                         ↓ failure
                                      CI_REPAIR → validation → fresh review
```

Run `run --id ...` again after an interruption. Role calls are charged before
launch; partial Developer changes remain in its worktree for inspection/continuation.
A committed change interrupted before checkpointing is recovered only when its
parent, branch, clean tree and exact controller commit message match the saved
commit intent. Other unexpected edits/head changes require a human decision.
PR publication retries query by branch, including the crash-after-create case.
Repeated identical failure stops early; three infrastructure failures block the
run, including authorization/network/rate-limit failures. No infinite retry.

An exclusive `run.lock` prevents concurrent writers for the task/branch. After a
hard crash, inspect its PID and stop any surviving child processes before removing
that exact lock. Do not delete a lock for an active run or edit an active worktree.
Windows uses process-tree termination with a root-process fallback under restricted
tokens; OS/job-level containment is required to guarantee descendant termination
if Windows denies tree termination. The fallback is covered by local tests.

Terminal failure states preserve evidence and work for inspection. After resolving
an external requirement, use a new run ID with the reviewed corrected base rather
than editing saved states to bypass gates. Policy/tooling digests prevent silently
resuming an old run under changed gate code. Worktree initialization interrupted
before confirmation is marked BLOCKED for manual inspection.

## Validation, hosting and reuse

```sh
node --test .github/codex/orchestration/orchestration.test.mjs
```

The deterministic fixture introduces a subtraction bug, executes an independent
review probe that finds it, repairs it through Developer, then revalidates and
rereviews. It tests the actual controller with injected role/GitHub adapters; it
does **not** claim that a live model detected the bug. Fault fixtures cover stale
review, incomplete acceptance, interrupted work, locks, missing permission evidence,
CI failure/resume, budgets, repeated failures and task text kept out of shell code.

`Codex Orchestration Controls` is a read-only, secret-free workflow triggered
manually or for PRs changing this infrastructure. It runs offline tests only.
Existing CI/review/deploy workflows are unchanged. Hosted autonomous model/writer
execution, issue/comment triggers, shared cross-machine scheduling, uploaded run
recovery and deployment remain deferred. A hosted writer needs separately reviewed
credential isolation, authorization and permissions; no workflow silently adds it.

For another project, copy the controller and native roles through review, adapt
`policy.json` repository/base/checks/context, and replace StatTracker-specific role
context. Keep the model/effort lock, gate semantics and fault tests. Do not install
this as a global default. To roll back, stop active processes, disable the new
controls workflow if enabled, and remove only these additive files in a reviewed
change. Retain run worktrees/evidence until their changes are recovered; do not
delete existing local games, other agents, settings or credentials.

## Verification record

See the [implementation record](PLAN_CODEX_ORCHESTRATION.md). Live CLI model access,
an actual CLI model-driven defect/repair run, remote push/draft PR creation and protected
CI signoff remain pending until explicit publication and adequate GitHub access.
