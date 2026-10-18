import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const PROMPT = "/home/penis/.codex/prompts/rich-compaction.md";
const CONFIG = "/home/penis/.codex/config.toml";
const PI_SOURCE = "/home/penis/.pi/agent/extensions/rich-compaction.ts";

test("Codex prompt keeps the native free-form session summary contract", () => {
  const prompt = fs.readFileSync(PROMPT, "utf8");
  const headings = [
    "Session Narrative",
    "Done",
    "In Progress",
    "Next Steps",
    "Critical Context",
  ];
  for (const heading of headings)
    assert.match(prompt, new RegExp(`^## ${heading}$`, "m"));
  assert.doesNotMatch(prompt, /<<<RICH:REQUEST/);
});

test("config has exactly one native prompt override and no fake rich hooks", () => {
  const config = fs.readFileSync(CONFIG, "utf8");
  assert.equal(
    (
      config.match(
        /^(?:compact_prompt|experimental_compact_prompt_file)\s*=/gm,
      ) ?? []
    ).length,
    1,
  );
  assert.match(
    config,
    /^experimental_compact_prompt_file = "\/home\/penis\/\.codex\/prompts\/rich-compaction\.md"$/m,
  );
  assert.doesNotMatch(
    config,
    /rich-compaction.*(?:PreCompact|PostCompact)|(?:PreCompact|PostCompact).*rich-compaction/i,
  );
});

test("current Pi default uses its separate in-process direct-contract branch", () => {
  const source = fs.readFileSync(PI_SOURCE, "utf8");
  const body =
    /export default function \(pi: ExtensionAPI\): void \{([\s\S]*?)\n\}/.exec(
      source,
    )?.[1] ?? "";
  assert.match(
    body,
    /new ContractGenerator\(runner, createSummaryContract\(role\)\)/,
  );
  assert.match(
    body,
    /pi\.on\("session_before_compact", \(e, ctx\) => service\.compact\(e, ctx\)\)/,
  );
  assert.doesNotMatch(
    body,
    /registerRecursionGuardHooks|registerOrchestratorHooks|spawnChild/,
  );
});

test("compaction preserves original quantified scope and all unresolved obligations independently of recency", () => {
  const prompt = fs.readFileSync(PROMPT, "utf8");
  assert.match(prompt, /every still-active unresolved requirement regardless of recency/);
  assert.match(prompt, /original quantified rule/);
  assert.match(prompt, /non-exhaustive known targets/);
  assert.match(prompt, /satisfied with evidence or changed by an authoritative source/);
  assert.doesNotMatch(prompt, /tied to the latest user request|especially the most recent/);
});
