import { initialState } from "./state.mjs";

const DEFAULT_INTERVAL = 5;
const DEFAULT_LARGE_OUTPUT_BYTES = 8192;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function serializedResponse(event) {
  if (event.tool_response === undefined || event.tool_response === null) {
    return null;
  }
  try {
    return JSON.stringify(event.tool_response);
  } catch {
    return null;
  }
}

function isLargeResponse(event, environment) {
  const response = serializedResponse(event);
  if (response === null) return false;
  const threshold = positiveInteger(
    environment.CODEX_REASONING_POISON_LARGE_OUTPUT_BYTES,
    DEFAULT_LARGE_OUTPUT_BYTES,
  );
  return Buffer.byteLength(response, "utf8") >= threshold;
}

export function decide(event, current, environment = process.env) {
  const state = current ?? initialState();
  const fresh = current === null;
  const next = { ...state };

  if (
    event.hook_event_name === "SessionStart" ||
    event.hook_event_name === "SubagentStart"
  ) {
    return {
      state: {
        ...next,
        completedCalls: 0,
        injectedTotal: next.injectedTotal + 1,
      },
      inject: true,
    };
  }

  if (event.hook_event_name !== "PostToolUse") {
    return { state: next, inject: false };
  }

  if (fresh) {
    return {
      state: {
        ...next,
        completedCalls: 0,
        injectedTotal: next.injectedTotal + 1,
      },
      inject: true,
    };
  }

  next.completedCalls += 1;
  const interval = positiveInteger(
    environment.CODEX_REASONING_POISON_INTERVAL,
    DEFAULT_INTERVAL,
  );
  if (next.completedCalls >= interval || isLargeResponse(event, environment)) {
    return {
      state: {
        ...next,
        completedCalls: 0,
        injectedTotal: next.injectedTotal + 1,
      },
      inject: true,
    };
  }
  return { state: next, inject: false };
}
