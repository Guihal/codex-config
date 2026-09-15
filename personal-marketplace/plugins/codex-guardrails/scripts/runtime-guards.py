#!/usr/bin/env python3
"""Codex command-hook boundary; Python 3.10+ on Linux, standard library only."""
import json
import os
from pathlib import Path
import sys

from runtime_guards.common import GuardError, context_output, state_transaction
from runtime_guards.processes import evaluate
from runtime_guards.recovery import handle_recovery
from runtime_guards.skills import settings, thread_key

EVENTS = {"SessionStart", "SubagentStart", "UserPromptSubmit", "PostToolUse", "PreToolUse", "PreCompact", "PostCompact"}


def emit(output: dict) -> None:
    if output:
        sys.stdout.write(json.dumps(output, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def failure(event: str, message: str) -> dict:
    message = "[runtime-guards] " + message
    if event == "PreToolUse":
        return context_output(event, "", message)
    if event in {"PreCompact", "PostCompact", "SessionStart", "UserPromptSubmit"}:
        return {"continue": False, "stopReason": message}
    return {"systemMessage": message}


def main() -> None:
    event_name = ""
    emitted = False
    try:
        # Input truncation is detected, not parsed as a valid shorter event.
        raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise GuardError("Hook input exceeded the supported size.")
        event = json.loads(raw)
        if not isinstance(event, dict) or event.get("hook_event_name") not in EVENTS:
            return
        event_name = event["hook_event_name"]
        denial = None
        if event_name == "PreToolUse" and event.get("tool_name") == "Bash":
            command = event.get("tool_input", {}).get("command")
            if isinstance(command, str):
                denial = evaluate(command)
        data_dir = os.environ.get("PLUGIN_DATA")
        if not data_dir:
            raise GuardError("Missing PLUGIN_DATA; recovery cannot isolate this thread.")
        plugin_root = Path(__file__).resolve().parent.parent
        config = settings(plugin_root, Path(event.get("cwd", ".")).resolve())
        # Codex session_id is shared by root and descendants, not a thread ID.
        # Role names are not identities; siblings with the same role stay separate.
        reset = event_name == "SessionStart" and event.get("source") == "clear"
        with state_transaction(Path(data_dir), thread_key(event), reset=reset) as state:
            result = handle_recovery(event, state, config)
            if denial:
                result = context_output(event_name, result.get("hookSpecificOutput", {}).get("additionalContext", ""), denial)
            # Emit before committing delivery bookkeeping: a crash may repeat context,
            # but must not mark a body delivered before it has even reached stdout.
            emit(result)
            emitted = bool(result)
    except GuardError as error:
        if emitted:
            sys.stderr.write("[runtime-guards] Delivery bookkeeping failed; context may be repeated.\n")
        else:
            emit(failure(event_name, str(error)))
    except Exception as error:
        # No transcript text, command, config value or raw OS exception in diagnostics.
        if emitted:
            sys.stderr.write("[runtime-guards] Delivery bookkeeping failed; context may be repeated.\n")
        else:
            emit(failure(event_name, f"Hook input/state/source could not be processed ({type(error).__name__}). Recovery was not confirmed."))


if __name__ == "__main__":
    main()