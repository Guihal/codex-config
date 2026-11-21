import { UPDATE_RULE, DERIVED_TASK_RULE } from "./render.mjs";
import crypto from "node:crypto";

import { rotateToken, transactSessionState } from "./state.mjs";

export const MAX_TASK_BYTES = 32 * 1024;
const MAX_REASON_LENGTH = 1_000;
const MAX_ADD_ITEMS = 64;

export const SET_TOOL = {
  name: "control_task_set",
  title: "Set Session Control Task",
  description: `${DERIVED_TASK_RULE} ${UPDATE_RULE} Use the latest injected base token; binding is only this Codex session.`,
  inputSchema: {
    type: "object",
    properties: {
      base_token: { type: "string", minLength: 16 },
      task_body: { type: "string", minLength: 1 },
      reason: { type: "string", minLength: 1, maxLength: 1000 },
    },
    required: ["base_token", "task_body", "reason"],
    additionalProperties: false,
  },
  annotations: {
    title: "Set Session Control Task",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export const ADD_TOOL = {
  name: "control_task_add",
  title: "Add Items To Session Control Task",
  description: `${DERIVED_TASK_RULE} ${UPDATE_RULE} Appends items to the anchored task instead of replacing the whole body. Items already present (compared after trimming, collapsing whitespace and lowercasing) are skipped, so repeating the same call converges instead of growing the anchor. Use the latest injected base token; binding is only this Codex session.`,
  inputSchema: {
    type: "object",
    properties: {
      base_token: { type: "string", minLength: 16 },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: { type: "string", minLength: 1, maxLength: 4000 },
      },
      reason: { type: "string", minLength: 1, maxLength: 1000 },
    },
    required: ["base_token", "items", "reason"],
    additionalProperties: false,
  },
  annotations: {
    title: "Add Items To Session Control Task",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export function toolError(message) {
  return {
    content: [{ type: "text", text: `control_task_set error: ${message}` }],
    isError: true,
  };
}

function addError(message) {
  return {
    content: [{ type: "text", text: `control_task_add error: ${message}` }],
    isError: true,
  };
}

export function getThreadId(params) {
  const value = params?._meta?.threadId ?? params?._meta?.thread_id;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Codex thread metadata is unavailable");
  }
  return value;
}

export function isValidToken(actual, supplied) {
  if (typeof supplied !== "string" || actual.length !== supplied.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(supplied));
}

function validateArguments(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("arguments must be an object");
  }
  const allowed = new Set(["base_token", "task_body", "reason"]);
  const unknown = Object.keys(args).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown argument: ${unknown}`);
  if (typeof args.base_token !== "string") {
    throw new Error("base_token must be a string");
  }
  if (typeof args.task_body !== "string" || args.task_body.trim() === "") {
    throw new Error("task_body must not be empty");
  }
  if (Buffer.byteLength(args.task_body, "utf8") > MAX_TASK_BYTES) {
    throw new Error(`task_body exceeds ${MAX_TASK_BYTES} bytes`);
  }
  if (typeof args.reason !== "string" || args.reason.trim() === "") {
    throw new Error("reason must not be empty");
  }
  if (args.reason.length > MAX_REASON_LENGTH) {
    throw new Error(`reason exceeds ${MAX_REASON_LENGTH} characters`);
  }
  return args;
}

function validateAddArguments(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("arguments must be an object");
  }
  const allowed = new Set(["base_token", "items", "reason"]);
  const unknown = Object.keys(args).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown argument: ${unknown}`);
  if (typeof args.base_token !== "string") {
    throw new Error("base_token must be a string");
  }
  if (!Array.isArray(args.items) || args.items.length === 0) {
    throw new Error("items must be a non-empty array");
  }
  if (args.items.length > MAX_ADD_ITEMS) {
    throw new Error(`items exceeds ${MAX_ADD_ITEMS} entries`);
  }
  for (const item of args.items) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error("every item must be a non-empty string");
    }
  }
  if (typeof args.reason !== "string" || args.reason.trim() === "") {
    throw new Error("reason must not be empty");
  }
  if (args.reason.length > MAX_REASON_LENGTH) {
    throw new Error(`reason exceeds ${MAX_REASON_LENGTH} characters`);
  }
  return args;
}

// Dedupe key mirroring omo's itemKey: a repeated item with different spacing or
// casing must converge instead of growing the anchor, and the byte ceiling must
// hold here too — otherwise a later control_task_set would reject the document.
export function itemKey(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function addTask(params) {
  try {
    const sessionId = getThreadId(params);
    const args = validateAddArguments(params.arguments);
    let addedCount = 0;
    let skippedCount = 0;
    const state = transactSessionState(sessionId, "unavailable", (current) => {
      if (!isValidToken(current.baseToken, args.base_token)) {
        throw new Error("stale or invalid base_token");
      }
      if (
        current.status !== "current" ||
        typeof current.taskBody !== "string"
      ) {
        throw new Error(
          "no control task recorded; call control_task_set first",
        );
      }
      const known = new Set(
        current.taskBody
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map(itemKey),
      );
      const fresh = [];
      for (const item of args.items) {
        const key = itemKey(item);
        if (known.has(key)) {
          skippedCount += 1;
          continue;
        }
        known.add(key);
        fresh.push(item.trim());
      }
      addedCount = fresh.length;
      if (fresh.length === 0) {
        return { ...current, reason: args.reason };
      }
      const separator = current.taskBody.endsWith("\n") ? "" : "\n";
      const nextBody = current.taskBody + separator + fresh.join("\n") + "\n";
      if (Buffer.byteLength(nextBody, "utf8") > MAX_TASK_BYTES) {
        throw new Error(
          `resulting task_body would exceed ${MAX_TASK_BYTES} bytes; use control_task_set to rewrite the anchor`,
        );
      }
      return {
        ...current,
        status: "current",
        revision: current.revision + 1,
        baseToken: rotateToken(),
        taskBody: nextBody,
        reason: args.reason,
        updatedAt: new Date().toISOString(),
      };
    });
    const committed = addedCount > 0;
    return {
      content: [
        {
          type: "text",
          text: committed
            ? `control_task_add committed: revision ${state.revision}, added ${addedCount}, skipped ${skippedCount}`
            : `control_task_add unchanged: all ${skippedCount} items already present, revision ${state.revision}`,
        },
      ],
      structuredContent: {
        status: committed ? "committed" : "unchanged",
        revision: state.revision,
        added: addedCount,
        skipped: skippedCount,
        sessionBound: true,
      },
    };
  } catch (error) {
    return addError(error instanceof Error ? error.message : String(error));
  }
}

export function setTask(params) {
  try {
    const sessionId = getThreadId(params);
    const args = validateArguments(params.arguments);
    const state = transactSessionState(sessionId, "unavailable", (current) => {
      if (!isValidToken(current.baseToken, args.base_token)) {
        throw new Error("stale or invalid base_token");
      }
      return {
        ...current,
        status: "current",
        revision: current.revision + 1,
        baseToken: rotateToken(),
        taskBody: args.task_body,
        reason: args.reason,
        updatedAt: new Date().toISOString(),
      };
    });
    return {
      content: [
        {
          type: "text",
          text: `control_task_set committed: revision ${state.revision}, session-bound`,
        },
      ],
      structuredContent: {
        status: "committed",
        revision: state.revision,
        sessionBound: true,
      },
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}
