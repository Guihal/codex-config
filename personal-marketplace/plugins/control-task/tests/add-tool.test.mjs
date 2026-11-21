import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  additionalContext,
  baseToken,
  cleanupState,
  invokeHook,
  invokeMcp,
  sessionFile,
  setTask,
} from "./test-helpers.mjs";

let counter = 0;

function newSession() {
  counter += 1;
  const sessionId = `thread-add-${counter}-${Date.now()}`;
  const start = invokeHook({
    hook_event_name: "SessionStart",
    source: "startup",
    session_id: sessionId,
  });
  return { sessionId, token: baseToken(additionalContext(start)) };
}

function stateOf(sessionId) {
  return JSON.parse(fs.readFileSync(sessionFile(sessionId), "utf8"));
}

function add(sessionId, token, items) {
  return invokeMcp([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "control_task_add",
        arguments: {
          base_token: token,
          items,
          reason: "The user added requirements",
        },
        _meta: { threadId: sessionId },
      },
    },
  ])[0].result;
}

test.after(() => cleanupState());

test("items are appended and deduplicated by normalized key", () => {
  const { sessionId, token } = newSession();
  assert.equal(
    setTask(sessionId, token, "ЦЕЛЬ: перенести правила").isError,
    undefined,
  );

  const first = add(sessionId, stateOf(sessionId).baseToken, [
    "требование A",
    "Requirement B",
  ]);
  assert.deepEqual(
    {
      status: first.structuredContent.status,
      added: first.structuredContent.added,
    },
    { status: "committed", added: 2 },
  );

  const second = add(sessionId, stateOf(sessionId).baseToken, [
    "  требование   A ",
    "requirement b",
    "требование C",
  ]);
  assert.equal(second.structuredContent.status, "committed");
  assert.equal(second.structuredContent.added, 1);
  assert.equal(second.structuredContent.skipped, 2);

  const body = stateOf(sessionId).taskBody;
  assert.equal(body.match(/требование A/gi).length, 1);
  assert.equal(body.match(/requirement B/gi).length, 1);
  assert.equal(body.match(/требование C/g).length, 1);
  assert.deepEqual(
    add(sessionId, stateOf(sessionId).baseToken, ["требование C"])
      .structuredContent.status,
    "unchanged",
  );
});

test("add without a recorded task is rejected", () => {
  const { sessionId, token } = newSession();
  const result = add(sessionId, token, ["требование A"]);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /call control_task_set first/);
});

test("add refuses to grow the anchor past the byte ceiling", () => {
  const { sessionId, token } = newSession();
  const nearLimit = "x".repeat(32 * 1024 - 200);
  assert.equal(setTask(sessionId, token, nearLimit).isError, undefined);
  const before = stateOf(sessionId).taskBody;

  const result = add(sessionId, stateOf(sessionId).baseToken, [
    "y".repeat(400),
  ]);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /would exceed 32768 bytes/);
  assert.equal(stateOf(sessionId).taskBody, before);
});

test("control_task_add forces immediate re-injection", () => {
  const { sessionId, token } = newSession();
  assert.equal(
    setTask(sessionId, token, "ЦЕЛЬ: держать задачу").isError,
    undefined,
  );
  const added = add(sessionId, stateOf(sessionId).baseToken, [
    "требование после ответа",
  ]);
  assert.equal(added.structuredContent.status, "committed");

  const family = invokeHook({
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    tool_name: "control_task_add",
  });
  assert.match(additionalContext(family), /требование после ответа/);
});
