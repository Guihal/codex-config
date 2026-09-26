#!/usr/bin/env node

import { decide } from "./decision.mjs";
import { REMINDER_TEXT } from "./reminder-text.mjs";
import { readSessionState, sessionFile, writeSessionState } from "./state.mjs";

const SUPPORTED_EVENTS = new Set([
  "SessionStart",
  "SubagentStart",
  "PostToolUse",
]);

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function hookOutput(eventName) {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: REMINDER_TEXT,
    },
  })}\n`;
}

async function main() {
  try {
    const event = JSON.parse(await readStdin());
    if (!SUPPORTED_EVENTS.has(event.hook_event_name)) return;
    const file = sessionFile(event);
    const outcome = decide(event, readSessionState(file));
    writeSessionState(file, { ...outcome.state, updatedAt: Date.now() });
    if (outcome.inject) process.stdout.write(hookOutput(event.hook_event_name));
  } catch (error) {
    process.stderr.write(`reasoning-poison hook: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}

await main();
