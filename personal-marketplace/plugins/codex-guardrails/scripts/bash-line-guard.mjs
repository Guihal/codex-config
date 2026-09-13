#!/usr/bin/env node

const MAX_LINES = 20;

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function deny(lines) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Автоматическая защита: команда из ${lines} строк (лимит ${MAX_LINES}). ` +
        "Запишите её в файл и выполните через bash < файл.",
    },
  };
}

try {
  const raw = await readStdin();
  const event = JSON.parse(raw);

  if (
    event?.hook_event_name !== "PreToolUse" ||
    event?.tool_name !== "Bash" ||
    typeof event?.tool_input?.command !== "string"
  ) {
    process.exit(0);
  }

  const lines = event.tool_input.command.split("\n").length;
  if (lines > MAX_LINES) {
    process.stdout.write(`${JSON.stringify(deny(lines))}\n`);
  }
} catch {
  // A guardrail must not disable Bash because Codex supplied malformed input.
}
