import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runColdForFiles } from "../lint-inject/cold-runner.ts";

function project() {
  const root = mkdtempSync(path.join(tmpdir(),"codex-config-timeout-")); mkdirSync(path.join(root,".git","info"),{recursive:true}); writeFileSync(path.join(root,".git","info","exclude"),"# keep-without-newline"); return root;
}

function executable(file, body) {
  mkdirSync(path.dirname(file),{recursive:true}); writeFileSync(file,`#!/bin/sh\n${body}\n`); chmodSync(file,0o755);
}

function assertClean(root) {
  assert.equal(existsSync(path.join(root,"eslint.config.mjs")),false); assert.equal(existsSync(path.join(root,"tsconfig.json")),false); assert.equal(readFileSync(path.join(root,".git","info","exclude"),"utf8"),"# keep-without-newline");
}

test("timed-out ESLint releases its generated config and exact exclude bytes", async () => {
  const root = project(); const file = path.join(root,"bad.js"); writeFileSync(file,"export {};\n");
  executable(path.join(root,"node_modules/.bin/eslint"),"sleep 2\nprintf '[]'"); executable(path.join(root,"node_modules/.bin/prettier"),"exit 0");
  await runColdForFiles([{abs:file,editedAt:Date.now()}],{budgetMs:180,coldLinterMs:100,changeWaitMs:0}); assertClean(root);
});

test("timed-out tsc releases both generated configs and exact exclude bytes", async () => {
  const root = project(); const file = path.join(root,"bad.ts"); writeFileSync(file,"export const value = 1;\n");
  executable(path.join(root,"node_modules/.bin/eslint"),"printf '[]'"); executable(path.join(root,"node_modules/.bin/prettier"),"exit 0"); executable(path.join(root,"node_modules/.bin/tsc"),"sleep 2");
  await runColdForFiles([{abs:file,editedAt:Date.now()}],{budgetMs:220,coldLinterMs:100,changeWaitMs:0}); assertClean(root);
});
