# Manual orchestration scope and adaptation

Status: **Markdown-only guidance for explicit Codex interactions**.
Owner direction on 2026-10-18: start simple and add infrastructure only when needed.

The supplied ChatGPT planning document proposed an autonomous development pipeline.
The initial implementation explored controllers, persistent state, process spawning,
polling and shutdown controls. The owner has withdrawn that implementation scope.
Those files and their tests/configuration are removed from the final PR diff.
Earlier prototype test results are historical and do not validate this manual workflow.

## Current deliverable

- [Workflow entry point](../CODEX_MULTI_AGENT_ORCHESTRATION.md).
- [Usage, validation and stop guidance](CODEX_ORCHESTRATION.md).
- [Shared instructions](codex/roles/common.md) and five Markdown role briefs.
- A documentation-index link for discovery.

GPT-6.1 Sol / Ultra remains the required selection for the coordinating chat and
every delegated role. That is a procedural requirement; this deliverable installs
no configuration or code to enforce it. Roles use native Codex capabilities when
explicitly invoked. The coordinating chat handles task context, evidence and handoff.

AGENTS.md, existing agent configurations, app source, dependencies, database and
rollout policy, CI, advisory review and deployment remain unchanged. The final
change adds no Actions YAML, controller, schemas, machine-readable policy, runtime
tests, native agent registrations, persistent kill switch or background polling.

## Acceptance and validation

The final diff must contain only Markdown files. Internal links must resolve, role
briefs must support a manual conversation, and instructions must preserve the
repository's source-trace, current-head review and observed-evidence rules.
No guide may refer users to removed commands or claim runtime enforcement.

Check the final file list, internal links and whitespace. App tests/builds are
unnecessary for this documentation-only reduction; earlier runtime test counts
must not be presented as current verification. A small manual task is a future
trial, not evidence already obtained or authorization to build more infrastructure.
