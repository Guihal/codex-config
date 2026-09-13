#!/usr/bin/env node

import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const PROJECT_HOOK_TIMEOUT_MS = 1_000;

function isInside(cwd, target) {
  const relative = path.relative(cwd, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function extractPatchPaths(command, cwd) {
  const paths = []; let updateSource;
  const add = (raw, explicitAbsolute = path.isAbsolute(raw)) => {
    const target = path.resolve(cwd, raw);
    if (!explicitAbsolute && !isInside(cwd, target)) return;
    if (!paths.includes(target)) paths.push(target);
  };
  const remove = (raw) => { const target = path.resolve(cwd, raw); const index = paths.indexOf(target); if (index >= 0) paths.splice(index, 1); };
  for (const line of command.split("\n")) {
    let match = /^\*\*\* Add File: (.+)$/.exec(line);
    if (match) { updateSource = undefined; add(match[1]); continue; }
    match = /^\*\*\* Update File: (.+)$/.exec(line);
    if (match) { updateSource = match[1]; add(match[1]); continue; }
    match = /^\*\*\* Move to: (.+)$/.exec(line);
    if (match && updateSource) { remove(updateSource); add(match[1]); updateSource = undefined; continue; }
    if (/^\*\*\* Delete File: /.test(line)) updateSource = undefined;
  }
  return paths;
}

function lintInWorker(items) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./lint-inject-worker.mjs", import.meta.url), { workerData: { items } });
    let settled = false;
    const finish = (operation, value) => {
      if (settled) return;
      settled = true; clearTimeout(hookTimer); void worker.terminate(); operation(value);
    };
    const hookTimer = setTimeout(() => finish(resolve, `[lint-inject] hook: хук упал: timeout ${PROJECT_HOOK_TIMEOUT_MS}ms`), PROJECT_HOOK_TIMEOUT_MS);
    worker.on("message", (message) => {
      if (message?.type === "plans-resolved") { clearTimeout(hookTimer); return; }
      if (message?.type === "report") finish(resolve, message.report);
      if (message?.type === "error") finish(reject, new Error(message.error));
    });
    worker.on("error", (error) => finish(reject, error));
    worker.on("exit", (code) => { if (!settled) finish(reject, new Error(`lint worker exited ${code}`)); });
  });
}

async function existingFiles(paths) {
  const files = [];
  for (const candidate of paths) {
    try {
      if ((await stat(candidate)).isFile()) files.push(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }
  }
  return files;
}

export async function handleEvent(event) {
  if (event?.hook_event_name !== "PostToolUse" || event?.tool_name !== "apply_patch" || typeof event?.tool_input?.command !== "string" || typeof event?.cwd !== "string") return undefined;
  const files = await existingFiles(extractPatchPaths(event.tool_input.command, event.cwd));
  if (files.length === 0) return undefined;
  const report = await lintInWorker(files.map((abs) => ({ abs, editedAt: Date.now() })));
  return report ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: report } } : undefined;
}

async function main() {
  let raw = "";
  try {
    for await (const chunk of process.stdin) raw += chunk;
  } catch (error) {
    process.stderr.write(`[lint-inject] unexpected error: ${error?.stack ?? error}\n`);
    return;
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  try {
    const output = await handleEvent(event);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    // Runtime faults are observable, but never turn lint advice into a block.
    process.stderr.write(`[lint-inject] unexpected error: ${error?.stack ?? error}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
