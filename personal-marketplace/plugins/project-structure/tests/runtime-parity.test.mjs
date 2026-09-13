import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getProjectTree } from "../scripts/tree.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MCP = path.join(ROOT, "scripts/project-tree-mcp.mjs");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "project-structure-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function touch(file, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

test("ordinary tree output matches the current Pi context and tool", async (t) => {
  const root = fixture(t);
  touch(path.join(root, "project-structure.ignore"), "*.tmp\n!keep.tmp\n");
  for (const file of ["src/deep/x.ts", "drop.tmp", "keep.tmp", "README.md"])
    touch(path.join(root, file));

  const source =
    await import("/home/penis/.pi/agent/extensions/project-structure.ts");
  const handlers = new Map();
  let tool;
  source.default({
    on: (name, handler) => handlers.set(name, handler),
    registerTool: (definition) => {
      tool = definition;
    },
  });
  const ctx = {
    cwd: root,
    model: { api: "openai-completions" },
    isProjectTrusted: () => true,
    ui: { notify: () => {} },
  };
  handlers.get("session_start")({}, ctx);
  handlers.get("context")({ messages: [] }, ctx);
  const payload = { messages: [{ role: "system", content: "base" }] };
  handlers.get("before_provider_request")({ payload });
  const block = payload.messages.find((message) =>
    message.content.startsWith("## Project Structure"),
  );
  const canonical = block.content
    .split("## Project Structure\n```\n")[1]
    .replace(/\n```$/, "");
  const adapted = getProjectTree(root, {
    maxDepth: 2,
    charBudget: 12000,
    warn: () => {},
  });
  assert.equal(adapted, canonical);
  const result = await tool.execute(
    "id",
    { path: root, depth: 2 },
    null,
    null,
    ctx,
  );
  assert.equal(result.content[0].text, adapted);
});

async function mcpClient(t, cwd) {
  const child = spawn(process.execPath, [MCP], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const lines = readline.createInterface({ input: child.stdout });
  let id = 0;
  const pending = new Map();
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  const call = (method, params = {}) => {
    const current = ++id;
    const response = new Promise((resolve) => pending.set(current, resolve));
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: current, method, params })}\n`,
    );
    return response;
  };
  const meta = { "codex/sandbox-state-meta": { sandboxCwd: cwd } };
  return {
    call: (method, params = {}) => call(method, { ...params, _meta: meta }),
  };
}

test("MCP uses cwd defaults, explicit inputs, and validation", async (t) => {
  const root = fixture(t);
  touch(path.join(root, "pj-tree.conf"), "depth=0\n");
  touch(path.join(root, "sub/deep/x"));
  touch(path.join(root, "root.txt"));
  const client = await mcpClient(t, root);
  const initialized = await client.call("initialize", {
    protocolVersion: "2025-06-18",
  });
  assert.equal(initialized.result.serverInfo.name, "project-structure");
  const listed = await client.call("tools/list");
  assert.equal(
    listed.result.tools[0].inputSchema.properties.depth.maximum,
    undefined,
  );
  const defaultCall = await client.call("tools/call", {
    name: "project_tree",
    arguments: {},
  });
  assert.doesNotMatch(defaultCall.result.content[0].text, /deep/);
  const explicit = await client.call("tools/call", {
    name: "project_tree",
    arguments: { path: "sub", depth: 2 },
  });
  assert.match(explicit.result.content[0].text, /deep[\s\S]*x/);
  touch(path.join(root, "pj-tree.conf"), "depth=broken\n");
  for (const argumentsValue of [{ path: "sub", depth: 1 }, { depth: 31 }]) {
    const accepted = await client.call("tools/call", {
      name: "project_tree",
      arguments: argumentsValue,
    });
    assert.equal(accepted.result.isError, undefined);
  }
  for (const argumentsValue of [
    { depth: -1 },
    { extra: true },
    null,
    { path: null },
    { depth: null },
  ]) {
    const rejected = await client.call("tools/call", {
      name: "project_tree",
      arguments: argumentsValue,
    });
    assert.equal(rejected.result.isError, true);
  }
});
