import {
  REMIND_FIELDS,
  VALID_SOURCES,
  WHEN_FIELDS,
} from "./constants.mjs";
import { RuleParseError } from "./errors.mjs";
import { compilePatterns, normalizeHintMode } from "./patterns.mjs";

function hasOnlyFields(value, allowed) {
  return Object.keys(value).every((key) => key.startsWith("_") || allowed.has(key));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePositiveInteger(value, reason, file) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RuleParseError(file, reason);
  }
  return value;
}

function parseWhen(value, file) {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new RuleParseError(file, "remind-when-not-object");
  if (!hasOnlyFields(value, WHEN_FIELDS)) {
    throw new RuleParseError(file, "unknown-remind-when-field");
  }
  const parsed = {};
  for (const key of ["any", "all", "none"]) {
    if (value[key] !== undefined && value[key] !== null) {
      parsed[key] = compilePatterns(value[key], `remind-when-${key}`, file);
    }
  }
  if (value.source !== undefined && value.source !== null) {
    if (typeof value.source !== "string" || !VALID_SOURCES.has(value.source)) {
      throw new RuleParseError(file, "remind-when-source-invalid");
    }
    parsed.source = value.source;
  }
  if (value.cooldown_turns !== undefined && value.cooldown_turns !== null) {
    if (!Number.isInteger(value.cooldown_turns) || value.cooldown_turns < 0) {
      throw new RuleParseError(file, "remind-when-cooldown-invalid");
    }
    parsed.cooldownTurns = value.cooldown_turns;
  }
  if (value.hint !== undefined && value.hint !== null) {
    parsed.hintMode = normalizeHintMode(value.hint, file);
  }
  return parsed;
}

export function parseRemind(value, file) {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new RuleParseError(file, "remind-not-object");
  if (!hasOnlyFields(value, REMIND_FIELDS)) {
    throw new RuleParseError(file, "unknown-remind-field");
  }
  const parsed = parseWhen(value.when, file);
  if (value.every_n_turns !== undefined && value.every_n_turns !== null) {
    parsed.every = parsePositiveInteger(value.every_n_turns, "remind-every-invalid", file);
  }
  if (value.priority !== undefined && value.priority !== null) {
    parsed.priority = parsePositiveInteger(value.priority, "remind-priority-invalid", file);
  }
  if (value.suffix !== undefined && value.suffix !== null) {
    if (typeof value.suffix !== "string") {
      throw new RuleParseError(file, "remind-suffix-not-string");
    }
    parsed.suffix = value.suffix;
  }
  for (const [input, output] of [["on_user_end", "onUserEnd"], ["every_input", "everyInput"]]) {
    if (value[input] !== undefined && value[input] !== null) {
      if (typeof value[input] !== "boolean") {
        throw new RuleParseError(file, `remind-${input.replaceAll("_", "-")}-not-boolean`);
      }
      parsed[output] = value[input];
    }
  }
  if (parsed.everyInput && !parsed.onUserEnd) {
    throw new RuleParseError(file, "every-input-requires-on-user-end");
  }
  const hasSemantic = [parsed.any, parsed.all, parsed.none].some((items) => items?.length);
  if (!parsed.every && !parsed.priority && !parsed.everyInput && !hasSemantic) {
    throw new RuleParseError(file, "remind-needs-trigger");
  }
  return parsed;
}
