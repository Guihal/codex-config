# reasoning-poison (Codex plugin)

Codex adaptation of ZCode's `reasoning-poison` plugin. It injects exactly the
same v0.1.2 reminder payload and no other behavioral rules.

Codex does not expose ZCode's `PostToolUseFailure` event, so the port uses the
supported `SessionStart`, `SubagentStart`, and `PostToolUse` events. Main and
subagent counters are isolated by `session_id`, `agent_id`, and canonical CWD.
The reminder is delivered at each start, after every five completed tool calls,
and after a tool response of at least 8192 serialized bytes.

Configuration:

- `CODEX_REASONING_POISON_INTERVAL`: positive integer, default `5`.
- `CODEX_REASONING_POISON_LARGE_OUTPUT_BYTES`: positive integer, default `8192`.
- `CODEX_REASONING_POISON_STATE_DIR`: explicit state root for tests or overrides.

The normal state root is `${PLUGIN_DATA}/reasoning-poison`; direct invocation
falls back to `${XDG_STATE_HOME:-~/.local/state}/codex-reasoning-poison`.

## Self-check

```bash
node --test tests/*.test.mjs
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

Expected output: all tests pass and validation ends with
`Plugin validation passed: <plugin-path>`.
