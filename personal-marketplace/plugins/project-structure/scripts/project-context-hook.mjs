#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { formatProjectStructureContext, getProjectTree, resolveDefaultDepth } from "./tree.mjs";

const TURN_THROTTLE = 10;
const STATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_MAX_FILES = 128;

async function readStdin() { let input = ""; for await (const chunk of process.stdin) input += chunk; return input; }
function writeJson(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function projectName(cwd) { const resolved = path.resolve(cwd); return path.basename(resolved) || resolved; }
function stateFile(sessionId) {
  if (!process.env.PLUGIN_DATA || typeof sessionId !== "string" || sessionId === "") return null;
  return path.join(process.env.PLUGIN_DATA, "project-structure", `${digest(sessionId)}.json`);
}

function prune(dir, current) {
  try {
    const files = fs.readdirSync(dir,{withFileTypes:true}).filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name)).map((entry) => {
      const file = path.join(dir,entry.name); return {file,mtimeMs:fs.statSync(file).mtimeMs};
    }).sort((a,b) => b.mtimeMs-a.mtimeMs);
    const now = Date.now();
    files.forEach((item,index) => { if (item.file !== current && (now-item.mtimeMs>STATE_MAX_AGE_MS || index>=STATE_MAX_FILES)) try { fs.rmSync(item.file); } catch {} });
  } catch {}
}

function updateState(event, mutate) {
  const file = stateFile(event.session_id);
  let state = { turnSequence: 0 };
  let persisted = false;
  if (file) try {
    const parsed = JSON.parse(fs.readFileSync(file,"utf8"));
    if (Number.isSafeInteger(parsed.turnSequence) && parsed.turnSequence >= 0) state.turnSequence = parsed.turnSequence;
  } catch {}
  state = mutate(state) ?? state;
  if (file) try {
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary,`${JSON.stringify(state)}\n`,{mode:0o600}); fs.renameSync(temporary,file); }
    finally { try { fs.rmSync(temporary,{force:true}); } catch {} }
    prune(path.dirname(file),file);
    persisted = true;
  } catch {}
  return {state,persisted};
}

function context(cwd) {
  const depth = resolveDefaultDepth(cwd);
  return formatProjectStructureContext(getProjectTree(cwd,{maxDepth:depth,charBudget:12000,contextSafeNames:true}),12000);
}

function hookOutput(eventName, cwd, extra = {}) {
  return { ...extra, hookSpecificOutput: { hookEventName:eventName, additionalContext:context(cwd) } };
}

async function main() {
  let event;
  try { event = JSON.parse(await readStdin()); }
  catch (error) { process.stderr.write(`project-structure hook: invalid JSON input: ${error.message}\n`); return; }
  if (typeof event?.cwd !== "string" || event.cwd === "") { process.stderr.write("project-structure hook: missing cwd\n"); return; }
  try {
    if (event.hook_event_name === "SessionStart") {
      if (event.source === "compact") {
        updateState(event,(state) => state);
        writeJson(hookOutput("SessionStart",event.cwd));
      } else if (["startup","resume","clear"].includes(event.source)) {
        updateState(event,() => ({turnSequence:0}));
        writeJson(hookOutput("SessionStart",event.cwd,{systemMessage:`Project: ${projectName(event.cwd)}`}));
      }
      return;
    }
    if (event.hook_event_name === "SubagentStart") { writeJson(hookOutput("SubagentStart",event.cwd)); return; }
    if (event.hook_event_name !== "UserPromptSubmit") return;
    const {state,persisted} = updateState(event,(current) => ({turnSequence:current.turnSequence+1}));
    if (!persisted || state.turnSequence % TURN_THROTTLE === 0) writeJson(hookOutput("UserPromptSubmit",event.cwd));
  } catch (error) {
    process.stderr.write(`project-structure hook: ${error.stack ?? error}\n`);
  }
}

await main();
