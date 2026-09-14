# Harness transfer review

Reviewed on 2026-09-14 against `Guihal/codex-config` commit
`b44d4b2b1d04adb484cf1e7cffeac8e8cfa63289` and the source blobs recorded below.
This is a targeted configuration and selected-source review, not a complete
runtime audit of every extension or of the user's installed environment.

## Implemented in this change

Remove the Bash command line-count guard, its hook registration, obsolete trust
record, and old limit-enforcement tests. Keep the rule engine, rule catalogue,
lint implementation, other plugins, and all unrelated configuration unchanged.
Add registration regression tests and update the plugin version and README.
No additional blocking hook or behavioural rule is enabled by this review.

## First priority: merge two missing policy details

**Correction is a minimal semantic patch, not a task reset.** Pi's
`agent/rules/17-user-correction-rebase.json` explicitly preserves compatible
requirements, invalidates only conclusions depending on the corrected fact, and
distinguishes a durable task definition from temporary execution state. Codex's
root `AGENTS.md` covers misunderstandings and task queues, and `task-list.json`
covers plan bookkeeping, but these are not the same detailed contract.

Merge the portable semantics into the existing instruction/rule layer rather
than installing a second state manager. Do not import Pi-only actor names,
sibling-rule references, incident history, or a new per-input reminder without
checking the existing injection cadence and context budget. Acceptance case:
changing "Pi" to "Codex" preserves the remaining goal and constraints; a local
tool failure does not overwrite the durable task definition.

**Do not weaken tests merely to obtain a pass.** Pi's
`agent/rules/04-dont-game-the-check.json` explicitly rejects removed assertions,
mocking away the path being tested, swallowed failures, and snapshot rewrites
without investigating the mismatch. Codex's `verify-before-done.json` requires
real verification but does not spell out this anti-gaming policy.

Merge this into verification guidance instead of adding a second verifier.
Preserve the exception for demonstrably incorrect or intentionally superseded
tests, with the changed requirement and reason reported. Removing tests for the
line limit is intentional here because the user explicitly removed that policy;
replacement tests check the new requirement and preserved hooks.

These two policy merges have the best immediate benefit-to-complexity ratio.
They are recommendations, not changes made to the standing rules in this commit.

## Next candidate: process-target protection, adapted for Codex

Pi's `agent/extensions/pi-kill-guard.ts` inspects Bash commands and nested script
text to block killing Pi processes or targeting ambiguous process groups. This
is a useful accident-prevention idea, but not a safe copy-and-rename port: its
process recognizer, escape mechanism, runtime API, and feedback are Pi-specific.
It also rejects broad decode/execute combinations that can be legitimate.

A Codex port needs explicit process identity/ownership and tests for the current
session, other working sessions, subagents, ancestors, groups, PID reuse, and
ordinary owned development servers. Test harmless `timeout` and multiline
commands as allowed cases. Keep messages short; do not replace the removed line
limit with another blanket restriction. Static shell inspection is a heuristic
against accidents, not a security boundary against arbitrary code execution.

Do not enable this port before those checks. Existing sandbox/approval/execpolicy
settings are outside this removal and must not be silently changed.

## Conditional candidate: compact capability/document refresh

Pi's `agent/extensions/docs-inject.ts` injects a documentation and MCP capability
snapshot at session start and after compaction. The useful transferable part is
remembering configured capabilities and attempting discovery/use before declaring
them unavailable. Native instructions, skills, and tool discovery may already
cover a particular Codex workload; first reproduce a missing-capability failure.

If needed, inject a small allowlisted summary rather than all Pi documentation,
configuration values, secrets, or duplicate standing rules. Use Codex tool names
and verify post-compaction behaviour and context size.

## Already present: do not duplicate

The current Codex configuration enables `codex-guardrails`, `project-structure`,
`codebase-project-graph`, and `control-task`. Its guardrails register stateful
injection and post-`apply_patch` linting; `experimental_compact_prompt_file` points
to the existing rich-compaction prompt. Configuration presence is not evidence
that every installed path currently resolves or that every runtime works.

Claude's current `settings.json` has corresponding structure/injection/lint hooks.
Porting those again would add competing lifecycle handlers. Keep the existing
documented choice that the auditor is a Codex subagent role, not an automatically
ported Pi background auditor runtime.

## Do not port by default

Pi's `bash-timeout.ts` clamps every Bash command to 60 seconds and recommends
detached jobs for longer work. Do not add another arbitrary universal limit;
choose execution budgets according to the command and available process controls.
Pi provider/temperature adapters are not automatically relevant to Codex, and
disabled Claude plugins such as `context-mode` are not proof of useful defaults.
Do not copy permissions, trust hashes, local absolute paths, or credentials from
another harness as a shortcut to compatibility.

## Source anchors

All hashes below are Git blob IDs, not commit IDs. Source names refer to the
repositories under `Guihal`; these observations should be rechecked after edits.

| Repository / path | Blob SHA |
| --- | --- |
| `pi-config/agent/rules/17-user-correction-rebase.json` | `3479a3d60c1c9a1fd2a134bc7b015f70f11e9924` |
| `pi-config/agent/rules/04-dont-game-the-check.json` | `067f224d7ad1d4b972e72ca99c4632d558914d05` |
| `pi-config/agent/extensions/pi-kill-guard.ts` | `7894e63671e883ec2dde0c6720d4e530abc4d4ce` |
| `pi-config/agent/extensions/docs-inject.ts` | `cf7700b7bcb5da2ef2d652bd0329225568f0da30` |
| `pi-config/agent/extensions/bash-timeout.ts` | `5130cfec43e85faced1251e13e350ab9697589f2` |
| `claude-config/settings.json` | `350986dad0b144f4b220ef66b5709f230b7c3a09` |
| `codex-config/AGENTS.md` | `4352d2c4aedb74a12845edc6b8c6b04dbe39b6f8` |
| `codex-config/personal-marketplace/plugins/codex-guardrails/rules/task-list.json` | `5828df77fc04aec6e81e249f6a095343de3641f8` |
| `codex-config/personal-marketplace/plugins/codex-guardrails/rules/verify-before-done.json` | `dca8774b1566fcd7b774677e931495c84e13f436` |

## Verification boundary

The removal was checked with the original guard's six tests before deletion,
five new registration tests (two fail on the original, all pass after removal),
JSON/TOML parsing, and a structural comparison proving that unrelated hooks and
configuration are unchanged. This is not a full lint/rule-engine suite run, an
official plugin-validator run, or an end-to-end test in the user's Codex session.
