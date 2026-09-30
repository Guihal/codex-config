import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { REMINDER_TEXT, USER_INTENT_REMINDER_TEXT, PROJECT_SOURCES_REMINDER_TEXT } from "../scripts/reminder-text.mjs";

const ZCODE_PAYLOAD = new URL(
  "../../../../../.zcode/personal-marketplace/plugins/reasoning-poison/scripts/reminder-text.mjs",
  import.meta.url,
);

test("PS-1: all three Codex reminder texts are byte-identical to the ZCode source payloads", async () => {
  const source = fs.readFileSync(ZCODE_PAYLOAD, "utf8");
  const moduleUrl = `${ZCODE_PAYLOAD.href}?test=${crypto.randomUUID()}`;
  const { REMINDER_TEXT: zcodeReminder, USER_INTENT_REMINDER_TEXT: zcodeIntent, PROJECT_SOURCES_REMINDER_TEXT: zcodeSources } = await import(moduleUrl);
  assert.match(source, /v0\.1\.2/);
  assert.strictEqual(REMINDER_TEXT, zcodeReminder);
  assert.strictEqual(USER_INTENT_REMINDER_TEXT, zcodeIntent);
  assert.strictEqual(PROJECT_SOURCES_REMINDER_TEXT, zcodeSources);
  assert.ok(REMINDER_TEXT.endsWith("binding.\n"));
});

test("the original reasoning-poison payload retains its exact pinned bytes", () => {
  assert.equal(crypto.createHash("sha256").update(REMINDER_TEXT).digest("hex"),
    "9d471cedfca1c5a0daf8107155eafea19700ec4116fb3fd0f6524b40ebe8993a");
});

test("PS-1: source text matches the approved English payload and existing intent bytes stay pinned", () => {
  assert.equal(crypto.createHash("sha256").update(PROJECT_SOURCES_REMINDER_TEXT).digest("hex"), "e50d94656e826539ea4748bafab15321d5dfeef8fd03ca49e7c17e666bb33eef");
  assert.equal(crypto.createHash("sha256").update(USER_INTENT_REMINDER_TEXT).digest("hex"), "cf7ae05b11f36ec6b0d0e46fadb99930b4af65b1a2466477b5c6cd0d4ed814d8");
});

test("PS-5: both global instruction files contain the same project reading rule", () => {
  const section = text => text.split("## Project sources before decisions\n")[1]?.split("\n## ")[0];
  const codex = section(fs.readFileSync(new URL("../../../../AGENTS.md", import.meta.url), "utf8"));
  const zcode = section(fs.readFileSync(new URL("../../../../../.zcode/AGENTS.md", import.meta.url), "utf8"));
  assert.ok(codex);
  assert.equal(codex, zcode);
  for (const detail of ["mandatory documents completely", "truncated output", "exceptions", "alternative revisions", "original passage"]) {
    assert.ok(codex.includes(detail), detail);
  }
});
