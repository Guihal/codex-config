"""Run: python3 -m unittest discover -s tests -p 'test_*.py' -v"""
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN / "scripts"))
from runtime_guards.common import GuardError, blank_state, read_regular
from runtime_guards.processes import Process, evaluate, is_agent, pgrep, protected_pids, snapshot
from runtime_guards.recovery import handle_recovery
from runtime_guards.shell import skill_reads, static_commands
from runtime_guards.skills import Settings, observe_tool, render_skills, scan_transcript, settings, thread_key


class HookIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.data = self.home / "plugin-data"
        self.path = self.home / ".codex/skills/demo/SKILL.md"
        self.path.parent.mkdir(parents=True)
        self.path.write_text("# Full workflow\nNever skip the final verification gate.\n")
        self.env = {**os.environ, "HOME": str(self.home), "CODEX_HOME": str(self.home / ".codex"), "PLUGIN_DATA": str(self.data)}

    def run_hook(self, name, session="main", **extra):
        event = {"hook_event_name": name, "session_id": session, "cwd": str(self.home), **extra}
        result = subprocess.run([sys.executable, str(PLUGIN / "scripts/runtime-guards.py")], input=json.dumps(event),
                                capture_output=True, text=True, env=self.env, timeout=5, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return json.loads(result.stdout) if result.stdout else {}

    def remember(self, session="main"):
        return self.run_hook("PostToolUse", session, tool_name="Bash", tool_input={"command": f"cat '{self.path}'"}, tool_response={"exit_code": 0})

    def test_full_cli_lifecycle_with_subagent_isolation(self):
        self.assertEqual(self.remember("child"), {})
        for session in ["main", "child"]:
            self.assertEqual(self.run_hook("PreCompact", session), {})
            self.assertEqual(self.run_hook("PostCompact", session), {})
        self.assertEqual(self.run_hook("PreToolUse", "main", tool_name="apply_patch"), {})
        restored = self.run_hook("PreToolUse", "child", tool_name="apply_patch")["hookSpecificOutput"]
        self.assertEqual(restored["permissionDecision"], "deny")
        self.assertIn(self.path.read_text(), restored["additionalContext"])
        self.assertEqual(self.run_hook("PreToolUse", "child", tool_name="apply_patch"), {})

    def test_parallel_read_observers_do_not_lose_skills(self):
        children = []
        for i in range(8):
            path = self.path.parent.parent / f"skill-{i}" / "SKILL.md"
            path.parent.mkdir()
            path.write_text(f"workflow {i}")
            event = {"hook_event_name": "PostToolUse", "session_id": "main", "cwd": str(self.home), "tool_name": "Bash",
                     "tool_input": {"command": f"cat '{path}'"}, "tool_response": {"exit_code": 0}}
            child = subprocess.Popen([sys.executable, str(PLUGIN / "scripts/runtime-guards.py")], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.env)
            child.stdin.write(json.dumps(event))
            child.stdin.close()
            child.stdin = None
            children.append(child)
        for child in children:
            stdout, stderr = child.communicate(timeout=5)
            self.assertEqual((child.returncode, stdout, stderr), (0, "", ""))
        state = json.loads(next((self.data / "skill-recovery").glob("*.json")).read_text())
        self.assertEqual(len(state["skills"]), 8)

    def test_corrupt_state_stops_compact(self):
        self.remember()
        path = next((self.data / "skill-recovery").glob("*.json"))
        path.write_text("broken")
        output = self.run_hook("PreCompact")
        self.assertIs(output["continue"], False)
        self.assertIn("Corrupt", output["stopReason"])
        self.assertEqual(self.run_hook("SessionStart", source="clear"), {})
        self.assertEqual(self.run_hook("PreCompact"), {})

    def test_cli_siblings_share_session_but_not_skill_ledger(self):
        shared = "shared-root-session"
        self.run_hook("PostToolUse", shared, agent_id="child-a", agent_type="worker", tool_name="Bash",
                      tool_input={"command": f"cat '{self.path}'"}, tool_response={"exit_code": 0})
        for actor in ["child-a", "child-b"]:
            self.run_hook("PreCompact", shared, agent_id=actor, agent_type="worker")
            self.run_hook("PostCompact", shared, agent_id=actor, agent_type="worker")
        self.assertEqual(self.run_hook("PreToolUse", shared, agent_id="child-b", tool_name="apply_patch"), {})
        restored = self.run_hook("PreToolUse", shared, agent_id="child-a", tool_name="apply_patch")
        self.assertIn(self.path.read_text(), restored["hookSpecificOutput"]["additionalContext"])

    def test_private_metadata_contains_no_skill_body(self):
        self.remember()
        self.run_hook("PreCompact")
        path = next((self.data / "skill-recovery").glob("*.json"))
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("Never skip", path.read_text())

    def test_source_deleted_between_compact_hooks_causes_explicit_stop(self):
        self.remember()
        self.run_hook("PreCompact")
        self.run_hook("PostCompact")
        self.path.unlink()
        output = self.run_hook("UserPromptSubmit")
        self.assertIs(output["continue"], False)
        self.assertIn("unreadable", output["stopReason"])

    def test_new_hooks_registered_without_overwriting_old_positions(self):
        hooks = json.loads((PLUGIN / "hooks/hooks.json").read_text())["hooks"]
        for name in ["PreCompact", "PostCompact", "PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit"]:
            registered = [h for group in hooks.get(name, []) for h in group["hooks"] if "runtime-guards.py" in h["command"]]
            self.assertEqual(len(registered), 1, name)
            if name not in {"PreCompact", "PostCompact", "PostToolUse"}:
                self.assertEqual(registered[0]["additionalContextLimit"], 0)
        self.assertEqual(hooks["PostToolUse"][1]["matcher"], "^apply_patch$")


if __name__ == "__main__":
    unittest.main()
