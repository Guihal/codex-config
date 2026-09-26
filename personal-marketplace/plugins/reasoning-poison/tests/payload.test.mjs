import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { REMINDER_TEXT } from "../scripts/reminder-text.mjs";

const ZCODE_PAYLOAD = new URL(
  "../../../../../.zcode/personal-marketplace/plugins/reasoning-poison/scripts/reminder-text.mjs",
  import.meta.url,
);

test("Codex reminder text is byte-identical to the active ZCode payload", async () => {
  const source = fs.readFileSync(ZCODE_PAYLOAD, "utf8");
  const moduleUrl = `${ZCODE_PAYLOAD.href}?test=${crypto.randomUUID()}`;
  const { REMINDER_TEXT: zcodeReminder } = await import(moduleUrl);
  assert.match(source, /v0\.1\.2/);
  assert.strictEqual(REMINDER_TEXT, zcodeReminder);
  assert.ok(REMINDER_TEXT.endsWith("binding.\n"));
});
