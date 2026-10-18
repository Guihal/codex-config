import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { REMINDER_TEXT, USER_INTENT_REMINDER_TEXT, PROJECT_SOURCES_REMINDER_TEXT } from "../scripts/reminder-text.mjs";

const ZCODE_PAYLOAD = new URL(
  "../../../../../.zcode/personal-marketplace/plugins/reasoning-poison/scripts/reminder-text.mjs",
  import.meta.url,
);

test("both clients deliver quantified scope while retaining their own authorized payloads", async () => {
  const { USER_INTENT_REMINDER_TEXT: zcodeIntent } = await import(ZCODE_PAYLOAD.href);
  for (const text of [USER_INTENT_REMINDER_TEXT, zcodeIntent]) {
    assert.match(text, /requirements independently of discovered lists/);
    assert.match(text, /coverage OPEN until systematic discovery/);
    assert.match(text, /necessary integration are already in scope/);
    assert.match(text, /repair derived state\/plans/);
  }
});

test("the original reasoning-poison payload retains its exact pinned bytes", () => {
  assert.equal(crypto.createHash("sha256").update(REMINDER_TEXT).digest("hex"),
    "9d471cedfca1c5a0daf8107155eafea19700ec4116fb3fd0f6524b40ebe8993a");
});

test("PS-1: local approved source payload is unchanged and revised intent bytes are pinned", () => {
  assert.equal(crypto.createHash("sha256").update(PROJECT_SOURCES_REMINDER_TEXT).digest("hex"), "e50d94656e826539ea4748bafab15321d5dfeef8fd03ca49e7c17e666bb33eef");
  assert.equal(crypto.createHash("sha256").update(USER_INTENT_REMINDER_TEXT).digest("hex"), "ed6e16ef512d5e84d4fc95b82b0640ad3d9d4cb9ae4afab26d870ff649a9f3d8");
});

test("each client's current instructions retain the source-reading obligation", () => {
  const codex = fs.readFileSync(new URL("../../../../AGENTS.md", import.meta.url), "utf8");
  const zcode = fs.readFileSync(new URL("../../../../../.zcode/AGENTS.md", import.meta.url), "utf8");
  assert.match(codex, /## Project sources before decisions/);
  assert.match(zcode, /## E1\. Establish or restore task/);
  for (const text of [codex, zcode]) {
    for (const detail of ["mandatory documents completely", "exceptions", "alternative revisions"]) assert.ok(text.includes(detail), detail);
    assert.match(text, /truncated (?:output|material)/);
    assert.match(text, /deciding passage|original passage/);
  }
});
