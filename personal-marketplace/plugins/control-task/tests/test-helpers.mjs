import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(ROOT, "scripts", "control-task-hook.mjs");
const MCP = path.join(ROOT, "scripts", "control-task-mcp.mjs");
const SUBAGENT_BOOTSTRAP = path.join(
  ROOT,
  "scripts",
  "subagent-bootstrap-hook.mjs",
);
export const STATE_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "control-task-test-"),
);
const ENV = { ...process.env, CODEX_CONTROL_TASK_STATE_DIR: STATE_DIR };

export function cleanupState() {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
}

export function invokeHook(event) {
  const result = spawnSync(process.execPath, [HOOK], {
    env: ENV,
    input: JSON.stringify(event),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

export function invokeSubagentBootstrap(event, env = {}) {
  const result = spawnSync(process.execPath, [SUBAGENT_BOOTSTRAP], {
    env: { ...ENV, ...env },
    input: JSON.stringify(event),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

export function invokeMcp(requests) {
  const input = `${requests.map((value) => JSON.stringify(value)).join("\n")}\n`;
  const result = spawnSync(process.execPath, [MCP], {
    env: ENV,
    input,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

export function additionalContext(result) {
  return result.hookSpecificOutput.additionalContext;
}

export function baseToken(context) {
  return context.match(/^Base token: (.+)$/m)?.[1];
}

export function bootstrapToken(message) {
  return message.match(/^Bootstrap token: (.+)$/m)?.[1];
}

export function setTask(sessionId, token, taskBody) {
  return invokeMcp([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "control_task_set",
        arguments: {
          base_token: token,
          task_body: taskBody,
          reason: "The user defined the durable task",
        },
        _meta: { threadId: sessionId },
      },
    },
  ])[0].result;
}

export function adoptTask(sessionId, baseTokenValue, bootstrapTokenValue) {
  return invokeMcp([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "control_task_adopt",
        arguments: {
          base_token: baseTokenValue,
          bootstrap_token: bootstrapTokenValue,
        },
        _meta: { threadId: sessionId },
      },
    },
  ])[0].result;
}

export function sessionFile(sessionId) {
  const digest = crypto.createHash("sha256").update(sessionId).digest("hex");
  return path.join(STATE_DIR, "sessions", `${digest}.json`);
}
