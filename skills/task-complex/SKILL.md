---
name: task-complex
description: >
  EXPLICIT-INVOKE ONLY. Multi-reviewer RLM cycle for architecture-sensitive,
  security-sensitive, pipeline, refactor, and multi-module work. The parent is
  the only worker; architect, critic, and task-researcher review each plan in
  parallel, then critic reviews implementation. Trigger only on `$task-complex`,
  "via task-complex", "multi-reviewer plan", or "3-reviewer plan".
---

# Task Complex — Codex multi-reviewer RLM cycle

Use only when explicitly invoked. Generic `via task`, plan-only, and reviewer
phrasing belongs to `$task-simple`.

## Invariants

- Read this file completely before acting.
- The current parent session writes every plan and all implementation. Never
  spawn a worker, planner, implementer, or nested task agent.
- Crystallize under `$CODEX_HOME/tasks/--<sanitized-cwd>--/YYYY-MM-DD/`
  with `/home/penis/.codex` as the default home when `CODEX_HOME` is unset.
  Write the latest plan to `<crystal-stem>.plan.md`. Installed instructions
  never infer a staging profile path.
- Use apply_patch for workflow artifacts and implementation edits. Re-read the
  crystal and plan before every iteration.
- Every non-trivial plan is accepted only when architect, critic, and
  task-researcher all return `ok: true` in the same iteration.
- Full mode requires a separate critic acceptance of implementation.
- Reviewer agents are fresh, read-only, non-spawning, and return verdicts only.
- No vault, daily-note, hidden RLM metadata, or implementation delegation.

## Modes and complexity

Empty input returns:

```text
Usage: $task-complex [--depth=standard|complex] <task description>
```

Plan-only and reviewer phrases behave as in `$task-simple`. Full mode is the
default. Honor `--depth=standard|complex`; otherwise use complex for architecture,
pipelines, security, data flow, refactors, or multi-file uncertainty. There is
no fixed review-call budget: continue until all active gates accept, unless a
real external blocker or user decision prevents meaningful progress.

## Reviewers

| role | focus | required feedback prefix |
|---|---|---|
| architect | patterns, config boundaries, seams, migration, maintenance | `arch-` |
| critic | correctness, scope, verification, project rules | none |
| task-researcher | current primary-source evidence and known pitfalls | `tres-` |

For the first plan iteration, issue three Codex `spawn_agent` calls without
waiting between them, then wait for all results. Use `fork_turns: "none"` and
underscore-only task names such as `architect_plan_0`, `critic_plan_0`, and
`task_researcher_plan_0`. Select the matching custom role when role selection is
surfaced. When the current tool schema has no role selector, provide a complete
self-contained role, input, and verdict contract in each message. Never invent
Pi arguments such as `subagent_type`, `agent`, or `max_turns`.

Reuse the same three agents on revised plans via `followup_task`. They must not
spawn children. The configured three-thread cap is sufficient because the
parent is excluded and all reviewers are leaves.

Each reviewer receives TASK, PHASE=plan, SOLUTION, CRYSTAL, PLAN, DEPTH,
COMPLEXITY, unresolved HISTORY, optional PROJECT_RULES capped at 4000
characters, and optional ADDITIONAL. Omit empty optional fields.

## Verdict contract

All reviewers return one Markdown block:

```md
ok: <true|false>
phase: plan
feedback: |
  <zero to eight [severity]rule @loc → fix lines>
additional: |
  <optional non-empty context; omit when empty>
```

After indentation is stripped, every feedback line must match
`^\[(medium|high|critical)\]([\w-]+)\s+@(.+?)\s+→\s+(.+)$`. Require `arch-`
and `tres-` prefixes for their roles. `ok: true` requires empty feedback. Retry
an unparsable reviewer once on the same agent; a second failure is a visible
`parse_error` and does not count as acceptance.

## Plan loop

1. Write a self-contained plan with outcome, exact files, order, interfaces,
   verification, migration/rollback, risks, and exclusions.
2. Dispatch or follow up all three reviewers in parallel.
3. Optionally append parent-owned reviewer logs beside the crystal:
   `<stem>.architect.md` and `<stem>.task-researcher.md`. Reviewers never write
   these files.
4. Parse all verdicts. Deduplicate by rule plus location, keep the highest
   severity, and on ties prefer critic, then task-researcher, then architect.
5. Accept only when all three return `ok: true`. Otherwise revise with
   apply_patch and repeat.

In plan-only mode, reveal the accepted plan and stop.

## Implementation loop

The parent implements directly and runs relevant verification. Reuse the critic
reviewer only; architect and task-researcher do not review implementation.
Implementation SOLUTION must include the real diff or complete changed artifacts,
the accepted plan, and verification evidence. Fix medium+ findings directly,
verify, and continue until critic accepts. Return to the three-reviewer plan
loop if implementation disproves a load-bearing plan decision.

## Final response

Use the `$task-simple` final format, with actual plan and implementation
iteration counts plus revisits. Surface non-empty additional context from the
latest accepted verdicts in a compact `### Additional from reviewers` section.
Never hide parse errors, unavailable verification, or a genuine blocker.
