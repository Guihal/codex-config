export const TASK_MARKER = "<!-- codex-control-task:v1 -->";

const INTERNAL =
  "Internal main-task anchor, not a user message. Do not reply to this block; act on the actual user request.";

export const UPDATE_RULE =
  "After each user message, and ONLY after a user message, call control_task_set with the complete MAIN TASK, then continue. Never update it during tool-only work, compaction, verification or progress changes. DECOMPOSE STRUCTURE, NOT SEMANTICS. Preserve the original goal and compatible constraints, every requirement, and quantified/general rules in full meaning; questions or clarifications do not replace the whole task. Preserve consequential original wording and source references. Missing requirements here are not exclusions. Known targets are non-exhaustive coverage kept ONLY in conversation context: keep coverage OPEN until exhaustive discovery is evidenced. Newly discovered qualifying targets and necessary integration are already in scope, subject to edit authority; do not persist discovery/progress updates in control-task.";

export const DERIVED_TASK_RULE =
  "This is the canonical MAIN TASK anchor, NOT current execution state. It stores the user-requested outcome, complete requirements, constraints and structural decomposition only. Original user messages and governing project sources remain authoritative. Missing requirements here are not exclusions; correct incomplete or misinterpreted task definitions against those sources only after a user message. Current execution state, progress, agents, temporary parameters, measurements, check results, completed-work and next-step reports stay ONLY in conversation context. Never write them to control-task, agent-state, or any other durable artifact reinjected into context. Periodic hooks only re-inject the unchanged task; they do not authorize task updates.";

export const USER_PROMPT_REMINDER = "UPDATE THE MAIN TASK ONLY AFTER THIS USER MESSAGE, THEN CONTINUE THE TASK. DECOMPOSE STRUCTURE, NOT SEMANTICS. Store the main task and requirements, never execution state. Use control_task_set with the latest base token.";

export function renderTaskState(state) {
  const header = [
    TASK_MARKER,
    "",
    INTERNAL,
    DERIVED_TASK_RULE,
    UPDATE_RULE,
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
      "Later user messages change it only where they explicitly modify the task; the actual user request wins on conflict.",
    ].join("\n");
  }
  if (state.status === "unavailable") {
    return [
      ...header,
      "",
      "## ACTIVE TASK — UNAVAILABLE",
      "",
      "The stored task for this resumed or compacted session is missing or corrupt.",
      "Do not reconstruct it from conversation summaries. Recover from available original user messages/governing sources; if unavailable, ask the user to restate the task, then call control_task_set.",
    ].join("\n");
  }
  return [
    ...header,
    "",
    "## ACTIVE TASK — NOT SET",
    "",
    "After a user message establishes the main task, record that task before substantial work with control_task_set. Never use this anchor for execution state.",
  ].join("\n");
}
