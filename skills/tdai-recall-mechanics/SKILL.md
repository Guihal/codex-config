---
name: tdai-recall-mechanics
description: >
  Diagnose and tune TDAI vector recall quality: scoreThreshold, strategy,
  maxResults, proxy age filtering, and file-memory dedup. Use for noisy, stale,
  irrelevant, or empty recalled-memory and for embedding-vs-hybrid decisions.
---

# TDAI recall mechanics

TDAI `/recall` is config-driven vector search with optional keyword fusion. The
calling proxy cannot re-rank individual memories because `/recall` and
`/search/memories` do not return per-item scores.

Configuration is currently expected at
`/home/penis/TencentDB-Agent-Memory/tdai-gateway.yaml`, section
`memory.recall`. Verify the live path before changing anything.

## Relevant knobs

- `scoreThreshold`: cosine-similarity floor. Higher yields fewer, more focused
  results; lower yields broader, noisier results.
- `strategy`: `embedding`, `keyword`, or `hybrid`. Hybrid RRF can include
  borderline hits from both lists and is normally the noisiest.
- `maxResults`: top-K cap.
- `maxCharsPerMemory`, `maxTotalRecallChars`, `maxPersonaChars`: injection size
  caps, not relevance controls.

`POST /recall` accepts `{query, session_key, include_persona?}` and returns a
preformatted context, strategy, and memory count. `/search/memories` returns
flat strings. Neither exposes similarity scores.

The proxy wraps recall as optional, potentially stale background context. It
also applies:

- `TDAI_PROXY_RECALL_MAX_AGE_DAYS` (default 7) to drop old activity;
- substring dedup against the file-memory payload.

These filters address age and exact duplication, not semantic mismatch.

## Diagnosis

1. Confirm `<recalled-memory>` is actually present.
2. Inspect `scoreThreshold`, `strategy`, and `maxResults` before blaming the
   proxy.
3. For adjacent-topic noise, try embedding-only and a higher threshold.
4. For too many stale results, lower maxResults and tighten age/threshold.
5. For no useful recall, lower the threshold and verify embedding plus provider
   configuration.
6. Smoke-test representative queries before and after any config change.

Disabling recall is valid when it is consistently harmful, but explicitly note
what file-memory and persona context remain and what long-term recall is lost.
