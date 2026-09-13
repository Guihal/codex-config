export function buildHookOutput(hookEventName, additionalContext, systemMessages = []) {
  const output = {};
  if (additionalContext) {
    output.hookSpecificOutput = { hookEventName, additionalContext };
  }
  if (systemMessages.length) output.systemMessage = systemMessages.join("\n");
  return Object.keys(output).length ? output : null;
}

export function mergeContext(...parts) {
  return parts.filter(Boolean).join("\n\n");
}
