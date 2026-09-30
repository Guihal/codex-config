#!/usr/bin/env node

import { decide } from "./decision.mjs";
import { fileURLToPath } from "node:url";
import { REMINDER_TEXT, USER_INTENT_REMINDER_TEXT, PROJECT_SOURCES_REMINDER_TEXT } from "./reminder-text.mjs";
import { readSessionState, runLockedHook, sessionFile, writeSessionState } from "./state.mjs";

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

function hookOutput(eventName, outcome) {
  const blocks = [];
  if (outcome.inject) blocks.push(REMINDER_TEXT);
  if (outcome.injectIntent) blocks.push(USER_INTENT_REMINDER_TEXT);
  if (outcome.injectSources) blocks.push(PROJECT_SOURCES_REMINDER_TEXT);
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: blocks.join("\n"),
    },
  })}\n`;
}

async function main() {
  try {
    const input = await readStdin();
    const event = JSON.parse(input);
    if (!SUPPORTED_EVENTS.has(event.hook_event_name)) return;
    const file = sessionFile(event);
    if (process.argv[2] !== "--state-locked") {
      process.stdout.write(runLockedHook(file, fileURLToPath(import.meta.url), input));
      return;
    }
    const outcome = decide(event, readSessionState(file));
    writeSessionState(file, { ...outcome.state, updatedAt: Date.now() });
    if (outcome.inject || outcome.injectIntent || outcome.injectSources) {
      process.stdout.write(hookOutput(event.hook_event_name, outcome));
    }
  } catch (error) {
    process.stderr.write(`reasoning-poison hook: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}

await main();
