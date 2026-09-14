import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);
const { hooks } = JSON.parse(
  readFileSync(new URL("hooks/hooks.json", pluginRoot), "utf8"),
);
const injectionCommand = 'node "${PLUGIN_ROOT}/scripts/injection-rules.mjs"';

function commandsFor(event) {
  return (hooks[event] ?? []).flatMap((group) => group.hooks);
}

test("does not register the removed Bash line limiter under any event", () => {
  const commands = Object.keys(hooks).flatMap(commandsFor);
  assert.ok(commands.length > 0, "the remaining guardrails must stay enabled");
  for (const hook of commands) {
    assert.doesNotMatch(hook.command, /bash-line-guard/);
  }
});

test("does not ship the obsolete Bash line limiter executable", () => {
  assert.equal(
    existsSync(new URL("scripts/bash-line-guard.mjs", pluginRoot)),
    false,
  );
});

test("preserves injection-rules registration for all six lifecycle events", () => {
  for (const event of [
    "SessionStart", "SubagentStart", "UserPromptSubmit",
    "PostToolUse", "Stop", "SubagentStop",
  ]) {
    const injectors = commandsFor(event).filter(
      (hook) => hook.command === injectionCommand,
    );
    assert.equal(injectors.length, 1, `${event}: exactly one rule injector`);
    assert.equal(injectors[0].type, "command");
    assert.equal(injectors[0].timeout, 5);
  }
  assert.equal(hooks.SessionStart[0].matcher, "startup|resume|clear|compact");
  assert.equal(hooks.PostToolUse[0].matcher, ".*");
});

test("preserves standing-rule context limits", () => {
  for (const event of ["SessionStart", "SubagentStart", "UserPromptSubmit"]) {
    const injector = commandsFor(event).find(
      (hook) => hook.command === injectionCommand,
    );
    assert.equal(injector?.additionalContextLimit, 24000, event);
  }
});

test("preserves the apply_patch lint hook and its existing position", () => {
  const lintGroup = hooks.PostToolUse[1];
  assert.equal(lintGroup.matcher, "^apply_patch$");
  assert.equal(lintGroup.hooks.length, 1);
  assert.deepEqual(lintGroup.hooks[0], {
    type: "command",
    command: 'node "${PLUGIN_ROOT}/scripts/lint-inject.mjs"',
    timeout: 25,
    statusMessage: "Linting changed files",
    additionalContextLimit: 5000,
  });
});
