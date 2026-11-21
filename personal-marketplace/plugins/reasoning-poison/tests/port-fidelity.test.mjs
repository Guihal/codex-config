import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Spec: PS-6 (../README.md#standing-rules-catalogue).
// The port is only trustworthy if every delivered body still equals its omo
// original modulo the adaptations the catalogue itself records, and if the
// index in AGENTS.md matches the catalogue it points at.

const HOME = os.homedir();
const OMO = path.join(HOME, ".omo", "agent", "rules");
const CATALOGUE = path.join(HOME, ".codex", "standing-rules");
const AGENTS = path.join(HOME, ".codex", "AGENTS.md");

// omo counts completed model steps, Codex counts tool calls; the delivered
// cadence is the Codex scale derived once from the working installation.
const CADENCE = {
  "01-operating-principle": 3,
  "17-user-correction-rebase": null,
  "18-intent-stream-map": null,
  "68-reason-in-user-language": 37,
  "70-reasoning-poison": 2,
  "71-user-intent-outcome": 5,
  "72-project-sources-details": 13,
  "73-tests-not-proof": 7,
  "74-use-context-frontier": 17,
  "75-evidence-or-blocker": 19,
  "76-execution-progress-close-questions": 11,
  "77-layout-model-and-verification": 23,
  "79-behavior-comments-and-contract": 29,
  "80-independent-review": 31,
  "81-engineering-invariants": 41,
  "84-communication-profile": null,
};

// Rules authored for Codex itself, not ported from omo: rule 84 is the
// communication profile the brief rewrites on the installed machine. They skip
// the omo-equality loop but must still appear in the cadence table and in the
// AGENTS.md index.
const AUTHORED = new Set(["84-communication-profile"]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function catalogueFiles() {
  if (!fs.existsSync(CATALOGUE)) return [];
  return fs.readdirSync(CATALOGUE).filter((file) => file.endsWith(".json"));
}

test("PS-6: every catalogue rule equals its omo original modulo the recorded adaptations", (t) => {
  const files = catalogueFiles();
  if (files.length === 0 || !fs.existsSync(OMO)) {
    t.skip("no standing-rules catalogue or no omo catalogue on this machine");
    return;
  }
  for (const file of files) {
    const ported = readJson(path.join(CATALOGUE, file));
    if (AUTHORED.has(ported.name)) continue;
    const source = readJson(path.join(OMO, `${ported.name}.json`));

    let expectedBody = source.body;
    const adaptations = ported.source?.adaptations ?? [];
    for (const adaptation of adaptations.filter(
      (entry) => entry.kind === "body",
    )) {
      assert.equal(
        source.body.split(adaptation.from).length - 1,
        1,
        `${ported.name}: recorded adaptation does not occur exactly once in the omo body`,
      );
      assert.ok(
        ported.body.includes(adaptation.to),
        `${ported.name}: recorded adaptation target is missing in the ported body`,
      );
      expectedBody = expectedBody.replace(adaptation.from, adaptation.to);
    }
    assert.equal(
      ported.body,
      expectedBody,
      `${ported.name}: the ported body drifted away from the omo original`,
    );
    assert.equal(
      ported.remind.suffix ?? "",
      source.remind.suffix ?? "",
      `${ported.name}: suffix drifted`,
    );
    assert.equal(
      ported.remind.every_input === true,
      source.remind.every_input === true,
      `${ported.name}: the every_input trigger drifted`,
    );
    assert.equal(
      ported.remind.send_full_rule === true,
      source.remind.send_full_rule === true,
      `${ported.name}: send_full_rule drifted`,
    );
    assert.equal(
      ported.remind.every_n_tools ?? null,
      CADENCE[ported.name] ?? null,
      `${ported.name}: cadence does not match the delivered table`,
    );
    assert.equal(
      ported.source?.every_n_turns ?? null,
      source.remind?.every_n_turns ?? null,
      `${ported.name}: the recorded omo step cadence drifted`,
    );
    assert.equal(
      ported.source?.harness,
      "omo",
      `${ported.name}: source harness is not omo`,
    );
    assert.deepEqual(
      ported._contract ?? null,
      source._contract ?? null,
      `${ported.name}: _contract lost`,
    );
    assert.equal(
      ported._comment ?? null,
      source._comment ?? null,
      `${ported.name}: _comment lost`,
    );
  }
});

test("PS-6: the catalogue covers exactly the omo rule set", (t) => {
  const files = catalogueFiles();
  if (files.length === 0 || !fs.existsSync(OMO)) {
    t.skip("no standing-rules catalogue or no omo catalogue on this machine");
    return;
  }
  const omoNames = fs
    .readdirSync(OMO)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson(path.join(OMO, file)).name);
  const portedNames = files.map(
    (file) => readJson(path.join(CATALOGUE, file)).name,
  );
  const portedFromOmo = portedNames.filter((name) => !AUTHORED.has(name));
  assert.deepEqual(
    [...portedFromOmo].sort(),
    [...omoNames].sort(),
    "the catalogue must carry every omo rule exactly once",
  );
  assert.deepEqual(
    Object.keys(CADENCE).sort(),
    [...portedNames].sort(),
    "the cadence table must cover the catalogue",
  );
});

test("PS-6: the AGENTS.md index lists every rule with its real cadence", (t) => {
  const files = catalogueFiles();
  if (files.length === 0 || !fs.existsSync(AGENTS)) {
    t.skip("no standing-rules catalogue or no AGENTS.md on this machine");
    return;
  }
  const agents = fs.readFileSync(AGENTS, "utf8");
  for (const file of files) {
    const rule = readJson(path.join(CATALOGUE, file));
    assert.ok(
      agents.includes(rule.name),
      `AGENTS.md does not list ${rule.name}`,
    );
    const cadence = rule.remind.every_n_tools;
    if (typeof cadence === "number") {
      assert.ok(
        agents.includes(`every ${cadence} tool calls`) ||
          agents.includes(`every ${cadence} calls`),
        `AGENTS.md does not state the cadence ${cadence} of ${rule.name}`,
      );
    }
    if (rule.remind.every_input === true) {
      assert.ok(
        agents.includes("every user message"),
        `AGENTS.md does not state the every_input trigger of ${rule.name}`,
      );
    }
  }
  assert.ok(
    agents.includes("82-verification-scope-bounded"),
    "AGENTS.md lacks rule 82",
  );
});
