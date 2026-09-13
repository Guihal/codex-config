import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { errorMessage, RuleParseError } from "./errors.mjs";
import { parseRule } from "./rule-parser.mjs";

export const DISTRIBUTION_DEFAULT = Object.freeze({ minStep: 3, maxStep: 15 });

export function loadRules(directory, onError = () => {}) {
  let files;
  try {
    files = readdirSync(directory).filter((file) => file.endsWith(".json")).sort();
  } catch (error) {
    onError(new RuleParseError(directory, `read-directory: ${errorMessage(error)}`, { cause: error }));
    return [];
  }
  const rules = [];
  const names = new Set();
  for (const file of files) {
    try {
      const parsed = parseRule(JSON.parse(readFileSync(join(directory, file), "utf8")), file);
      if (names.has(parsed.name)) throw new RuleParseError(file, "duplicate-name");
      names.add(parsed.name);
      rules.push(parsed);
    } catch (error) {
      const reason = error instanceof SyntaxError ? `invalid-json: ${error.message}` : errorMessage(error);
      onError(error instanceof RuleParseError ? error : new RuleParseError(file, reason, { cause: error }));
    }
  }
  return rules.sort((left, right) => left.name.localeCompare(right.name, "en"));
}

export function loadDistribution(path, onWarning = () => {}) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") onWarning(`[injection-rules] invalid distribution: ${errorMessage(error)}`);
    return { ...DISTRIBUTION_DEFAULT };
  }
  const minStep = value?.min_step ?? value?.minStep;
  const maxStep = value?.max_step ?? value?.maxStep;
  if (!Number.isInteger(minStep) || minStep < 1 || !Number.isInteger(maxStep) || maxStep < minStep) {
    onWarning("[injection-rules] invalid distribution bounds; using default");
    return { ...DISTRIBUTION_DEFAULT };
  }
  return { minStep, maxStep };
}
