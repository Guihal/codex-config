import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Spec: PS-6 (../README.md#standing-rules-catalogue).

export function resolveCatalogueDir(environment = process.env) {
  if (environment.CODEX_STANDING_RULES_DIR) {
    return path.resolve(environment.CODEX_STANDING_RULES_DIR);
  }
  return path.join(os.homedir(), ".codex", "standing-rules");
}

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A malformed rule file must never break delivery of the remaining rules, but
// it must not disappear silently either: the caller reports every problem.
export function loadCatalogue(environment = process.env) {
  const directory = resolveCatalogueDir(environment);
  const rules = [];
  const problems = [];

  let files;
  try {
    files = fs.readdirSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return { rules, problems };
    problems.push(
      `catalogue directory ${directory} is unreadable: ${error?.code ?? error}`,
    );
    return { rules, problems };
  }

  for (const file of files.filter((entry) => entry.endsWith(".json")).sort()) {
    const full = path.join(directory, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (error) {
      problems.push(`${file}: invalid JSON (${error?.message ?? error})`);
      continue;
    }
    const name = typeof parsed?.name === "string" ? parsed.name : "";
    const body = typeof parsed?.body === "string" ? parsed.body : "";
    const cadence =
      parsed?.remind?.every_n_tools ?? parsed?.remind?.every_n_turns;
    const suffix = parsed?.remind?.suffix;
    const everyInput = parsed?.remind?.every_input === true;
    const sendFullRule = parsed?.remind?.send_full_rule === true;
    if (!name || !body.trim()) {
      problems.push(`${file}: missing name or body`);
      continue;
    }
    if (!Number.isInteger(cadence) || cadence < 1) {
      if (!everyInput) {
        problems.push(
          `${file}: remind.every_n_tools must be a positive integer`,
        );
        continue;
      }
    }
    if (!sendFullRule && (typeof suffix !== "string" || !suffix.trim())) {
      problems.push(
        `${file}: remind.suffix must be a non-empty string unless send_full_rule is set`,
      );
      continue;
    }
    rules.push({
      name,
      title: extractTitle(body),
      file,
      body,
      everyNTools: Number.isInteger(cadence) ? cadence : null,
      everyInput,
      sendFullRule,
      suffix: typeof suffix === "string" ? suffix : "",
    });
  }

  return { rules, problems };
}

// The first line of a rule body carries its title in the form
// "[rule-name] Title"; the title is what the digest line shows.
function extractTitle(body) {
  const firstLine = body.split("\n", 1)[0].trim();
  return firstLine.replace(/^\[[^\]]+\]\s*/, "").trim() || firstLine;
}

// The digest must name the rule and its purpose in one line: the agent reads
// the full contract from the file when the rule becomes relevant.
export function summarize(rule, maxLength = 110) {
  const section = /(?:Desired behavior|Желаемое поведение)\n([^\n]+)/.exec(
    rule.body,
  );
  const purpose = section ? section[1].trim() : rule.title;
  const firstSentence = purpose.split(/(?<=\.)\s+/)[0] ?? purpose;
  const text =
    firstSentence.length > maxLength
      ? `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`
      : firstSentence;
  return text;
}

export function catalogueDigest(rules, directory) {
  if (rules.length === 0) return "";
  const lines = [
    `[Каталог правил Codex] Поведенческие правила, перенесённые из omo. Полный контракт правила лежит в файле ${directory}/<имя-правила>.json; читай его, когда правило стало релевантным.`,
  ];
  for (const rule of rules) {
    lines.push(`- ${rule.name}: ${summarize(rule, 90)}`);
  }
  return lines.join("\n");
}

// The reminder text of a rule: its full body when the rule asks for it,
// otherwise the compressed contract.
export function reminderText(rule) {
  return rule.sendFullRule ? rule.body : rule.suffix.trim();
}

export function catalogueBodies(rules) {
  return rules.map((rule) => rule.body);
}

// Codex truncates an injected hook context to a few kilobytes and keeps the
// head and the tail of it. A rule body therefore cannot be dumped in one
// block: the bodies are delivered one per tool call, each rule once per
// session, so the context cost stays bounded.
export function nextPendingRule(rules, delivered) {
  const seen = Array.isArray(delivered) ? delivered : [];
  for (const rule of rules) {
    if (!seen.includes(rule.name)) return rule;
  }
  return null;
}

export function catalogueState(rules) {
  const counters = {};
  for (const rule of rules) counters[rule.name] = 0;
  return counters;
}

export function normalizeRuleCounters(value, rules) {
  if (!isPlainObject(value)) return null;
  const counters = {};
  for (const rule of rules) {
    const counter = Object.hasOwn(value, rule.name) ? value[rule.name] : 0;
    if (!Number.isInteger(counter) || counter < 0) return null;
    counters[rule.name] = counter;
  }
  return counters;
}
