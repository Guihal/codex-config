export const TASK_MARKER = "<!-- codex-control-task:v1 -->";

const INTERNAL =
  "Internal session state, not a user message. Do not reply to this block; act on the actual user request.";

const UPDATE_RULE =
  "After each user message, decompose the request and update control state with control_task_set, then continue the task. Preserve the original goal and compatible constraints; a clarification or question does not replace the whole task.";

export const USER_PROMPT_REMINDER = "DECOMPOSE THE USER'S REQUEST AND UPDATE CONTROL STATE, THEN CONTINUE THE TASK. Use control_task_set with the latest base token. Keep the original goal and compatible constraints when integrating the new request.";

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
