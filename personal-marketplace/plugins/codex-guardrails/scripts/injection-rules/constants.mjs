import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const RULES_DIR = join(SCRIPT_DIR, "../../rules");
export const DISTRIBUTION_PATH = join(SCRIPT_DIR, "../../rule-distribution.json");
export const RECENT_WINDOW_DEFAULT = 30;
export const RECENT_ENTRY_CHAR_CAP = 50_000;
export const WINDOW_HARD_CAP = 500;
export const STATE_VERSION = 1;
export const LOCK_WAIT_MS = 750;
export const LOCK_STALE_MS = 10_000;
export const LOCK_POLL_MS = 10;
export const DEBUG_FILENAME = "rules-debug.jsonl";
export const VALID_SOURCES = new Set([
  "user_only",
  "assistant_only",
  "tool_only",
  "any",
]);
export const RULE_FIELDS = new Set([
  "name",
  "apply",
  "body",
  "remind",
  "window",
  "send_on_start",
]);
export const REMIND_FIELDS = new Set([
  "every_n_turns",
  "suffix",
  "when",
  "on_user_end",
  "priority",
  "every_input",
]);
export const WHEN_FIELDS = new Set([
  "any",
  "all",
  "none",
  "source",
  "cooldown_turns",
  "hint",
]);

export function normalizeAgentId(value) {
  const normalized = String(value ?? "main")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return normalized || "main";
}
