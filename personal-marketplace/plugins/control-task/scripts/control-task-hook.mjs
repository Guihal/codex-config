#!/usr/bin/env node

import { resetSessionState, transactSessionState } from "./state.mjs";
import { renderTaskState, USER_PROMPT_REMINDER } from "./render.mjs";

const DEFAULT_REFRESH_SECONDS = 300;

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function refreshMilliseconds() {
  const value = Number(process.env.CODEX_CONTROL_TASK_REFRESH_SECONDS);
  return Number.isFinite(value) && value >= 1
    ? value * 1000
    : DEFAULT_REFRESH_SECONDS * 1000;
}

function createStatus(event) {
  return (event.hook_event_name === "SessionStart" &&
    event.source === "startup") ||
    event.hook_event_name === "SubagentStart"
    ? "uninitialized"
    : "unavailable";
}

function stateSessionId(event) {
  const value = event.agent_id ?? event.session_id;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("missing session or agent id");
  }
  return value;
}

function shouldInject(event, state, now) {
  if (event.hook_event_name !== "PostToolUse") return true;
  if (/control_task_(set|adopt)$/.test(String(event.tool_name ?? "")))
    return true;
  return now - state.lastInjectedAt >= refreshMilliseconds();
}

function output(eventName, context) {
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: context } })}\n`,
  );
}

async function main() {
  let event;
  try {
    event = JSON.parse(await readStdin());
    const sessionId = stateSessionId(event);
    const isClear =
      event.hook_event_name === "SessionStart" && event.source === "clear";
    if (isClear) resetSessionState(sessionId);
    const now = Date.now();
    let isInjectionDue = false;
    const state = transactSessionState(
      sessionId,
      createStatus(event),
      (current) => {
        isInjectionDue = shouldInject(event, current, now);
        return isInjectionDue ? { ...current, lastInjectedAt: now } : current;
      },
    );
    if (!isInjectionDue) return;
    const reminder = event.hook_event_name === "UserPromptSubmit" ? USER_PROMPT_REMINDER + "\n\n" : "";
    output(event.hook_event_name, reminder + renderTaskState(state));
  } catch (error) {
    process.stderr.write(`control-task hook: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}

await main();
