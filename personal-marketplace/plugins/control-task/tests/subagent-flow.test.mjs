import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  additionalContext,
  adoptTask,
  baseToken,
  bootstrapToken,
  cleanupState,
  invokeHook,
  invokeSubagentBootstrap,
  setTask,
} from "./test-helpers.mjs";

after(cleanupState);

function start(sessionId, source = "startup") {
  return additionalContext(
    invokeHook({
      session_id: sessionId,
      hook_event_name: "SessionStart",
      source,
    }),
  );
}

test("subagent launch task becomes isolated durable child state", () => {
  const parentId = "parent-session";
  const childId = "child-session";
  const parentTask = "Keep the parent task unchanged.";
  const childTask = "Inspect module A.\nReturn evidence in Russian.";

  const parentStartup = start(parentId);
  assert.equal(
    setTask(parentId, baseToken(parentStartup), parentTask).isError,
    undefined,
  );

  const rewritten = invokeSubagentBootstrap({
    session_id: parentId,
    hook_event_name: "PreToolUse",
    tool_name: "spawn_agent",
    tool_input: {
      agent_type: "default",
      fork_turns: "none",
      message: childTask,
    },
  }).hookSpecificOutput;
  assert.equal(rewritten.hookEventName, "PreToolUse");
  assert.equal(rewritten.permissionDecision, "allow");
  assert.equal(rewritten.updatedInput.agent_type, "default");
  assert.equal(rewritten.updatedInput.fork_turns, "none");
  assert.match(rewritten.updatedInput.message, /SUBAGENT BOOTSTRAP/);
  assert.match(rewritten.updatedInput.message, /Inspect module A\./);
  assert.match(rewritten.updatedInput.message, /Return evidence in Russian\./);

  const childStartup = additionalContext(
    invokeHook({
      session_id: parentId,
      hook_event_name: "SubagentStart",
      agent_id: childId,
      agent_type: "default",
    }),
  );
  assert.match(childStartup, /ACTIVE TASK — NOT SET/);
  const bootstrapTokenValue = bootstrapToken(rewritten.updatedInput.message);
  const rejected = adoptTask(
    childId,
    "wrong-base-token-value",
    bootstrapTokenValue,
  );
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /stale or invalid base_token/);
  const adopted = adoptTask(
    childId,
    baseToken(childStartup),
    bootstrapTokenValue,
  );
  assert.equal(adopted.isError, undefined);
  assert.equal(adopted.structuredContent.revision, 1);

  const childCompact = start(childId, "compact");
  assert.match(childCompact, /Revision: 1/);
  assert.match(childCompact, /Inspect module A\./);
  assert.match(childCompact, /Return evidence in Russian\./);

  const parentCompact = start(parentId, "compact");
  assert.match(parentCompact, /Keep the parent task unchanged\./);
  assert.doesNotMatch(parentCompact, /Inspect module A\./);

  const replay = adoptTask(
    childId,
    baseToken(childStartup),
    bootstrapTokenValue,
  );
  assert.equal(replay.isError, true);
  assert.match(replay.content[0].text, /missing, expired, or already used/);
});

test("parallel bootstrap tokens keep child tasks separate", () => {
  const tasks = ["First child task.", "Second child task."];
  const children = tasks.map((taskBody, index) => {
    const rewritten = invokeSubagentBootstrap({
      hook_event_name: "PreToolUse",
      tool_input: { agent_type: "default", message: taskBody },
    }).hookSpecificOutput.updatedInput.message;
    const childId = `parallel-child-${index}`;
    const startup = additionalContext(
      invokeHook({
        session_id: "parallel-parent",
        hook_event_name: "SubagentStart",
        agent_id: childId,
        agent_type: "default",
      }),
    );
    const result = adoptTask(
      childId,
      baseToken(startup),
      bootstrapToken(rewritten),
    );
    assert.equal(result.isError, undefined);
    return childId;
  });

  const first = start(children[0], "compact");
  const second = start(children[1], "compact");
  assert.match(first, /First child task\./);
  assert.doesNotMatch(first, /Second child task\./);
  assert.match(second, /Second child task\./);
  assert.doesNotMatch(second, /First child task\./);
});
