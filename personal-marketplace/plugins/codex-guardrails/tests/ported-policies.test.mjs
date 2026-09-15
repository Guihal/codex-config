import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchesRule, parseRule } from "../scripts/injection-rules/rule-parser.mjs";

function load(name) {
  return JSON.parse(readFileSync(new URL(`../rules/${name}.json`, import.meta.url), "utf8"));
}

test("correction policy parses in the existing engine and covers workers and reviewers", () => {
  const rule = parseRule(load("user-correction-rebase"));
  for (const actor of ["main", "worker", "critic", "architect", "auditor"]) {
    assert.equal(matchesRule(rule, actor), true, actor);
  }
  assert.equal(rule.sendOnStart, true);
  assert.equal(rule.everyInput, false);
  assert.equal(rule.every, undefined);
});

test("correction policy preserves compatible requirements and separates durable state", () => {
  const { body } = load("user-correction-rebase");
  assert.match(body, /сохрани все совместимые прежние требования/);
  assert.match(body, /реально зависящие от исправленного факта/);
  assert.match(body, /сами по себе не отменяют требований/);
  assert.match(body, /не переписывают durable task anchor/);
});

test("verification policy keeps its existing actor scope and reminder cadence", () => {
  const rule = parseRule(load("verify-before-done"));
  assert.equal(matchesRule(rule, "main"), true);
  assert.equal(matchesRule(rule, "auditor"), false);
  assert.equal(rule.every, 12);
  assert.equal(rule.everyInput, false);
});

test("anti-gaming policy retains the exception for proven wrong or superseded tests", () => {
  const { body } = load("verify-before-done");
  assert.match(body, /не удаляй упавшие assert/);
  assert.match(body, /не замокивай проверяемый реальный путь/);
  assert.match(body, /доказанно неверном тесте либо явно изменённом пользователем требовании/);
  assert.match(body, /укажи отдельно в отчёте/);
});

test("the existing parser still rejects unported Pi-only schema fields", () => {
  assert.throws(() => parseRule({ ...load("user-correction-rebase"), send_on_subagent: true }), /unknown-field/);
});