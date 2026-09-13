import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";

import {
  STATE_DIR,
  additionalContext,
  baseToken,
  cleanupState,
  invokeHook,
  invokeMcp,
  sessionFile,
  setTask,
} from "./test-helpers.mjs";

after(cleanupState);

test("setter and hooks preserve one task within one Codex session", () => {
  const sessionId = "session-a";
  const startup = additionalContext(
    invokeHook({
      session_id: sessionId,
      hook_event_name: "SessionStart",
      source: "startup",
    }),
  );
  assert.match(startup, /ACTIVE TASK — NOT SET/);

  const token = baseToken(startup);
  const task = "Keep the canonical goal alive after compaction.";
  const committed = setTask(sessionId, token, task);
  assert.deepEqual(committed.structuredContent, {
    status: "committed",
    revision: 1,
    sessionBound: true,
  });

  const compact = additionalContext(
    invokeHook({
      session_id: sessionId,
      hook_event_name: "SessionStart",
      source: "compact",
    }),
  );
  assert.match(compact, /Revision: 1/);
  assert.match(compact, new RegExp(task.replaceAll(".", "\\.")));

  const afterSet = additionalContext(
    invokeHook({
      session_id: sessionId,
      hook_event_name: "PostToolUse",
      tool_name: "mcp__control-task__control_task_set",
    }),
  );
  assert.match(afterSet, /ACTIVE TASK/);
  assert.match(afterSet, /Revision: 1/);

  const stale = setTask(sessionId, token, "Overwrite with a stale token");
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /stale or invalid base_token/);
});

test("sessions are isolated and raw session ids are absent from paths", () => {
  const result = additionalContext(
    invokeHook({
      session_id: "session-b",
      hook_event_name: "SessionStart",
      source: "startup",
    }),
  );
  assert.match(result, /ACTIVE TASK — NOT SET/);
  assert.doesNotMatch(result, /Keep the canonical goal/);
  assert.equal(
    fs.existsSync(path.join(STATE_DIR, "sessions", "session-b.json")),
    false,
  );
});

test("corrupt state is preserved and surfaced as unavailable", () => {
  const sessionId = "session-corrupt";
  invokeHook({
    session_id: sessionId,
    hook_event_name: "SessionStart",
    source: "startup",
  });
  const file = sessionFile(sessionId);
  fs.writeFileSync(file, "not-json\n", { mode: 0o600 });

  const result = additionalContext(
    invokeHook({
      session_id: sessionId,
      hook_event_name: "SessionStart",
      source: "compact",
    }),
  );
  assert.match(result, /ACTIVE TASK — UNAVAILABLE/);
  const backups = fs
    .readdirSync(path.dirname(file))
    .filter((name) => name.startsWith(`${path.basename(file)}.corrupt-`));
  assert.equal(backups.length, 1);
});

test("setter rejects calls without trusted Codex thread metadata", () => {
  const result = invokeMcp([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "control_task_set",
        arguments: { base_token: "x".repeat(24), task_body: "x", reason: "x" },
      },
    },
  ])[0].result;
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /thread metadata is unavailable/);
});

test("setter enforces the runtime reason limit", () => {
  const startup = additionalContext(
    invokeHook({
      session_id: "session-long-reason",
      hook_event_name: "SessionStart",
      source: "startup",
    }),
  );
  const result = invokeMcp([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "control_task_set",
        arguments: {
          base_token: baseToken(startup),
          task_body: "x",
          reason: "x".repeat(1_001),
        },
        _meta: { threadId: "session-long-reason" },
      },
    },
  ])[0].result;
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /reason exceeds 1000 characters/);
});
