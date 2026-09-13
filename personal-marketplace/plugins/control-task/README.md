# Control Task

`control-task` keeps one canonical task per Codex session. The MCP tool derives the
session from Codex-provided thread metadata; callers never provide a session ID.

The state is stored outside repositories under
`${XDG_STATE_HOME:-~/.local/state}/codex-control-task/sessions/`, keyed by a SHA-256
digest of the session ID. Override the root with `CODEX_CONTROL_TASK_STATE_DIR`.

Hooks inject the task at session start, resume, clear, and compaction; before every
user prompt; and after `control_task_set`. During long tool-only turns they refresh
after `CODEX_CONTROL_TASK_REFRESH_SECONDS` seconds (default: `300`).

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
  task_body: "<complete durable task definition>",
  reason: "<why the canonical task is being set or changed>"
})
```

## Verification

Самостоятельный чек: `node --test tests/*.test.mjs` → all tests pass with exit code `0`.
