# Codex multi-agent orchestration — StatTracker

This is the repository adaptation of the supplied ChatGPT planning document.
It describes an **opt-in pipeline**, not a replacement for AGENTS.md or ordinary
Codex sessions. Existing user/agent configuration, product release gates, CI,
advisory reviews and deployment remain authoritative and unchanged.

Read the [architecture and compatibility audit](docs/PLAN_CODEX_ORCHESTRATION.md)
and [operating guide](docs/CODEX_ORCHESTRATION.md) before running it. The audit
distinguishes implemented local behavior, offline evidence and pending live checks.

## Implemented contract

- Every pipeline role uses `gpt-6.1-sol` / `ultra`; unsupported access fails with
  no fallback. There is no global model/configuration change.
- The controller coordinates intake, adaptive risk, plans, challenges, Developer,
  independent read-only QA, validation, bounded repair and PR/CI handling.
- Small tasks skip architecture/challenge ceremony. Sensitive work raises risk;
  high-risk work requires design and final adversarial review.
- Only Developer authors implementation. Fresh CLI sessions enforce separate
  developer/reviewer sandbox policies. Native project roles are also supplied.
- A persistent, default-off master switch applies across linked worktrees. Stop
  cancels active child commands, checkpoints STOPPED and requires explicit resume;
  enable never restarts work. Cancellation clears publication authorization.
- A task owns an isolated Git worktree/branch and atomic durable checkpoints
  outside tracked source, with locks and wall-time/call/repair/observed-token bounds.
- Acceptance, local gates and independent review bind to the exact head/base.
  Every substantive repair is validated and independently reviewed again.
- Local execution/dry-run does not publish. Explicit `--publish` grants that run's
  bounded draft-PR/branch updates. Ready/closed/fork/unexpected PRs stop the writer.
- Current-head CI, protection and rules must be inspectable and satisfied. Missing
  checks, stale evidence, required human approval and unsupported rules never
  produce a false READY. Pending CI is polled within the saved time budget.
- No agent approves itself, merges, deploys, applies migrations, weakens mandatory
  checks or silently broadens rollout. Execution-policy changes stop for inspection.

## Entry points and current limits

Run `node .github/codex/orchestration/run.mjs help`. Policy, role prompts, schema,
controller, adapters and fault tests are in
[.github/codex/orchestration](.github/codex/orchestration/). Native opt-in roles are
in [.codex/agents](.codex/agents/).

Local implementation and offline controller/Git tests are verified. A full live
CLI model-driven repair, remote publication and protected-CI pilot remain pending.
Orchestration runs only through explicit Codex interactions. No GitHub Actions
workflow, hosted writer, issue/comment trigger or cross-machine scheduler is added.
Run the offline contract tests locally through Codex. Token usage is an observed
stop threshold, not an enforceable provider spend cap.

For another project, review/adapt the repository policy, context and role prompts;
retain model locks, trust boundaries and fault coverage. See the operating guide
for setup, recovery, troubleshooting and rollback.
