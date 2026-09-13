#!/usr/bin/env node

import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import {
  ProjectTreeError,
  getProjectTree,
  normalizeDepth,
  resolveDefaultDepth,
  resolveTreePath,
} from "./tree.mjs";

const SERVER_NAME = "project-structure";
const SERVER_VERSION = "0.1.0";
const SANDBOX_STATE_CAPABILITY = "codex/sandbox-state-meta";

const PROJECT_TREE_TOOL = {
  name: "project_tree",
  title: "Project Tree",
  description:
    "Show a bounded directory tree using basename-matched project-structure.ignore rules. Defaults to the active Codex project directory.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Directory path, absolute or relative to the active project (defaults to the active project)",
      },
      depth: {
        type: "integer",
        minimum: 0,
        description: "Maximum recursive depth (defaults to active cwd/pj-tree.conf, otherwise 2)",
      },
    },
    additionalProperties: false,
  },
  annotations: {
    title: "Project Tree",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: "2.0", id, error });
}

function sandboxCwd(params) {
  const raw =
    params?._meta?.[SANDBOX_STATE_CAPABILITY]?.sandboxCwd ??
    params?._meta?.[SANDBOX_STATE_CAPABILITY]?.sandbox_cwd;
  if (typeof raw !== "string" || raw.length === 0) return process.cwd();

  try {
    if (raw.startsWith("file:")) return fileURLToPath(raw);
    if (path.isAbsolute(raw)) return raw;
  } catch {
    // Fall through to the server cwd when metadata is malformed.
  }
  return process.cwd();
}

function toolError(error) {
  const message =
    error instanceof ProjectTreeError || error instanceof Error
      ? error.message
      : String(error);
  return {
    content: [{ type: "text", text: `project_tree error: ${message}` }],
    isError: true,
  };
}

function callProjectTree(params) {
  const hasArguments = Object.hasOwn(params ?? {}, "arguments");
  const args = hasArguments ? params.arguments : {};
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return toolError(new ProjectTreeError("arguments must be an object"));
  }

  try {
    const unknown = Object.keys(args).filter((key) => key !== "path" && key !== "depth");
    if (unknown.length) throw new ProjectTreeError(`unknown argument: ${unknown[0]}`);
    if (Object.hasOwn(args, "path") && typeof args.path !== "string") throw new ProjectTreeError("path must be a string");
    if (Object.hasOwn(args, "depth") && !Number.isSafeInteger(args.depth)) throw new ProjectTreeError("depth must be an integer");
    const baseDir = sandboxCwd(params);
    const dir = resolveTreePath(args.path, baseDir);
    const maxDepth = args.depth === undefined ? resolveDefaultDepth(baseDir) : normalizeDepth(args.depth);
    const tree = getProjectTree(dir, { maxDepth, charBudget: 40000 });
    return { content: [{ type: "text", text: tree }] };
  } catch (error) {
    return toolError(error);
  }
}

function handleRequest(message) {
  const { id, method, params } = message;

  switch (method) {
    case "initialize":
      result(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: {
          tools: { listChanged: false },
          experimental: { [SANDBOX_STATE_CAPABILITY]: {} },
        },
        serverInfo: {
          name: SERVER_NAME,
          title: "Project Structure",
          version: SERVER_VERSION,
        },
        instructions:
          "Use project_tree when the user asks about file structure, directory layout, or which files exist in the project.",
      });
      return;

    case "ping":
      result(id, {});
      return;

    case "tools/list":
      result(id, { tools: [PROJECT_TREE_TOOL] });
      return;

    case "tools/call":
      if (params?.name !== "project_tree") {
        rpcError(id, -32602, `Unknown tool: ${params?.name ?? "<missing>"}`);
        return;
      }
      result(id, callProjectTree(params));
      return;

    default:
      rpcError(id, -32601, `Method not found: ${method}`);
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on("line", (line) => {
  if (line.trim() === "") return;

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    rpcError(null, -32700, "Parse error", error.message);
    return;
  }

  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") {
    if (Object.hasOwn(message ?? {}, "id")) {
      rpcError(message.id, -32600, "Invalid Request");
    }
    return;
  }

  if (!Object.hasOwn(message, "id")) return;

  try {
    handleRequest(message);
  } catch (error) {
    rpcError(message.id, -32603, "Internal error", error.message);
  }
});

input.on("error", (error) => {
  process.stderr.write(`${SERVER_NAME}: stdin error: ${error.message}\n`);
});
