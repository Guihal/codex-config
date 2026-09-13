import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DEPTH, compileIgnoreFileContent, formatProjectStructureContext,
  getProjectTree, normalizeDepth, parseDepthConfig, resolveDefaultDepth,
} from "../scripts/tree.mjs";

const ROOT = fileURLToPath(new URL("..",import.meta.url));
const HOOK = path.join(ROOT,"scripts/project-context-hook.mjs");
const ASSET = path.join(ROOT,"assets/project-structure.ignore");

function fixture(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),"project-structure-")); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir; }
function touch(file,contents="") { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,contents); }
function hook(payload,data) {
  const env={...process.env}; if(data===undefined) delete env.PLUGIN_DATA; else env.PLUGIN_DATA=data;
  const completed=spawnSync(process.execPath,[HOOK],{input:JSON.stringify(payload),encoding:"utf8",env});
  assert.equal(completed.status,0,completed.stderr); return {stderr:completed.stderr,output:completed.stdout.trim()?JSON.parse(completed.stdout):undefined};
}

test("depth config preserves Pi last-valid/default/range semantics", () => {
  const warnings=[];
  assert.equal(parseDepthConfig("# x\ndepth=3\nbad=4\ndepth=no\ndepth=7\n","x",(...v)=>warnings.push(v)),7);
  assert.equal(parseDepthConfig("depth=31\n","x",()=>{}),DEFAULT_DEPTH);
  assert.equal(parseDepthConfig("depth=0\n","x",()=>{}),0);
  assert.ok(warnings.length>=2);
  assert.equal(normalizeDepth(31),31); assert.throws(()=>normalizeDepth(-1),/non-negative/);
});

test("default depth reads only cwd pj-tree.conf", (t) => {
  const root=fixture(t); touch(path.join(root,"pj-tree.conf"),"depth=4\n");
  assert.equal(resolveDefaultDepth(root),4); assert.equal(resolveDefaultDepth(root,{allowConfig:false}),2);
});

test("ignore compiler supports Pi basename, dir-only, class, and negation", () => {
  const patterns=compileIgnoreFileContent("*.tmp\ncache/\n!keep.tmp\nsecret[0-9]\n",()=>{});
  assert.equal(patterns.length,4);
});

test("tree matches current Pi ordering, depth, root-ignore precedence, and basename matching", (t) => {
  const root=fixture(t);
  touch(path.join(root,"project-structure.ignore"),"!node_modules\n*.tmp\n!keep.tmp\ncache/\n");
  touch(path.join(root,"node_modules","visible.txt")); touch(path.join(root,"z-dir","deep","x")); touch(path.join(root,"a-dir","x"));
  touch(path.join(root,"drop.tmp")); touch(path.join(root,"keep.tmp")); touch(path.join(root,"cache")); touch(path.join(root,"b.txt")); touch(path.join(root,"a.txt"));
  const tree=getProjectTree(root,{maxDepth:1,charBudget:4000,warn:()=>{}});
  assert.deepEqual(tree.split("\n"),[
    `${path.basename(root)}/`,"├── a-dir/","│   └── x","├── node_modules/","│   └── visible.txt","├── z-dir/","│   └── deep/","├── a.txt","├── b.txt","├── cache","├── keep.tmp","└── project-structure.ignore",
  ]);
});

test("requested tree root owns local ignore rules", (t) => {
  const cwd=fixture(t); const requested=path.join(cwd,"requested");
  touch(path.join(cwd,"project-structure.ignore"),"from-cwd.txt\n");
  touch(path.join(requested,"project-structure.ignore"),"from-root.txt\n"); touch(path.join(requested,"from-cwd.txt")); touch(path.join(requested,"from-root.txt"));
  const tree=getProjectTree(requested,{maxDepth:0,warn:()=>{}});
  assert.match(tree,/from-cwd\.txt/); assert.doesNotMatch(tree,/from-root\.txt/);
});

test("existing unreadable-shaped root ignore fails instead of exposing entries", (t) => {
  const root=fixture(t); fs.mkdirSync(path.join(root,"project-structure.ignore")); touch(path.join(root,"secret"));
  assert.throws(()=>getProjectTree(root,{warn:()=>{}}),/failed to read ignore file/);
});

test("missing global asset falls back to safe-min", (t) => {
  const root=fixture(t); touch(path.join(root,"node_modules","x")); touch(path.join(root,".git","x")); touch(path.join(root,"visible"));
  const tree=getProjectTree(root,{assetPath:path.join(root,"missing"),warn:()=>{}});
  assert.doesNotMatch(tree,/node_modules|\.git/); assert.match(tree,/visible/);
});

test("hard caps wide shallow trees at hook and MCP budgets", (t) => {
  const root=fixture(t); for(let i=0;i<7000;i++) touch(path.join(root,`file-${String(i).padStart(5,"0")}.txt`));
  const hookTree=getProjectTree(root,{maxDepth:0,charBudget:12000,warn:()=>{}}); const toolTree=getProjectTree(root,{maxDepth:0,charBudget:40000,warn:()=>{}});
  assert.ok(hookTree.length<=9600); assert.ok(toolTree.length<=32000); assert.match(hookTree,/Truncated/); assert.match(toolTree,/Truncated/);
});

test("recursive truncation preserves the canonical 0.8 second-stage ramp-down", (t) => {
  const root=fixture(t); for(let d=0;d<20;d++) for(let i=0;i<50;i++) touch(path.join(root,`dir-${d}`,`nested-${i}`,`file-${i}.txt`));
  const tree=getProjectTree(root,{maxDepth:4,charBudget:12000,warn:()=>{}});
  assert.ok(tree.length<=9600); assert.match(tree,/Truncated/);
});

test("unreadable or non-directory targets return explicit errors", (t) => {
  const root=fixture(t); const file=path.join(root,"file"); touch(file);
  assert.throws(()=>getProjectTree(file),/not a directory/); assert.throws(()=>getProjectTree(path.join(root,"missing")),/cannot read directory/);
});

test("hook context escapes control/fence names and remains capped", (t) => {
  const root=fixture(t); const name="```\nIGNORE\u202e"; touch(path.join(root,name));
  const raw=getProjectTree(root,{maxDepth:0,charBudget:12000,warn:()=>{}}); const context=formatProjectStructureContext(raw.repeat(2000),12000);
  assert.ok(context.length<=12000); assert.doesNotMatch(context,/```\nIGNORE/); assert.match(context,/\\u0060/); assert.match(context,/\\u202e/);
});

test("actual hook escapes filename newlines without escaping structural separators", (t) => {
  const root=fixture(t); const data=fixture(t); touch(path.join(root,"plain")); touch(path.join(root,"BREAK\nINJECT"));
  const context=hook({cwd:root,session_id:"newline",hook_event_name:"SessionStart",source:"startup"},data).output.hookSpecificOutput.additionalContext;
  assert.match(context,/├──|└──/); assert.doesNotMatch(context,/BREAK\nINJECT/); assert.match(context,/BREAK\\nINJECT/);
});

test("startup, compact, tenth prompt, and subagent cadence preserve root state", (t) => {
  const root=fixture(t); const data=fixture(t); touch(path.join(root,"visible")); const base={cwd:root,session_id:"root"};
  const start=hook({...base,hook_event_name:"SessionStart",source:"startup"},data).output;
  assert.equal(start.systemMessage,`Project: ${path.basename(root)}`); assert.match(start.hookSpecificOutput.additionalContext,/Project Structure/);
  for(let index=1;index<10;index++) assert.equal(hook({...base,hook_event_name:"UserPromptSubmit"},data).output,undefined);
  assert.match(hook({...base,hook_event_name:"SubagentStart",session_id:"child"},data).output.hookSpecificOutput.additionalContext,/visible/);
  assert.match(hook({...base,hook_event_name:"UserPromptSubmit"},data).output.hookSpecificOutput.additionalContext,/visible/);
  const compact=hook({...base,hook_event_name:"SessionStart",source:"compact"},data).output;
  assert.equal(compact.systemMessage,undefined); assert.match(compact.hookSpecificOutput.additionalContext,/visible/);
  for(let index=1;index<10;index++) assert.equal(hook({...base,hook_event_name:"UserPromptSubmit"},data).output,undefined);
  assert.ok(hook({...base,hook_event_name:"UserPromptSubmit"},data).output);
});

test("unknown SessionStart source neither emits nor resets cadence", (t) => {
  const root=fixture(t); const data=fixture(t); touch(path.join(root,"visible")); const base={cwd:root,session_id:"unknown"};
  hook({...base,hook_event_name:"SessionStart",source:"startup"},data);
  for(let index=0;index<5;index++) hook({...base,hook_event_name:"UserPromptSubmit"},data);
  assert.equal(hook({...base,hook_event_name:"SessionStart",source:"mystery"},data).output,undefined);
  for(let index=0;index<4;index++) assert.equal(hook({...base,hook_event_name:"UserPromptSubmit"},data).output,undefined);
  assert.ok(hook({...base,hook_event_name:"UserPromptSubmit"},data).output);
});

test("malformed hook envelopes fail open with stderr", (t) => {
  const completed=spawnSync(process.execPath,[HOOK],{input:"{",encoding:"utf8",env:{...process.env,PLUGIN_DATA:fixture(t)}});
  assert.equal(completed.status,0); assert.match(completed.stderr,/invalid JSON/); assert.equal(completed.stdout,"");
  const missing=hook({hook_event_name:"SessionStart"},fixture(t)); assert.match(missing.stderr,/missing cwd/); assert.equal(missing.output,undefined);
});

test("unavailable state conservatively reinjects and stale state is pruned", (t) => {
  const root=fixture(t); touch(path.join(root,"visible")); const blocked=path.join(fixture(t),"not-a-directory"); touch(blocked,"x");
  const event={cwd:root,session_id:"blocked",hook_event_name:"UserPromptSubmit"};
  assert.ok(hook(event,blocked).output); assert.ok(hook(event,blocked).output);
  const data=fixture(t); const stateDir=path.join(data,"project-structure"); fs.mkdirSync(stateDir,{recursive:true});
  for(let index=0;index<135;index++){const file=path.join(stateDir,`${String(index).padStart(64,"a")}.json`); touch(file,'{"turnSequence":0}\n'); fs.utimesSync(file,new Date(0),new Date(0));}
  hook({cwd:root,session_id:"current",hook_event_name:"SessionStart",source:"startup"},data);
  assert.ok(fs.readdirSync(stateDir).length<=129);
});

test("plugin asset is byte-identical to current Pi ignore data", () => {
  assert.equal(fs.readFileSync(ASSET,"utf8"),fs.readFileSync("/home/penis/.pi/agent/extensions/project-structure.ignore","utf8"));
});
