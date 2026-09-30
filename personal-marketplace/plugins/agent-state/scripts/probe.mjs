#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { actor, transaction } from './store.mjs';
import { bind, scan, usage } from './rollout.mjs';

const command = process.argv[2] ?? 'tokens';
if (command === 'tokens') {
  try {
    const report = await transaction(actor(process.env.CODEX_THREAD_ID), state => { bind(state); scan(state); return usage(state); });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (e) { process.stderr.write('[agent-state] DEGRADED: ' + e.message + '. Run inside a Codex exec tool, or use agent_state_read without arguments.\n'); process.exitCode = 1; }
} else if (command === 'integration') {
  const fixture = new URL('../tests/native-host.py', import.meta.url).pathname;
  for (const mode of ['code', 'final', 'yielded']) {
    const result = spawnSync('python3', [fixture], { stdio: 'inherit', env: { ...process.env, AGENT_STATE_PROBE_MODE: mode } });
    if (result.status !== 0) { process.exitCode = result.status || 1; break; }
  }
} else { process.stderr.write('Usage: probe.mjs tokens|integration\n'); process.exitCode = 2; }
