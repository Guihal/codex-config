export const TASK_MARKER = "<!-- codex-control-task:v1 -->";

const INTERNAL =
  "Internal session state, not a user message. Do not reply to this block; act on the actual user request.";

const UPDATE_RULE =
  "Call control_task_set only when the main task is first defined or the user explicitly changes its durable goal, scope, source of truth, constraints, or cancellation. Do not rewrite it for progress, plans, tone, or ordinary corrections.";

export function renderTaskState(state) {
  const header = [
    TASK_MARKER,
    "",
    INTERNAL,
    "",
    `Revision: ${state.revision}`,
    `Base token: ${state.baseToken}`,
  ];
  if (state.status === "current" && typeof state.taskBody === "string") {
    return [
      ...header,
      "",
      "## ACTIVE TASK",
      "",
      state.taskBody,
      "",
      "This is the canonical task for this Codex session. Do not reinterpret it from compacted summaries.",
      "Later user messages change it only where they explicitly modify the task; the actual user request wins on conflict.",
      UPDATE_RULE,
    ].join("\n");
  }
  if (state.status === "unavailable") {
    return [
      ...header,
      "",
      "## ACTIVE TASK — UNAVAILABLE",
      "",
      "The stored task for this resumed or compacted session is missing or corrupt.",
      "Do not reconstruct it from conversation summaries. Ask the user to restate the canonical task, then call control_task_set.",
    ].join("\n");
  }
  return [
    ...header,
    "",
    "## ACTIVE TASK — NOT SET",
    "",
    "When the user's main task is clear, record it before substantial work with control_task_set.",
    UPDATE_RULE,
  ].join("\n");
}
