---
name: task-simple
description: >
  READ THIS SKILL.md COMPLETELY BEFORE USING. Compact single-reviewer RLM cycle
  where the parent session is the only worker: crystallize, plan, mandatory
  critic review, implement, verify, and mandatory implementation review.
  Supports plan-only and reviewer modes. Trigger on "via task", "using task",
  "plan only", "just plan", "no code", "task as reviewer", or `$task-simple`.
---

# Task Simple — Codex RLM cycle

## Non-negotiable rules

- The current parent session is the worker. It writes the plan and performs all
  implementation. Never delegate planning or implementation.
- Before the plan loop, crystallize the task under the effective runtime Codex
  home: `$CODEX_HOME/tasks/--<sanitized-cwd>--/YYYY-MM-DD/HHMMSS-<slug>.md`.
  When `CODEX_HOME` is unset, use `/home/penis/.codex` as the home. The plan is
  `<crystal-stem>.plan.md`, overwritten on each revision. Never infer a staging
  profile path at runtime.
- Use `apply_patch` for crystal, plan, and implementation edits. Re-read the
  crystal and plan before every review iteration.
- A fresh critic subagent must accept the plan before it is revealed. In full
  mode, a critic must also accept the implementation before the final answer.
- Do not spawn worker, planner, implementer, task, or general-purpose agents.
  The only allowed child is the mandatory critic.
- Do not persist vault, daily-note, or RLM metadata. Crystal and plan are the
  only workflow artifacts.
- Final artifacts must be self-contained and must not rely on feedback history.

## Pre-check

If task text is empty, reply exactly:

```text
Usage: $task-simple [--depth=trivial|standard|complex] <task description>
```

Then stop.

## Modes

- Plan-only: selected by `plan only`, `just plan`, `only plan`, `plan first`,
  `no code`, or `don't write code`. Run the plan gate and skip implementation.
- Reviewer: selected by `task as reviewer`, `task for review`, or an explicit
  request to review an artifact. Do not edit the reviewed product.
- Full: default. Run plan, implementation, verification, and both critic gates.

## Complexity and budgets

Honor a leading `--depth=trivial|standard|complex` override and remove it from
the task text. Otherwise classify:

| complexity | use when | plan reviews | implementation reviews | revisits |
|---|---|---:|---:|---:|
| trivial | tiny obvious local change | 2 | 3 | 0 |
| standard | normal bugfix or feature | 3 | 5 | 1 |
| complex | architecture, pipeline, security, multi-module uncertainty | 5 | 8 | 2 |

When unsure, use standard. The budget counts critic calls. If exhausted, keep
the best current artifact and report `maxDepth_plan` or `maxDepth_impl`.

## Starting and reusing the critic

Use Codex collaboration tools only. On the first plan review, start one fresh
critic with `fork_turns: "none"` and a valid underscore-only task name such as
`critic_plan_0`. If the runtime exposes custom-agent selection, select the
`critic` role. If the surfaced `spawn_agent` schema has no role selector,
include `Act as the critic role` plus the complete input and verdict contract in
the self-contained message. Never invent `agent_type`, `subagent_type`,
`max_turns`, or other unsupported arguments.

Reuse the same critic with `followup_task` for later plan and implementation
iterations. Use `wait_agent` for completion and `send_message` only for concise
non-triggering corrections. The critic must never edit or spawn.

Every call includes:

- `TASK`, `PHASE`, `SOLUTION`, `DEPTH`, `COMPLEXITY`;
- absolute `CRYSTAL` and `PLAN` paths;
- unresolved `HISTORY`, omitted when empty;
- binding `PROJECT_RULES` excerpts, capped at 4000 characters and omitted when
  empty;
- optional `ADDITIONAL`, omitted when empty.

For implementation, SOLUTION must contain the relevant real diff or complete
changed artifact plus verification evidence, not a success-only summary.

## Critic verdict and parsing

The critic returns exactly one Markdown block:

```md
ok: <true|false>
phase: <plan|implementation>
feedback: |
  <zero to eight issue lines>
additional: |
  <optional non-empty context; omitted when empty>
```

Each feedback line, after leading whitespace is stripped, must match:

```text
^\[(medium|high|critical)\]([\w-]+)\s+@(.+?)\s+→\s+(.+)$
```

Require lowercase boolean `ok` and exact phase echo. `ok: true` requires empty
feedback. If parsing fails, retry that same critic once with a terse request for
the exact Markdown contract. A second parse failure becomes `parse_error`; keep
the current artifact and surface the warning.

## Plan loop

1. Write a self-contained plan with outcome, exact files, ordered changes,
   verification commands, risks, exclusions, and rollback when relevant.
2. Re-read crystal and plan.
3. Send the critic PHASE=plan and the current plan as SOLUTION.
4. If accepted, freeze the plan. If rejected, deduplicate medium+ feedback by
   rule and location, revise the plan with apply_patch, and repeat within budget.
5. Do not show plan drafts before acceptance or budget termination.

In plan-only mode, stop here.

## Implementation loop

1. Implement the accepted plan directly in the parent session with apply_patch.
2. Preserve unrelated user changes and stay within the authorized paths.
3. Run cheap relevant checks before the critic. Fix local verification failures
   first when possible.
4. Re-read crystal and accepted plan; send PHASE=implementation with the real
   diff/artifacts and verification output.
5. If rejected, merge medium+ feedback, fix directly, verify again, and reuse
   the critic. If the plan is fundamentally wrong, return to the plan loop only
   within the revisit budget.

Passing verification is not proof of correctness; it is a cheap gate before
independent review. When no safe relevant check exists, state that verification
is unavailable and continue to the critic.

## Final response

Plan-only:

```text
✅ Task solved (complexity: <x>, plan: <n> iter, impl: skipped).
Crystal: `<path>`
<warning when applicable>

### Plan
<accepted self-contained plan>
```

Full mode:

```text
✅ Task solved (complexity: <x>, plan: <n> iter, impl: <m> iter, revisits: <r>).
Crystal: `<path>`
<warning when applicable>

### Plan
<accepted self-contained plan>

### Implementation
<outcome, changed files, checks, remaining risks>
```

Append `### Additional from critic` only when the latest accepted critic verdict
contains non-empty additional context. Do not hide parse or budget warnings.
