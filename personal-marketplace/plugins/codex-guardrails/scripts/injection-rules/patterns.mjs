import { RuleParseError } from "./errors.mjs";

export function compilePattern(raw, context, file) {
  const value = raw.trim();
  if (!value) throw new RuleParseError(file, `${context}-empty`);
  const match = /^\/(.+)\/([gimsuy]*)$/.exec(value);
  if (!match) {
    const needle = value.toLowerCase();
    return (text) => text.toLowerCase().includes(needle);
  }
  try {
    const expression = new RegExp(match[1], match[2]);
    return (text) => {
      expression.lastIndex = 0;
      return expression.test(text);
    };
  } catch (error) {
    throw new RuleParseError(file, `${context}-bad-regex`, { cause: error });
  }
}

export function compilePatterns(value, context, file) {
  if (!Array.isArray(value)) {
    throw new RuleParseError(file, `${context}-not-array`);
  }
  if (value.length === 0) {
    throw new RuleParseError(file, `${context}-empty`);
  }
  if (value.some((item) => typeof item !== "string")) {
    throw new RuleParseError(file, `${context}-not-string-array`);
  }
  return value.map((item) => compilePattern(item, context, file));
}

export function normalizeHintMode(value, file) {
  if (value === true) return "notify_and_inject";
  if (value === false) return "inject_only";
  if (value === "only") return "notify_only";
  if (["inject_only", "notify_only", "notify_and_inject"].includes(value)) {
    return value;
  }
  throw new RuleParseError(file, "remind-when-hint-mode-invalid");
}
