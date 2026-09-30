import crypto from "node:crypto";

import { rotateToken, transactSessionState } from "./state.mjs";

export const MAX_TASK_BYTES = 32 * 1024;
const MAX_REASON_LENGTH = 1_000;

export const SET_TOOL = {
  name: "control_task_set",
  title: "Set Session Control Task",
  description:
    "Update the canonical control state for only this Codex session after decomposing each user message, then continue the task. Use the latest injected base token. Preserve the original goal and compatible constraints; integrate the new request without replacing the whole task with a question or status report.",
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

export function toolError(message) {
  return {
    content: [{ type: "text", text: `control_task_set error: ${message}` }],
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
