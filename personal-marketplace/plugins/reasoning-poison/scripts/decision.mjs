import { initialState } from "./state.mjs";

const DEFAULT_INTERVAL = 5;
const INTENT_INTERVAL = 13;
// Spec: PS-2 (../README.md#project-sources-contract).
const SOURCES_INTERVAL = 17;
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

  // Spec: PS-4 (../README.md#project-sources-contract).
  if (
    event.hook_event_name === "SessionStart" ||
    event.hook_event_name === "SubagentStart"
  ) {
    return {
      state: {
        ...next,
        completedCalls: 0,
        intentCompletedCalls: 0,
        sourcesCompletedCalls: 0,
        injectedTotal: next.injectedTotal + 1,
      },
      inject: true,
      injectIntent: true,
      injectSources: true,
    };
  }

  if (event.hook_event_name !== "PostToolUse") {
    return { state: next, inject: false, injectIntent: false, injectSources: false };
  }

  if (fresh) {
    return {
      state: {
        ...next,
        completedCalls: 0,
        intentCompletedCalls: 0,
        sourcesCompletedCalls: 0,
        injectedTotal: next.injectedTotal + 1,
      },
      inject: true,
      injectIntent: true,
      injectSources: true,
    };
  }

  next.completedCalls += 1;
  next.intentCompletedCalls += 1;
  const injectIntent = next.intentCompletedCalls >= INTENT_INTERVAL;
  if (injectIntent) next.intentCompletedCalls = 0;
  next.sourcesCompletedCalls += 1;
  const injectSources = next.sourcesCompletedCalls >= SOURCES_INTERVAL;
  if (injectSources) next.sourcesCompletedCalls = 0;
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
      injectIntent,
      injectSources,
    };
  }
  return { state: next, inject: false, injectIntent, injectSources };
}
