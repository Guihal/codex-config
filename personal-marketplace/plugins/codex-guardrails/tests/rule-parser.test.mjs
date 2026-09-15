import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { distributeCadences } from "../scripts/injection-rules/cadence.mjs";
import { parseRule, matchesRule, semanticHit } from "../scripts/injection-rules/rule-parser.mjs";
import { loadDistribution, loadRules } from "../scripts/injection-rules/rules-loader.mjs";

const RULES_DIR = new URL("../rules", import.meta.url).pathname;
const DISTRIBUTION_PATH = new URL("../rule-distribution.json", import.meta.url).pathname;

test("full Pi schema parses and exclusions win", () => {
  const rule = parseRule({
    name: "full", apply: ["*", "!critic"], body: "body", window: 4, send_on_start: false,
    remind: {
      priority: 8, suffix: "suffix", on_user_end: true, every_input: true,
      when: { any: ["needle"], all: ["/foo/i"], none: ["blocked"], source: "user_only", cooldown_turns: 3, hint: "notify_and_inject" },
    },
  });
  assert.equal(matchesRule(rule, "main"), true);
  assert.equal(matchesRule(rule, "critic"), false);
  assert.equal(rule.windowSize, 4);
  assert.equal(rule.sendOnStart, false);
  assert.equal(rule.everyInput, true);
  assert.equal(semanticHit(rule, ["Needle FOO"]), true);
  assert.equal(semanticHit(rule, ["needle foo blocked"]), false);
});

test("legacy hint modes map to canonical modes", () => {
  const make = (hint) => parseRule({ name: String(hint), apply: ["*"], body: "x", remind: { when: { any: ["x"], hint } } });
  assert.equal(make(true).hintMode, "notify_and_inject");
  assert.equal(make(false).hintMode, "inject_only");
  assert.equal(make("only").hintMode, "notify_only");
});

test("strict parser rejects every malformed schema branch", () => {
  const invalid = [
    null,
    { name: "x", apply: ["*"], body: "x", extra: true },
    { name: "x", apply: ["!critic"], body: "x" },
    { name: "x", apply: ["*"], body: "x", window: 0 },
    { name: "x", apply: ["*"], body: "x", send_on_start: 1 },
    { name: "x", apply: ["*"], body: "x", remind: {} },
    { name: "x", apply: ["*"], body: "x", remind: { every_input: true } },
    { name: "x", apply: ["!main", "critic"], body: "x", remind: { on_user_end: true, every_n_turns: 2 } },
    { name: "x", apply: ["*"], body: "x", remind: { when: { any: ["/[/"] } } },
  ];
  for (const value of invalid) assert.throws(() => parseRule(value), { name: "RuleParseError" });
});

test("loader keeps valid peers and rejects duplicate names", () => {
  const directory = mkdtempSync(join(tmpdir(), "guardrail-rules-"));
  writeFileSync(join(directory, "a.json"), JSON.stringify({ name: "same", apply: ["*"], body: "first" }));
  writeFileSync(join(directory, "b.json"), JSON.stringify({ name: "same", apply: ["*"], body: "second" }));
  writeFileSync(join(directory, "bad.json"), "{");
  const errors = [];
  const rules = loadRules(directory, (error) => errors.push(error));
  assert.equal(rules.length, 1);
  assert.equal(rules[0].body, "first");
  assert.equal(errors.length, 2);
});

test("active catalog has the exact 18-rule inventory and Codex role mappings", () => {
  const rules = loadRules(RULES_DIR);
  assert.deepEqual(rules.map((rule) => rule.name), [
    "a-working-product", "ab-verify-recipes", "accuracy", "agent-orchestration",
    "agents-md-update", "code-file-size", "config-extract", "destructive-confirm",
    "explore-before-edit", "git-hygiene", "incremental-steps", "invariants",
    "layout-skills-hint", "no-unrequested-work", "rule-announce-execute", "task-list",
    "user-correction-rebase", "verify-before-done",
  ]);
  assert.deepEqual(loadDistribution(DISTRIBUTION_PATH), { minStep: 6, maxStep: 52 });
});

test("tracked Codex rules contain no unresolved Claude-only roles", () => {
  const rules = rulesJsonFiles().map((file) => JSON.parse(readFileSync(join(RULES_DIR, file), "utf8")));
  const roles = rules.flatMap((rule) => rule.apply);
  assert.equal(roles.some((role) => /task-worker|intent-auditor|pi-agent/.test(role)), false);
});

test("approved runtime vocabulary adaptations are explicit and policy-preserving", () => {
  const values = Object.fromEntries(rulesJsonFiles().map((file) => [file, JSON.parse(readFileSync(join(RULES_DIR, file), "utf8"))]));
  assert.match(values["agent-orchestration.json"].body, /Задача >2 файлов \/ >1 слоя/);
  assert.match(values["agent-orchestration.json"].body, /spawn_agent/);
  assert.match(values["agent-orchestration.json"].remind.suffix, /spawn_agent/);
  assert.match(values["explore-before-edit.json"].body, /rg \/ rg --files/);
  assert.match(values["explore-before-edit.json"].remind.suffix, /rg \/ rg --files/);
  assert.match(values["task-list.json"].body, /update_plan/);
  assert.match(values["task-list.json"].remind.suffix, /update_plan/);
  assert.match(values["layout-skills-hint.json"].body, /mcp__web_inspector__\*/);
  assert.match(values["layout-skills-hint.json"].remind.suffix, /mcp__web_inspector__\*/);
  assert.match(values["layout-skills-hint.json"].body, /mcp__browser_inspector__browser_inspect/);
  assert.match(values["layout-skills-hint.json"].body, /mcp__swatchdog__check_design_drift/);
  const corpus = JSON.stringify(values);
  assert.doesNotMatch(corpus, /TaskCreate|TaskUpdate|ToolSearch|mcp__web-inspector__/);
});

function rulesJsonFiles() {
  return [
    "a-working-product.json", "ab-verify-recipes.json", "accuracy.json", "agent-orchestration.json",
    "agents-md-update.json", "code-file-size.json", "config-extract.json", "destructive-confirm.json",
    "explore-before-edit.json", "git-hygiene.json", "incremental-steps.json", "invariants.json",
    "layout-skills-hint.json", "no-unrequested-work.json", "rule-announce-execute.json", "task-list.json",
    "user-correction-rebase.json", "verify-before-done.json",
  ];
}

test("priority distribution is deterministic and separates input clocks", () => {
  const make = (name, priority, onUserEnd = false) => ({ name, priority, onUserEnd, everyInput: false });
  const values = distributeCadences([make("b", 1), make("a", 2), make("input", 9, true)], { minStep: 6, maxStep: 12 });
  assert.deepEqual(values, { input: 6, a: 6, b: 7 });
});
