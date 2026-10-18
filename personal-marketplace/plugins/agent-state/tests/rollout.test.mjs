import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { transaction } from '../scripts/store.mjs';
import { bind, scan, usage, history } from '../scripts/rollout.mjs';

const A = '01900000-0000-7000-8000-000000000001', B = '01900000-0000-7000-8000-000000000002';
const message = (role, text) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] } });
function setup(child = false) {
  const dir = fs.mkdtempSync('/home/penis/tmp/agent-rollout-tests-'); process.env.CODEX_HOME = dir; process.env.CODEX_AGENT_STATE_STATE_DIR = path.join(dir, 'state');
  const file = path.join(dir, `sessions/2026/09/30/rollout-2026-09-30T00-00-00-${A}.jsonl`); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: A, source: child ? { subagent: { thread_spawn: { parent_thread_id: B } } } : 'cli' } }) + '\n');
  return file;
}
const append = (file, row) => fs.appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), ...row }) + '\n');
const sample = (id, total = 123) => ({ type: 'token_usage_record', payload: { thread_id: id, response_id: 'r' + total, turn_id: 'own-turn', usage: { input_tokens: total - 3, cached_input_tokens: 1, output_tokens: 3, reasoning_output_tokens: 2, total_tokens: total }, thread_token_usage: { total_tokens: 99000000 } } });
test('exact own sample excludes inherited/cumulative/compact data and reports unsampled freshness', async () => {
  const file = setup(); append(file, { type: 'turn_context', payload: { turn_id: 'own-turn', model: 'fixture' } }); append(file, sample(B, 100000)); append(file, sample(A));
  append(file, { type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { total_tokens: 999 } } } });
  await transaction(A, state => {
    bind(state, file); scan(state); const report = usage(state);
    assert.equal(report.latest.total_tokens, 123); assert.equal(report.latest.reasoning_output_tokens, 2); assert.equal(report.declared_window, 1000); assert.equal(report.native_cutoff, null); assert.match(report.calibration, /UNCALIBRATED/);
    assert.ok(report.freshness.unsampled_bytes > 0); assert.equal(report.proxy_warning, false);
  });
  append(file, { type: 'compacted', payload: { latest_token_usage_record: sample(A, 9000).payload } });
  await transaction(A, state => { bind(state); scan(state); assert.equal(usage(state).latest, null); });
  append(file, sample(A, 850));
  await transaction(A, state => { bind(state); scan(state); assert.equal(usage(state).proxy_warning, true); });
  append(file, { type: 'turn_context', payload: { turn_id: 'new', model: 'different' } });
  await transaction(A, state => { bind(state); scan(state); assert.equal(usage(state).latest, null); });
});
test('partial tail waits, completes after append; oversized line is visibly skipped with cursor progress', async () => {
  const file = setup(); const row = JSON.stringify({ timestamp: new Date().toISOString(), ...sample(A) }); fs.appendFileSync(file, row.slice(0, 70));
  await transaction(A, state => { bind(state, file); scan(state); assert.equal(usage(state).status, 'DEGRADED'); assert.ok(state.reader.partialBytes); });
  fs.appendFileSync(file, row.slice(70) + '\n');
  await transaction(A, state => { bind(state); scan(state); assert.equal(usage(state).latest.total_tokens, 123); });
  fs.appendFileSync(file, 'x'.repeat(2 * 1024 * 1024 + 1));
  await transaction(A, state => { bind(state); scan(state); const report = usage(state); assert.equal(report.status, 'DEGRADED'); assert.equal(report.latest, null); assert.ok(report.rollout_coverage.pending_large_record); });
  append(file, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'not parsed: still inside the oversized line' }] } });
  append(file, sample(A, 777));
  await transaction(A, state => { bind(state); scan(state); const report = usage(state); assert.equal(report.latest.total_tokens, 777); assert.equal(report.status, 'EXACT_LAST_RESPONSE'); assert.equal(report.rollout_coverage.skipped_records, 1); assert.equal(report.rollout_coverage.status, 'DEGRADED'); });
});
test('oversized records stream across scan budgets and append boundaries; original history resumes with explicit gaps', async () => {
  const file = setup(); append(file, sample(A)); append(file, message('user', 'BEFORE gap needle'));
  const start = fs.statSync(file).size;
  const huge = JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'x'.repeat(19 * 1024 * 1024) } });
  fs.appendFileSync(file, huge); const bytes = fs.statSync(file).size;
  await transaction(A, state => {
    bind(state, file); let previous = 0;
    for (let i = 0; i < 4; i++) { scan(state); assert.ok(state.reader.offset - previous <= 10 * 1024 * 1024); previous = state.reader.offset; }
    assert.equal(state.reader.offset, bytes); assert.equal(state.reader.pendingLargeLine.start, start); assert.equal(usage(state).latest, null); assert.equal(usage(state).freshness.caught_up, false);
    const page = history(state, 'needle'); assert.equal(page.matches.length, 1); assert.match(page.status, /DEGRADED/); assert.ok(page.next_cursor);
    state.testHistoryCursor = page.next_cursor;
  });
  fs.appendFileSync(file, '\n'); append(file, message('assistant', 'AFTER gap needle')); append(file, sample(A, 321));
  await transaction(A, state => {
    bind(state); scan(state); assert.equal(usage(state).latest.total_tokens, 321); assert.equal(usage(state).rollout_coverage.skipped_records, 1);
    let page, token = state.testHistoryCursor, matches = [], skipped = [];
    for (let i = 0; i < 5 && token; i++) { page = history(state, 'needle', token); token = page.next_cursor; matches.push(...page.matches); skipped.push(...page.skipped_records); }
    assert.equal(token, null); assert.equal(matches.length, 1); assert.match(matches[0].excerpt, /AFTER gap/);
    assert.equal(skipped.length, 1); assert.equal(skipped[0].byte_offset, start); assert.equal(skipped[0].bytes, Buffer.byteLength(huge) + 1); assert.match(page.status, /DEGRADED/);
  });
  assert.equal(fs.statSync(file).size > bytes, true);
});
test('literal bounded history spans compaction, excludes instructions and inherited child prefix', async () => {
  const file = setup(true); append(file, message('user', 'PARENT_PRIVATE needle'));
  const floor = fs.statSync(file).size;
  append(file, message('developer', 'secret needle')); append(file, message('user', '# AGENTS.md instructions needle'));
  append(file, { type: 'response_item', payload: { type: 'agent_message', content: [{ type: 'input_text', text: 'OWN_LAUNCH needle' }] } });
  append(file, message('user', 'OWN needle.* literally')); append(file, { type: 'compacted', payload: { message: 'needle summary' } }); append(file, message('assistant', 'AFTER needle'));
  await assert.rejects(transaction(A, state => { bind(state, file); return history(state, 'needle'); }), /floor unknown/);
  await transaction(A, state => {
    bind(state, file); state.historyFloor = floor;
    const first = history(state, 'needle', undefined, 1); assert.equal(first.matches.length, 1); assert.match(first.matches[0].excerpt, /OWN_LAUNCH/);
    const rest = history(state, 'needle', first.next_cursor, 20); assert.equal(rest.matches.length, 2); assert.doesNotMatch(JSON.stringify(rest), /PARENT_PRIVATE|secret needle|summary/);
    assert.equal(history(state, 'needle.*').matches.length, 1);
    assert.throws(() => history(state, 'other', first.next_cursor), /another query/);
    assert.throws(() => history(state, 'needle', first.next_cursor.slice(0, -1) + 'x'), /scope/);
  });
});
test('parse-size boundary is inclusive and malformed ordinary JSON still fails closed', async () => {
  const file = setup();
  const empty = JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', output: '' } });
  const exact = empty.replace('"output":""', '"output":"' + 'x'.repeat(2 * 1024 * 1024 - Buffer.byteLength(empty)) + '"');
  assert.equal(Buffer.byteLength(exact), 2 * 1024 * 1024);
  fs.appendFileSync(file, exact + '\n'); append(file, sample(A));
  await transaction(A, state => { bind(state, file); scan(state); assert.equal(usage(state).rollout_coverage.skipped_records, 0); assert.equal(usage(state).latest.total_tokens, 123); });
  const over = exact.replace('"output":"', '"output":"x'); fs.appendFileSync(file, over + '\n');
  await transaction(A, state => { bind(state); scan(state); assert.equal(usage(state).rollout_coverage.skipped_records, 1); assert.equal(usage(state).latest, null); });
  fs.appendFileSync(file, '{invalid small row}\n');
  await assert.rejects(transaction(A, state => { bind(state); scan(state); }), /JSON|property name/);
});
test('verified same-actor rewrite/replacement persists fresh binding and invalidates old history cursors', async () => {
  const file = setup(); append(file, sample(A)); append(file, message('user', 'needle one')); append(file, message('user', 'needle two'));
  let token;
  await transaction(A, state => { bind(state, file); scan(state); token = history(state, 'needle', undefined, 1).next_cursor; state.epoch = { cut: 123, deliveryFloor: null, rootDelivered: false }; state.proxyWarned = true; });
  const original = fs.readFileSync(file); fs.writeFileSync(file, original.toString().replace('"total_tokens":123', '"total_tokens":124'));
  await transaction(A, state => { bind(state); assert.equal(state.reader, null); assert.equal(state.epoch, null); assert.equal(state.proxyWarned, false); scan(state); assert.equal(usage(state).latest.total_tokens, 124); assert.throws(() => history(state, 'needle', token), /another query\/rollout/); });
  fs.renameSync(file, file + '.old'); fs.writeFileSync(file, original);
  let identity;
  await transaction(A, state => { bind(state); scan(state); identity = state.binding.identity; assert.equal(usage(state).latest.total_tokens, 123); assert.equal(state.rolloutGeneration, 2); });
  await transaction(A, state => { bind(state); assert.equal(state.binding.identity, identity); assert.equal(state.rolloutGeneration, 2); });
});
test('stale device identity recovers once; wrong actor or changed parent cannot authorize rebinding', async () => {
  const file = setup(true); append(file, sample(A));
  await transaction(A, state => { bind(state, file); scan(state); state.binding.identity = 'old-device:old-inode'; state.historyFloor = 1; });
  await transaction(A, state => { bind(state); assert.equal(state.reader, null); assert.equal(state.historyFloor, null); assert.equal(state.rolloutGeneration, 1); assert.throws(() => history(state, 'needle'), /floor unknown/); scan(state); });
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('"id":"'+A+'"', '"id":"'+B+'"'));
  await assert.rejects(transaction(A, state => bind(state)), /actor\/header mismatch/);
  fs.writeFileSync(file, original.replace('"parent_thread_id":"'+B+'"', '"parent_thread_id":"01900000-0000-7000-8000-000000000003"'));
  await assert.rejects(transaction(A, state => bind(state)), /relationship changed/);
  fs.writeFileSync(file, original);
  await transaction(A, state => { bind(state); assert.equal(state.rolloutGeneration, 1); });
});

test('same-actor header refresh and truncation discard stale samples and persist the new binding', async () => {
  const file = setup(); append(file, sample(A));
  await transaction(A, state => { bind(state, file); scan(state); assert.equal(usage(state).latest.total_tokens, 123); });
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"source":"cli"', '"source":"cli","cli_version":"new-version"'));
  await transaction(A, state => { bind(state); scan(state); assert.equal(state.binding.cliVersion, 'new-version'); assert.equal(usage(state).latest.total_tokens, 123); });
  const header = fs.readFileSync(file, 'utf8').split('\n')[0]+'\n'; fs.writeFileSync(file, header);
  await transaction(A, state => { bind(state); scan(state); assert.equal(usage(state).latest, null); assert.equal(state.rolloutGeneration, 2); });
  await transaction(A, state => { bind(state); scan(state); assert.equal(usage(state).latest, null); assert.equal(state.rolloutGeneration, 2); });
});
