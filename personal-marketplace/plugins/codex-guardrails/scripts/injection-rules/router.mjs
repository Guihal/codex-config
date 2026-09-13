import { DISTRIBUTION_PATH, RULES_DIR, normalizeAgentId } from "./constants.mjs";
import { distributeCadences } from "./cadence.mjs";
import { buildStandingContext, consumePending, recordRecent, tickInput, tickTurn } from "./engine.mjs";
import { buildHookOutput, mergeContext } from "./hook-output.mjs";
import { resolveDataDirectory, transactState } from "./repository.mjs";
import { loadDistribution, loadRules } from "./rules-loader.mjs";
import { createSessionState, ensureActor } from "./state-model.mjs";

const RESET_SOURCES = new Set(["startup", "clear"]);
const PRESERVE_SOURCES = new Set(["resume", "compact"]);

function actorIdentity(event) {
  if (typeof event.agent_id === "string" && event.agent_id) {
    return { key: `agent:${event.agent_id}`, id: normalizeAgentId(event.agent_type || event.agent_id) };
  }
  return { key: "main", id: "main" };
}

function maximumWindow(rules) {
  return Math.max(30, ...rules.map((rule) => rule.windowSize));
}

function serializeToolResponse(response) {
  if (typeof response === "string") return response;
  try { return JSON.stringify(response); } catch { return String(response ?? ""); }
}

function startLifecycle(state, event, rules) {
  if (!RESET_SOURCES.has(event.source) && !PRESERVE_SOURCES.has(event.source)) return null;
  if (RESET_SOURCES.has(event.source)) Object.assign(state, createSessionState());
  const actor = ensureActor(state, "main", "main");
  const pending = consumePending(rules, actor);
  actor.hasStandingContext = true;
  return buildHookOutput("SessionStart", mergeContext(buildStandingContext(rules, actor), pending.reminders), pending.systemMessages);
}

function startSubagent(state, event, rules) {
  const identity = actorIdentity(event);
  if (identity.key === "main") return null;
  const actor = ensureActor(state, identity.key, identity.id);
  const pending = consumePending(rules, actor);
  actor.hasStandingContext = true;
  return buildHookOutput("SubagentStart", mergeContext(buildStandingContext(rules, actor), pending.reminders), pending.systemMessages);
}

function submitPrompt(state, event, rules, cadences, maxWindow) {
  const identity = actorIdentity(event);
  const actor = ensureActor(state, identity.key, identity.id);
  recordRecent(actor, event.prompt, "user", maxWindow);
  if (identity.key === "main") tickInput({ actor, rules, cadences });
  const standing = actor.hasStandingContext ? "" : buildStandingContext(rules, actor);
  const pending = consumePending(rules, actor);
  actor.hasStandingContext = true;
  return buildHookOutput("UserPromptSubmit", mergeContext(standing, pending.reminders), pending.systemMessages);
}

function captureTool(state, event, maxWindow) {
  const identity = actorIdentity(event);
  const actor = ensureActor(state, identity.key, identity.id);
  recordRecent(actor, serializeToolResponse(event.tool_response), "tool", maxWindow);
  return null;
}

function stopTurn(state, event, rules, cadences, maxWindow, debugEvents) {
  const identity = actorIdentity(event);
  const actor = ensureActor(state, identity.key, identity.id);
  recordRecent(actor, event.last_assistant_message, "assistant", maxWindow);
  debugEvents.push(...tickTurn({ actor, rules, cadences }));
  actor.hasStandingContext = false;
  return null;
}

export function routeHook(event, options = {}) {
  const warnings = [];
  const warn = (message) => warnings.push(message);
  const rules = loadRules(options.rulesDirectory ?? RULES_DIR, warn);
  const distribution = loadDistribution(options.distributionPath ?? DISTRIBUTION_PATH, warn);
  const cadences = distributeCadences(rules, distribution, warn);
  const debugEvents = [];
  const handlers = {
    SessionStart: (state) => startLifecycle(state, event, rules),
    SubagentStart: (state) => startSubagent(state, event, rules),
    UserPromptSubmit: (state) => submitPrompt(state, event, rules, cadences, maximumWindow(rules)),
    PostToolUse: (state) => captureTool(state, event, maximumWindow(rules)),
    Stop: (state) => stopTurn(state, event, rules, cadences, maximumWindow(rules), debugEvents),
    SubagentStop: (state) => stopTurn(state, event, rules, cadences, maximumWindow(rules), debugEvents),
  };
  const handler = handlers[event?.hook_event_name];
  if (!handler) return { output: null, warnings };
  const output = transactState({
    sessionId: String(event.session_id ?? "unknown-session"),
    dataDirectory: options.dataDirectory ?? resolveDataDirectory(options.environment),
    mutate: handler,
    debugEvents,
    options: { ...options.repositoryOptions, onWarning: warn },
  });
  return { output, warnings };
}
