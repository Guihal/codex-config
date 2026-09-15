"""Skill recovery lifecycle. PostCompact marks readiness; context hooks deliver."""
from pathlib import Path
import uuid

from .common import GuardError, blank_state, context_output
from .skills import Settings, observe_tool, render_skills, scan_transcript


def handle_recovery(event: dict, state: dict, config: Settings) -> dict:
    name = event.get("hook_event_name")
    source = event.get("source")
    if name == "SessionStart" and source == "clear":
        state.clear()
        state.update(blank_state())
        scan_transcript(state, event, config, skip=True)
        return {}
    if name in {"PostToolUse", "PreCompact", "UserPromptSubmit", "SessionStart", "SubagentStart"}:
        scan_transcript(state, event, config)
    if name == "PostToolUse":
        arguments = event.get("tool_input", {})
        if isinstance(arguments, dict):
            observe_tool(state, event.get("tool_name", ""), arguments,
                         event.get("tool_response"), Path(event.get("cwd", ".")), config)
        return {}
    if name == "PreCompact":
        _, hashes = render_skills(state, config)
        state["pending"] = {"id": uuid.uuid4().hex, "hashes": hashes, "phase": "prepared"}
        return {}
    checkpoint = state.get("pending")
    if name == "PostCompact":
        if checkpoint is None:
            if state["skills"] or state.get("unresolved"):
                raise GuardError("Missing PreCompact checkpoint. Trust both compact hooks before relying on skill restoration.")
        elif checkpoint.get("phase") != "delivered":
            checkpoint["phase"] = "ready"
        return {}  # PostCompact does NOT consume additionalContext in Codex.
    if not checkpoint or checkpoint.get("phase") == "delivered":
        return {}
    is_compact_start = name == "SessionStart" and source == "compact"
    if not is_compact_start and (checkpoint.get("phase") != "ready" or name not in {"UserPromptSubmit", "PreToolUse", "SessionStart"}):
        return {}
    hashes = checkpoint.get("hashes")
    if not isinstance(hashes, dict):
        raise GuardError("Invalid skill-recovery checkpoint hashes.")
    text, _ = render_skills(state, config, hashes)
    checkpoint["phase"] = "delivered"
    if not text:
        return {}
    reason = None
    if name == "PreToolUse":
        # The model chose this call without the missing instructions. Make it reconsider.
        reason = "Skills were restored after compaction. Re-evaluate this action against the full instructions, then retry if still correct."
    return context_output(name, text, reason)