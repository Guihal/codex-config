import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { statePathFor, transactState } from "../scripts/injection-rules/repository.mjs";

const SCRIPT = new URL("../scripts/injection-rules.mjs", import.meta.url).pathname;

function spawnHook(dataDirectory, event) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, CODEX_GUARDRAILS_DATA_DIR: dataDirectory } });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(stderr) : reject(new Error(`exit ${code}: ${stderr}`)));
    child.stdin.end(JSON.stringify(event));
  });
}

test("state filenames hash session ids", () => {
  const path = statePathFor("/tmp/data", "private-session-id");
  assert.doesNotMatch(path, /private-session-id/);
  assert.match(path, /session-[a-f0-9]{64}\.json$/);
});

test("concurrent PostToolUse processes preserve every captured result", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "guardrail-concurrency-"));
  const events = Array.from({ length: 12 }, (_, index) => ({
    session_id: "concurrent", hook_event_name: "PostToolUse", tool_response: `result-${index}`,
  }));
  await Promise.all(events.map((event) => spawnHook(dataDirectory, event)));
  const state = JSON.parse(readFileSync(statePathFor(dataDirectory, "concurrent"), "utf8"));
  assert.equal(state.actorsByKey.main.recentEntries.length, 12);
  assert.deepEqual(new Set(state.actorsByKey.main.recentEntries.map((entry) => entry.text)), new Set(events.map((event) => event.tool_response)));
});

test("lock timeout raises typed error without corrupting state", () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "guardrail-lock-"));
  const statePath = statePathFor(dataDirectory, "blocked");
  writeFileSync(`${statePath}.lock`, "holder");
  let tick = 0;
  assert.throws(() => transactState({
    sessionId: "blocked", dataDirectory, mutate: () => null,
    options: { now: () => { tick += 5; return tick; }, sleep: () => {}, waitMilliseconds: 1, staleMilliseconds: 1_000 },
  }), { name: "StateLockError" });
});

test("stale locks are recovered", () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "guardrail-stale-"));
  mkdirSync(dataDirectory, { recursive: true });
  const statePath = statePathFor(dataDirectory, "stale");
  const lockPath = `${statePath}.lock`;
  writeFileSync(lockPath, "dead");
  utimesSync(lockPath, new Date(0), new Date(0));
  const value = transactState({ sessionId: "stale", dataDirectory, mutate: (state) => { state.marker = "ok"; return 42; } });
  assert.equal(value, 42);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).marker, "ok");
});

test("CLI lock failure is fail-open", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "guardrail-cli-lock-"));
  writeFileSync(`${statePathFor(dataDirectory, "locked")}.lock`, "holder");
  const stderr = await spawnHook(dataDirectory, { session_id: "locked", hook_event_name: "PostToolUse", tool_response: "x" });
  assert.match(stderr, /lock-timeout/);
});
