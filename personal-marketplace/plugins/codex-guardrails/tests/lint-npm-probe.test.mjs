import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("generated ESLint config bounds npm root probe by the remaining preparation budget", () => {
  const bin = mkdtempSync(path.join(tmpdir(),"codex-slow-npm-")); const npm = path.join(bin,"npm"); writeFileSync(npm,"#!/bin/sh\nsleep 2\n"); chmodSync(npm,0o755);
  const moduleUrl = new URL("../lint-inject/auto-config-definitions.ts",import.meta.url).href;
  const code = `import { ESLINT_CONFIG_DEFAULT, resolveAutoConfigContent } from ${JSON.stringify(moduleUrl)}; process.stdout.write(resolveAutoConfigContent(ESLINT_CONFIG_DEFAULT,50));`;
  const started = Date.now(); const result = spawnSync(process.execPath,["--input-type=module","-e",code],{encoding:"utf8",env:{...process.env,PATH:`${bin}:${process.env.PATH ?? ""}`},timeout:1000});
  assert.equal(result.status,0,result.stderr); assert.ok(Date.now()-started<700); assert.match(result.stdout,/AUTO-GENERATED-BY-LINT-INJECT/);
});
