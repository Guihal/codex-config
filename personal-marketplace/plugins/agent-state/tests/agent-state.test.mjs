import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { CAPS, directory, transaction, hash, checkpoint, readNote, saveNote, saveCheckpoint } from '../scripts/store.mjs';
import { callTool, TOOLS } from '../scripts/agent-state-mcp.mjs';
import { handleHook, hookFailure, render, POLICY } from '../scripts/agent-state-hook.mjs';

const A = '01900000-0000-7000-8000-000000000001', B = '01900000-0000-7000-8000-000000000002', C = '01900000-0000-7000-8000-000000000003';
function setup() {
  const dir = fs.mkdtempSync('/home/penis/tmp/agent-state-tests-');
  process.env.CODEX_HOME = path.join(dir, 'codex'); process.env.CODEX_AGENT_STATE_STATE_DIR = path.join(dir, 'state');
  return dir;
}
function rollout(id, parent = null, rows = []) {
  const file = path.join(process.env.CODEX_HOME, 'sessions/2026/09/30', `rollout-2026-09-30T00-00-00-${id}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = { type: 'session_meta', payload: { id, cli_version: '0.159.1', source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : 'cli' } };
  fs.writeFileSync(file, [header, ...rows].map(r => JSON.stringify(r) + '\n').join(''));
  return file;
}
const invoke = (id, name, args) => callTool({ name, arguments: args, _meta: { threadId: id } });
const hook = (id, file, event, extra = {}) => handleHook({ session_id: id, transcript_path: file, hook_event_name: event, ...extra });
const append = (file, row) => fs.appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), ...row }) + '\n');
const sample = id => ({ type: 'token_usage_record', payload: { thread_id: id, turn_id: 't1', response_id: 'resp1', usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 }, thread_token_usage: { total_tokens: 99999999 } } });
async function holdingChild(id) {
  const url = new URL('../scripts/store.mjs', import.meta.url).href;
  const script = `import {transaction} from ${JSON.stringify(url)}; process.stdin.resume(); await transaction(${JSON.stringify(id)},async()=>{process.stdout.write('LOCKED\\n');await new Promise(()=>{});});`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', script], { env: process.env });
  let stderr = ''; p.stderr.on('data', chunk => stderr += chunk.toString().slice(0, 1000));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('holder did not acquire lock: ' + stderr)); }, 10000);
    p.once('error', e => { clearTimeout(timeout); reject(e); });
    p.once('exit', code => { clearTimeout(timeout); reject(new Error('holder exited before ready: ' + code + ' ' + stderr)); });
    p.stdout.once('data', data => { clearTimeout(timeout); data.toString().includes('LOCKED') ? resolve() : reject(new Error('unexpected holder output')); });
  });
  return p;
}

test('actual tool descriptions and injected policy direct future guides; metadata only binding', async () => {
  setup(); rollout(A);
  for (const name of ['agent_state_note', 'agent_state_checkpoint']) {
    const description = TOOLS.find(t => t.name === name).description;
    assert.match(description, /future-action|future actions/); assert.match(description, /task.state|task state/);
    assert.equal(TOOLS.find(t => t.name === name).inputSchema.additionalProperties, false);
  }
  assert.match(POLICY, /Never store current task goals/);
  const missing = await callTool({ name: 'agent_state_note', arguments: { title: 'guide', body: 'When X, do Y; verify Z.' } });
  assert.equal(missing.isError, true);
  for (const key of ['sid', 'session_id', 'path']) assert.equal((await invoke(A, 'agent_state_note', { title: 'guide', body: 'procedure', [key]: B })).isError, true);
  assert.equal(fs.existsSync(directory(A)), false);
});
test('note acknowledgement follows durable exact bytes, idempotence, UTF-8 and immutable revisions', async () => {
  setup(); rollout(A);
  const args = { title: 'Проверка', body: 'Когда запускаешь проверку — читай результат. 😀', shared: true };
  const result = await invoke(A, 'agent_state_note', args); assert.equal(result.isError, undefined);
  const note = result.structuredContent;
  const original = fs.readFileSync(note.path);
  assert.equal(note.hash, hash(original)); assert.equal(note.verified_read_back, true);
  assert.equal((await invoke(A, 'agent_state_note', args)).structuredContent.note_id, note.note_id);
  assert.notEqual((await invoke(A, 'agent_state_note', { ...args, body: args.body + '\nMore verification.' })).structuredContent.note_id, note.note_id);
  assert.deepEqual(fs.readFileSync(note.path), original);
  assert.equal(fs.statSync(note.path).mode & 0o777, 0o600); assert.equal(fs.statSync(directory(A)).mode & 0o777, 0o700);
  assert.equal((await invoke(A, 'agent_state_note', { ...args, body: 'я'.repeat(CAPS.note) })).isError, true);
  assert.equal((await invoke(A, 'agent_state_note', { ...args, shared: 'true' })).isError, true);
  assert.equal((await invoke(A, 'agent_state_note', { ...args, body: '\uD800' })).isError, true);
});
test('independent processes serialize immutable duplicates without losing notes', async () => {
  setup(); rollout(A);
  const stale = await holdingChild(A), exited = once(stale, 'exit'); stale.kill('SIGKILL'); await exited;
  const file = new URL('../scripts/agent-state-mcp.mjs', import.meta.url).pathname;
  async function child(n) {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [file], { env: process.env }); let output = '';
      p.stdout.on('data', chunk => output += chunk); p.on('error', reject);
      p.on('close', code => code ? reject(new Error('MCP subprocess failed')) : resolve(JSON.parse(output.trim()).result));
      p.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'agent_state_note', _meta: { threadId: A }, arguments: { title: 'same', body: 'Reusable procedure; verify result.' } } }) + '\n');
    });
  }
  const results = await Promise.all([child(1), child(2), child(3)]);
  assert.ok(results.every(r => !r.isError)); assert.equal(new Set(results.map(r => r.structuredContent.note_id)).size, 1);
});
test('edit own existing file by stable index; stale original-read cursors fail for own and shared parent', async () => {
  setup(); rollout(A); rollout(B, A);
  const saved = (await invoke(A, 'agent_state_note', { title: 'procedure', body: 'old'.repeat(5000), shared: true })).structuredContent;
  const own = (await invoke(A, 'agent_state_read', { note_id: saved.note_id })).structuredContent;
  const child = (await invoke(B, 'agent_state_read', { note_id: saved.note_id })).structuredContent;
  assert.ok(own.next_cursor && child.next_cursor);
  assert.equal((await invoke(B, 'agent_state_note', { note_id: saved.note_id, title: 'forged', body: 'must not edit parent' })).isError, true);
  const changed = await invoke(A, 'agent_state_note', { note_id: saved.note_id, title: 'new procedure', body: 'new'.repeat(5000), shared: true });
  assert.equal(changed.isError, undefined);
  assert.equal(changed.structuredContent.path, saved.path);
  assert.equal(changed.structuredContent.note_id, saved.note_id);
  assert.notEqual(changed.structuredContent.hash, saved.hash);
  for (const [id, page] of [[A, own], [B, child]]) {
    const stale = await invoke(id, 'agent_state_read', { note_id: saved.note_id, cursor: page.next_cursor });
    assert.equal(stale.isError, true); assert.match(stale.content[0].text, /stale guide cursor/);
    assert.match((await invoke(id, 'agent_state_read', { note_id: saved.note_id })).structuredContent.content, /newnew/);
  }
  assert.equal((await invoke(A, 'agent_state_note', { note_id: 'f'.repeat(64), title: 'missing', body: 'x' })).isError, true);
  assert.equal((await invoke(A, 'agent_state_read', {})).structuredContent.total_notes, 1);
});
test('live lock is not stolen; SIGKILL holder releases mutex and the next save/PreCompact recovers', async () => {
  setup(); const file = rollout(A); await invoke(A, 'agent_state_checkpoint', { content: 'When measuring a view, preserve the original guide bytes.' });
  const cp = path.join(directory(A), 'checkpoint.json'), original = fs.readFileSync(cp);
  const p = await holdingChild(A);
  try {
    const busy = await invoke(A, 'agent_state_note', { title: 'live owner', body: 'Must not steal the live owner lock.' });
    assert.equal(busy.isError, true); assert.match(busy.content[0].text, /busy/);
    assert.equal(p.exitCode, null); assert.deepEqual(fs.readFileSync(cp), original);
    const owner = JSON.parse(fs.readFileSync(path.join(directory(A), 'lock'))); assert.equal(owner.pid, p.pid);
    const exited = once(p, 'exit'); p.kill('SIGKILL'); await exited;
    const result = await invoke(A, 'agent_state_note', { title: 'after crash', body: 'When a process dies, recover its proven-dead gate under the kernel mutex.' });
    assert.equal(result.isError, undefined); assert.equal(result.structuredContent.verified_read_back, true);
    assert.notEqual((await hook(A, file, 'PreCompact')).continue, false);
    assert.deepEqual(fs.readFileSync(cp), original);
  } finally { if (p.exitCode === null && p.signalCode === null) { const exited = once(p, 'exit'); p.kill('SIGKILL'); await exited; } }
});
test('fractional kernel lock timeout is independent of the caller locale', async () => {
  setup(); rollout(A); const before = process.env.LC_ALL;
  try {
    process.env.LC_ALL = 'ru_RU.UTF-8';
    const result = await invoke(A, 'agent_state_checkpoint', { content: 'When invoking numeric CLI arguments, pin the helper locale.' });
    assert.equal(result.isError, undefined); assert.equal(result.structuredContent.verified_read_back, true);
  } finally { if (before === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = before; }
});
test('legacy live-owner gate is respected, unknown owners are not stolen, retry follows release', async () => {
  setup(); rollout(A); await invoke(A, 'agent_state_checkpoint', { content: 'Preserve guide bytes while another version owns the storage gate.' });
  const file = path.join(directory(A), 'lock');
  const raw = fs.readFileSync('/proc/self/stat', 'utf8');
  const owner = JSON.stringify({ pid: process.pid, boot: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), start: raw.slice(raw.lastIndexOf(')') + 2).split(' ')[19], token: 'legacy-live-owner' });
  fs.writeFileSync(file, owner);
  const blocked = await invoke(A, 'agent_state_note', { title: 'legacy busy', body: 'Respect the live legacy owner.' });
  assert.equal(blocked.isError, true); assert.match(blocked.content[0].text, /busy/); assert.equal(fs.readFileSync(file, 'utf8'), owner);
  fs.writeFileSync(file, JSON.stringify({ unknown: true }));
  const unknown = await invoke(A, 'agent_state_note', { title: 'unknown', body: 'Never steal an unknown owner.' });
  assert.equal(unknown.isError, true); assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ unknown: true }));
  fs.writeFileSync(file, 'null');
  const nullOwner = await invoke(A, 'agent_state_note', { title: 'null owner', body: 'Unknown null metadata must fail within the lock wait bound.' });
  assert.equal(nullOwner.isError, true); assert.match(nullOwner.content[0].text, /busy\/unknown/); assert.equal(fs.readFileSync(file, 'utf8'), 'null');
  fs.unlinkSync(file);
  assert.equal((await invoke(A, 'agent_state_note', { title: 'retry', body: 'Retry after the actual owner releases its gate.' })).isError, undefined);
});
test('I/O/fsync failure never acknowledges success; corruption is retained and blocks compact', async () => {
  setup(); const file = rollout(A); await invoke(A, 'agent_state_checkpoint', { content: 'When uncertain, verify the boundary.' });
  const cpFile = path.join(directory(A), 'checkpoint.json'), original = fs.readFileSync(cpFile);
  const saved = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw new Error('fsync test failure'); };
    assert.equal((await invoke(A, 'agent_state_checkpoint', { content: 'new guide' })).isError, true);
  } finally { fs.fsyncSync = saved; }
  assert.deepEqual(fs.readFileSync(cpFile), original);
  assert.equal(fs.existsSync(path.join(directory(A), 'lock')), false);
  assert.equal((await invoke(A, 'agent_state_checkpoint', { content: 'verified retry after filesystem repair' })).isError, undefined);
  fs.writeFileSync(cpFile, '{bad');
  await assert.rejects(hook(A, file, 'PreCompact'), /JSON|property name/);
  assert.equal(hookFailure('PreCompact', new Error('bad')).continue, false);
  assert.equal((await invoke(A, 'agent_state_checkpoint', { content: 'replacement' })).isError, true);
  assert.equal(fs.readFileSync(cpFile, 'utf8'), '{bad');
});
test('own guides, immediate shared parent only, no parent anchor or unrelated roots', async () => {
  setup(); rollout(A); const bf = rollout(B, A); rollout(C, B);
  await invoke(A, 'agent_state_note', { title: 'private', body: 'PARENT_PRIVATE' });
  const shared = (await invoke(A, 'agent_state_note', { title: 'shared', body: 'PARENT_SHARED', shared: true })).structuredContent;
  await invoke(A, 'agent_state_checkpoint', { content: 'PARENT_ANCHOR_PRIVATE' });
  const childStart = await hook(B, bf, 'SubagentStart', { agent_id: B, session_id: A });
  const injection = childStart.hookSpecificOutput.additionalContext;
  assert.match(injection, /PARENT_SHARED/); assert.doesNotMatch(injection, /PARENT_PRIVATE|PARENT_ANCHOR_PRIVATE/);
  const childRead = await invoke(B, 'agent_state_read', {}); assert.equal(childRead.structuredContent.notes.length, 1);
  assert.match((await invoke(B, 'agent_state_read', { note_id: shared.note_id })).structuredContent.content, /PARENT_SHARED/);
  assert.equal((await invoke(C, 'agent_state_read', { note_id: shared.note_id })).isError, true);
  const unknown = rollout('01900000-0000-7000-8000-000000000004');
  assert.doesNotMatch((await hook('01900000-0000-7000-8000-000000000004', unknown, 'SessionStart')).hookSpecificOutput.additionalContext, /PARENT_SHARED/);
});
test('large ledger becomes explicit index; complete original paginated reads and cross-actor cursors rejected', async () => {
  setup(); const file = rollout(A); rollout(B);
  const args = { title: 'large', body: '😀'.repeat(25000) };
  const note = (await invoke(A, 'agent_state_note', args)).structuredContent;
  const start = await hook(A, file, 'SessionStart');
  assert.match(start.hookSpecificOutput.additionalContext, /INJECTION TRUNCATED/);
  assert.ok(start.hookSpecificOutput.additionalContext.includes(note.path));
  assert.ok(Buffer.byteLength(start.hookSpecificOutput.additionalContext) <= 80000);
  let token, combined = '';
  do {
    const result = await invoke(A, 'agent_state_read', { note_id: note.note_id, ...(token ? { cursor: token } : {}) });
    assert.equal(result.isError, undefined); combined += result.structuredContent.content; token = result.structuredContent.next_cursor;
    if (token) assert.equal((await invoke(B, 'agent_state_read', { note_id: note.note_id, cursor: token })).isError, true);
  } while (token);
  assert.equal(combined, fs.readFileSync(note.path, 'utf8'));
});
test('no separate index or compulsory anchor; repeated compact reinjects original guide files', async () => {
  setup(); const file = rollout(A); const note = (await invoke(A, 'agent_state_note', { title: 'guide', body: 'Original procedure' })).structuredContent;
  const before = fs.readFileSync(note.path);
  assert.deepEqual(await hook(A, file, 'PreCompact'), {});
  assert.equal(fs.existsSync(path.join(directory(A), 'recovery.json')), false);
  for (let n = 0; n < 3; n++) {
    await hook(A, file, 'PostCompact');
    const restored = (await hook(A, file, 'SessionStart', { source: 'compact' })).hookSpecificOutput.additionalContext;
    assert.ok(restored.includes(before.toString())); assert.doesNotMatch(restored, /no authored|recovery index/);
    await hook(A, file, 'PreCompact');
  }
  assert.deepEqual(fs.readFileSync(note.path), before);
});
test('valid oversized transcript does not block guide writes, original reads or verified PreCompact', async () => {
  setup(); const file = rollout(A);
  const original = (await invoke(A, 'agent_state_note', { title: 'procedure', body: 'When measuring an overlap, inspect visible geometry.' })).structuredContent;
  await invoke(A, 'agent_state_checkpoint', { content: 'Preserve original guides and measure authorized copies.' });
  const cpBefore = fs.readFileSync(path.join(directory(A), 'checkpoint.json'));
  append(file, sample(A));
  append(file, { type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'x'.repeat(3 * 1024 * 1024) } });
  const transcript = fs.readFileSync(file), bytes = fs.readFileSync(original.path);
  const pre = await hook(A, file, 'PreCompact');
  assert.deepEqual(pre, {});
  const report = (await invoke(A, 'agent_state_read', {})).structuredContent.usage;
  assert.equal(report.rollout_coverage.skipped_records, 1);
  assert.equal(report.latest, null); // Never report the pre-gap sample as current.
  assert.equal((await invoke(A, 'agent_state_note', { title: 'another', body: 'When validating a saved guide, compare original bytes.' })).isError, undefined);
  const read = await invoke(A, 'agent_state_read', { note_id: original.note_id });
  assert.equal(read.structuredContent.content, bytes.toString());
  assert.deepEqual(fs.readFileSync(original.path), bytes); assert.deepEqual(fs.readFileSync(file), transcript);
  assert.deepEqual(fs.readFileSync(path.join(directory(A), 'checkpoint.json')), cpBefore);
});
test('periodic reminders are bounded, proxy warning is one-shot, large unsampled output is explicit', async () => {
  setup(); const file = rollout(A);
  await invoke(A, 'agent_state_note', { title: 'original', body: 'FULL_ORIGINAL_GUIDE_BODY' });
  await hook(A, file, 'SessionStart');
  append(file, { type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 100 } } });
  append(file, sample(A));
  const warning = await hook(A, file, 'PostToolUse');
  assert.match(warning.hookSpecificOutput.additionalContext, /YOU MUST SAVE IMPORTANT REUSABLE GUIDES NOW/);
  assert.match(warning.hookSpecificOutput.additionalContext, /FULL_ORIGINAL_GUIDE_BODY/);
  assert.match(warning.hookSpecificOutput.additionalContext, /CONTINUE THE TASK/);
  assert.deepEqual(await hook(A, file, 'PostToolUse'), {});
  assert.deepEqual(await hook(A, file, 'PostToolUse'), {});
  assert.deepEqual(await hook(A, file, 'PostToolUse'), {});
  const periodic = await hook(A, file, 'PostToolUse');
  assert.match(periodic.hookSpecificOutput.additionalContext, /Exact last-response tokens/);
  assert.match(periodic.hookSpecificOutput.additionalContext, /FULL_ORIGINAL_GUIDE_BODY/);
  const large = await hook(A, file, 'PostToolUse', { tool_response: 'x'.repeat(65536) });
  assert.match(large.hookSpecificOutput.additionalContext, /YOU MUST SAVE IMPORTANT REUSABLE GUIDES NOW/);
  assert.match(large.hookSpecificOutput.additionalContext, /UNCALIBRATED effective native cutoff\/live count/);
  assert.ok(Buffer.byteLength(large.hookSpecificOutput.additionalContext) < 2000);
  append(file, { ...sample(A), payload: { ...sample(A).payload, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  await hook(A, file, 'PostToolUse'); append(file, sample(A));
  assert.match((await hook(A, file, 'PostToolUse')).hookSpecificOutput.additionalContext, /YOU MUST SAVE IMPORTANT REUSABLE GUIDES NOW/);
});
test('final-only child recovery preserves maximum checkpoint and needs a new generation', async () => {
  setup(); const af = rollout(A), bf = rollout(B, A);
  await hook(B, bf, 'SubagentStart', { agent_id: B, session_id: A });
  const content = 'BEGIN\n' + 'я'.repeat(2010) + '\nMIDDLE\n' + 'я'.repeat(2010) + '\nEND';
  const full = content + 'x'.repeat(CAPS.checkpoint - Buffer.byteLength(content));
  assert.equal((await invoke(B, 'agent_state_checkpoint', { content: full })).isError, undefined);
  append(bf, { type: 'compacted', payload: {} });
  await hook(B, bf, 'PostCompact', { agent_id: B, session_id: A });
  append(bf, { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'old final' }] } });
  append(bf, sample(B));
  const first = await hook(A, af, 'SubagentStop', { agent_id: B, agent_transcript_path: bf, last_assistant_message: 'old final' });
  assert.equal(first.decision, 'block'); assert.ok(Buffer.byteLength(first.reason) <= CAPS.reason); assert.ok(first.reason.includes(full));
  assert.equal((await hook(A, af, 'SubagentStop', { agent_id: B, agent_transcript_path: bf, last_assistant_message: 'old final' })).decision, 'block');
  append(bf, { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'restored final' }] } }); append(bf, sample(B));
  assert.deepEqual(await hook(A, af, 'SubagentStop', { agent_id: B, agent_transcript_path: bf, last_assistant_message: 'restored final' }), {});
  assert.equal(checkpoint(B).content, full);
  const pressured = render({ actor: B, binding: { child: true, parent: null, path: bf }, reader: { sample: { total_tokens: 900, timestamp: new Date().toISOString() }, window: 1000, caughtUp: true, skippedRecords: 16, pendingLargeLine: { start: 1 } } }, CAPS.reason);
  assert.ok(Buffer.byteLength(pressured) <= CAPS.reason); assert.ok(pressured.includes(full) || (pressured.includes('INJECTION TRUNCATED') && pressured.includes(path.join(directory(B), 'checkpoint.json'))));
  assert.match(pressured, /DEGRADED history|HEADROOM PROXY WARNING/); assert.match(pressured, /Never store current task goals/);
});
test('configured compact limit triggers an imperative early and rearms on limit/model changes', async () => {
  setup(); const file = rollout(A);
  const config = path.join(process.env.CODEX_HOME, 'config.toml');
  fs.writeFileSync(config, 'model_auto_compact_token_limit=1000\n');
  await hook(A, file, 'SessionStart');
  append(file, { type: 'turn_context', payload: { model: 'fixture', cwd: process.env.CODEX_HOME } });
  append(file, { ...sample(A), payload: { ...sample(A).payload, usage: { input_tokens: 800, output_tokens: 10, total_tokens: 810 } } });
  const first = (await hook(A, file, 'PostToolUse')).hookSpecificOutput.additionalContext;
  assert.match(first, /YOU MUST SAVE IMPORTANT REUSABLE GUIDES NOW/); assert.match(first, /CONTINUE THE TASK/);
  assert.match(first, /save trigger=800/);
  assert.deepEqual(await hook(A, file, 'PostToolUse'), {});
  fs.writeFileSync(config, 'model_auto_compact_token_limit=900\n');
  assert.match((await hook(A, file, 'PostToolUse')).hookSpecificOutput.additionalContext, /save trigger=720/);
  append(file, { type: 'turn_context', payload: { model: 'new-fixture' } });
  append(file, { ...sample(A), payload: { ...sample(A).payload, usage: { input_tokens: 800, output_tokens: 10, total_tokens: 810 } } });
  assert.match((await hook(A, file, 'PostToolUse')).hookSpecificOutput.additionalContext, /YOU MUST SAVE/);
  fs.writeFileSync(config, 'invalid = [');
  assert.equal((await invoke(A, 'agent_state_note', { title: 'resilient', body: 'Keep guide writes independent of config lookup failure.' })).isError, undefined);
  assert.match((await invoke(A, 'agent_state_read', {})).structuredContent.usage.compact_policy.error, /UNCALIBRATED/);
});
test('symlink/forged rollout rejected, invalid private header never shared', async () => {
  setup(); const file = rollout(A); rollout(B, A);
  await hook(A, file, 'SessionStart');
  const dir = path.join(directory(A), 'notes'); fs.mkdirSync(dir);
  const target = path.join(process.env.CODEX_HOME, 'secret'); fs.writeFileSync(target, 'private');
  fs.symlinkSync(target, path.join(dir, 'a'.repeat(64) + '.md'));
  assert.equal((await invoke(A, 'agent_state_read', {})).isError, true);
  await assert.rejects(hook(B, file, 'SubagentStart'));
  fs.unlinkSync(path.join(dir, 'a'.repeat(64) + '.md'));
  const bad = 'shared:yes\n# header\n\nINVALID_PRIVATE'; const id = hash(bad); fs.writeFileSync(path.join(dir, id + '.md'), bad);
  const own = await invoke(A, 'agent_state_read', { note_id: id }); assert.match(own.structuredContent.content, /INVALID_PRIVATE/);
  const child = await invoke(B, 'agent_state_read', {}); assert.equal(child.structuredContent.notes.length, 0);
});
