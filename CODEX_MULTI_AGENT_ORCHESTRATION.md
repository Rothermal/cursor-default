# Manual multi-agent workflow for StatTracker

Use this workflow only when the user explicitly requests it in a Codex chat.
Use **GPT-6.1 Sol / Ultra for the coordinating chat and every delegated role**.
Select that model/effort in Codex before starting; these Markdown files do not
enforce client settings. Do not substitute another model or effort silently.

Read [the operating guide](docs/CODEX_ORCHESTRATION.md), [AGENTS.md](AGENTS.md),
the [codebase overview](docs/AGENT_CODEBASE_OVERVIEW.md), and the task's owning plan.
The [scope record](docs/PLAN_CODEX_ORCHESTRATION.md) explains this initial approach.

## Roles

Read the [shared instructions](docs/codex/roles/common.md), then the relevant brief:

| Role | Purpose |
| --- | --- |
| [Orchestrator](docs/codex/roles/orchestrator.md) | Scope the task, choose roles, coordinate evidence and report progress |
| [Architect](docs/codex/roles/architect.md) | Propose design and acceptance criteria when needed |
| [Developer](docs/codex/roles/developer.md) | Own implementation, tests and repairs |
| [Reviewer](docs/codex/roles/reviewer.md) | Independently inspect the current change and validation evidence |
| [Devil's Advocate](docs/codex/roles/challenger.md) | Challenge consequential design and failure assumptions |

For a small task, use Developer and independent Reviewer. Add Architect for
design work and Devil's Advocate for high-risk work. The coordinating chat assigns
bounded tasks using native Codex delegation when available, then consolidates the
results. Delegate only useful work; do not create ceremony for a simple edit.

## Working agreement

1. Establish scope, current behavior and acceptance criteria from the user and
   governing plans. Distinguish shipped contracts, approved targets and deferred work.
2. Assign one implementation writer. Give reviewers a read-only assignment and
   the relevant plan, diff and prior findings. Role instructions are procedural;
   they do not create separate sandbox permissions.
3. Implement, run appropriate existing checks, independently review, and repair
   proved defects. Re-review the current change after substantive fixes.
4. Stop repeated unsuccessful repair attempts or unresolved blocking disagreements
   and report the evidence to the user. Keep meaningful decisions in the chat or
   owning project document as needed.
5. Prepare or update a PR when authorized. Report exact validation and current-head
   CI status; pending or unavailable checks are not a passing result. Human review
   and merge remain separate actions.

The user can stop the workflow at any time. Stop delegating, cancel known active
agents/commands through native controls, preserve partial work, and report any
shutdown that cannot be confirmed. Resume only when the user requests it.

This initial version is Markdown guidance. It adds no controller scripts,
registered agent configurations, state engine, polling loops or scheduled jobs.
Existing repository instructions, CI, advisory reviews and deployment stay intact.
