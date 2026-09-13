# Codex configuration

This repository keeps authored Codex configuration and personal plugin sources.
Runtime databases, sessions, history, memories, caches, OAuth data, and credentials
are excluded by a root allowlist in `.gitignore`.

The canonical personal marketplace lives under `personal-marketplace/`. Four local
plugins are tracked directly. `codebase-project-graph` remains an independent Git
repository and is linked into the marketplace, matching the separation used by the
Pi configuration repository.

Compatibility paths used by the default personal marketplace remain available:

- `~/.agents/plugins/marketplace.json`
- `~/plugins/project-structure`
- `~/plugins/codex-guardrails`
- `~/plugins/searxng`
- `~/plugins/control-task`

Never put literal credentials in `config.toml`; reference environment variables or
credential stores instead.

Самостоятельный чек: `git -C ~/.codex status --short --branch && codex plugin list`
→ Git reports branch `main` and the personal plugins resolve from their compatibility
paths without plugin-loading errors.
