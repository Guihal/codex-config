import assert from "node:assert/strict";
import { after, test } from "node:test";

import { cleanupState, invokeSubagentBootstrap } from "./test-helpers.mjs";

after(cleanupState);

test("an active plugin bootstrap is not wrapped twice", () => {
  const first = invokeSubagentBootstrap({
    hook_event_name: "PreToolUse",
    tool_input: { message: "existing task" },
  }).hookSpecificOutput.updatedInput;
  const second = invokeSubagentBootstrap({
    hook_event_name: "PreToolUse",
    tool_input: first,
  });
  assert.equal(second, null);
});

test("a task quoting the marker is still captured", () => {
  const marker = "<!-- codex-control-task:subagent-bootstrap:v1 -->";
  const result = invokeSubagentBootstrap({
    hook_event_name: "PreToolUse",
    tool_input: { message: `Audit docs that quote ${marker} exactly.` },
  }).hookSpecificOutput;
  assert.equal(result.permissionDecision, "allow");
  assert.match(result.updatedInput.message, /Audit docs that quote/);
});

test("an inactive wrapper-shaped task is captured", () => {
  const message = [
    "<!-- codex-control-task:subagent-bootstrap:v1 -->",
    "",
    "## ACTIVE TASK — SUBAGENT BOOTSTRAP",
    "",
    "ordinary quoted wrapper",
    "",
    "Bootstrap token: short",
    "",
    "Before substantial work, call control_task_adopt exactly once.",
    "Use the base token from the injected ACTIVE TASK — NOT SET developer block.",
    "Pass the bootstrap token written above. Do not copy or summarize the task into tool arguments.",
    "After the tool commits, perform the original task normally.",
  ].join("\n");
  const result = invokeSubagentBootstrap({
    hook_event_name: "PreToolUse",
    tool_input: { message },
  }).hookSpecificOutput;
  assert.equal(result.permissionDecision, "allow");
  assert.notEqual(result.updatedInput.message, message);
});

test("invalid Agent input is denied", () => {
  const result = invokeSubagentBootstrap({
    hook_event_name: "PreToolUse",
    tool_input: { items: [{ type: "text", text: "child task" }] },
  }).hookSpecificOutput;
  assert.equal(result.permissionDecision, "deny");
  assert.match(result.permissionDecisionReason, /spawn blocked/);
});

test("bootstrap write failure denies the spawn", () => {
  const result = invokeSubagentBootstrap(
    {
      hook_event_name: "PreToolUse",
      tool_input: { message: "child task" },
    },
    { CODEX_CONTROL_TASK_STATE_DIR: "/dev/null/not-a-directory" },
  ).hookSpecificOutput;
  assert.equal(result.permissionDecision, "deny");
  assert.match(result.permissionDecisionReason, /spawn blocked/);
});

test("oversized launch tasks are rejected instead of losing control state", () => {
  const result = invokeSubagentBootstrap({
    hook_event_name: "PreToolUse",
    tool_input: { agent_type: "default", message: "x".repeat(32 * 1024 + 1) },
  }).hookSpecificOutput;
  assert.equal(result.permissionDecision, "deny");
  assert.match(result.permissionDecisionReason, /exceeds.*32768 bytes/);
});
