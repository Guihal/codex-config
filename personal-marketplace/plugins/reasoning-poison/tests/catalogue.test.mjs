import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";

import {
  REMINDER_TEXT,
  USER_INTENT_REMINDER_TEXT,
  PROJECT_SOURCES_REMINDER_TEXT,
} from "../scripts/reminder-text.mjs";
import {
  loadCatalogue,
  resolveCatalogueDir,
  catalogueDigest,
} from "../scripts/catalogue.mjs";
import { sessionFile } from "../scripts/state.mjs";

// Spec: PS-6 (../README.md#standing-rules-catalogue).

const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(ROOT, "scripts", "reasoning-poison-hook.mjs");
const STATE_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "codex-catalogue-state-"),
);
const CATALOGUE_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "codex-catalogue-rules-"),
);
const CWD = "/catalogue-workspace";

const BODY_A = "[a-rule] Тело A\n\nЖелаемое поведение\nЦель A.";
const BODY_B = "[b-rule] Тело B\n\nЖелаемое поведение\nЦель B.";
const BODY_C = "[c-rule] Тело C\n\nЖелаемое поведение\nЦель C.";

function writeRule(file, name, remind, body) {
  fs.writeFileSync(
    path.join(CATALOGUE_DIR, file),
    JSON.stringify({
      name,
      apply: [],
      send_on_start: true,
      send_on_subagent: true,
      body,
      remind,
    }),
  );
}

writeRule(
  "a-rule.json",
  "a-rule",
  { every_n_tools: 2, suffix: "SUFFIX A" },
  BODY_A,
);
writeRule(
  "b-rule.json",
  "b-rule",
  { every_n_tools: 3, every_input: true, suffix: "SUFFIX B" },
  BODY_B,
);
writeRule(
  "c-rule.json",
  "c-rule",
  { every_n_tools: 4, every_input: true, send_full_rule: true, suffix: "" },
  BODY_C,
);

after(() => {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.rmSync(CATALOGUE_DIR, { recursive: true, force: true });
});

function run(event, environment = {}) {
  return spawnSync(process.execPath, [HOOK], {
    env: {
      ...process.env,
      CODEX_REASONING_POISON_STATE_DIR: STATE_DIR,
      CODEX_STANDING_RULES_DIR: CATALOGUE_DIR,
      ...environment,
    },
    input: JSON.stringify({ cwd: CWD, ...event }),
    encoding: "utf8",
  });
}

function invoke(event, environment = {}) {
  const result = run(event, environment);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function context(output) {
  return output?.hookSpecificOutput?.additionalContext;
}

function start(sessionId, eventName = "SessionStart", agentId) {
  return invoke({
    session_id: sessionId,
    agent_id: agentId,
    hook_event_name: eventName,
    source: "startup",
  });
}

function userInput(sessionId) {
  return invoke({
    session_id: sessionId,
    hook_event_name: "UserPromptSubmit",
    prompt: "продолжай",
  });
}

function tool(sessionId) {
  return invoke({
    session_id: sessionId,
    hook_event_name: "PostToolUse",
    tool_name: "functions.exec",
    tool_response: "ok",
  });
}

function stateOf(sessionId) {
  const file = sessionFile(
    { session_id: sessionId, cwd: CWD },
    { CODEX_REASONING_POISON_STATE_DIR: STATE_DIR },
  );
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("PS-6: the catalogue directory resolves from the environment override", () => {
  assert.equal(
    resolveCatalogueDir({ CODEX_STANDING_RULES_DIR: CATALOGUE_DIR }),
    CATALOGUE_DIR,
  );
  assert.match(resolveCatalogueDir({}), /\.codex\/standing-rules$/);
});

test("PS-6: the loader reads name, title, cadence, trigger, body and suffix of every rule", () => {
  const { rules, problems } = loadCatalogue({
    CODEX_STANDING_RULES_DIR: CATALOGUE_DIR,
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(
    rules.map((rule) => [
      rule.name,
      rule.title,
      rule.everyNTools,
      rule.everyInput,
      rule.sendFullRule,
      rule.suffix,
      rule.file,
    ]),
    [
      ["a-rule", "Тело A", 2, false, false, "SUFFIX A", "a-rule.json"],
      ["b-rule", "Тело B", 3, true, false, "SUFFIX B", "b-rule.json"],
      ["c-rule", "Тело C", 4, true, true, "", "c-rule.json"],
    ],
  );
});

test("PS-6: starts deliver the pinned payloads and the catalogue digest", () => {
  const digest = catalogueDigest(
    loadCatalogue({ CODEX_STANDING_RULES_DIR: CATALOGUE_DIR }).rules,
    CATALOGUE_DIR,
  );
  assert.match(digest, /a-rule: Цель A/);
  assert.match(digest, /b-rule: Цель B/);
  assert.match(digest, /c-rule: Цель C/);
  assert.match(digest, /<имя-правила>\.json/);
  assert.match(digest, /a-rule: Цель A/);
  for (const [eventName, agentId] of [
    ["SessionStart", undefined],
    ["SubagentStart", "agent-1"],
  ]) {
    const output = start(`start-${eventName}`, eventName, agentId);
    assert.equal(
      context(output),
      [
        REMINDER_TEXT,
        USER_INTENT_REMINDER_TEXT,
        PROJECT_SOURCES_REMINDER_TEXT,
        digest,
      ].join("\n"),
    );
  }
});

test("PS-6: the start injection stays inside the Codex context budget", () => {
  const output = start("budget-start");
  assert.ok(
    context(output).length < 8000,
    `start injection too large for the Codex truncation: ${context(output).length}`,
  );
});

test("PS-6: every rule fires on its own cadence and never resets another rule's counter", () => {
  const id = "cadence";
  start(id);
  const expected = {
    1: BODY_A,
    2: `SUFFIX A\n${BODY_B}`,
    3: `SUFFIX B\n${BODY_C}`,
    4: `SUFFIX A\n${BODY_C}`,
    5: REMINDER_TEXT,
  };
  for (const [call, text] of Object.entries(expected)) {
    assert.equal(context(tool(id)), text, `call ${call}`);
  }
  const state = stateOf(id);
  // a fires on calls 2 and 4, b on call 3, c on call 4; each counter keeps the
  // calls since its own last firing.
  assert.equal(state.ruleCompletedCalls["a-rule"], 1);
  assert.equal(state.ruleCompletedCalls["b-rule"], 2);
  assert.equal(state.ruleCompletedCalls["c-rule"], 1);
  // The full contract of a rule is delivered once per session.
  assert.deepEqual(state.ruleBodiesDelivered, ["a-rule", "b-rule", "c-rule"]);
});

test("PS-6: a rule with send_full_rule delivers its whole body as the reminder", () => {
  const id = "full-rule";
  start(id);
  tool(id);
  tool(id);
  tool(id);
  const fourth = tool(id);
  assert.equal(context(fourth), `SUFFIX A\n${BODY_C}`);
});

test("PS-6: every_input rules are delivered on every user message", () => {
  const id = "user-input";
  start(id);
  assert.equal(context(userInput(id)), `SUFFIX B\n${BODY_C}`);
  assert.equal(context(userInput(id)), `SUFFIX B\n${BODY_C}`);
});

test("PS-6: input-only rules never acquire a tool cadence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-input-only-"));
  const id = "input-only";
  const body = "[input-rule] Input-only contract";
  const environment = { CODEX_STANDING_RULES_DIR: directory };
  try {
    fs.writeFileSync(
      path.join(directory, "input-rule.json"),
      JSON.stringify({
        name: "input-rule",
        body,
        remind: {
          every_input: true,
          every_n_tools: null,
          suffix: "INPUT REMINDER",
        },
      }),
    );
    invoke(
      { session_id: id, hook_event_name: "SessionStart", source: "startup" },
      environment,
    );
    const input = () =>
      context(
        invoke(
          { session_id: id, hook_event_name: "UserPromptSubmit" },
          environment,
        ),
      );
    const completedTool = () =>
      context(
        invoke(
          {
            session_id: id,
            hook_event_name: "PostToolUse",
            tool_response: "ok",
          },
          environment,
        ),
      );
    assert.equal(input(), "INPUT REMINDER");
    // The one-time body is allowed; periodic input reminders are not.
    assert.equal(completedTool(), body);
    assert.equal(completedTool(), undefined);
    assert.equal(input(), "INPUT REMINDER");
    assert.equal(completedTool(), undefined);
    assert.equal(stateOf(id).ruleCompletedCalls["input-rule"], 0);
    assert.equal(stateOf(id).completedCalls, 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("PS-6: rule counters survive independently of the pinned payload counters", () => {
  const id = "counters";
  start(id);
  tool(id);
  const state = stateOf(id);
  assert.equal(state.ruleCompletedCalls["a-rule"], 1);
  assert.equal(state.ruleCompletedCalls["b-rule"], 1);
  assert.equal(state.completedCalls, 1);
  assert.deepEqual(state.ruleBodiesDelivered, ["a-rule"]);
});

test("PS-6: a rule body that would exceed the budget is skipped, the reminder is not", () => {
  const id = "budget";
  start(id);
  const first = invoke(
    {
      session_id: id,
      cwd: CWD,
      hook_event_name: "PostToolUse",
      tool_name: "functions.exec",
      tool_response: "ok",
    },
    { CODEX_STANDING_RULES_BUDGET: "5" },
  );
  assert.equal(context(first), undefined);
  const second = invoke(
    {
      session_id: id,
      cwd: CWD,
      hook_event_name: "PostToolUse",
      tool_name: "functions.exec",
      tool_response: "ok",
    },
    { CODEX_STANDING_RULES_BUDGET: "5" },
  );
  assert.equal(context(second), "SUFFIX A");
});

test("PS-6: a missing catalogue directory leaves the pinned delivery intact", () => {
  const missing = path.join(CATALOGUE_DIR, "does-not-exist");
  const output = invoke(
    {
      session_id: "missing-catalogue",
      hook_event_name: "SessionStart",
      source: "startup",
    },
    { CODEX_STANDING_RULES_DIR: missing },
  );
  assert.equal(
    context(output),
    `${REMINDER_TEXT}\n${USER_INTENT_REMINDER_TEXT}\n${PROJECT_SOURCES_REMINDER_TEXT}`,
  );
});

test("PS-6: a broken rule file is reported and does not block the remaining rules", () => {
  const brokenDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "codex-catalogue-broken-"),
  );
  fs.writeFileSync(path.join(brokenDir, "broken.json"), "{not json");
  fs.writeFileSync(
    path.join(brokenDir, "good.json"),
    JSON.stringify({
      name: "good-rule",
      body: "[good-rule] Тело GOOD\n\nЖелаемое поведение\nЦель GOOD.",
      remind: { every_n_tools: 1, suffix: "SUFFIX GOOD" },
    }),
  );
  const result = run(
    {
      session_id: "broken-catalogue",
      hook_event_name: "SessionStart",
      source: "startup",
    },
    { CODEX_STANDING_RULES_DIR: brokenDir },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /broken\.json/);
  assert.match(result.stderr, /invalid JSON/);
  const output = JSON.parse(result.stdout);
  assert.match(context(output), /good-rule: Цель GOOD/);
  fs.rmSync(brokenDir, { recursive: true, force: true });
});

test("PS-6: the installed standing-rules catalogue loads with a digest inside the budget", (t) => {
  const directory = path.join(os.homedir(), ".codex", "standing-rules");
  if (!fs.existsSync(directory)) {
    t.skip("no installed standing-rules catalogue on this machine");
    return;
  }
  const { rules, problems } = loadCatalogue({
    CODEX_STANDING_RULES_DIR: directory,
  });
  assert.deepEqual(problems, []);
  assert.equal(rules.length, 16);
  const digest = catalogueDigest(rules, directory);
  assert.ok(digest.length < 3000, `digest too large: ${digest.length}`);
  for (const rule of rules) {
    assert.ok(rule.body.length > 500, `${rule.name} body looks truncated`);
    if (!rule.sendFullRule) {
      assert.ok(
        rule.suffix.length > 200,
        `${rule.name} suffix looks truncated`,
      );
    }
  }
});
