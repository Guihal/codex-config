import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { extractPatchPaths, handleEvent } from "../scripts/lint-inject.mjs";
import { planFor, registry } from "../lint-inject/linters/index.ts";
import { runColdForFiles } from "../lint-inject/cold-runner.ts";

function project() { const root = mkdtempSync(path.join(tmpdir(), "codex-lint-")); mkdirSync(path.join(root, ".git")); return root; }
function executable(file, body) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755); }

test("extracts add/update/move destinations in final appearance order", () => {
  const cwd = project();
  assert.deepEqual(extractPatchPaths("*** Add File: a.ts\n*** Update File: old.ts\n*** Move to: moved.ts\n*** Update File: a.ts\n*** Delete File: gone.ts", cwd), [path.join(cwd,"a.ts"),path.join(cwd,"moved.ts")]);
});

test("deduplicates move destination and rejects relative cwd escapes", () => {
  const cwd = project(); const absolute = path.join(tmpdir(), "absolute.ts");
  assert.deepEqual(extractPatchPaths(`*** Add File: moved.ts\n*** Update File: old.ts\n*** Move to: moved.ts\n*** Add File: ../escape.ts\n*** Add File: ${absolute}`, cwd), [path.join(cwd,"moved.ts"),absolute]);
});

test("malformed and irrelevant envelopes fail open", async () => {
  assert.equal(await handleEvent({}), undefined);
  assert.equal(await handleEvent({hook_event_name:"PostToolUse",tool_name:"Bash",cwd:"/tmp",tool_input:{command:"*** Add File: x.ts"}}), undefined);
});

test("real PostToolUse cold-lints all existing patch targets and emits advisory context", async () => {
  const cwd = project(); const file = path.join(cwd,"bad.ts"); writeFileSync(file,"bad\n");
  const bins = path.join(cwd,"node_modules/.bin");
  executable(path.join(bins,"eslint"), `printf '[{"filePath":"${file}","messages":[{"line":1,"column":1,"severity":2,"message":"bad","ruleId":"demo"}]}]' ; exit 1`);
  executable(path.join(bins,"prettier"), "exit 0");
  const output = await handleEvent({hook_event_name:"PostToolUse",tool_name:"apply_patch",cwd,tool_input:{command:"*** Update File: bad.ts"},tool_response:{anything:true}});
  assert.match(output.hookSpecificOutput.additionalContext,/\[lint-inject\] eslint:/);
  assert.match(output.hookSpecificOutput.additionalContext,/bad\.ts:1:1: bad \(demo\)/);
  assert.equal("decision" in output,false);
});

test("batch-capable jobs receive all edited files once", async () => {
  const cwd = project(); const first = path.join(cwd,"a.ts"); const second = path.join(cwd,"b.ts");
  writeFileSync(first,"bad\n"); writeFileSync(second,"bad\n");
  const argsFile = path.join(cwd,"eslint.args");
  executable(path.join(cwd,"node_modules/.bin/eslint"), `printf '%s\\n' "$@" > '${argsFile}'; exit 0`);
  executable(path.join(cwd,"node_modules/.bin/prettier"), "exit 0");
  await runColdForFiles([{abs:first,editedAt:Date.now()},{abs:second,editedAt:Date.now()}]);
  const args = readFileSync(argsFile,"utf8");
  assert.equal((args.match(/--format/g) ?? []).length,1);
  assert.match(args,/a\.ts/); assert.match(args,/b\.ts/);
});

test("per-file jobs are separated", async () => {
  const cwd = project(); const first = path.join(cwd,"a.php"); const second = path.join(cwd,"b.php");
  writeFileSync(first,"<?php\n"); writeFileSync(second,"<?php\n");
  const calls = path.join(cwd,"php.calls");
  executable(path.join(cwd,"node_modules/.bin/php"), `printf '%s\\n' "$*" >> '${calls}'; exit 0`);
  await runColdForFiles([{abs:first,editedAt:Date.now()},{abs:second,editedAt:Date.now()}]);
  const lines = readFileSync(calls,"utf8").trim().split("\n");
  assert.equal(lines.length,2); assert.ok(lines.every((line) => !(/a\.php.*b\.php|b\.php.*a\.php/.test(line))));
});

test("missing files, directories, and missing binaries produce no report", async () => {
  const cwd = project(); const directory = path.join(cwd,"dir"); mkdirSync(directory);
  assert.equal(await runColdForFiles([{abs:path.join(cwd,"missing.ts"),editedAt:Date.now()},{abs:directory,editedAt:Date.now()}]),undefined);
  const file = path.join(cwd,"x.ts"); writeFileSync(file,"ok\n");
  const oldPath = process.env.PATH; process.env.PATH = "";
  try { assert.equal(await runColdForFiles([{abs:file,editedAt:Date.now()}]),undefined); }
  finally { process.env.PATH = oldPath; }
});

test("PATH fallback runs at git root when no local binary exists", async () => {
  const cwd = project(); const sub = path.join(cwd,"src"); mkdirSync(sub); const file = path.join(sub,"x.php"); writeFileSync(file,"<?php\n");
  const binDir = mkdtempSync(path.join(tmpdir(),"lint-path-")); const cwdFile = path.join(cwd,"php.cwd");
  executable(path.join(binDir,"php"), `pwd > '${cwdFile}'; printf 'PHP Parse error: syntax error in ${file} on line 1\\n' >&2; exit 255`);
  const oldPath = process.env.PATH; process.env.PATH = `${binDir}:${oldPath ?? ""}`;
  try { assert.match(await runColdForFiles([{abs:file,editedAt:Date.now()}]),/syntax error/); }
  finally { process.env.PATH = oldPath; }
  assert.equal(readFileSync(cwdFile,"utf8").trim(),cwd);
});

test("all registered parser/report seams parse representative diagnostics", () => {
  const fixtures = {
    eslint: (f) => [JSON.stringify([{filePath:f,messages:[{line:1,column:2,severity:2,message:"bad",ruleId:"r"}]}]),"",1],
    stylelint: (f) => [JSON.stringify([{source:f,warnings:[{line:1,column:2,text:"bad",severity:"error",rule:"r"}]}]),"",1],
    prettier: (f) => [`${f}\n`,"",1], ruff: (f) => [JSON.stringify([{filename:f,code:"E1",message:"bad",location:{row:1,column:2}}]),"",1],
    shellcheck: (f) => [JSON.stringify({comments:[{file:f,line:1,column:2,level:"error",code:1,message:"bad"}]}),"",1],
    markdownlint: (f) => [JSON.stringify([{fileName:f,lineNumber:1,ruleNames:["MD001"],ruleDescription:"bad",severity:2}]),"",1],
    php: (f) => ["",`PHP Parse error: syntax error in ${f} on line 1`,255],
    cargo: (f) => [JSON.stringify({reason:"compiler-message",message:{level:"error",message:"bad",code:{code:"E1"},spans:[{file_name:f,line_start:1,column_start:2}]}}),"",1],
    go: (f) => [`${f}:1:2: bad`,"",1], gofmt: (f) => [`${f}\n`,"",1],
    yamllint: (f) => [`${f}:1:2: [error] bad (rule)`,"",1],
    sqlfluff: (f) => [JSON.stringify([{filepath:f,violations:[{line_no:1,line_pos:2,code:"L1",description:"bad"}]}]),"",1],
    taplo: (f) => [`${f}:1:2: bad`,"",1],
    hadolint: (f) => [JSON.stringify([{line:1,column:2,code:"DL1",message:"bad",level:"error",filename:f}]),"",1],
  };
  const cases = ["x.ts","x.vue","x.css","x.py","x.sh","x.md","x.json","x.php","x.rs","x.go","x.yaml","x.html","x.sql","x.toml","Dockerfile"];
  for (const file of cases) for (const linter of planFor(`/repo/${file}`).cold) {
    const [stdout,stderr,code] = fixtures[linter.bin](`/repo/${file}`);
    const parsed = linter.parse(stdout,stderr,"/repo",code);
    assert.equal(parsed.parseError,undefined,`${file}:${linter.bin}`);
    assert.ok(parsed.diags.length>0,`${file}:${linter.bin}`);
  }
});

test("cold runner executes at most three independent jobs concurrently", async () => {
  const cwd = project(); const files = ["x.py","x.sh","x.md","Dockerfile"].map((name) => path.join(cwd,name));
  for (const file of files) writeFileSync(file,"bad\n");
  for (const bin of ["ruff","shellcheck","markdownlint","hadolint"]) executable(path.join(cwd,"node_modules/.bin",bin),"sleep 0.2; exit 0");
  const started = Date.now();
  await runColdForFiles(files.map((abs) => ({abs,editedAt:Date.now()})),{budgetMs:2000,coldLinterMs:1000,changeWaitMs:0});
  const elapsed = Date.now()-started;
  assert.ok(elapsed>=350,`four jobs finished too quickly: ${elapsed}ms`);
  assert.ok(elapsed<900,`jobs did not run in bounded parallel: ${elapsed}ms`);
});

test("failed-update ambiguity is advisory and deterministic", async () => {
  const cwd = project(); const file = path.join(cwd,"existing.json"); writeFileSync(file,"{}\n");
  executable(path.join(cwd,"node_modules/.bin/prettier"), `printf 'existing.json\\n'; exit 1`);
  const output = await handleEvent({hook_event_name:"PostToolUse",tool_name:"apply_patch",cwd,tool_input:{command:"*** Update File: existing.json"},tool_response:{error:"patch failed"}});
  assert.match(output.hookSpecificOutput.additionalContext,/file is not formatted/);
  assert.equal("decision" in output,false);
});

test("registry preserves all 17 Pi language definitions and expected plans", () => {
  assert.equal(registry.length,17);
  const cases = {"x.ts":"eslint","x.vue":"eslint","x.css":"stylelint","x.py":"ruff","x.sh":"shellcheck","x.md":"markdownlint","x.json":"prettier","x.php":"php","x.rs":"cargo","x.go":"go","x.yaml":"yamllint","x.html":"prettier","x.sql":"sqlfluff","x.toml":"taplo","Dockerfile":"hadolint"};
  for (const [file,bin] of Object.entries(cases)) assert.ok(planFor(`/repo/${file}`).cold.some((item) => item.bin===bin), file);
});
