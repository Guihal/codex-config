---
name: goclaw-sandbox-architecture
description: >
  Explain goclaw's file-tool sandbox rooted at ws/system and diagnose "path
  outside workspace" errors. Use when placing an agent-editable file, designing
  a goclaw skill that reads/writes files, or mapping host/container paths.
---

# goclaw sandbox architecture

This is a goclaw runtime rule. `write_file`, `read_file`, and `list_files` below
are goclaw tools, not Codex tool names.

Every goclaw agent's file-tool sandbox is rooted at `ws/system/`. Tool paths are
relative to that root; `..` escapes and sibling directories are rejected even
when they exist on disk.

Mirrored roots:

- container: `/app/workspace/<agent-key>/ws/system/`
- host: `/home/penis/goclaw/workspace/<agent-key>/ws/system/`

Reachable relative paths include `articles/`, `notes/`, `tasks/`, `vacancies/`,
`skills/`, `memory.md`, and `memory/YYYY-MM-DD-brief.md` when they are beneath
that exact root. Agent-root siblings such as `bot/`, `hf-digest/`, `http/`, or
the parent `ws/` are not reachable through file tools.

The host and container paths are volume-mirrored. A valid write to
`memory.md` changes the host `ws/system/memory.md` immediately; the proxy can
inject it on the next turn.

Diagnostic rule: if the agent must edit the file, place it under `ws/system/`.
If only a human or host script edits it, an agent-root location may be fine.
Never hardcode `/app/workspace/...` inside an agent skill; use a sandbox-relative
path.
