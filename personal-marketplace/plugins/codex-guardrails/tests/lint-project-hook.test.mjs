import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { planFor } from "../lint-inject/linters/index.ts";
import { applyProjectHook, findProjectHook } from "../lint-inject/project-hook.ts";
import { runColdForFiles } from "../lint-inject/cold-runner.ts";

function project() { const root = mkdtempSync(path.join(tmpdir(), "codex-lint-")); mkdirSync(path.join(root, ".git")); return root; }
function executable(file, body) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755); }

test("project hook finds nearest config, cancels, replaces, and validates daemon plans", async () => {
  const cwd = project(); const sub = path.join(cwd,"src"); mkdirSync(sub); const file = path.join(sub,"x.ts"); writeFileSync(file,"");
  const config = path.join(cwd,"lint-inject.config.ts");
  writeFileSync(config,"export default () => null;\n"); assert.equal(findProjectHook(file),config); assert.deepEqual((await applyProjectHook(file,planFor(file))).plan.cold,[]);
  writeFileSync(config,"export default (_f, p) => ({ cold: p.cold.slice(0, 1) });\n"); const replaced = await applyProjectHook(file,planFor(file)); assert.equal(replaced.plan.cold.length,1);
  writeFileSync(config,"export default (_f, p) => ({ cold: p.cold, daemon: { ...p.daemon, args: ['--noEmit', '--watch', '--pretty', 'false'] } });\n");
  const daemon = await applyProjectHook(file,planFor(file));
  assert.deepEqual(daemon.plan.daemon.args,["--noEmit","--watch","--pretty","false"]);
  assert.equal(typeof daemon.plan.daemon.parse,"function"); assert.equal(daemon.plan.daemon.autoConfig.file,"tsconfig.json");
  writeFileSync(config,"export default (_f, p) => ({ cold: p.cold, daemon: { bin: 'tsc', args: ['--noEmit'] } });\n"); const invalid = await applyProjectHook(file,planFor(file)); assert.match(invalid.hookError,/невалидный/);
});

test("project hook throw and timeout fall back without disabling lint", async () => {
  const cwd = project(); const file = path.join(cwd,"x.ts"); writeFileSync(file,""); const config = path.join(cwd,"lint-inject.config.ts");
  writeFileSync(config,"export default () => { throw new Error('boom') };\n"); assert.match((await applyProjectHook(file,planFor(file))).hookError,/boom/);
  writeFileSync(config,"export default () => new Promise(() => {});\n"); assert.match((await applyProjectHook(file,planFor(file))).hookError,/timeout 1000ms/);
});

test("project hook top-level-await import is bounded and fails open", async () => {
  const cwd = project(); const file = path.join(cwd,"x.ts"); writeFileSync(file,""); const config = path.join(cwd,"lint-inject.config.ts");
  writeFileSync(config,"await new Promise(() => {}); export default (_file, plan) => plan;\n");
  const started = Date.now(); const result = await applyProjectHook(file,planFor(file));
  assert.ok(Date.now()-started < 1500); assert.ok(result.plan.cold.length>0); assert.match(result.hookError,/не загрузился: timeout 1000ms/);
});

test("project hook cache reloads on mtime change and load failures fall back", async () => {
  const cwd = project(); const file = path.join(cwd,"x.ts"); writeFileSync(file,""); const config = path.join(cwd,"lint-inject.config.ts");
  writeFileSync(config,"export default () => null;\n"); assert.equal((await applyProjectHook(file,planFor(file))).plan.cold.length,0);
  await new Promise((resolve) => setTimeout(resolve,20));
  writeFileSync(config,"export default (_f, p) => p;\n"); assert.ok((await applyProjectHook(file,planFor(file))).plan.cold.length>0);
  await new Promise((resolve) => setTimeout(resolve,20));
  writeFileSync(config,"export default (\n"); const failed = await applyProjectHook(file,planFor(file));
  assert.ok(failed.plan.cold.length>0); assert.match(failed.hookError,/не загрузился/);
});

test("project hook daemon fields reach bounded cold typecheck and custom auto-config cleanup", async () => {
  const cwd = project(); const file = path.join(cwd,"x.ts"); writeFileSync(file,"export const x = 1;\n"); const config = path.join(cwd,"lint-inject.config.ts");
  const argsFile = path.join(cwd,"tsc.args");
  executable(path.join(cwd,"node_modules/.bin/eslint"),"printf '[]'"); executable(path.join(cwd,"node_modules/.bin/prettier"),"exit 0");
  executable(path.join(cwd,"node_modules/.bin/tsc"),`test -f "$PWD/custom-tsconfig.json" || exit 9\nprintf '%s\\n' "$@" > '${argsFile}'\nprintf 'custom-output\\n'\nexit 2`);
  writeFileSync(config,`export default (_file, plan) => ({ cold: plan.cold, daemon: {
    bin: "tsc", args: ["--watch", "--custom-flag"],
    parse: () => [{ absPath: ${JSON.stringify(file)}, line: 1, col: 1, severity: "error", msg: "custom type failure", rule: "CUSTOM" }],
    autoConfig: { file: "custom-tsconfig.json", content: "// AUTO-GENERATED-BY-LINT-INJECT\\n{}\\n", configNames: ["custom-tsconfig.json"] }
  } });\n`);
  const report = await runColdForFiles([{abs:file,editedAt:Date.now()}],{budgetMs:3000,coldLinterMs:1000,changeWaitMs:0});
  assert.match(report,/\[lint-inject\] tsc:/); assert.match(report,/custom type failure/);
  const args = readFileSync(argsFile,"utf8"); assert.match(args,/--custom-flag/); assert.match(args,/--noEmit/); assert.doesNotMatch(args,/--watch/);
  assert.equal(existsSync(path.join(cwd,"custom-tsconfig.json")),false);
});

test("CLI keeps malformed JSON silent but logs unexpected runtime errors fail-open", () => {
  const script = new URL("../scripts/lint-inject.mjs",import.meta.url).pathname;
  const malformed = spawnSync(process.execPath,[script],{input:"{",encoding:"utf8"});
  assert.equal(malformed.status,0); assert.equal(malformed.stderr,"");
  const cwd = project(); const loop = path.join(cwd,"loop"); symlinkSync("loop",loop);
  const event = JSON.stringify({hook_event_name:"PostToolUse",tool_name:"apply_patch",cwd,tool_input:{command:`*** Update File: ${loop}`}});
  const runtime = spawnSync(process.execPath,[script],{input:event,encoding:"utf8"});
  assert.equal(runtime.status,0); assert.match(runtime.stderr,/unexpected error:.*ELOOP/s);
});

test("spawned CLI interrupts a CPU-blocking synchronous project hook", () => {
  const script = new URL("../scripts/lint-inject.mjs",import.meta.url).pathname; const cwd = project(); const file = path.join(cwd,"x.js"); writeFileSync(file,"export {};\n");
  writeFileSync(path.join(cwd,"lint-inject.config.ts"),"export default () => { for (;;) {} };\n");
  const event = JSON.stringify({hook_event_name:"PostToolUse",tool_name:"apply_patch",cwd,tool_input:{command:"*** Update File: x.js"}});
  const started = Date.now(); const result = spawnSync(process.execPath,[script],{input:event,encoding:"utf8",timeout:3000});
  assert.equal(result.status,0,result.stderr); assert.ok(Date.now()-started<2000); assert.match(result.stdout,/\[lint-inject\] hook: хук упал: timeout 1000ms/);
});

test("timed-out slow job is killed while another cold report survives", async () => {
  const cwd = project(); const file = path.join(cwd,"x.go"); writeFileSync(file,"package main\n");
  const bins = path.join(cwd,"node_modules/.bin"); executable(path.join(bins,"go"), "sleep 2"); executable(path.join(bins,"gofmt"), "printf 'x.go\\n'");
  const started = Date.now(); const report = await runColdForFiles([{abs:file,editedAt:Date.now()}], {budgetMs:150,coldLinterMs:100,changeWaitMs:0});
  assert.ok(Date.now()-started < 1000); assert.match(report,/\[lint-inject\] gofmt:/);
});
