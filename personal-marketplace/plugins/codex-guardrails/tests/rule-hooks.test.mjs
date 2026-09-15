import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { routeHook } from "../scripts/injection-rules/router.mjs";
import { statePathFor } from "../scripts/injection-rules/repository.mjs";

const SCRIPT = new URL("../scripts/injection-rules.mjs", import.meta.url).pathname;

function createHarness() {
  const dataDirectory = mkdtempSync(join(tmpdir(), "guardrail-hooks-"));
  const invoke = (hook_event_name, fields = {}) => routeHook({ session_id: "session", hook_event_name, ...fields }, { dataDirectory }).output;
  return { dataDirectory, invoke };
}

function context(output) {
  return output?.hookSpecificOutput?.additionalContext ?? "";
}

test("startup injects all standing rules and suppresses the immediate duplicate", () => {
  const { invoke } = createHarness();
  const startup = context(invoke("SessionStart", { source: "startup" }));
  assert.match(startup, /^\[a-working-product]/);
  assert.equal((startup.match(/^\[/gm) ?? []).length, 18);
  assert.equal(invoke("UserPromptSubmit", { prompt: "hello" }), null);
});

test("Stop schedules cadence and reopens standing injection for the next prompt", () => {
  const { invoke } = createHarness();
  invoke("SessionStart", { source: "startup" });
  invoke("UserPromptSubmit", { prompt: "hello" });
  invoke("Stop", { last_assistant_message: "done" });
  const next = context(invoke("UserPromptSubmit", { prompt: "again" }));
  assert.match(next, /^\[a-working-product]/);
  assert.match(next, /Первое действие после сообщения юзера/);
});

test("resume and compact preserve state while startup and clear reset it", () => {
  for (const source of ["resume", "compact"]) {
    const { invoke } = createHarness();
    invoke("SessionStart", { source: "startup" });
    invoke("Stop", { last_assistant_message: "done" });
    assert.match(context(invoke("SessionStart", { source })), /Первое действие после сообщения юзера/);
  }
  for (const source of ["startup", "clear"]) {
    const { invoke } = createHarness();
    invoke("SessionStart", { source: "startup" });
    invoke("Stop", { last_assistant_message: "done" });
    assert.doesNotMatch(context(invoke("SessionStart", { source })), /Первое действие после сообщения юзера/);
  }
});

test("explicit subagent lifecycle uses isolated actor state and role exclusions", () => {
  const { dataDirectory, invoke } = createHarness();
  invoke("SessionStart", { source: "startup" });
  const subagent = context(invoke("SubagentStart", { agent_id: "a1", agent_type: "critic" }));
  assert.doesNotMatch(subagent, /\[agent-orchestration]/);
  assert.equal(invoke("UserPromptSubmit", { agent_id: "a1", agent_type: "critic", prompt: "review" }), null);
  invoke("SubagentStop", { agent_id: "a1", agent_type: "critic", last_assistant_message: "verdict" });
  const state = JSON.parse(readFileSync(statePathFor(dataDirectory, "session"), "utf8"));
  assert.equal(state.actorsByKey.main.turnIndex, 0);
  assert.equal(state.actorsByKey["agent:a1"].turnIndex, 1);
  assert.equal(state.actorsByKey["agent:a1"].inputCounter, 0);
});

test("events without explicit agent fields route to main, never turn_id", () => {
  const { dataDirectory, invoke } = createHarness();
  invoke("PostToolUse", { turn_id: "looks-like-agent", tool_response: "tool text" });
  const state = JSON.parse(readFileSync(statePathFor(dataDirectory, "session"), "utf8"));
  assert.deepEqual(Object.keys(state.actorsByKey), ["main"]);
  assert.equal(state.actorsByKey.main.recentEntries[0].text, "tool text");
});

test("semantic hits persist debug JSONL and inject on the next entry", () => {
  const { dataDirectory, invoke } = createHarness();
  invoke("SessionStart", { source: "startup" });
  invoke("UserPromptSubmit", { prompt: "проверь layout" });
  invoke("Stop", { last_assistant_message: "done" });
  assert.match(readFileSync(join(dataDirectory, "rules-debug.jsonl"), "utf8"), /"ruleName":"layout-skills-hint"/);
  assert.match(context(invoke("UserPromptSubmit", { prompt: "continue" })), /\[layout-skills-hint]/);
});

test("notify_and_inject emits both developer context and systemMessage", () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "guardrail-notify-"));
  const rulesDirectory = mkdtempSync(join(tmpdir(), "guardrail-notify-rules-"));
  writeFileSync(join(rulesDirectory, "hint.json"), JSON.stringify({
    name: "hint", apply: ["*"], body: "[hint]", remind: { suffix: "remember", when: { any: ["needle"], source: "user_only", hint: "notify_and_inject" } },
  }));
  const options = { dataDirectory, rulesDirectory, distributionPath: join(rulesDirectory, "missing.json") };
  routeHook({ session_id: "hint", hook_event_name: "UserPromptSubmit", prompt: "needle" }, options);
  routeHook({ session_id: "hint", hook_event_name: "Stop", last_assistant_message: "done" }, options);
  const output = routeHook({ session_id: "hint", hook_event_name: "UserPromptSubmit", prompt: "next" }, options).output;
  assert.match(context(output), /remember/);
  assert.equal(output.systemMessage, "hint: remember");
});

test("hooks manifest wires every stateful lifecycle event", () => {
  const manifest = JSON.parse(readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8"));
  for (const event of ["SessionStart", "SubagentStart", "UserPromptSubmit", "PostToolUse", "Stop", "SubagentStop"]) {
    assert.ok(manifest.hooks[event]?.length, event);
  }
});

test("malformed CLI input fails open", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { input: "{bad", encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /injection-rules/);
});
