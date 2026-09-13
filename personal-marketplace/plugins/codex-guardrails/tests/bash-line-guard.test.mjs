import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("../scripts/bash-line-guard.mjs", import.meta.url),
);

function run(input) {
  return spawnSync(process.execPath, [script], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });
}

function bash(command, overrides = {}) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    ...overrides,
  };
}

function commandWithLines(count, newline = "\n") {
  return Array.from({ length: count }, (_, index) => `echo ${index + 1}`).join(
    newline,
  );
}

test("allows a one-line command silently", () => {
  const result = run(bash("echo ok"));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("allows exactly 20 lines silently", () => {
  const result = run(bash(commandWithLines(20)));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("denies 21 lines with the exact Codex payload and Pi reason", () => {
  const result = run(bash(commandWithLines(21)));
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Автоматическая защита: команда из 21 строк (лимит 20). Запишите её в файл и выполните через bash < файл.",
    },
  });
});

test("keeps JavaScript split semantics for CRLF commands", () => {
  const allowed = run(bash(commandWithLines(20, "\r\n")));
  const denied = run(bash(commandWithLines(21, "\r\n")));
  assert.equal(allowed.stdout, "");
  assert.match(
    JSON.parse(denied.stdout).hookSpecificOutput.permissionDecisionReason,
    /из 21 строк/,
  );
});

test("ignores irrelevant tools and events", () => {
  const tool = run(bash(commandWithLines(21), { tool_name: "apply_patch" }));
  const event = run(
    bash(commandWithLines(21), { hook_event_name: "PostToolUse" }),
  );
  assert.equal(tool.status, 0);
  assert.equal(tool.stdout, "");
  assert.equal(event.status, 0);
  assert.equal(event.stdout, "");
});

test("fails open for malformed JSON and malformed tool input", () => {
  const invalidJson = run("{not json");
  const missingCommand = run({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: {},
  });
  const nonStringCommand = run(bash(42));

  for (const result of [invalidJson, missingCommand, nonStringCommand]) {
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
});
