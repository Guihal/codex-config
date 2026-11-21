import { initialState } from "./state.mjs";
import {
  loadCatalogue,
  catalogueDigest,
  catalogueState,
  nextPendingRule,
  reminderText,
  resolveCatalogueDir,
} from "./catalogue.mjs";

const DEFAULT_INTERVAL = 5;
const INTENT_INTERVAL = 13;
// Spec: PS-2 (../README.md#project-sources-contract).
const SOURCES_INTERVAL = 17;
const DEFAULT_LARGE_OUTPUT_BYTES = 8192;
// Codex truncates an injected hook context to a few kilobytes and keeps the
// head and the tail of it. The pinned payloads already take about 4.8 KB, so
// the catalogue part of one injection has to stay well below the limit.
const DEFAULT_CATALOGUE_BUDGET = 3000;

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

// Spec: PS-6 (../README.md#standing-rules-catalogue).
// Each catalogue rule owns an independent counter, so a rule fires on its own
// cadence and never inherits or resets another rule's schedule.
export function advanceRuleCounters(rules, counters) {
  const next = { ...counters };
  const due = [];
  for (const rule of rules) {
    // Input-only rules have no tool cadence; null must not coerce to zero.
    if (!Number.isInteger(rule.everyNTools) || rule.everyNTools < 1) continue;
    const counter = (Number.isInteger(next[rule.name]) ? next[rule.name] : 0) + 1;
    if (counter >= rule.everyNTools) {
      due.push(rule);
      next[rule.name] = 0;
    } else {
      next[rule.name] = counter;
    }
  }
  return { counters: next, due };
}

function startOutcome(state, rules, environment) {
  return {
    state: {
      ...state,
      completedCalls: 0,
      intentCompletedCalls: 0,
      sourcesCompletedCalls: 0,
      ruleCompletedCalls: catalogueState(rules),
      ruleBodiesDelivered: [],
      injectedTotal: state.injectedTotal + 1,
    },
    inject: true,
    injectIntent: true,
    injectSources: true,
    catalogueDigest: catalogueDigest(rules, resolveCatalogueDir(environment)),
    ruleTexts: [],
    ruleBody: null,
  };
}

export function decide(event, current, environment = process.env) {
  const state = current ?? initialState();
  const fresh = current === null;
  const next = { ...state };
  // The catalogue is read outside the session lock by the caller and handed
  // over with the event, so the locked section stays a short state update.
  const { rules, problems } = event.__standingRules ?? loadCatalogue(environment);

  // Spec: PS-6 (../README.md#standing-rules-catalogue).
  if (
    event.hook_event_name === "SessionStart" ||
    event.hook_event_name === "SubagentStart" ||
    fresh
  ) {
    return { ...startOutcome(next, rules, environment), problems };
  }

  if (event.hook_event_name === "UserPromptSubmit") {
    // Spec: PS-6 (../README.md#standing-rules-catalogue).
    // mcode sent every_input rules on every user message; Codex exposes the
    // same trigger as the UserPromptSubmit hook.
    const ruleTexts = rules.filter((rule) => rule.everyInput).map((rule) => reminderText(rule));
    return {
      state: next,
      inject: false,
      injectIntent: false,
      injectSources: false,
      catalogueDigest: "",
      ruleTexts,
      ruleBody: null,
      problems,
    };
  }

  if (event.hook_event_name !== "PostToolUse") {
    return {
      state: next,
      inject: false,
      injectIntent: false,
      injectSources: false,
      catalogueDigest: "",
      ruleTexts: [],
      ruleBody: null,
      problems,
    };
  }

  next.completedCalls += 1;
  next.intentCompletedCalls += 1;
  const injectIntent = next.intentCompletedCalls >= INTENT_INTERVAL;
  if (injectIntent) next.intentCompletedCalls = 0;
  next.sourcesCompletedCalls += 1;
  const injectSources = next.sourcesCompletedCalls >= SOURCES_INTERVAL;
  if (injectSources) next.sourcesCompletedCalls = 0;

  // Spec: PS-6 (../README.md#standing-rules-catalogue).
  const counters = Object.hasOwn(next, "ruleCompletedCalls") ? next.ruleCompletedCalls : {};
  const advanced = advanceRuleCounters(rules, counters);
  next.ruleCompletedCalls = advanced.counters;
  const ruleTexts = advanced.due.map((rule) => reminderText(rule));

  // One rule contract per tool call, each rule once per session. The full
  // contract is too large to share one injection with the pinned payloads, so
  // it arrives turn by turn; repeating it would grow the context without
  // adding anything.
  const budget = positiveInteger(
    environment.CODEX_STANDING_RULES_BUDGET,
    DEFAULT_CATALOGUE_BUDGET,
  );
  const suffixChars = ruleTexts.reduce((total, text) => total + text.length, 0);
  const delivered = Array.isArray(next.ruleBodiesDelivered) ? next.ruleBodiesDelivered : [];
  const deliveredByCadence = advanced.due.filter((rule) => rule.sendFullRule).map((rule) => rule.name);
  const known = [...new Set([...delivered, ...deliveredByCadence])];
  const pending = nextPendingRule(rules, known);
  let ruleBody = null;
  if (pending !== null && suffixChars + pending.body.length <= budget) {
    ruleBody = pending.body;
    next.ruleBodiesDelivered = [...known, pending.name];
  } else {
    next.ruleBodiesDelivered = known;
  }

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
      catalogueDigest: "",
      ruleTexts,
      ruleBody,
      problems,
    };
  }
  return {
    state: next,
    inject: false,
    injectIntent,
    injectSources,
    catalogueDigest: "",
    ruleTexts,
    ruleBody,
    problems,
  };
}
