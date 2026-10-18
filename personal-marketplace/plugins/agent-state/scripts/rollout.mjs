import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { actor, home, checkPath, hash, cursor, decodeCursor, utf8Prefix } from './store.mjs';

const SCAN_BYTES = 8 * 1024 * 1024;
const LINE_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 512;
const identity = stat => `${stat.dev}:${stat.ino}`;
export function chunk(file, start, count) {
  checkPath(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || !Number.isSafeInteger(start) || start < 0 || start > stat.size) throw new Error('rollout/cursor outside bounds');
    const bytes = Buffer.alloc(Math.min(count, stat.size - start));
    let n = 0;
    while (n < bytes.length) { const got = fs.readSync(fd, bytes, n, bytes.length - n, start + n); if (!got) throw new Error('rollout changed during read'); n += got; }
    return { bytes, stat, identity: identity(stat) };
  } finally { fs.closeSync(fd); }
}
export function prefixAnchor(file, end) { return hash(chunk(file, Math.max(0, end - 4096), Math.min(end, 4096)).bytes); }
function inRoots(file) {
  return ['sessions', 'archived_sessions'].some(dir => { const rel = path.relative(path.join(home(), dir), file); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); });
}
export function inspect(file, id) {
  actor(id); file = path.resolve(file);
  if (!inRoots(file) || !path.basename(file).endsWith(`-${id}.jsonl`)) throw new Error('rollout hint outside actor/session roots');
  const first = chunk(file, 0, LINE_BYTES);
  const end = first.bytes.indexOf(10);
  if (end < 0) throw new Error('missing/oversized rollout header');
  const headerBytes = first.bytes.subarray(0, end);
  const row = JSON.parse(headerBytes.toString('utf8'));
  if (row.type !== 'session_meta' || row.payload?.id !== id) throw new Error('rollout actor/header mismatch');
  const meta = row.payload;
  const child = typeof meta.source === 'object' && meta.source !== null && Object.hasOwn(meta.source, 'subagent');
  const parent = meta.source?.subagent?.thread_spawn?.parent_thread_id;
  if (parent !== undefined) actor(parent);
  if (parent === id) throw new Error('invalid self-parent');
  return { path: file, identity: first.identity, headerHash: hash(headerBytes), child, parent: parent ?? null, cwd: meta.cwd, cliVersion: meta.cli_version, size: first.stat.size };
}
function discover(id) {
  const matches = []; let visited = 0, files = 0;
  function walk(dir, depth) {
    if (depth > 4 || ++visited > 4096) throw new Error('rollout discovery exhausted; wait for a trusted lifecycle hook');
    checkPath(dir); let handle;
    try { handle = fs.opendirSync(dir); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    try {
      for (let entry; (entry = handle.readSync());) {
        if (++files > 100000) throw new Error('rollout discovery file bound exceeded');
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(`-${id}.jsonl`)) matches.push(full);
      }
    } finally { handle.closeSync(); }
  }
  for (const dir of ['sessions', 'archived_sessions']) walk(path.join(home(), dir), 0);
  if (matches.length !== 1) throw new Error('unique actor rollout unavailable; no newest-session guessing');
  return matches[0];
}
export function bind(state, hint) {
  const binding = inspect(hint || state.binding?.path || discover(state.actor), state.actor);
  // A filesystem identity is a cache key, not the session authority. inspect()
  // verifies the actor header before we can replace a binding or read guides.
  if (state.binding && (state.binding.child !== binding.child || state.binding.parent !== binding.parent)) throw new Error('rollout parent/child relationship changed');
  const replaced = state.binding && (state.binding.identity !== binding.identity || state.binding.headerHash !== binding.headerHash);
  const rewritten = state.reader && (state.reader.offset > binding.size || (state.reader.anchor && prefixAnchor(binding.path, state.reader.offset) !== state.reader.anchor));
  if (replaced || rewritten) {
    state.reader = null; state.epoch = null; state.historyFloor = null;
    state.proxyWarned = false; state.saveTriggerKey = null;
    state.rolloutGeneration = (state.rolloutGeneration ?? 0) + 1;
  }
  state.binding = binding;
  return binding;
}
// Parse only bounded rows. Large native tool/image records stay in the archive;
// traverse them without assembling their JSON or pinning the cursor forever.
function walkLines(binding, start, pending, visit) {
  if (pending && (!Number.isSafeInteger(pending.start) || pending.start < 0 || pending.start > start)) throw new Error('invalid oversized-record cursor');
  const data = chunk(binding.path, start, SCAN_BYTES + LINE_BYTES);
  if (data.identity !== binding.identity) throw new Error('rollout replaced; old cursor invalid');
  let used = 0, discarding = pending ?? null;
  const gaps = [];
  while (used < data.bytes.length && used < SCAN_BYTES) {
    const end = data.bytes.indexOf(10, used);
    if (discarding) {
      if (end < 0 || end + 1 > SCAN_BYTES) { used = Math.min(data.bytes.length, SCAN_BYTES); break; }
      gaps.push({ byte_offset: discarding.start, bytes: start + end + 1 - discarding.start });
      discarding = null; used = end + 1; continue;
    }
    if ((end < 0 ? data.bytes.length : end) - used > LINE_BYTES) {
      discarding = { start: start + used };
      visit({ gapStart: discarding.start });
      continue;
    }
    if (end < 0) break; // Ordinary incomplete tail waits for its append.
    const row = JSON.parse(data.bytes.subarray(used, end).toString('utf8'));
    if (visit({ row, position: start + used }) === false) break;
    used = end + 1;
  }
  const offset = start + used;
  const partialTail = offset < data.stat.size && data.stat.size - offset <= LINE_BYTES && start + data.bytes.length === data.stat.size && !data.bytes.subarray(used).includes(10);
  const caughtUp = !discarding && (offset === data.stat.size || partialTail);
  return { offset, size: data.stat.size, pending: discarding, gaps, caughtUp, partialBytes: discarding ? data.stat.size - discarding.start : caughtUp ? data.stat.size - offset : 0, scannedBytes: used };
}
export function scan(state) {
  const binding = state.binding;
  if (!binding) throw new Error('rollout not bound');
  const reader = state.reader ?? { offset: 0, items: [], usages: [], sample: null, window: null, model: null, turn: null, compactOffset: null };
  if (reader.anchor && prefixAnchor(binding.path, reader.offset) !== reader.anchor) throw new Error('rollout replaced/rewritten; telemetry invalid');
  const result = walkLines(binding, reader.offset, reader.pendingLargeLine, ({ row, position, gapStart }) => {
    if (gapStart !== undefined) {
      // Unknown row may contain a model/compact boundary: none of the earlier
      // sample or final-message evidence can establish the post-gap state.
      reader.sample = null; reader.window = null; reader.model = null; reader.turn = null;
      reader.items = []; reader.usages = [];
      return;
    }
    const p = row.payload;
    if (!p || typeof row.type !== 'string') throw new Error('incompatible rollout schema');
    if (row.type === 'turn_context') {
      if (reader.model && reader.model !== p.model) { reader.sample = null; reader.window = null; }
      reader.model = p.model; reader.turn = p.turn_id; reader.cwd = p.cwd;
    }
    if (row.type === 'compacted') { reader.sample = null; reader.usages = []; reader.compactOffset = position; }
    if (row.type === 'event_msg' && ['token_count', 'task_started'].includes(p.type)) {
      const w = p.info?.model_context_window ?? p.model_context_window;
      if (Number.isSafeInteger(w) && w > 0) reader.window = w;
    }
    if (row.type === 'token_usage_record' && p.thread_id === state.actor) {
      const u = p.usage;
      if (!u || !['input_tokens', 'output_tokens', 'total_tokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0) || typeof p.response_id !== 'string') throw new Error('incompatible exact usage record');
      reader.sample = { ...u, response_id: p.response_id, turn_id: p.turn_id, timestamp: row.timestamp, offset: position, model: reader.model };
      reader.usages.push(position); reader.usages = reader.usages.slice(-MAX_ITEMS);
    }
    if (row.type === 'response_item' && (!binding.child || (Number.isSafeInteger(state.historyFloor) && position >= state.historyFloor))) {
      if (p.type === 'message' && p.role === 'assistant') {
        const value = (p.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('');
        if (value) reader.items.push({ position, assistantHash: hash(value) });
      }
      reader.items = reader.items.slice(-MAX_ITEMS);
    }
  });
  reader.offset = result.offset;
  reader.pendingLargeLine = result.pending;
  reader.skippedRecords = (reader.skippedRecords ?? 0) + result.gaps.length;
  reader.gaps = [...(reader.gaps ?? []), ...result.gaps].slice(-16);
  reader.anchor = prefixAnchor(binding.path, reader.offset);
  reader.caughtUp = result.caughtUp;
  reader.partialBytes = result.partialBytes;
  state.reader = reader;
  const config = spawnSync('python3', [new URL('./compact-config.py', import.meta.url).pathname], { input: JSON.stringify({ home: home(), cwd: reader.cwd ?? binding.cwd, model: reader.model, window: reader.window }), encoding: 'utf8', timeout: 1000, maxBuffer: 16384 });
  try {
    if (config.status !== 0) throw new Error('config helper unavailable');
    reader.compactPolicy = JSON.parse(config.stdout);
  } catch { reader.compactPolicy = { error: 'UNCALIBRATED config lookup unavailable; cadence fallback' }; }
  return reader;
}
export function usage(state) {
  const r = state.reader;
  return {
    status: r?.sample && r.caughtUp ? 'EXACT_LAST_RESPONSE' : 'DEGRADED',
    source: 'token_usage_record.payload.usage (own thread; not cumulative)',
    latest: r?.caughtUp ? r.sample : null,
    declared_window: r?.window ?? null,
    native_cutoff: null,
    calibration: 'UNCALIBRATED: effective per-thread native cutoff/scope is not exposed by Codex hook metadata',
    freshness: { sampled_at: r?.sample?.timestamp ?? null, sampled_turn: r?.sample?.turn_id ?? null, current_turn: r?.turn ?? null, age_seconds: r?.sample ? Math.max(0, Math.floor((Date.now() - Date.parse(r.sample.timestamp)) / 1000)) : null, unsampled_bytes: r?.sample ? Math.max(0, r.offset - r.sample.offset) : null, caught_up: r?.caughtUp ?? false, partial_bytes: r?.partialBytes ?? null },
    rollout_coverage: { status: r?.skippedRecords || r?.pendingLargeLine ? 'DEGRADED' : r?.caughtUp ? 'COMPLETE' : 'INCOMPLETE', skipped_records: r?.skippedRecords ?? 0, pending_large_record: r?.pendingLargeLine ? { path: state.binding.path, byte_offset: r.pendingLargeLine.start } : null, recent_gaps: (r?.gaps ?? []).map(g => ({ path: state.binding.path, ...g })) },
    live_count: 'Unknown: local tool output after the completed response is not an exact upstream sample',
    compact_policy: r?.compactPolicy ?? null,
    save_due: Boolean(r?.caughtUp && r.sample && Number.isSafeInteger(r.compactPolicy?.save_at) && r.sample.total_tokens >= r.compactPolicy.save_at),
    proxy_warning: Boolean(r?.sample && r.window && r.sample.total_tokens >= 0.8 * r.window),
  };
}
function historyText(p) {
  if (p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
    const value = (p.content ?? []).filter(c => ['input_text', 'output_text'].includes(c.type)).map(c => c.text).join('\n');
    if (/^\s*(?:# AGENTS\.md instructions|<environment_context>|<user_instructions>)/.test(value)) return null;
    return { role: p.role, text: value };
  }
  if (p.type === 'agent_message') return { role: 'agent_message', text: (p.content ?? []).filter(c => ['input_text', 'output_text'].includes(c.type)).map(c => c.text).join('\n') };
  if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) return { role: 'tool', text: typeof p.output === 'string' ? p.output : (Array.isArray(p.output) ? p.output.filter(c => c.type === 'input_text').map(c => c.text).join('\n') : '') };
  return null;
}
export function history(state, query, token, limit = 8) {
  if (typeof query !== 'string' || !query.trim() || Buffer.byteLength(query) > 256) throw new Error('query must be literal non-empty text <=256 bytes');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be 1..20');
  const b = state.binding;
  if (b.child && !Number.isSafeInteger(state.historyFloor)) throw new Error('child own-history floor unknown; inherited private prefix is excluded by failing closed');
  const scope = { kind: 'history', query: hash(query), identity: b.identity, header: b.headerHash, generation: state.rolloutGeneration ?? 0 };
  const c = token ? decodeCursor(state, token) : { ...scope, offset: b.child ? state.historyFloor : 0 };
  if (Object.entries(scope).some(([key, value]) => c[key] !== value)) throw new Error('cursor belongs to another query/rollout');
  if (c.anchor && prefixAnchor(b.path, c.offset) !== c.anchor) throw new Error('history prefix changed');
  let pageBytes = 0; const matches = [];
  const result = walkLines(b, c.offset, c.pendingLargeLine, ({ row, position, gapStart }) => {
    if (gapStart !== undefined) return;
    if (matches.length >= limit) return false;
    const value = row.type === 'response_item' ? historyText(row.payload) : null;
    const index = value?.text.indexOf(query) ?? -1;
    if (index >= 0) {
      const excerpt = utf8Prefix(value.text.slice(Math.max(0, index - 160)), 1200);
      if (pageBytes + Buffer.byteLength(excerpt) > 8192) return false;
      matches.push({ role: value.role, timestamp: row.timestamp, locator: { path: b.path, byte_offset: position }, excerpt });
      pageBytes += Buffer.byteLength(excerpt);
    }
  });
  const offset = result.offset, more = offset < result.size || Boolean(result.pending);
  const skippedCount = (c.skippedCount ?? 0) + result.gaps.length;
  const status = skippedCount || result.pending ? 'DEGRADED: oversized records omitted from search; originals retained in archive' : result.scannedBytes === 0 && more ? 'DEGRADED: incomplete final line; retry after append' : 'ok';
  return { matches, scanned_bytes: result.scannedBytes, skipped_records: result.gaps.map(g => ({ path: b.path, ...g })), total_skipped_records: skippedCount, pending_large_record: result.pending ? { path: b.path, byte_offset: result.pending.start } : null, next_cursor: more ? cursor(state, { ...scope, offset, pendingLargeLine: result.pending, skippedCount, anchor: prefixAnchor(b.path, offset) }) : null, status };
}
