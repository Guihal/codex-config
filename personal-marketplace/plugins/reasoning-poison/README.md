# reasoning-poison (Codex plugin)

Version 0.1.2 delivers three independent reminders: the unchanged reasoning-poison
v0.1.2 payload, `[User intent — outcome reminder]`, and the English
`[Project sources — details reminder]`. All three texts match the ZCode
source but are standalone copies, with no runtime dependency on that harness.
The new rule re-anchors to the user's requested outcome, separates intent,
artifact and evidence, and keeps service documents/checks subordinate to
execution. User-requested documents and required verification remain required.

Codex does not expose ZCode's `PostToolUseFailure` event, so the port uses the
supported `SessionStart`, `SubagentStart`, and `PostToolUse` events. Main and
subagent counters are isolated by `session_id`, `agent_id`, and canonical CWD.
All three reminders are delivered at each start or first contact without state;
all three counters reset. Reasoning-poison still arrives after every five completed
tool calls or a tool response of at least 8192 serialized UTF-8 bytes.
The user-intent reminder arrives every 13 completed calls independently. Early
reasoning-poison delivery resets only its own counter; user-intent delivery
resets only the intent counter. At coincident boundaries (65 ordinary calls at
defaults), both texts appear old → new in one JSON envelope. Unsupported events
are silent; due events use the existing `hookSpecificOutput.additionalContext`.

Configuration:

- `CODEX_REASONING_POISON_INTERVAL`: positive integer, default `5`.
- `CODEX_REASONING_POISON_LARGE_OUTPUT_BYTES`: positive integer, default `8192`.
- `CODEX_REASONING_POISON_STATE_DIR`: explicit state root for tests or overrides.

The first two settings affect only reasoning-poison, not the fixed intent
period. No tool command text is parsed to guess tests or major edits.

The normal state root is `${PLUGIN_DATA}/reasoning-poison`; direct invocation
falls back to `${XDG_STATE_HOME:-~/.local/state}/codex-reasoning-poison`.
Version 1 state includes `intentCompletedCalls` and `sourcesCompletedCalls`; old valid state without that
field reads it as zero while retaining old cadence and `injectedTotal` (the
number of reasoning-poison deliveries). Invalid present counters use the
existing quarantine/fresh-state recovery path.

One hook owns read → decide → write under a per-key `flock` (util-linux) lock.
The hook re-executes itself under `flock --no-fork`, keeping the lock through
the transaction; the kernel releases it on exit or crash. A three-second
bounded wait fits within the existing five-second hook timeout. Different
session/actor/CWD keys do not contend. Lock inodes remain in place so crash
recovery cannot create competing owners. State and locks are mode 0600, and
state replacement remains atomic. Errors, including lock timeout, produce
stderr/exit 1 without a success envelope; nothing due means empty stdout/exit 0.

## Install

```bash
codex plugin add reasoning-poison@personal --json
codex plugin list --json
diff -qr ~/.codex/personal-marketplace/plugins/reasoning-poison \
  ~/.codex/plugins/cache/personal/reasoning-poison/0.1.2
```

The list should show installed/enabled version 0.1.2; the diff should be empty.
Existing hook registrations are unchanged. Review this plugin's entries in
`/hooks` after installation and approve updated hashes if the host requests it.
Already running sessions keep their snapshots; use new sessions after install.

## Self-check

```bash
node --test ~/.codex/personal-marketplace/plugins/reasoning-poison/tests/*.test.mjs
node --test ~/.codex/plugins/cache/personal/reasoning-poison/0.1.2/tests/lifecycle.test.mjs
```

Expected: exit 0, fail 0. These suites invoke the real hook through stdin/stdout
and isolated persistent state: independent 5/13 cadence, starts/first contact,
large-output and configurable old cadence, actor/session/CWD isolation,
legacy/corrupt state, overlapping processes, bounded lock contention and
crash/error release. The source payload suite pins old bytes and compares both
texts across harnesses; its relative cross-harness locator is source-only, so
the installed-cache check deliberately runs the portable lifecycle suite.
These standalone Node modules have no project typecheck/lint toolchain;
`node --check` checks syntax. The formerly documented plugin-creator validator
is absent; install/list, file comparison and executable tests verify delivery.

Desktop delivery, model behavior and host-specific compact/child integration
remain for the user's later desktop check. Local suites prove executable
behavior and installed files, not model effectiveness or a running session's
hot reload. No Stop-hook or immediate compact delivery is promised beyond the
host's supported events.

## Project sources contract

Authority: user request of 2026-09-30 to study existing project documents and
style guides before repository work, emphasizing details and non-obvious rules;
"На английском ремайндер. Лучше по отдельной каденции"; acceptance of the
proposed English text and 17-call cadence: "Делай, брат. Можешь целиком брать
логику из тех расширений"; scope extension: "И в zcode докинь его тоже".
This section records those authorized requirements, not independent authority.

| ID | Status | Enforcement point | Acceptance |
| --- | --- | --- | --- |
| PS-1 | required; English payload accepted verbatim | scripts/reminder-text.mjs | exact approved text, same bytes across clients |
| PS-2 | required; fixed 17-call cadence accepted | decision logic in existing hook | source-only delivery at 17/34; 5/13 unchanged; early triggers never reset source counter |
| PS-3 | required; existing state/identity contract preserved | scripts/state.mjs | legacy missing source counter starts at zero; invalid present value quarantined; concurrency and isolation preserved |
| PS-4 | required; start/recovery delivery accepted | decision logic in existing hook | all existing start sources and first-contact fallback deliver all three texts, counters zero |
| PS-5 | required; repository reading rule accepted | global AGENTS.md, section Project sources before decisions | both clients contain the same rule before consequential repository work |

Only existing hooks/state owners are extended. No new hook events, dependencies,
services, blocking read gate, command-text heuristics, or changes to old payloads.
The new sourcesCompletedCalls field is optional in legacy version-1 state.
Its cadence is fixed at 17 and independent of old interval configuration,
large-output/Skill/Agent/TaskOutput early triggers, and intent delivery.
At coincident boundaries only due blocks share the existing envelope, in
reasoning-poison → user-intent → project-sources order. A cadence reminder does
not replace the obligation to read sources before the first substantive decision.

Project-sources delivery: every 17 completed calls, no early triggers. Starts
and first contact deliver all three texts; the three counters reset independently.
Legacy state defaults only the missing sourcesCompletedCalls field to zero.
Verification: source suites exercise the real hook stdin/stdout boundary,
including independent cadences, migration, starts, early triggers and concurrency.
Installed-copy validation is performed after installation.
Hook tests establish mechanics, not improved model behavior or hot reload.

самостоятельный чек: `node --test /home/penis/.codex/personal-marketplace/plugins/reasoning-poison/tests/*.test.mjs` + ожидаемый вывод: exit 0, fail 0; source cadence 17, existing cadences 5/13 preserved.
