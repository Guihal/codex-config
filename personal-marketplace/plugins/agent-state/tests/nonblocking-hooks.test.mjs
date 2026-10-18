import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { directory, transaction } from '../scripts/store.mjs';
import { bind } from '../scripts/rollout.mjs';

const A = '01900000-0000-7000-8000-000000000001';
const hook = new URL('../scripts/agent-state-hook.mjs', import.meta.url).pathname;
const events = Object.keys(JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url))).hooks);
function invoke(event, input) {
  const p = spawnSync(process.execPath, [hook, event], { input, env: process.env, encoding: 'utf8', timeout: 4500, maxBuffer: 100000 });
  assert.equal(p.status, 0, `${event}: ${p.stderr || p.error}`);
  assert.equal(p.stderr, '');
  const result = JSON.parse(p.stdout);
  assert.notEqual(result.continue, false); assert.ok(!['block', 'deny'].includes(result.decision));
  assert.ok(Buffer.byteLength(p.stdout) <= 90000);
  return result;
}
test('every registered hook continues through malformed, oversized, identity, storage and lock errors', async () => {
  const root = fs.mkdtempSync('/home/penis/tmp/nonblocking-hooks-');
  process.env.CODEX_HOME = root; process.env.CODEX_AGENT_STATE_STATE_DIR = path.join(root, 'state');
  const file = path.join(root, 'sessions', `rollout-fixture-${A}.jsonl`);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: A, source: 'cli' } }) + '\n');
  await transaction(A, state => bind(state, file));
  const dir = directory(A), stateFile = path.join(dir, 'state.json'), original = fs.readFileSync(stateFile);
  for (const event of events) {
    invoke(event, '{bad');
    invoke(event, JSON.stringify({ hook_event_name: event }));
    invoke(event, 'x'.repeat(1024 * 1024 + 1));
    const payload = JSON.stringify({ hook_event_name: event, session_id: A, transcript_path: file });
    fs.writeFileSync(stateFile, '{corrupt'); invoke(event, payload); assert.equal(fs.readFileSync(stateFile, 'utf8'), '{corrupt');
    fs.writeFileSync(stateFile, original);
    fs.writeFileSync(path.join(dir, 'lock'), JSON.stringify({ unknown: true }));
    invoke(event, payload); assert.equal(fs.readFileSync(path.join(dir, 'lock'), 'utf8'), JSON.stringify({ unknown: true }));
    fs.unlinkSync(path.join(dir, 'lock'));
    const bytes = fs.readFileSync(file); fs.writeFileSync(file, bytes.toString().replace(A, '01900000-0000-7000-8000-000000000002'));
    invoke(event, payload); assert.deepEqual(fs.readFileSync(file), Buffer.from(bytes.toString().replace(A, '01900000-0000-7000-8000-000000000002')));
    fs.writeFileSync(file, bytes);
  }
});
