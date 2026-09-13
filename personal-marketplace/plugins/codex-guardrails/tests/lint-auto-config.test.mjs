import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireAutoConfig, findUserConfig, releaseAutoConfig, writeExclusiveConfig } from "../lint-inject/auto-config.ts";
import { AUTO_MARKER, ESLINT_CONFIG_DEFAULT } from "../lint-inject/auto-config-definitions.ts";
import { ensureOwnedExclude, removeOwnedExclude } from "../lint-inject/git-exclude.ts";
import { ownersDirectory } from "../lint-inject/lease-lock.ts";
import { runColdForFiles } from "../lint-inject/cold-runner.ts";

const TIMINGS = { budgetMs: 4_000, coldLinterMs: 2_000, changeWaitMs: 0 };

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "codex-auto-config-"));
  mkdirSync(path.join(root, ".git", "info"), { recursive: true });
  return root;
}

function executable(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

function cleanPrettier(root) {
  executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
}

test("generated ESLint config exists during lint, yields parsed diagnostics, and restores Git metadata", async () => {
  const root = project(); const file = path.join(root, "src", "bad.js"); mkdirSync(path.dirname(file)); writeFileSync(file, "const unused = 1;\n");
  const excludePath = path.join(root, ".git", "info", "exclude"); const originalExclude = "# keep-without-newline"; writeFileSync(excludePath, originalExclude);
  executable(path.join(root, "node_modules/.bin/eslint"), `test -f "$PWD/eslint.config.mjs" || exit 9
grep -q AUTO-GENERATED-BY-LINT-INJECT "$PWD/eslint.config.mjs" || exit 8
printf '[{"filePath":"${file}","messages":[{"line":1,"column":7,"severity":1,"message":"unused","ruleId":"no-unused-vars"}]}]'
exit 1`);
  cleanPrettier(root);
  const report = await runColdForFiles([{ abs: file, editedAt: Date.now() }], TIMINGS);
  assert.match(report, /\[lint-inject\] eslint:/); assert.match(report, /no-unused-vars/);
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
  assert.equal(readFileSync(excludePath, "utf8"), originalExclude);
});

test("user ESLint config is authoritative, unchanged, and survives cleanup", async () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "export {};\n");
  const config = path.join(root, "eslint.config.mjs"); const userContent = "export default [];\n"; writeFileSync(config, userContent);
  executable(path.join(root, "node_modules/.bin/eslint"), "test -f \"$PWD/eslint.config.mjs\" || exit 9\nprintf '[]'"); cleanPrettier(root);
  assert.equal(await runColdForFiles([{ abs: file, editedAt: Date.now() }], TIMINGS), undefined);
  assert.equal(readFileSync(config, "utf8"), userContent);
});

test("generated tsconfig drives bounded cold tsc and is removed after parsed output", async () => {
  const root = project(); const file = path.join(root, "bad.ts"); writeFileSync(file, 'const value: number = "bad";\n');
  const argsPath = path.join(root, "tsc.args");
  executable(path.join(root, "node_modules/.bin/eslint"), "printf '[]'"); cleanPrettier(root);
  executable(path.join(root, "node_modules/.bin/tsc"), `test -f "$PWD/tsconfig.json" || exit 9
grep -q AUTO-GENERATED-BY-LINT-INJECT "$PWD/tsconfig.json" || exit 8
printf '%s\\n' "$@" > '${argsPath}'
printf 'bad.ts(1,7): error TS2322: Type string is not assignable to type number.\\n'
exit 2`);
  const report = await runColdForFiles([{ abs: file, editedAt: Date.now() }], TIMINGS);
  assert.match(report, /\[lint-inject\] tsc:/); assert.match(report, /TS2322/);
  const args = readFileSync(argsPath, "utf8"); assert.match(args, /--noEmit/); assert.doesNotMatch(args, /--watch|--preserveWatchOutput/);
  assert.equal(existsSync(path.join(root, "tsconfig.json")), false); assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
});

test("missing binaries create no default configs", async () => {
  const root = project(); const file = path.join(root, "bad.ts"); writeFileSync(file, "export const value = 1;\n");
  const previousPath = process.env.PATH; process.env.PATH = "";
  try { assert.equal(await runColdForFiles([{ abs: file, editedAt: Date.now() }], TIMINGS), undefined); }
  finally { process.env.PATH = previousPath; }
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false); assert.equal(existsSync(path.join(root, "tsconfig.json")), false);
});

test("worktree exclude cleanup preserves pre-existing path and unrelated marker blocks byte-for-byte", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-auto-worktree-")); const gitDir = path.join(root, "actual-git"); mkdirSync(path.join(gitDir, "info"), { recursive: true });
  writeFileSync(path.join(root, ".git"), `gitdir: ${gitDir}\n`);
  const excludePath = path.join(gitDir, "info", "exclude"); const original = "# unrelated\neslint.config.mjs\n# lint-inject-auto:foreign:plain\nforeign.json\n"; writeFileSync(excludePath, original);
  const use = await acquireAutoConfig(root, ESLINT_CONFIG_DEFAULT); assert.equal(use.isAvailable, true); assert.ok(use.lease);
  await releaseAutoConfig(use.lease);
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false); assert.equal(readFileSync(excludePath, "utf8"), original);
});

test("broken configured linter stays advisory and still releases generated config", async () => {
  const root = project(); const file = path.join(root, "bad.js"); writeFileSync(file, "export {};\n");
  executable(path.join(root, "node_modules/.bin/eslint"), "printf 'not-json' >&2; exit 2"); cleanPrettier(root);
  const report = await runColdForFiles([{ abs: file, editedAt: Date.now() }], TIMINGS);
  assert.match(report, /вывод не распарсен: not-json/); assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
});

test("partial exclusive writes remove only their own inode and never a replacement", async () => {
  const root = project(); const configPath = path.join(root,"eslint.config.mjs"); const excludePath = path.join(root,".git","info","exclude"); const original = "# keep\n"; writeFileSync(excludePath,original);
  assert.throws(() => writeExclusiveConfig(configPath,`// ${AUTO_MARKER}\n`,(descriptor,content) => { writeFileSync(descriptor,content.slice(0,5)); throw new Error("write failed"); }),/write failed/);
  assert.equal(existsSync(configPath),false);
  assert.throws(() => writeExclusiveConfig(configPath,`// ${AUTO_MARKER}\n`,(descriptor) => { writeFileSync(descriptor,"partial"); unlinkSync(configPath); writeFileSync(configPath,"export default [];\n",{flag:"wx"}); throw new Error("replacement won"); }),/replacement won/);
  assert.equal(readFileSync(configPath,"utf8"),"export default [];\n"); assert.equal(readFileSync(excludePath,"utf8"),original);
});

test("exclusive create preserves a user file appearing after discovery", () => {
  const root = project(); const configPath = path.join(root,"eslint.config.mjs"); assert.equal(findUserConfig(root,ESLINT_CONFIG_DEFAULT),undefined);
  writeFileSync(configPath,"export default [{ rules: {} }];\n",{flag:"wx"});
  assert.equal(writeExclusiveConfig(configPath,`// ${AUTO_MARKER}\n`),false); assert.equal(readFileSync(configPath,"utf8"),"export default [{ rules: {} }];\n");
});

test("exclude cleanup rejects marker substring prefix collisions", () => {
  const root = project(); const configPath = path.join(root,"eslint.config.mjs"); const excludePath = path.join(root,".git","info","exclude"); writeFileSync(excludePath,"");
  ensureOwnedExclude(root,configPath); const collision = `prefix${readFileSync(excludePath,"utf8")}`; writeFileSync(excludePath,collision);
  removeOwnedExclude(root,configPath); assert.equal(readFileSync(excludePath,"utf8"),collision);
});

test("owner registration failure rolls back a new config and owned exclude block", async () => {
  const root = project(); const configPath = path.join(root,"eslint.config.mjs"); const ownerPath = ownersDirectory(configPath); const excludePath = path.join(root,".git","info","exclude"); const original = "# keep\n"; writeFileSync(excludePath,original);
  mkdirSync(path.dirname(ownerPath),{recursive:true}); writeFileSync(ownerPath,"blocks owner directory");
  const use = await acquireAutoConfig(root,ESLINT_CONFIG_DEFAULT); assert.equal(use.isAvailable,false); assert.equal(existsSync(configPath),false); assert.equal(readFileSync(excludePath,"utf8"),original);
  unlinkSync(ownerPath);
});
