#!/usr/bin/env node

import { decide } from "./decision.mjs";
import { fileURLToPath } from "node:url";
import { REMINDER_TEXT, USER_INTENT_REMINDER_TEXT, PROJECT_SOURCES_REMINDER_TEXT } from "./reminder-text.mjs";
import { loadCatalogue } from "./catalogue.mjs";
import { readSessionState, runLockedHook, sessionFile, writeSessionState } from "./state.mjs";

const SUPPORTED_EVENTS = new Set([
  "SessionStart",
  "SubagentStart",
  "UserPromptSubmit",
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
  // Spec: PS-6 (../README.md#standing-rules-catalogue).
  if (outcome.catalogueDigest) blocks.push(outcome.catalogueDigest);
  if (outcome.ruleTexts?.length) blocks.push(outcome.ruleTexts.join("\n"));
  if (outcome.ruleBody) blocks.push(outcome.ruleBody);
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
    // The catalogue is read here, outside the session lock: the locked section
    // stays a short state update even when many calls arrive at once.
    const childInput = JSON.stringify({ ...event, __standingRules: loadCatalogue() });
    if (process.argv[2] !== "--state-locked") {
      process.stdout.write(runLockedHook(file, fileURLToPath(import.meta.url), childInput));
      return;
    }
    const outcome = decide(event, readSessionState(file));
    writeSessionState(file, { ...outcome.state, updatedAt: Date.now() });
    // Spec: PS-6 (../README.md#standing-rules-catalogue).
    // A broken rule file must not break delivery, but it must stay visible.
    for (const problem of outcome.problems ?? []) {
      process.stderr.write(`reasoning-poison catalogue: ${problem}\n`);
    }
    const hasContent =
      outcome.inject ||
      outcome.injectIntent ||
      outcome.injectSources ||
      Boolean(outcome.catalogueDigest) ||
      (outcome.ruleTexts?.length ?? 0) > 0 ||
      Boolean(outcome.ruleBody);
    if (hasContent) {
      process.stdout.write(hookOutput(event.hook_event_name, outcome));
    }
  } catch (error) {
    process.stderr.write(`reasoning-poison hook: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}

await main();
