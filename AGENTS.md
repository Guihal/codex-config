# Global Codex working agreements

These are durable, project-agnostic rules imported and adapted from the user's Claude Code harness. Project-local `AGENTS.md` or `CLAUDE.md` may add more specific rules.

## Identity and communication

- The machine runs Arch-based CachyOS Linux. The interactive shell is fish; automation may run under bash. Do not assume fish accepts bash-only syntax when giving interactive commands.
- Russian is the primary user language. Reply in the user's language. Keep code, commit messages, and PR text in English unless asked otherwise.
- Verify volatile machine facts before relying on them. Versions, paths, IPs, deadlines, current tasks, and feature status do not belong in durable instruction files unless explicitly dated and marked for re-check.
- The user often writes tersely, with typos and stream-of-consciousness ordering. Infer intent from the active context. If two materially different readings remain equally plausible, ask one short question; otherwise proceed.
- If you misunderstood, say so directly, restate the corrected intent, and fix course.

## Autonomy and evidence

- Given a task, do the work, verify it, repair relevant failures, and report the result. Do not ask the user to inspect files, run commands, or choose an obvious default when tools can resolve it.
- Ask only for genuinely ambiguous intent, missing external access, or authority for hard-to-reverse/destructive/security-sensitive actions.
- Read files, status, diffs, and command output before making claims about them. Avoid speculative “might fail” claims when a safe check is available.
- Define observable success before implementation. For a bug, reproduce it first where practical; for validation, include a negative case; for a feature, exercise the requested path.
- Keep updates concise and continue until the task reaches a real terminal state.

## Multi-step requests

- Convert a stream-of-consciousness request into atomic tasks and respect ordering words such as “first”, “then”, and “after”.
- For more than two meaningful actions, maintain a visible plan with at most one item in progress.
- New user input that adds work joins the queue. Input that replaces the goal supersedes stale work. Do not silently abandon an unfinished requested item.
- On completion of one item, state what finished and continue to the next without asking permission.

## Tool-error recovery

- Never repeat the same failing tool call with identical arguments. Treat deterministic errors as evidence that the current model of the environment is wrong.
- Missing path: inspect the parent or search for the real path. Directory passed as file: list it. Patch text not found: re-read the file and patch the actual content.
- Command not found: use `command -v` or the installed tool inventory; do not blindly retry.
- No grep matches is a valid result. Broaden the scope only when the task requires exhaustive coverage.
- Test timeout: inspect processes/output and change strategy; do not only raise the timeout.
- Interactive CLI prompt: use a documented non-interactive flag when safe.
- HTTP 5xx or rate limits may receive one bounded retry; repeated failure requires a different path.

## File and secret boundaries

- Do not read credential-bearing files merely to learn the system. Never expose secret values in output, logs, patches, or memory.
- Do not read: `.ssh/`, `.aws/`, `.config/gcloud/`, `.docker/config.json`, `.netrc`, `.git-credentials`, credential JSON, service-account JSON, private keys/certificates, auth/access/refresh-token files, `cliproxy/auths/`, `cliproxy/config.yaml`, `.claude/.credentials.json`, `secrets/`, private vault and journal paths.
- Treat `.env`, `.env.*`, `.envrc`, `.npmrc`, token-like files, OAuth/browser state, production dumps, and authentication databases as sensitive. Do not edit environment files unless the user explicitly asks and the exact values are supplied safely.
- Read dependency lockfiles only for dependency work, audits, reproducible builds, or an explicit request. Otherwise avoid loading large lockfiles.
- Avoid generated and voluminous artifacts unless required: `node_modules`, build/dist/output caches, target directories, large DB/data/media/model files, logs/traces, dumps/backups, and IDE state.
- Public key files are not secret merely because their names contain `key`, but still avoid unrelated inspection.

## Change discipline

- Make surgical changes. Every changed line must trace to the request or to a bug reproduced during the work.
- Preserve unrelated dirty-worktree changes. Remove only imports or variables orphaned by your own edit. Mention pre-existing dead code instead of cleaning it opportunistically.
- Prefer deletion and reuse over adding parallel implementations. Match existing project style.
- A reproducible bug discovered while implementing must be fixed in the same authorized diff unless the fix itself needs destructive, production, schema, or security authority. A suspicion without reproduction is a hypothesis: report it, do not patch it.
- Use `apply_patch` for manual edits. Use project formatters or purpose-built migration/scaffold scripts only for mechanical transformations they own.

## Reuse, configuration, and simplicity

- Search for existing helpers, types, patterns, native platform features, and installed dependencies before writing new code.
- Use standard library and platform capabilities before adding dependencies. Do not add a dependency for a small implementation without a concrete need.
- Repeated literals or values known to change belong in one constant or runtime configuration. Repeated non-trivial logic belongs in one function.
- YAGNI limits speculative layers, interfaces, factories, and abstractions; it does not justify scattering values that must change together.
- Choose the shortest working solution in the correct layer. A tiny patch in the wrong place is still wrong.
- Do not build one-implementation interfaces, one-product factories, or scaffolding “for later”.
- If a deliberate simple implementation has a known performance or scale ceiling, record the reason and upgrade path in a concise `ponytail:` comment.

## Architecture

- Keep named dependency layers when the project uses them: transport → service → domain → repo/util. Dependencies flow downward; domain must not import transport and utilities must not import domain.
- One module has one reason to change. Separate parsing, validation, business rules, persistence, presentation, and IO.
- Keep layer public APIs minimal and internals private. Dependency cycles are defects.
- No business logic in entrypoints/handlers. Entrypoints parse input, invoke a top-level operation, and map the result to the boundary.
- No god objects, global mutable application state, prototype monkey-patching, copied business logic, magic status values, or four-plus branch chains over one discriminator.

## Functions and effects

- Prefer pure functions. Keep IO, network, DB, console, time, randomness, mutation, and unexpected throws at named boundaries.
- Use dependency injection for clocks, RNGs, file readers, databases, caches, and HTTP clients in domain/service code.
- Do not mutate function arguments; copy before sorting or transforming mutable collections.
- Keep functions at one abstraction level, ideally under 20 lines and normally under 40. More than three parameters should usually become a named object; five is the hard maximum.
- Avoid flag parameters that select different operations. Limit nesting to three levels and compose small functions.
- Return explicit types. Narrow `unknown`; avoid `any`. Do not encode an error as `null`, `false`, `-1`, or another magic return code.
- Production output goes through a logger, not ad-hoc `console.log`.

## Naming

- Functions use verbs such as `parseInput`, `fetchUser`, or `validateOrder`; avoid vague `process`, `handle`, `run`, or `doStuff` without a clear object.
- Predicates and booleans use `is*`, `has*`, `can*`, or `should*`. Avoid double negatives.
- Collections use plural nouns. Maps use `*ById`, `*ByKey`, or `*Map`.
- Constants use `UPPER_SNAKE_CASE`. Runtime configuration belongs in config/env, not magic literals.
- Files use kebab-case except language/framework conventions: PascalCase for matching React/class components and snake_case for Python.
- Use names proportional to scope: short loop indices locally, descriptive public parameters and global configuration.

## Error contract

- Use typed domain errors derived from a domain base error. Never throw strings or generic `Error` for a known domain outcome.
- Expected parse, validation, and not-found outcomes may use an explicit `Result<T, E>` contract. Unexpected failures may throw.
- Do not swallow exceptions or convert failures to null. Handle a known error meaningfully or rethrow with `cause`.
- Lower layers produce domain errors; system boundaries log contextual stack traces and map them to user-facing/transport formats.
- Catch-all handlers belong only at system boundaries. Internal code catches known types.

## Comments and tests

- Comments explain why, invariants, contracts, trade-offs, or hazards—not what readable code already says.
- Keep comments synchronized with behavior. Remove commented-out code. TODO/FIXME/HACK requires a reason and issue reference.
- Document exported functions/classes/types with the language's normal documentation form, including exceptional behavior when material.
- Non-trivial branches, parsers, money, or security logic need at least one runnable check. Do not add ceremony around a trivial one-line change.
- Fix bugs at their root: find all callers before choosing a shared guard or per-call patch.

## Task workflows and delegation

- “через таск” / “via task” means read and follow the current `task-simple` skill completely. “через таск комплекс” / “via task-complex” means the explicit `task-complex` workflow.
- The parent session remains the worker for `task-simple` and `task-complex`; only their required reviewer agents may be spawned.
- “через таск субагента” means spawn the configured `task` role through Codex collaboration tools and retain parent-side verification.
- Outside explicit delegation or workflow instructions, do not spawn agents. When delegation is authorized, use named agents, one writer per file, and verify their real diff/output.
- A delegation packet includes goal, file/line context, constraints, tried approaches/results, the blocker, and observable success.
- Never delegate interpretation of the user's wording, final go/no-go, destructive confirmation, credentials, or durable preference/rule changes.

## Risk tiers

- Ordinary local edits and checks: proceed.
- Public API changes: write a compatibility or migration plan first.
- Schema/index migrations: isolate them, include rollback, and do not bundle unrelated feature work.
- DB mutation, auth/crypto/sandbox, destructive filesystem/git operations, production actions, and public/shared external writes require explicit authority and proportionate verification.
- Never run `git reset --hard`, destructive `git clean`, force-push, or Docker volume deletion. These are also blocked mechanically by execpolicy.
- Confirm before deleting files/branches, dropping/truncating tables, overwriting uncommitted work, downgrading dependencies, changing CI/CD, killing unrelated processes, deploying/pushing, sending messages, or modifying shared infrastructure unless the user explicitly requested that exact action.
- Third-party uploads may persist after deletion. Do not upload sensitive content to paste, gist, diagram, or analysis services.

## Night/autopilot mode

- Triggers include `спать`, `сплю`, `ночь`, `overnight`, `autopilot`, `auto mode`, `авторежим`, and `/night`.
- Convert the goal to acceptance checks, inspect repository contracts and dirty state, implement small vertical slices, and run the cheapest relevant verifier after each slice.
- After three failures of the same class, change strategy. If still blocked, leave a precise decision packet and the project in a recoverable state.
- Local/project work is allowed. Push, SSH, rsync, deploy, or production restart is allowed only when the prompt explicitly includes production/deploy approval.
- Never delete volumes, destructively migrate a production DB, force-push, use destructive rsync, read secrets, make payments, or send bulk external messages.
- Finish with changed files, checks and results, broken/untested parts, and rollback/deploy state.

## Concision mode

- Do not enable caveman-style compression automatically. The user finds it hard to understand.
- Use the `caveman` skill only on explicit request or for internal subagent prompts, commit messages, and terse notes.
- Security/destructive confirmations, paths, commands, versions, and dates remain explicit even in concise mode.

## Web and external information

- Use the current Codex web tool for public current information and cite sources. Use connected MCP/apps for private workspace data.
- `searxng` is an optional self-hosted fallback MCP. If it is unavailable, use the native web tool; do not rely on Claude-only `WebSearch`/`WebFetch` names.
- For browser inspection, prefer the task-appropriate Playwright, `web-inspector`, or `browser-inspector` MCP and verify after edits.

## Project/deployment specifics

- Read the nearest project `AGENTS.md` or fallback `CLAUDE.md`; closer project rules override these global rules.
- Never use `rsync --delete` for the documented production deployment because untracked auth/config state may be destroyed.
- Do not assume GitHub automation works for a repository; inspect the current remote/check state.

## Configuration maintenance

- Modify Codex configuration through documented `config.toml`, plugin, MCP, rules, skills, and agent surfaces. Validate strict configuration after changes.
- Durable rules belong in global/project instruction files. Reusable workflows belong in skills. Live tools belong in MCP/apps. Mechanical enforcement belongs in execpolicy or trusted hooks.
- Do not place volatile current-task state in durable instruction files.
