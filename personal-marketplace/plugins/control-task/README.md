# Control Task

`control-task` keeps one main task per Codex session. The MCP tool derives the
session from Codex-provided thread metadata; callers never provide a session ID.

The state is stored outside repositories under
`${XDG_STATE_HOME:-~/.local/state}/codex-control-task/sessions/`, keyed by a SHA-256
digest of the session ID. Override the root with `CODEX_CONTROL_TASK_STATE_DIR`.

Hooks inject the task at session start, resume, clear, and compaction; before every
user prompt; and after `control_task_set`. During long tool-only turns they re-inject the unchanged main task
after `CODEX_CONTROL_TASK_REFRESH_SECONDS` seconds (default: `300`).

After every user message, `UserPromptSubmit` injects the English imperative:
`UPDATE THE MAIN TASK ONLY AFTER THIS USER MESSAGE, THEN CONTINUE THE TASK. DECOMPOSE STRUCTURE, NOT SEMANTICS. Store the main task and requirements, never execution state.`
Preserve the full main task when incorporating the new user message; call `control_task_set` with the latest base token and
complete main task definition, then continue. Preserve the original goal and compatible
constraints when incorporating a clarification, correction or question.

Before Codex starts a subagent, the plugin wraps that subagent's complete launch
message in an `ACTIVE TASK — SUBAGENT BOOTSTRAP` block. `SubagentStart` creates a
separate state using the child `agent_id`, and the child records the original launch
message with one-time `control_task_adopt` before substantial work. The model passes
tokens only; the server copies the exact captured message. Parent state is untouched.
Unused bootstrap records expire after `CODEX_CONTROL_TASK_BOOTSTRAP_TTL_SECONDS`
seconds (default: `3600`). Launch messages over `32768` bytes are rejected explicitly
instead of starting a child without durable control state.

The model calls:

```text
control_task_set({
  base_token: "<token from the latest injected block>",
  task_body: "<complete main task definition>",
  reason: "<which user message establishes or changes the main task>"
})
```

## Verification

Самостоятельный чек: `node --test tests/*.test.mjs` → all tests pass with exit code `0`.

## Main task, never execution state

This is the canonical MAIN TASK anchor, NOT current execution state. It stores the user-requested outcome, complete requirements, constraints and structural decomposition only. Original user messages and governing project sources remain authoritative. Missing requirements here are not exclusions; correct incomplete or misinterpreted task definitions against those sources only after a user message. Current execution state, progress, agents, temporary parameters, measurements, check results, completed-work and next-step reports stay ONLY in conversation context. Never write them to control-task, agent-state, or any other durable artifact reinjected into context. Periodic hooks only re-inject the unchanged task; they do not authorize task updates.

After each user message, and ONLY after a user message, call control_task_set with the complete MAIN TASK, then continue. Never update it during tool-only work, compaction, verification or progress changes. DECOMPOSE STRUCTURE, NOT SEMANTICS. Preserve the original goal and compatible constraints, every requirement, and quantified/general rules in full meaning; questions or clarifications do not replace the whole task. Preserve consequential original wording and source references. Missing requirements here are not exclusions. Known targets are non-exhaustive coverage kept ONLY in conversation context: keep coverage OPEN until exhaustive discovery is evidenced. Newly discovered qualifying targets and necessary integration are already in scope, subject to edit authority; do not persist discovery/progress updates in control-task.

## Scope and authority

Original user messages and governing sources define requirements. Stored task_body is the main task definition, never execution state; missing requirements are not exclusions. Decompose structure, not semantics. Preserve the original general rule, conditions, compatible unresolved obligations, consequential wording and source references. Keep known targets, discovery and coverage evidence only in conversation context; coverage stays OPEN until exhaustive discovery is evidenced. Necessary integration and newly qualifying instances are already in scope; mutation authority still applies. Correct omissions from originals, not a compacted summary. No new schema or automatic semantic validator is introduced; unchanged format/identity checks do not prove model scope preservation.

самостоятельный чек: `TMPDIR=/home/penis/tmp node --test tests/*.test.mjs` + ожидаемый вывод: exit 0, fail 0; hook and catalog expose main-task-only/context-only instructions, persistence/identity/bootstrap checks pass.
