---
name: goclaw-publish
description: >
  Publish an already-authored local skill directory or zip to the goclaw managed
  store through POST /v1/skills/upload, then verify it via GET /v1/skills. Use
  only when the user asks to register a skill with goclaw; not for authoring,
  updating an existing slug, deleting, dependency installation, or grants.
---

# Publish a skill to goclaw

This workflow causes an external state change. Run it only on an explicit user
request to publish the supplied source.

## Inputs

- Source: directory containing root `SKILL.md`, or a zip with `SKILL.md` at the
  root or inside one top-level directory.
- Gateway: `GOCLAW_GATEWAY_URL`, default `http://127.0.0.1:18790`.
- Token: `GOCLAW_GATEWAY_TOKEN`.
- Tenant: `GOCLAW_USER_ID` for `X-GoClaw-User-Id`.

Prefer environment variables. Never print a token. Do not inspect arbitrary
credential files merely to discover configuration. Use a project env file only
when the user has explicitly placed it in scope, and consume the required values
without echoing them.

## Server contract

`POST /v1/skills/upload` accepts multipart field `file` containing a zip. The
handler validates SKILL.md frontmatter, runs goclaw content guards, chooses the
next version, extracts into the managed store, and upserts the database row.
Authentication headers are `Authorization: Bearer <token>` and
`X-GoClaw-User-Id: <user>`. Maximum upload size is 20 MB.

| HTTP | meaning | action |
|---|---|---|
| 200/201 | success | report id and version, then GET-verify |
| 400 | malformed zip/frontmatter | surface, do not retry |
| 401 | bad token | request refreshed environment credential |
| 403 | user is not admin | report tenant/admin mismatch |
| 413 | over 20 MB | shrink source before another attempt |
| 503 | database unavailable | report gateway configuration failure |

## Preflight

1. Resolve and validate the exact source path read-only.
2. Require `SKILL.md` at directory root, or inspect the zip listing without
   extracting into the source tree.
3. Require `zip` and `unzip` when packaging/inspection needs them.
4. Check gateway health.
5. Require non-empty token and user id without printing either.
6. Parse `name` from the plain-text SKILL.md frontmatter and validate a
   non-empty slug.
7. `GET /v1/skills`; if the slug already exists, report its id/version and stop.
   Do not silently overwrite. Updating is `PUT /v1/skills/{id}` and outside this
   skill.

## Upload

For a directory, create a temporary directory with `mktemp -d` and zip the
contents so SKILL.md is at archive root. For a zip, extract only SKILL.md into
the temporary area for frontmatter validation. Keep the source immutable.

Upload with curl using the two authentication headers and multipart
`file=@<zip>` to `<gateway>/v1/skills/upload`. Capture the response without
logging request headers. Parse `id`, `slug`, and `version`, then verify with
`GET /v1/skills/<id>` and confirm the slug/version match.

Clean only the exact temporary directory created by this run. Never delete or
modify the source directory.

## Idempotency caveat

The upload handler hashes SKILL.md. If only reference files changed and SKILL.md
is byte-identical, the server can return `unchanged` without extracting the new
references. Ensure SKILL.md itself references the added files before re-upload,
so the intended version bump is explicit. This does not authorize overwriting an
already-published slug; surface the existing version and let the user choose the
separate update workflow.

## Final response

On success:

```text
✅ published <slug> v<version> (id=<uuid>)
source: <source>
gateway: <gateway>
```

On failure, state the step, HTTP status, and redacted gateway error. Retry only
transient 5xx responses that include a usable Retry-After instruction. Do not
install dependencies or grant the skill to agents.
