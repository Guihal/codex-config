#!/usr/bin/env node

import fs from "node:fs";
import readline from "node:readline";

import { ADOPT_TOOL, adoptTask } from "./control-task-adopt.mjs";
import { SET_TOOL, setTask } from "./control-task-tool.mjs";

const MANIFEST_URL = new URL("../.codex-plugin/plugin.json", import.meta.url);
const SERVER_VERSION = JSON.parse(
  fs.readFileSync(MANIFEST_URL, "utf8"),
).version;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function rpcError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    result(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: "control-task",
        title: "Control Task",
        version: SERVER_VERSION,
      },
      instructions:
        "Use control_task_set to anchor a root session task. Subagents use control_task_adopt with the bootstrap token from their launch prompt. Both tools bind from Codex thread metadata; never ask for or copy a session id.",
    });
    return;
  }
  if (method === "ping") return result(id, {});
  if (method === "tools/list") {
    return result(id, { tools: [SET_TOOL, ADOPT_TOOL] });
  }
  if (method === "tools/call" && params?.name === "control_task_set")
    return result(id, setTask(params));
  if (method === "tools/call" && params?.name === "control_task_adopt") {
    return result(id, adoptTask(params));
  }
  if (Object.hasOwn(message, "id"))
    rpcError(id, -32601, `Method not found: ${method}`);
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
input.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    if (message?.jsonrpc === "2.0" && typeof message.method === "string")
      handle(message);
  } catch (error) {
    rpcError(
      null,
      -32700,
      error instanceof Error ? error.message : "Parse error",
    );
  }
});
