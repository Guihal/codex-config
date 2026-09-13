import { consumeBootstrap } from "./bootstrap-state.mjs";
import { getThreadId, isValidToken, toolError } from "./control-task-tool.mjs";
import { rotateToken, transactSessionState } from "./state.mjs";

const ADOPT_REASON = "Initialize from the subagent launch prompt";

export const ADOPT_TOOL = {
  name: "control_task_adopt",
  title: "Adopt Subagent Control Task",
  description:
    "Initialize this subagent's durable task from the exact launch prompt captured by the control-task hook. Call once before substantial subagent work when the launch prompt contains a bootstrap token.",
  inputSchema: {
    type: "object",
    properties: {
      base_token: { type: "string", minLength: 16 },
      bootstrap_token: { type: "string", minLength: 16 },
    },
    required: ["base_token", "bootstrap_token"],
    additionalProperties: false,
  },
  annotations: {
    title: "Adopt Subagent Control Task",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

function validateArguments(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("arguments must be an object");
  }
  const allowed = new Set(["base_token", "bootstrap_token"]);
  const unknown = Object.keys(args).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown argument: ${unknown}`);
  if (typeof args.base_token !== "string") {
    throw new Error("base_token must be a string");
  }
  if (typeof args.bootstrap_token !== "string") {
    throw new Error("bootstrap_token must be a string");
  }
  return args;
}

export function adoptTask(params) {
  try {
    const sessionId = getThreadId(params);
    const args = validateArguments(params.arguments);
    const state = consumeBootstrap(args.bootstrap_token, (taskBody) =>
      transactSessionState(sessionId, "unavailable", (current) => {
        if (!isValidToken(current.baseToken, args.base_token)) {
          throw new Error("stale or invalid base_token");
        }
        return {
          ...current,
          status: "current",
          revision: current.revision + 1,
          baseToken: rotateToken(),
          taskBody,
          reason: ADOPT_REASON,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
    return {
      content: [
        {
          type: "text",
          text: `control_task_adopt committed: revision ${state.revision}, session-bound`,
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
