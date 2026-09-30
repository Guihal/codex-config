import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { after, test } from "node:test";

import { REMINDER_TEXT, USER_INTENT_REMINDER_TEXT, PROJECT_SOURCES_REMINDER_TEXT } from "../scripts/reminder-text.mjs";
import { sessionFile } from "../scripts/state.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(ROOT, "scripts", "reasoning-poison-hook.mjs");
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "codex-poison-test-"));
const BASE_ENV = {
  ...process.env,
  CODEX_REASONING_POISON_STATE_DIR: STATE_DIR,
};
delete BASE_ENV.CODEX_REASONING_POISON_INTERVAL;
delete BASE_ENV.CODEX_REASONING_POISON_LARGE_OUTPUT_BYTES;
const CWD = "/probe-workspace";
const BOTH_REMINDERS = `${REMINDER_TEXT}\n${USER_INTENT_REMINDER_TEXT}`;
const ALL_REMINDERS = `${BOTH_REMINDERS}\n${PROJECT_SOURCES_REMINDER_TEXT}`;

after(() => fs.rmSync(STATE_DIR, { recursive: true, force: true }));

function run(event, environment = {}) {
  return spawnSync(process.execPath, [HOOK], {
    env: { ...BASE_ENV, ...environment },
    input: JSON.stringify({ cwd: CWD, ...event }),
    encoding: "utf8",
  });
}

function invoke(event, environment = {}) {
  const result = run(event, environment);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  if (result.stdout) assert.equal(result.stdout.trim().split("\n").length, 1);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function start(sessionId, eventName = "SessionStart", agentId) {
  return invoke({
    session_id: sessionId,
    agent_id: agentId,
    hook_event_name: eventName,
    source: "startup",
  });
}

function tool(sessionId, agentId, response = "ok", environment = {}) {
  return invoke(
    {
      session_id: sessionId,
      agent_id: agentId,
      hook_event_name: "PostToolUse",
      tool_name: "functions.exec",
      tool_response: response,
    },
    environment,
  );
}

function context(output) {
  return output?.hookSpecificOutput?.additionalContext;
}

test("main and subagent starts inject both exact reminders", () => {
  for (const [eventName, agentId] of [
    ["SessionStart", undefined],
    ["SubagentStart", "agent-1"],
  ]) {
    const output = start(`start-${eventName}`, eventName, agentId);
    assert.equal(output.hookSpecificOutput.hookEventName, eventName);
    assert.strictEqual(context(output), ALL_REMINDERS);
  }
});

test("the default cadence injects on every fifth completed call", () => {
  const sessionId = "cadence";
  start(sessionId);
  for (let call = 1; call < 5; call += 1) {
    assert.equal(tool(sessionId), null, `call ${call}`);
  }
  assert.strictEqual(context(tool(sessionId)), REMINDER_TEXT);
});

test("main and subagent cadence state stay isolated", () => {
  const sessionId = "isolation";
  start(sessionId);
  start(sessionId, "SubagentStart", "agent-2");
  for (let call = 1; call < 5; call += 1) {
    assert.equal(tool(sessionId), null);
    assert.equal(tool(sessionId, "agent-2"), null);
  }
  assert.ok(tool(sessionId));
  assert.ok(tool(sessionId, "agent-2"));
});

test("large tool output injects early and resets the cadence", () => {
  const sessionId = "large-output";
  start(sessionId);
  tool(sessionId);
  tool(sessionId);
  assert.ok(tool(sessionId, undefined, "x".repeat(9000)));
  for (let call = 1; call < 5; call += 1) assert.equal(tool(sessionId), null);
  assert.ok(tool(sessionId));
});

test("the interval is configurable and invalid values use the default", () => {
  const custom = { CODEX_REASONING_POISON_INTERVAL: "2" };
  start("custom");
  assert.equal(tool("custom", undefined, "ok", custom), null);
  assert.ok(tool("custom", undefined, "ok", custom));

  const invalid = { CODEX_REASONING_POISON_INTERVAL: "0" };
  start("invalid");
  for (let call = 1; call < 5; call += 1) {
    assert.equal(tool("invalid", undefined, "ok", invalid), null);
  }
  assert.ok(tool("invalid", undefined, "ok", invalid));
});

test("malformed input fails visibly without emitting context", () => {
  const result = spawnSync(process.execPath, [HOOK], {
    env: BASE_ENV,
    input: "{bad",
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /reasoning-poison hook/);
});

function stateFile(sessionId, agentId, cwd = CWD) {
  return sessionFile({ session_id: sessionId, agent_id: agentId, cwd }, BASE_ENV);
}

function readState(sessionId, agentId, cwd = CWD) {
  return JSON.parse(fs.readFileSync(stateFile(sessionId, agentId, cwd), "utf8"));
}

test("PS-2: independent 5/13/17 cadences repeat through the 13/17 coincidence", () => {
  const id = "independent-cadences";
  start(id);
  for (let call = 1; call <= 221; call += 1) {
    const blocks = [];
    if (call % 5 === 0) blocks.push(REMINDER_TEXT);
    if (call % 13 === 0) blocks.push(USER_INTENT_REMINDER_TEXT);
    if (call % 17 === 0) blocks.push(PROJECT_SOURCES_REMINDER_TEXT);
    assert.equal(context(tool(id)), blocks.length ? blocks.join("\n") : undefined, `call ${call}`);
    const state = readState(id);
    assert.equal(state.completedCalls, call % 5);
    assert.equal(state.intentCompletedCalls, call % 13);
    assert.equal(state.sourcesCompletedCalls, call % 17);
    assert.equal(state.injectedTotal, 1 + Math.floor(call / 5));
  }
});

test("large-output early resets leave the intent cadence unchanged", () => {
  const id = "intent-large-output";
  start(id);
  for (let call = 1; call <= 15; call += 1) {
    const early = call === 3;
    const oldDue = early || (call > 3 && (call - 3) % 5 === 0);
    const blocks = [];
    if (oldDue) blocks.push(REMINDER_TEXT);
    if (call === 13) blocks.push(USER_INTENT_REMINDER_TEXT);
    assert.equal(context(tool(id, undefined, early ? "x".repeat(8190) : "ok")),
      blocks.length ? blocks.join("\n") : undefined, `call ${call}`);
    assert.equal(readState(id).intentCompletedCalls, call % 13);
  }
});

test("changing the old interval does not configure the intent interval", () => {
  const id = "intent-custom-interval";
  const environment = { CODEX_REASONING_POISON_INTERVAL: "2" };
  start(id);
  for (let call = 1; call <= 26; call += 1) {
    const blocks = [];
    if (call % 2 === 0) blocks.push(REMINDER_TEXT);
    if (call % 13 === 0) blocks.push(USER_INTENT_REMINDER_TEXT);
    if (call % 17 === 0) blocks.push(PROJECT_SOURCES_REMINDER_TEXT);
    assert.equal(context(tool(id, undefined, "ok", environment)),
      blocks.length ? blocks.join("\n") : undefined, `call ${call}`);
    assert.equal(readState(id).completedCalls, call % 2);
    assert.equal(readState(id).intentCompletedCalls, call % 13);
  }
});

test("large output counts serialized UTF-8 bytes at the configured boundary", () => {
  const environment = {
    CODEX_REASONING_POISON_INTERVAL: "1000",
    CODEX_REASONING_POISON_LARGE_OUTPUT_BYTES: "10",
  };
  const id = "large-output-boundary";
  start(id);
  assert.equal(tool(id, undefined, "éééx", environment), null); // 9 JSON bytes
  assert.equal(context(tool(id, undefined, "éééxx", environment)), REMINDER_TEXT); // 10
  assert.equal(tool(id, undefined, null, environment), null);
  assert.equal(readState(id).intentCompletedCalls, 3);
});

test("first contact injects both texts once and starts both counters at zero", () => {
  const id = "first-contact";
  assert.equal(context(tool(id, "child-no-start")), ALL_REMINDERS);
  assert.equal(readState(id, "child-no-start").completedCalls, 0);
  assert.equal(readState(id, "child-no-start").intentCompletedCalls, 0);
  assert.equal(tool(id, "child-no-start"), null);
  assert.equal(readState(id, "child-no-start").intentCompletedCalls, 1);
});

test("startup, resume, clear, compact and subagent starts reset both counters", () => {
  const id = "lifecycle-resets";
  start(id);
  for (const source of ["startup", "resume", "clear", "compact"]) {
    for (let call = 0; call < 12; call += 1) tool(id);
    assert.equal(context(invoke({ session_id: id, hook_event_name: "SessionStart", source })), ALL_REMINDERS);
    assert.equal(readState(id).completedCalls, 0);
    assert.equal(readState(id).intentCompletedCalls, 0);
  }
  start(id, "SubagentStart", "reset-child");
  tool(id, "reset-child");
  assert.equal(context(start(id, "SubagentStart", "reset-child")), ALL_REMINDERS);
  assert.equal(readState(id, "reset-child").intentCompletedCalls, 0);
});

test("sessions, actors and canonical CWD isolate both counters", () => {
  const id = "full-isolation";
  start(id);
  start(id, "SubagentStart", "child");
  start("other-isolation");
  invoke({ session_id: id, cwd: "/other-probe", hook_event_name: "SessionStart" });
  for (let call = 1; call <= 13; call += 1) tool(id);
  assert.equal(readState(id).intentCompletedCalls, 0);
  for (const [sessionId, agentId, cwd] of [
    [id, "child", CWD], ["other-isolation", undefined, CWD], [id, undefined, "/other-probe"],
  ]) {
    assert.equal(readState(sessionId, agentId, cwd).completedCalls, 0);
    assert.equal(readState(sessionId, agentId, cwd).intentCompletedCalls, 0);
    assert.equal(readState(sessionId, agentId, cwd).injectedTotal, 1);
  }
  const workspace = path.join(STATE_DIR, "workspace");
  const alias = path.join(STATE_DIR, "workspace-alias");
  fs.mkdirSync(workspace);
  fs.symlinkSync(workspace, alias);
  invoke({ session_id: id, cwd: workspace, hook_event_name: "SessionStart" });
  invoke({ session_id: id, cwd: alias, hook_event_name: "PostToolUse" });
  assert.equal(stateFile(id, undefined, workspace), stateFile(id, undefined, alias));
  assert.equal(readState(id, undefined, workspace).intentCompletedCalls, 1);
});

test("legacy version 1 state retains old cadence and starts intent at zero", () => {
  const id = "legacy-state";
  start(id);
  fs.writeFileSync(stateFile(id), JSON.stringify({
    version: 1, completedCalls: 2, injectedTotal: 4, updatedAt: 1,
  }));
  for (let call = 1; call <= 13; call += 1) {
    const blocks = [];
    if ((call + 2) % 5 === 0) blocks.push(REMINDER_TEXT);
    if (call === 13) blocks.push(USER_INTENT_REMINDER_TEXT);
    assert.equal(context(tool(id)), blocks.length ? blocks.join("\n") : undefined, `call ${call}`);
    assert.equal(readState(id).injectedTotal, 4 + Math.floor((call + 2) / 5));
    assert.equal(readState(id).intentCompletedCalls, call % 13);
  }
  assert.equal(fs.readdirSync(path.dirname(stateFile(id))).filter(name =>
    name.startsWith(`${path.basename(stateFile(id))}.corrupt-`)).length, 0);
});

test("invalid intent counters are quarantined and recover as fresh state", () => {
  for (const [index, intentCompletedCalls] of [-1, 1.5, "3", null].entries()) {
    const id = `corrupt-intent-${index}`;
    start(id);
    fs.writeFileSync(stateFile(id), JSON.stringify({
      version: 1, completedCalls: 4, injectedTotal: 8, updatedAt: 1, intentCompletedCalls,
    }));
    assert.equal(context(tool(id)), ALL_REMINDERS);
    assert.equal(readState(id).completedCalls, 0);
    assert.equal(readState(id).intentCompletedCalls, 0);
    assert.equal(readState(id).injectedTotal, 1);
    assert.equal(fs.readdirSync(path.dirname(stateFile(id))).filter(name =>
      name.startsWith(`${path.basename(stateFile(id))}.corrupt-`)).length, 1);
  }
});

test("missing required identity fails and unsupported events do not change state", () => {
  for (const event of [
    { hook_event_name: "PostToolUse" },
    { session_id: "missing-cwd", cwd: "", hook_event_name: "SessionStart" },
  ]) {
    const result = run(event);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /missing session/);
  }
  const id = "unsupported";
  start(id);
  const before = readState(id);
  for (const hook_event_name of ["PostToolUseFailure", "Stop", "PreToolUse"]) {
    assert.equal(invoke({ session_id: id, hook_event_name }), null);
    assert.deepEqual(readState(id), before);
  }
});

function collectProcess(child, input) {
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
  });
}

async function holdLock(id) {
  const child = spawn("flock", ["--exclusive", "--no-fork", `${stateFile(id)}.lock`, process.execPath, "-e",
    'process.stdout.write("locked\\n"); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));'], { env: BASE_ENV });
  const done = collectProcess(child);
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("lock holder exited before ready")));
  });
  return { child, done };
}

test("64 overlapping calls preserve both counters and exact delivery counts", async () => {
  const id = "concurrent-calls";
  start(id);
  const results = await Promise.all(Array.from({ length: 64 }, () => collectProcess(
    spawn(process.execPath, [HOOK], { env: BASE_ENV }),
    JSON.stringify({ session_id: id, cwd: CWD, hook_event_name: "PostToolUse", tool_response: "ok" }),
  )));
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  }
  const contexts = results.filter(result => result.stdout).map(result => {
    assert.equal(result.stdout.trim().split("\n").length, 1);
    return context(JSON.parse(result.stdout));
  });
  assert.equal(contexts.filter(text => text.includes(REMINDER_TEXT)).length, 12);
  assert.equal(contexts.filter(text => text.includes(USER_INTENT_REMINDER_TEXT)).length, 4);
  assert.equal(contexts.length, 19);
  assert.equal(contexts.filter(text => text.includes(PROJECT_SOURCES_REMINDER_TEXT)).length, 3);
  assert.equal(readState(id).sourcesCompletedCalls, 13);
  assert.equal(readState(id).completedCalls, 4);
  assert.equal(readState(id).intentCompletedCalls, 12);
  assert.equal(readState(id).injectedTotal, 13);
  assert.equal(context(tool(id)), BOTH_REMINDERS);
  assert.equal(readState(id).completedCalls, 0);
  assert.equal(readState(id).intentCompletedCalls, 0);
  assert.equal(fs.statSync(stateFile(id)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${stateFile(id)}.lock`).mode & 0o777, 0o600);
});

test("lock wait is bounded, fails visibly and does not block another actor", async () => {
  const id = "lock-contention";
  start(id);
  const before = readState(id);
  const holder = await holdLock(id);
  try {
    assert.equal(context(tool(id, "other-actor")), ALL_REMINDERS);
    const started = Date.now();
    const result = run({ session_id: id, hook_event_name: "PostToolUse" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /lock timed out after 3 seconds/);
    assert.ok(Date.now() - started < 4800, "must finish inside the five-second hook timeout");
    assert.deepEqual(readState(id), before);
  } finally {
    holder.child.stdin.end();
    await holder.done;
  }
  assert.equal(tool(id), null);
  assert.equal(readState(id).intentCompletedCalls, 1);
});

test("crashed lock owner releases the mutex without replacing the inode", async () => {
  const id = "lock-crash";
  start(id);
  const inode = fs.statSync(`${stateFile(id)}.lock`).ino;
  const holder = await holdLock(id);
  holder.child.kill("SIGKILL");
  await holder.done;
  assert.equal(tool(id), null);
  assert.equal(readState(id).intentCompletedCalls, 1);
  assert.equal(fs.statSync(`${stateFile(id)}.lock`).ino, inode);
});

test("transaction errors release the lock and do not emit success context", () => {
  const id = "state-io-error";
  start(id);
  const file = stateFile(id);
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  const result = run({ session_id: id, hook_event_name: "PostToolUse" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /EISDIR/);
  fs.rmdirSync(file);
  assert.equal(context(tool(id)), ALL_REMINDERS);
});

// Spec: PS-3 (../README.md#project-sources-contract).
test("PS-3: dual-counter legacy state preserves old schedules while sources starts at zero", () => {
  const id = "legacy-dual-source";
  start(id);
  fs.writeFileSync(stateFile(id), JSON.stringify({ version: 1, completedCalls: 4,
    intentCompletedCalls: 12, injectedTotal: 9, updatedAt: 123 }));
  for (let call = 1; call <= 17; call++) {
    const result = tool(id);
    const expected = [
      ...((call + 4) % 5 === 0 ? [REMINDER_TEXT] : []),
      ...((call + 12) % 13 === 0 ? [USER_INTENT_REMINDER_TEXT] : []),
      ...(call === 17 ? [PROJECT_SOURCES_REMINDER_TEXT] : []),
    ].join("\n");
    assert.equal((context)(result) ?? "", expected, `call ${call}`);
    assert.equal(readState(id).sourcesCompletedCalls, call % 17);
    assert.equal(readState(id).intentCompletedCalls, (call + 12) % 13);
    assert.equal(readState(id).injectedTotal, 9 + Math.floor((call + 4) / 5));
  }
});

test("PS-3/PS-4: invalid present source counter quarantines and delivers all reminders", () => {
  for (const [index, value] of [null, -1, 0.5, "0", {}, true].entries()) {
    const id = `corrupt-sources-${index}`;
    start(id);
    const file = stateFile(id);
    fs.writeFileSync(file, JSON.stringify({ ...readState(id), sourcesCompletedCalls: value }));
    assert.equal((context)(tool(id)), ALL_REMINDERS);
    assert.equal(readState(id).sourcesCompletedCalls, 0);
    assert.equal(fs.readdirSync(path.dirname(file)).filter(name => name.startsWith(`${path.basename(file)}.corrupt-`)).length, 1);
  }
});

test("PS-2: every large-output early trigger preserves the 17-call source period", () => {
  const id = "sources-early";
  const env = { CODEX_REASONING_POISON_INTERVAL: "2" };
  start(id);
  for (let call = 1; call <= 34; call++) {
    const expected = [REMINDER_TEXT,
      ...(call % 13 === 0 ? [USER_INTENT_REMINDER_TEXT] : []),
      ...(call % 17 === 0 ? [PROJECT_SOURCES_REMINDER_TEXT] : [])].join("\n");
    assert.equal(context(tool(id, undefined, "x".repeat(9000), env)), expected);
    assert.equal(readState(id).sourcesCompletedCalls, call % 17);
  }
});
