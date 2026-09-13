import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runColdForFiles } from "../lint-inject/cold-runner.ts";

function executable(file, body) {
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755);
}

test("nested user tsconfig wins in a monorepo and no root default is created", async () => {
  const root = mkdtempSync(path.join(tmpdir(),"codex-monorepo-")); mkdirSync(path.join(root,".git"));
  const packageRoot = path.join(root,"packages","app"); const file = path.join(packageRoot,"src","bad.ts"); mkdirSync(path.dirname(file),{recursive:true}); writeFileSync(file,'const value: number = "bad";\n');
  const tsconfig = path.join(packageRoot,"tsconfig.json"); const userConfig = '{"compilerOptions":{"strict":true}}\n'; writeFileSync(tsconfig,userConfig);
  const cwdLog = path.join(root,"tsc.cwd");
  executable(path.join(root,"node_modules/.bin/eslint"),"printf '[]'"); executable(path.join(root,"node_modules/.bin/prettier"),"exit 0");
  executable(path.join(root,"node_modules/.bin/tsc"),`pwd > '${cwdLog}'\ntest -f "$PWD/tsconfig.json" || exit 9\nprintf 'src/bad.ts(1,7): error TS2322: bad type\\n'\nexit 2`);
  const report = await runColdForFiles([{abs:file,editedAt:Date.now()}],{budgetMs:3000,coldLinterMs:1000,changeWaitMs:0});
  assert.match(report,/TS2322/); assert.equal(readFileSync(cwdLog,"utf8").trim(),packageRoot); assert.equal(readFileSync(tsconfig,"utf8"),userConfig);
  assert.equal(existsSync(path.join(root,"tsconfig.json")),false); assert.equal(existsSync(path.join(root,"eslint.config.mjs")),false);
});
