# reasoning-poison (Codex plugin)

Version 0.2.1 delivers three independent reminders: the unchanged reasoning-poison
v0.1.2 payload, `[User intent — outcome reminder]`, and the English
`[Project sources — details reminder]`. The texts are standalone copies, with no runtime dependency on ZCode; its accepted E0–E8 revision has separate literal excerpts.
The new rule re-anchors to the user's requested outcome, separates intent,
artifact and evidence, and keeps service documents/checks subordinate to
execution. User-requested documents and required verification remain required.
Version 0.2.1 adds the standing-rules catalogue: a directory of rule files whose
digest is delivered at starts, full contracts arrive incrementally, and
reminders fire on independent per-rule cadences and on user input (see `## Standing rules catalogue`). The three pinned payloads
are unchanged; their bytes and delivery order stay exactly as before.

Codex does not expose ZCode's `PostToolUseFailure` event, so the port uses the
supported `SessionStart`, `SubagentStart`, `UserPromptSubmit`, and `PostToolUse` events. Main and
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
  ~/.codex/plugins/cache/personal/reasoning-poison/0.2.1
```

The list should show installed/enabled version 0.2.1; the diff should be empty.
Existing hook registrations are unchanged. Review this plugin's entries in
`/hooks` after installation and approve updated hashes if the host requests it.
Already running sessions keep their snapshots; use new sessions after install.

## Self-check

```bash
node --test ~/.codex/personal-marketplace/plugins/reasoning-poison/tests/*.test.mjs
node --test ~/.codex/plugins/cache/personal/reasoning-poison/0.2.1/tests/lifecycle.test.mjs
```

Expected: exit 0, fail 0. These suites invoke the real hook through stdin/stdout
and isolated persistent state: independent 5/13 cadence, starts/first contact,
large-output and configurable old cadence, actor/session/CWD isolation,
legacy/corrupt state, overlapping processes, bounded lock contention and
crash/error release. The source payload suite pins old bytes and checks the shared quantified-scope obligations across harnesses; its relative cross-harness locator is source-only, so
the installed-cache check deliberately runs the portable lifecycle suite.
These standalone Node modules have no project typecheck/lint toolchain;
`node --check` checks syntax. The formerly documented plugin-creator validator
is absent; install/list, file comparison and executable tests verify delivery.

Desktop delivery, model behavior and host-specific compact/child integration
remain for the user's later desktop check. Local suites prove executable
behavior and installed files, not model effectiveness or a running session's
hot reload. No Stop-hook or immediate compact delivery is promised beyond the
host's supported events.

## Standing rules catalogue

Authority: user request of 2026-10-29 to port the whole omo rule catalogue into
Codex, and the earlier 2026-10-23 request that added a separate bounded-verification
rule. Source of the ported rules: `~/.omo/agent/rules/*.json` (15 rules), copied by
`~/.codex/standing-rules/_port-from-omo.py` with every body difference recorded
under `source.adaptations`. Neither the omo catalogogue nor `~/.minimax/rules` is
modified by this plugin;
`tests/port-fidelity.test.mjs` re-derives each body from its omo original.

Cadence unit: omo counts completed model steps, this plugin counts **tool calls**.
`remind.every_n_tools` is the delivered schedule and `remind.every_n_turns` is
accepted as an alias so a rule authored in the other unit still loads; the values
match the table in `~/.codex/AGENTS.md`, which `85-`/`82-`-style resident text
supplements but never overrides.

| ID | Status | Enforcement point | Acceptance |
| --- | --- | --- | --- |
| PS-6 | required; mcode rules delivered in Codex | scripts/catalogue.mjs, scripts/decision.mjs, scripts/state.mjs | catalogue rules delivered at starts; per-rule cadences independent; pinned payloads unchanged |

The catalogue lives outside the plugin at `~/.codex/standing-rules/*.json`; one file
per rule with `name`, `body`, and `remind{every_n_tools, every_input, send_full_rule, suffix}`. The directory is
overridable with `CODEX_STANDING_RULES_DIR` (used by the tests).

Delivery rules:

- A large hook output does not reach the model whole: a start injection of about
  39 KB arrived as a head-and-tail excerpt with the standard Codex output
  truncation envelope and a pointer to the full file under
  `/tmp/hook_outputs/<session>/<id>.txt`. The exact ceiling was not measured and
  is not treated as a platform constant; the design simply keeps every injection
  small enough to arrive intact, and the delivered injections were measured at
  1832 characters (digest) and up to 4568 characters per tool call.
- `SessionStart` and `SubagentStart` deliver the pinned three texts plus a
  catalogue digest: one line per rule with its purpose and the directory of its
  full contract. The digest stays under 3000 characters.
- Each catalogue rule owns its own counter in `ruleCompletedCalls`; it fires its own
  reminder when its own `every_n_tools` is reached, independently of the 5/13/17
  payload cadences and of the other rules. The reminder text is the rule's
  `remind.suffix`, or its whole body when `remind.send_full_rule` is set — the
  same rule as in mcode.
- A rule with `remind.every_input` is delivered on every user message through
  the `UserPromptSubmit` hook, which Codex supports (other installed plugins use
  it). The mcode trigger was preserved one for one, including the rule that had
  no tool-call cadence at all.
- `UserPromptSubmit` delivers every `every_input` rule without advancing or resetting
  tool counters: rules 17, 68 and 70. Rule 70 also sends its full body every two
  tool calls; rules 71 and 72 use tool cadences 5 and 13. The frozen English
  companions retain their separate 5/13/17 schedules.
- The full contract of one rule per tool call is delivered once per rule per
  session, so every rule reaches the model in complete form and the context cost
  stays bounded. A body is skipped when it does not fit the remaining budget
  (`CODEX_STANDING_RULES_BUDGET`, default 3000 characters) and is delivered later.
- At a coincident boundary the due blocks share the existing
  `hookSpecificOutput.additionalContext` envelope, in the order
  reasoning-poison → user-intent → project-sources → digest → rule reminders → rule body.
- A rule file that is missing, unparsable or incomplete is reported on stderr and
  skipped; it never blocks delivery of the remaining rules.
- A missing catalogue directory leaves the pinned delivery untouched.

State: version 1 keeps `ruleCompletedCalls` and `ruleBodiesDelivered` optional.
Legacy state without the fields reads every rule counter as zero and treats every
rule contract as not yet delivered; an invalid present value uses the existing
quarantine/fresh-state recovery path.

Only existing hook, state and decision owners are extended, including the supported
`UserPromptSubmit` event; no new services, no command-text heuristics, and no change to the pinned payload
bytes. The catalogue is read outside the session lock and handed to the locked
child with the event, so the locked section stays a short state update; reading
it inside the lock made the 64-way concurrency test hit the three-second lock
timeout under load. Verification: `tests/catalogue.test.mjs` exercises the real hook through
stdin/stdout, including per-rule cadence, `send_full_rule` bodies, the
`UserPromptSubmit` trigger, isolation from the pinned counters, the start digest
inside the Codex budget, the one-shot delivery of full bodies, a missing
directory and a broken rule file. `tests/port-fidelity.test.mjs` checks that every
ported body still equals its mcode original modulo the adaptations the catalogue
records, that no rule was lost, and that the index in `~/.codex/AGENTS.md` states
the real cadence of every rule. Hook tests establish mechanics, not improved
model behavior or hot reload in a running session.

самостоятельный чек: `TMPDIR=/home/penis/tmp node --test ~/.codex/personal-marketplace/plugins/reasoning-poison/tests/*.test.mjs` + ожидаемый вывод: exit 0, fail 0; pinned payloads unchanged, catalogue digest inside the budget, one rule contract per tool call.

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

## Quantified scope text update

Authority: user request of 2026-10-03 to refine and implement quantified-scope preservation. Existing USER_INTENT_REMINDER_TEXT now preserves the general predicate independently of discovered lists, OPEN coverage, necessary integration, unresolved obligations and repair of derived state/plans. This supersedes the earlier exact intent-text pin only. Reasoning/source payloads and 5/13/17 delivery, identity, state and hooks remain unchanged. ZCode keeps literal complete paragraphs from its current E0–E8 AGENTS; current cross-client whole-payload equality is not required by its accepted ZC-2 revision. Tests exercise instruction delivery; they do not prove universal model effectiveness or live native compact/hot reload.

самостоятельный чек: `TMPDIR=/home/penis/tmp node --test tests/*.test.mjs` + ожидаемый вывод: exit 0/fail 0, unchanged mechanics and revised local intent-text contract.
