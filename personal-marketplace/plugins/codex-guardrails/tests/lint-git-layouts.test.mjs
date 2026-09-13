import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireAutoConfig, releaseAutoConfig } from "../lint-inject/auto-config.ts";
import { ESLINT_CONFIG_DEFAULT } from "../lint-inject/auto-config-definitions.ts";

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function initRepository(root) {
  mkdirSync(root, { recursive: true }); git(root,["init","-q"]); git(root,["config","user.email","lint@example.invalid"]); git(root,["config","user.name","Lint Test"]);
  writeFileSync(path.join(root,"tracked.txt"),"tracked\n"); git(root,["add","tracked.txt"]); git(root,["commit","-qm","init"]);
}

test("real linked worktree uses common info/exclude and stays clean in git status", async () => {
  const base = mkdtempSync(path.join(tmpdir(),"codex-worktree-layout-")); const main = path.join(base,"main"); const linked = path.join(base,"linked"); initRepository(main);
  git(main,["worktree","add","-qb","lint-worktree",linked]);
  const excludePath = path.join(main,".git","info","exclude"); const original = "# common-keep"; writeFileSync(excludePath,original);
  const use = await acquireAutoConfig(linked,ESLINT_CONFIG_DEFAULT); assert.ok(use.lease); assert.equal(git(linked,["status","--porcelain","--untracked-files=all"]),"");
  await releaseAutoConfig(use.lease);
  assert.equal(existsSync(path.join(linked,"eslint.config.mjs")),false); assert.equal(readFileSync(excludePath,"utf8"),original); assert.equal(git(linked,["status","--porcelain"]),"");
});

test("real submodule gitfile uses its module info/exclude and stays clean in git status", async () => {
  const base = mkdtempSync(path.join(tmpdir(),"codex-submodule-layout-")); const source = path.join(base,"source"); const parent = path.join(base,"parent"); initRepository(source); initRepository(parent);
  execFileSync("git",["-c","protocol.file.allow=always","-C",parent,"submodule","add","-q",source,"modules/child"]);
  const child = path.join(parent,"modules","child"); const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(path.join(child,".git"),"utf8")); assert.ok(match);
  const gitDir = path.resolve(child,match[1].trim()); const excludePath = path.join(gitDir,"info","exclude"); mkdirSync(path.dirname(excludePath),{recursive:true}); const original = "# module-keep"; writeFileSync(excludePath,original);
  const use = await acquireAutoConfig(child,ESLINT_CONFIG_DEFAULT); assert.ok(use.lease); assert.equal(git(child,["status","--porcelain","--untracked-files=all"]),"");
  await releaseAutoConfig(use.lease);
  assert.equal(existsSync(path.join(child,"eslint.config.mjs")),false); assert.equal(readFileSync(excludePath,"utf8"),original); assert.equal(git(child,["status","--porcelain"]),"");
});
