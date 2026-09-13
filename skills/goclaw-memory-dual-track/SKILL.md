---
name: goclaw-memory-dual-track
description: >
  Explain and debug goclaw's two independent memory systems: DB-backed identity
  files versus sandbox-editable disk file-memory. Use for "memory didn't
  update", identity files, USER.md/SOUL.md, success markers, or deciding where
  a new goclaw memory type belongs.
---

# goclaw memory: dual track

This skill describes tools inside the goclaw runtime. Names such as
`write_file` are goclaw concepts, not Codex tools.

## Track 1 — identity

Files: `USER.md`, `SOUL.md`, `IDENTITY.md`, `AGENTS.md`, and
`CAPABILITIES.md`.

- Storage: Postgres tables `agent_context_files` and `user_context_files`.
- Prompt injection: `<user-persona>` and possibly direct system-prompt merge.
- A same-named disk file is not authoritative at session start.
- goclaw `write_file` may report `Context file written`, but it updates only a
  disk path; there is no sandbox-to-DB identity bridge.
- Edit through goclaw UI or its authenticated API. Treat identity files as
  read-only from an agent sandbox.

## Track 2 — file-memory

Files: `memory.md` and `memory/YYYY-MM-DD-brief.md`.

- Storage: workspace disk under `<agent-key>/ws/system/`.
- Prompt injection: `<file-memory>`, refreshed by tdai-gateway-proxy from disk
  on each turn.
- goclaw `write_file` persists only when the resolved path stays inside the
  sandbox. A successful marker alone does not prove the prompt source changed.

| prompt block | source | sandbox editable | correct update path |
|---|---|---|---|
| `<user-persona>` | Postgres | no | goclaw UI/API |
| `<file-memory>` | disk via proxy | yes | sandbox file tool |
| `<recalled-memory>` | TDAI vector DB | no | TDAI capture pipeline |
| `<recalled-memory-intermediate>` | TDAI vector DB | no | TDAI capture pipeline |

## Diagnostic procedure

1. Read the actual target path, not the success marker.
2. Classify it as identity or file-memory.
3. For identity, verify the DB/API update path; disk writes cannot work.
4. For file-memory, verify the path is within `ws/system/` and the proxy rereads
   it on the next turn.
5. Distinguish a true write from a flow that printed a success marker after a
   rejected out-of-sandbox path.

Choose identity storage for durable persona/profile data and file-memory for
notes, indices, and dated logs. Any plan that edits identity files with
`write_file` is invalid.
