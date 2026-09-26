import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";

import { REMINDER_TEXT } from "../scripts/reminder-text.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(ROOT, "scripts", "reasoning-poison-hook.mjs");
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "codex-poison-test-"));
const BASE_ENV = {
  ...process.env,
  CODEX_REASONING_POISON_STATE_DIR: STATE_DIR,
};
const CWD = "/probe-workspace";

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

test("main and subagent starts inject the exact reminder", () => {
  for (const [eventName, agentId] of [
    ["SessionStart", undefined],
    ["SubagentStart", "agent-1"],
  ]) {
    const output = start(`start-${eventName}`, eventName, agentId);
    assert.equal(output.hookSpecificOutput.hookEventName, eventName);
    assert.strictEqual(context(output), REMINDER_TEXT);
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
