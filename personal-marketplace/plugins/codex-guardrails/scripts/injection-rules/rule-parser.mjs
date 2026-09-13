import {
  RECENT_WINDOW_DEFAULT,
  RULE_FIELDS,
  WINDOW_HARD_CAP,
  normalizeAgentId,
} from "./constants.mjs";
import { RuleParseError } from "./errors.mjs";
import { parseRemind } from "./remind-parser.mjs";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseApply(value, file) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
    throw new RuleParseError(file, "apply-not-nonempty-string-array");
  }
  let wildcard = false;
  const includes = new Set();
  const excludes = new Set();
  for (const raw of value) {
    const entry = raw.trim();
    if (!entry) throw new RuleParseError(file, "apply-entry-empty");
    if (entry === "*") wildcard = true;
    else if (entry.startsWith("!")) {
      if (entry === "!") throw new RuleParseError(file, "apply-entry-bang-empty");
      excludes.add(normalizeAgentId(entry.slice(1)));
    } else includes.add(normalizeAgentId(entry));
  }
  if (!wildcard && includes.size === 0) {
    throw new RuleParseError(file, "apply-no-positive-entry");
  }
  return { wildcard, includes, excludes };
}

function parseWindow(value, file) {
  if (value === undefined || value === null) return RECENT_WINDOW_DEFAULT;
  if (!Number.isInteger(value) || value < 1) {
    throw new RuleParseError(file, "window-invalid");
  }
  if (value > WINDOW_HARD_CAP) throw new RuleParseError(file, "window-too-large");
  return value;
}

export function parseRule(value, file = "<input>") {
  if (!isObject(value)) throw new RuleParseError(file, "root-not-object");
  if (Object.keys(value).some((key) => !key.startsWith("_") && !RULE_FIELDS.has(key))) {
    throw new RuleParseError(file, "unknown-field");
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new RuleParseError(file, "name-not-string");
  }
  if (typeof value.body !== "string") throw new RuleParseError(file, "body-not-string");
  if (value.send_on_start !== undefined && typeof value.send_on_start !== "boolean") {
    throw new RuleParseError(file, "send-on-start-not-boolean");
  }
  const apply = parseApply(value.apply, file);
  const remind = parseRemind(value.remind, file);
  const rule = {
    name: value.name.trim(), body: value.body, ...apply, ...remind,
    windowSize: parseWindow(value.window, file),
    source: remind.source ?? "any",
    cooldownTurns: remind.cooldownTurns ?? 0,
    hintMode: remind.hintMode ?? "inject_only",
    onUserEnd: remind.onUserEnd ?? false,
    everyInput: remind.everyInput ?? false,
    sendOnStart: value.send_on_start !== false,
  };
  if (rule.onUserEnd && !matchesRule(rule, "main")) {
    throw new RuleParseError(file, "on-user-end-requires-main");
  }
  return rule;
}

export function matchesRule(rule, agentId) {
  const normalized = normalizeAgentId(agentId);
  if (rule.excludes.has(normalized)) return false;
  return rule.wildcard || rule.includes.has(normalized);
}

export function hasSemanticTrigger(rule) {
  return [rule.any, rule.all, rule.none].some((items) => items?.length);
}

export function semanticHit(rule, texts) {
  if (rule.any?.length && !rule.any.some((match) => texts.some(match))) return false;
  if (rule.all?.length && !rule.all.every((match) => texts.some(match))) return false;
  if (rule.none?.length && rule.none.some((match) => texts.some(match))) return false;
  return hasSemanticTrigger(rule);
}
