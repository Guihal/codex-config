# Runtime guards and skill recovery (0.2.0)

Implemented on 2026-09-14 on top of `82c77aa552a73258abd317db74b1ef91b853630b`.
`PORTABILITY.md` is the earlier, dated transfer review. This document records the
implemented subset, its contracts, and its verification boundary.

## What changed

`user-correction-rebase.json` ports Pi's minimal semantic patch policy to every
role, without another state manager or extra per-input reminder. Compatible
requirements survive corrections; only dependent conclusions are invalidated.
Durable task intent is not overwritten by a temporary tool failure.

`verify-before-done.json` now explicitly forbids weakening assertions, mocking
away the verified path, swallowing failures, or rewriting snapshots just to pass.
Proven wrong tests and explicitly superseded requirements remain legitimate reasons
to change a test, with the reason reported. Its exclusions and cadence are intact.

`runtime-guards.py` is a synchronous Codex command hook with small standard-library
modules for shell inspection, process identity, state transactions, and skill
recovery. There is no background agent, inference call, new service, or pip package.
The existing injection engine, lint runtime, task control, rich summary prompt,
other plugins, root configuration, sandbox policy, and stored hook trust are not
changed. Command line-count and universal execution-time guards remain absent.

## Native Codex versus full skill restoration

The inspected upstream skill extension contributes available-skill catalogs to
world state. It loads selected full skill prompts separately as `<skill>` user
fragments; this is not a contract to re-read every previously used local SKILL.md
after arbitrary compaction. This plugin restores those source documents instead
of hoping the lossy summary retained their workflow steps.

The inspected `PostCompact` runner accepts common output but does not record
`additionalContext`. Printing restored bodies there would not restore context.
The implementation therefore uses the following sequence:

1. `PostToolUse` remembers successful, statically recognizable skill reads.
   An incremental JSONL adapter also recognizes native selected skill blocks and
   pairs earlier supported read calls with explicit successful outputs.
2. `PreCompact` reads every remembered source completely, validates paths and
   budgets, and checkpoints SHA-256 hashes. An unreadable, changed-identity,
   untrusted, or oversized mandatory source stops compaction rather than silently
   keeping a partial workflow.
3. `PostCompact` marks that checkpoint ready. It emits no unsupported context field.
4. `SessionStart(source=compact)` or the next `UserPromptSubmit` delivers the full
   bodies. If an automatic mid-turn compact or subagent does not hit these entry
   points, the first supported `PreToolUse` delivers them and denies the already
   chosen call once, so the model can reconsider it with the restored instructions.
5. Repeated compactions repeat restoration. A normal subsequent tool call does
   not replay the same checkpoint. `clear` resets the inventory and skips the old
   transcript; it can also recover from a corrupt state file.

This is **not** a hook before every model inference. A model can generate prose
between a mid-turn compaction and the next supported context hook. The pre-tool
fallback protects the next hooked action, not that earlier prose. Unhooked tool
surfaces, including interactive input paths not exposing PreToolUse, are outside
that guarantee. The plugin does not edit Codex's internal conversation database.

Delivery bookkeeping is committed after stdout is flushed. A process failure can
cause a duplicate replay; there is no host acknowledgement protocol for exactly-once
delivery. No test claims that emitting JSON proves the host accepted it.

## Identity, sources, and storage

In current Codex, `session_id` is shared by the root and descendant threads.
State keys therefore use `agent_id` when supplied, otherwise the transcript's
`session_meta.payload.id`, with a per-transcript fallback for exporters without
that metadata. Role names do not identify a thread. The transcript-disabled root
fallback requires the current actor-aware subagent hook contract. Older Codex builds
that omit both subagent identity and its own transcript are not supported for
reliable child isolation. Normal subagent hooks must provide their own transcript,
not their parent's Stop transcript.

The default source roots are `~/.agents/skills`, `$CODEX_HOME/skills` (normally
`~/.codex/skills`), project/ancestor `.agents/skills` and `.codex/skills`, this
plugin's `skills`, and conventional local plugin `skills` directories under
`~/.codex/plugins`, `~/.agents/plugins`, and `~/plugins`. Only actual recognized
reads activate a skill; discovering a root does not activate its catalog.

Additional trusted directories belong in this plugin's `runtime-guards.json` under
`skill_roots`. Root paths must be absolute or start with `~/`. Symlinks may resolve
within another explicitly trusted root; escapes outside all roots are not followed.
Sensitive path components, non-regular files, invalid UTF-8, and reserved recovery
markers are rejected. Different skills with the same directory name remain distinct
because deduplication uses canonical paths, not names.

Default budgets are 32 skills, 64 KiB per source, and 256 KiB for the complete
restoration block. They are explicit JSON settings, not limits on Bash commands.
Context hooks use `additionalContextLimit: 0` to prevent a second, hidden truncation;
the plugin enforces its own complete-output budget first. A source changed after
the checkpoint is not silently substituted at delivery: re-run compaction against
the new source. Referenced files/scripts remain on-demand; only SKILL.md bodies are
restored, and completed workflow steps are not restarted.

`PLUGIN_DATA/skill-recovery` contains private 0600 metadata files in a 0700
directory, keyed by a hash of session/thread identity. It stores paths, hashes,
scan offsets, and read-call identities, not skill bodies, arbitrary command text,
or tool output. `flock` serializes updates; atomic replacement and fsync preserve
committed state. No runtime metadata belongs in Git.

The JSONL adapter supports the inspected `response_item` / `session_meta` /
`turn_context` layout, native `<skill><name>...<path>...` fragments, and common
`exec_command`, `shell_command`, `shell`, and `read_file` records. Recognition of
shell reads is deliberately a static subset (cat/head/tail/sed/nl/less/more,
literal paths and simple cd chains), with explicit zero exit status for Bash.
Echoed paths, catalogs, failed reads, and still-running shell calls do not count.
The transcript must be the hook's own local regular JSONL file. Incomplete trailing
records are retried; scans are bounded and never silently restricted to a tail.

Arbitrary interpreter-based file reads, remote `skills://` resources, and every
possible shell grammar are not covered. Native selected skills outside configured
local roots stop the checkpoint instead of pretending they were restored. Unknown
implicit read forms cannot be discovered reliably. Transcript recording may lag
or change format upstream; the PostToolUse observer reduces, but cannot eliminate,
that dependency. This port does not promise recovery for an unobserved skill.

## Process-target protection

The process guard passively reads `/proc` and queries `pgrep`; it never executes
the submitted command to discover its effects. It recognizes Codex, Pi, and Claude
native executables and known Node/Bun entry points, including resolved executable
symlinks and native binaries replaced on disk. It protects detected agents and
their hosting ancestors, not all descendants: a normal development server can
still be stopped.

For the supported literal `kill`, `pkill`, `killall`, and `fuser` forms, protected
PID or process-group targets are denied. Signal-zero/listing probes are allowed.
Broadcast/current-group kills, dynamic kill targets, unsupported signalling options,
and `fuser -k` resource-dependent targets require an inspected literal PID instead.
Common wrappers and literal shell `-c`/stdin-heredoc forms are inspected. Quoted
documentation and data heredocs are not executable commands. Ordinary multiline
commands and `timeout`-wrapped tests have no arbitrary line/60-second limit.

Unlike the Pi source, this port does not identify a process merely because an
arbitrary argument contains `pi` or `codex`. Regex selectors are passed to passive
`pgrep` with supported filters, not escaped into unrelated substring comparisons.
Process identity is re-read on each hook; stat/read/stat rejects observed PID reuse.

This remains an **accident-prevention heuristic, not a security boundary**. It
does not evaluate arbitrary scripts, aliases, interpreter APIs such as os.kill,
all substitutions, xargs/find execution, remote SSH commands, or unhooked input.
Process visibility and passive queries use the hook user's permissions; privilege
escalation, concurrent process changes, and arbitrary hostile code are not made
safe by this scanner. Sandbox/OS isolation and the native approval policy remain
separate controls. New hooks return no blanket permission allow decision.

## Installation and verification

Update the installed plugin source from this repository; a remote Git commit does
not update an independent local copy. Review and trust **each new runtime hook**
through `/hooks`, including both compact hooks and the context delivery hooks.
No trusted hash is fabricated or copied into config.toml. Existing handler groups
retain their original indexes and definitions. Requirements: Linux, Python 3.10+
and procps `pgrep` available to command hooks, plus the plugin's existing Node runtime.

From the plugin directory:

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/hook-registration.test.mjs tests/ported-policies.test.mjs
```

The checks cover full-body replay, repeated compaction, fallback deny/retry,
shared-session child isolation, concurrent observers, source/hash failures,
clear/corrupt state, symlink and FIFO boundaries, passive process selection,
quoted shell data, policy parsing in the existing rule engine, and unchanged old
hook registrations. Tests never send a signal to an agent.

Live acceptance still requires a disposable Codex session: read a local test
skill, compact, verify that its complete sentinel text is returned at the next
context hook, repeat with two child threads, and verify a harmless multiline
command. Test kill decisions only against disposable fixtures or by invoking the
guard directly; do not test against a real working session. The user's installed
Codex binary, full pre-existing lint suite, and official plugin validator were not
executed in the editing environment.

## Inspected upstream anchors

These are Git blob IDs, not claims about the user's installed executable version.

| Repository and source | Blob |
| --- | --- |
| `Guihal/pi-config/agent/extensions/rich-compaction/skill-manifest.ts` | `db77d98309446b2901d048e9c24205456e11d827` |
| `Guihal/pi-config/agent/extensions/pi-kill-guard-lib/processes.ts` | `c4a1b6a149256bdbe1f63bddd1d107e3637311b5` |
| `Guihal/pi-config/agent/rules/17-user-correction-rebase.json` | `3479a3d60c1c9a1fd2a134bc7b015f70f11e9924` |
| `Guihal/pi-config/agent/rules/04-dont-game-the-check.json` | `067f224d7ad1d4b972e72ca99c4632d558914d05` |
| `openai/codex/codex-rs/core/src/hook_runtime.rs` | `4e276868ce9ee6d18cbf909849f6b738db94c3ad` |
| `openai/codex/codex-rs/ext/skills/src/world_state.rs` | `466b8e56e57e2305a8730d6176f7b28e376ee32e` |
| `openai/codex/codex-rs/ext/skills/src/fragments.rs` | `0e2e3018db33be55d96c9195dbfcd14180fd00db` |

Thread identity was checked in `core/src/session/session.rs` at upstream commit
`2f8603f07547247e698748884542ba60a157621c`: `session_id()` explicitly returns the
identity shared by the root and descendants. This is why session-only state keys
are not sufficient.