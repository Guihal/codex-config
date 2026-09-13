#!/usr/bin/env node

import { createBootstrap, matchesBootstrap } from "./bootstrap-state.mjs";
import { MAX_TASK_BYTES } from "./control-task-tool.mjs";

export const SUBAGENT_BOOTSTRAP_MARKER =
  "<!-- codex-control-task:subagent-bootstrap:v1 -->";
const BODY_PREFIX = `${SUBAGENT_BOOTSTRAP_MARKER}\n\n## ACTIVE TASK — SUBAGENT BOOTSTRAP\n\n`;
const TOKEN_PREFIX = "\n\nBootstrap token: ";
const INSTRUCTIONS = [
  "Before substantial work, call control_task_adopt exactly once.",
  "Use the base token from the injected ACTIVE TASK — NOT SET developer block.",
  "Pass the bootstrap token written above. Do not copy or summarize the task into tool arguments.",
  "After the tool commits, perform the original task normally.",
].join("\n");

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function bootstrapMessage(taskBody, bootstrapToken) {
  return `${BODY_PREFIX}${taskBody}${TOKEN_PREFIX}${bootstrapToken}\n\n${INSTRUCTIONS}`;
}

function isActiveBootstrap(message) {
  if (!message.startsWith(BODY_PREFIX)) return false;
  const tokenOffset = message.lastIndexOf(TOKEN_PREFIX);
  if (tokenOffset < BODY_PREFIX.length) return false;
  const tokenStart = tokenOffset + TOKEN_PREFIX.length;
  const tokenEnd = message.indexOf("\n", tokenStart);
  if (tokenEnd < 0 || message.slice(tokenEnd + 2) !== INSTRUCTIONS)
    return false;
  const token = message.slice(tokenStart, tokenEnd);
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return false;
  const taskBody = message.slice(BODY_PREFIX.length, tokenOffset);
  return matchesBootstrap(token, taskBody);
}

function output(updatedInput) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput,
      },
    })}\n`,
  );
}

function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
}

async function main() {
  try {
    const event = JSON.parse(await readStdin());
    if (event?.hook_event_name !== "PreToolUse") return;
    const toolInput = event.tool_input;
    if (
      !toolInput ||
      typeof toolInput !== "object" ||
      Array.isArray(toolInput)
    ) {
      throw new Error("Agent tool_input must be an object");
    }
    if (typeof toolInput.message !== "string" || !toolInput.message.trim()) {
      throw new Error("Agent message must not be empty");
    }
    if (isActiveBootstrap(toolInput.message)) return;
    if (Buffer.byteLength(toolInput.message, "utf8") > MAX_TASK_BYTES) {
      deny(
        `Agent message exceeds the control-task limit of ${MAX_TASK_BYTES} bytes`,
      );
      return;
    }
    const bootstrapToken = createBootstrap(toolInput.message);
    output({
      ...toolInput,
      message: bootstrapMessage(toolInput.message, bootstrapToken),
    });
  } catch (error) {
    process.stderr.write(
      `control-task subagent bootstrap: ${error.stack ?? error}\n`,
    );
    deny("Could not capture the subagent task; spawn blocked");
  }
}

await main();
