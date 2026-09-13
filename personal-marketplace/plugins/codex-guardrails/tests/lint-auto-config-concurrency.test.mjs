import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { withRootLock } from "../lint-inject/lease-lock.ts";
import { acquireAutoConfig, releaseAutoConfig } from "../lint-inject/auto-config.ts";
import { ESLINT_CONFIG_DEFAULT } from "../lint-inject/auto-config-definitions.ts";

const hookScript = new URL("../scripts/lint-inject.mjs", import.meta.url).pathname;
const autoConfigModule = pathToFileURL(new URL("../lint-inject/auto-config.ts", import.meta.url).pathname).href;
const definitionsModule = pathToFileURL(new URL("../lint-inject/auto-config-definitions.ts", import.meta.url).pathname).href;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "codex-auto-race-"));
  mkdirSync(path.join(root, ".git", "info"), { recursive: true });
  return root;
}

function executable(file, body) {
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755);
}

function event(root, file) {
  return JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "apply_patch", cwd: root,
    tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n@@\n*** End Patch` } });
}

function completed(child, input) {
  return new Promise((resolve, reject) => {
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject); child.on("close", (status) => resolve({ status, stdout, stderr }));
    if (input !== undefined) { child.stdin.end(input); }
  });
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test("overlapping hook processes retain generated config until the final owner exits", async () => {
  const root = project(); const file = path.join(root, "bad.js"); const calls = path.join(root, "calls.log"); writeFileSync(file, "export {};\n");
  executable(path.join(root, "node_modules/.bin/eslint"), `printf 'start %s\\n' "$$" >> '${calls}'
test -f "$PWD/eslint.config.mjs" || exit 9
sleep 0.4
test -f "$PWD/eslint.config.mjs" || exit 8
printf 'end %s\\n' "$$" >> '${calls}'
printf '[]'`);
  executable(path.join(root, "node_modules/.bin/prettier"), "exit 0");
  const first = completed(spawn(process.execPath, [hookScript], { stdio: ["pipe", "pipe", "pipe"] }), event(root, file));
  await delay(60);
  const second = completed(spawn(process.execPath, [hookScript], { stdio: ["pipe", "pipe", "pipe"] }), event(root, file));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 0); assert.equal(b.status, 0); assert.equal(a.stderr, ""); assert.equal(b.stderr, "");
  assert.doesNotMatch(a.stdout + b.stdout, /вывод не распарсен/);
  const lines = readFileSync(calls, "utf8").trim().split("\n"); assert.equal(lines.filter((line) => line.startsWith("start ")).length, 2); assert.equal(lines.filter((line) => line.startsWith("end ")).length, 2);
  assert.equal(existsSync(path.join(root, "eslint.config.mjs")), false);
});

test("exclusive creation preserves a user config that wins while an injector waits", async () => {
  const root = project(); const configPath = path.join(root, "eslint.config.mjs"); let child;
  const code = `import { acquireAutoConfig } from ${JSON.stringify(autoConfigModule)}; import { ESLINT_CONFIG_DEFAULT } from ${JSON.stringify(definitionsModule)}; const use=await acquireAutoConfig(process.argv[1],ESLINT_CONFIG_DEFAULT); process.stdout.write(JSON.stringify({available:use.isAvailable,leased:!!use.lease}));`;
  await withRootLock(root, async () => {
    child = spawn(process.execPath, ["--input-type=module", "-e", code, root], { stdio: ["ignore", "pipe", "pipe"] });
    await delay(100); writeFileSync(configPath, "export default [{ rules: {} }];\n", { flag: "wx" });
  });
  const result = await completed(child); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { available: true, leased: false });
  assert.equal(readFileSync(configPath, "utf8"), "export default [{ rules: {} }];\n");
});

test("a dead owner is pruned on adoption and the final live owner cleans the orphan", async () => {
  const root = project(); const configPath = path.join(root,"eslint.config.mjs");
  const code = `import { acquireAutoConfig } from ${JSON.stringify(autoConfigModule)}; import { ESLINT_CONFIG_DEFAULT } from ${JSON.stringify(definitionsModule)}; const use=await acquireAutoConfig(process.argv[1],ESLINT_CONFIG_DEFAULT); process.stdout.write(JSON.stringify({available:use.isAvailable,leased:!!use.lease})); process.exit(0);`;
  const orphan = await completed(spawn(process.execPath,["--input-type=module","-e",code,root],{stdio:["ignore","pipe","pipe"]}));
  assert.equal(orphan.status,0); assert.deepEqual(JSON.parse(orphan.stdout),{available:true,leased:true}); assert.equal(existsSync(configPath),true);
  const adopted = await acquireAutoConfig(root,ESLINT_CONFIG_DEFAULT); assert.ok(adopted.lease); await releaseAutoConfig(adopted.lease);
  assert.equal(existsSync(configPath),false);
});

test("real and symlink project roots share leases across overlapping hook processes", async () => {
  const root = project(); const alias = `${root}-alias`; symlinkSync(root,alias,"dir"); const file = path.join(root,"bad.js"); const calls = path.join(root,"alias-calls.log"); writeFileSync(file,"export {};\n");
  executable(path.join(root,"node_modules/.bin/eslint"),`printf 'start\\n' >> '${calls}'\ntest -f "$PWD/eslint.config.mjs" || exit 9\nsleep 0.4\ntest -f "$PWD/eslint.config.mjs" || exit 8\nprintf 'end\\n' >> '${calls}'\nprintf '[]'`); executable(path.join(root,"node_modules/.bin/prettier"),"exit 0");
  const first = completed(spawn(process.execPath,[hookScript],{stdio:["pipe","pipe","pipe"]}),event(root,file)); await delay(60);
  const second = completed(spawn(process.execPath,[hookScript],{stdio:["pipe","pipe","pipe"]}),event(alias,path.join(alias,"bad.js")));
  const [a,b] = await Promise.all([first,second]); assert.equal(a.status,0); assert.equal(b.status,0); assert.doesNotMatch(a.stdout+b.stdout,/вывод не распарсен/);
  const lines = readFileSync(calls,"utf8").trim().split("\n"); assert.equal(lines.filter((line)=>line==="start").length,2); assert.equal(lines.filter((line)=>line==="end").length,2); assert.equal(existsSync(path.join(root,"eslint.config.mjs")),false);
});
