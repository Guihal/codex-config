import assert from "node:assert/strict";
import test from "node:test";
import { buildStandingContext, consumePending, recordRecent, tickInput, tickTurn } from "../scripts/injection-rules/engine.mjs";
import { parseRule } from "../scripts/injection-rules/rule-parser.mjs";
import { createActorState } from "../scripts/injection-rules/state-model.mjs";

const parse = (value) => parseRule({ apply: ["*"], body: `[${value.name}]`, ...value });

test("standing context respects send_on_start and role filters", () => {
  const actor = createActorState("critic");
  const rules = [
    parse({ name: "a", send_on_start: false }),
    parseRule({ name: "b", apply: ["*", "!critic"], body: "[b]" }),
    parse({ name: "c" }),
  ];
  assert.equal(buildStandingContext(rules, actor), "[c]");
});

test("every_input and input cadence deliver on the same prompt", () => {
  const actor = createActorState();
  const rules = [
    parse({ name: "always", remind: { on_user_end: true, every_input: true, suffix: "A" } }),
    parse({ name: "second", remind: { on_user_end: true, every_n_turns: 2, suffix: "B" } }),
  ];
  tickInput({ actor, rules, cadences: {} });
  assert.equal(consumePending(rules, actor).reminders, "A");
  tickInput({ actor, rules, cadences: {} });
  assert.equal(consumePending(rules, actor).reminders, "A\n\nB");
});

test("turn cadence schedules the next entry", () => {
  const actor = createActorState();
  const rule = parse({ name: "cadence", remind: { every_n_turns: 2, suffix: "tick" } });
  assert.deepEqual(tickTurn({ actor, rules: [rule], cadences: {} }), []);
  assert.equal(consumePending([rule], actor).reminders, "");
  tickTurn({ actor, rules: [rule], cadences: {} });
  assert.equal(consumePending([rule], actor).reminders, "tick");
});

test("semantic source, cooldown, and notify modes match Pi behavior", () => {
  const actor = createActorState();
  const rule = parse({
    name: "hint",
    window: 1,
    remind: { suffix: "inspect", when: { any: ["layout"], source: "user_only", cooldown_turns: 2, hint: "notify_only" } },
  });
  recordRecent(actor, "layout", "tool", 30);
  assert.equal(tickTurn({ actor, rules: [rule], cadences: {} }).length, 0);
  recordRecent(actor, "layout", "user", 30);
  assert.equal(tickTurn({ actor, rules: [rule], cadences: {} }).length, 1);
  assert.deepEqual(consumePending([rule], actor), { reminders: "inspect", systemMessages: ["hint: inspect"] });
  assert.equal(tickTurn({ actor, rules: [rule], cadences: {} }).length, 0);
  assert.equal(tickTurn({ actor, rules: [rule], cadences: {} }).length, 1);
});

test("recent buffers are capped independently by source", () => {
  const actor = createActorState();
  for (const text of ["u1", "u2", "u3"]) recordRecent(actor, text, "user", 2);
  for (const text of ["t1", "t2", "t3"]) recordRecent(actor, text, "tool", 2);
  assert.deepEqual(actor.recentEntries.map((entry) => entry.text), ["u2", "u3", "t2", "t3"]);
});
