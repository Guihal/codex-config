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


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.skills = self.root / "skills"
        self.path = self.skills / "task" / "SKILL.md"
        self.path.parent.mkdir(parents=True)
        self.body = "# Task\n\nAll phases are mandatory.\nGate: reviewer must approve.\nDo not repeat the completed phase.\n"
        self.path.write_text(self.body)
        self.config = Settings((self.skills,))
        self.state = blank_state()
        self.transcript = self.root / "session.jsonl"

    def event(self, name, **extra):
        return {"hook_event_name": name, "session_id": "test-session", "cwd": str(self.root), **extra}

    def read(self, path=None, response=None):
        return handle_recovery(self.event("PostToolUse", tool_name="Bash", tool_input={"command": f"cat '{path or self.path}'"},
                                          tool_response=response if response is not None else {"exit_code": 0}), self.state, self.config)

    def compact(self):
        handle_recovery(self.event("PreCompact"), self.state, self.config)
        return handle_recovery(self.event("PostCompact"), self.state, self.config)

    def test_full_body_returned_instead_of_lossy_summary(self):
        self.read()
        self.assertEqual(self.compact(), {})
        output = handle_recovery(self.event("SessionStart", source="compact"), self.state, self.config)
        text = output["hookSpecificOutput"]["additionalContext"]
        self.assertIn(self.body, text)
        self.assertIn(hashlib.sha256(self.body.encode()).hexdigest(), text)
        self.assertIn("do not restart", text)

    def test_postcompact_never_uses_unsupported_context_field(self):
        self.read()
        self.assertEqual(self.compact(), {})
        self.assertEqual(self.state["pending"]["phase"], "ready")

    def test_pretool_fallback_injects_and_denies_once(self):
        self.read()
        self.compact()
        event = self.event("PreToolUse", tool_name="apply_patch", tool_input={})
        first = handle_recovery(event, self.state, self.config)["hookSpecificOutput"]
        self.assertEqual(first["permissionDecision"], "deny")
        self.assertIn(self.body, first["additionalContext"])
        self.assertEqual(handle_recovery(event, self.state, self.config), {})

    def test_user_prompt_delivers_before_tool_without_deny(self):
        self.read()
        self.compact()
        output = handle_recovery(self.event("UserPromptSubmit"), self.state, self.config)
        self.assertNotIn("permissionDecision", output["hookSpecificOutput"])
        self.assertEqual(handle_recovery(self.event("PreToolUse"), self.state, self.config), {})

    def test_second_compaction_restores_the_same_set_again(self):
        self.read()
        for _ in range(3):
            self.compact()
            output = handle_recovery(self.event("SessionStart", source="compact"), self.state, self.config)
            self.assertEqual(output["hookSpecificOutput"]["additionalContext"].count(self.body), 1)

    def test_compact_start_before_postcompact_does_not_duplicate(self):
        self.read()
        handle_recovery(self.event("PreCompact"), self.state, self.config)
        self.assertTrue(handle_recovery(self.event("SessionStart", source="compact"), self.state, self.config))
        handle_recovery(self.event("PostCompact"), self.state, self.config)
        self.assertEqual(handle_recovery(self.event("UserPromptSubmit"), self.state, self.config), {})

    def test_failed_compaction_does_not_deliver_prepared_manifest(self):
        self.read()
        handle_recovery(self.event("PreCompact"), self.state, self.config)
        self.assertEqual(handle_recovery(self.event("PreToolUse"), self.state, self.config), {})

    def test_missing_source_stops_before_compact(self):
        self.read()
        self.path.unlink()
        with self.assertRaises(GuardError):
            handle_recovery(self.event("PreCompact"), self.state, self.config)

    def test_source_change_after_checkpoint_not_silently_substituted(self):
        self.read()
        self.compact()
        self.path.write_text("different instructions")
        with self.assertRaises(GuardError):
            handle_recovery(self.event("UserPromptSubmit"), self.state, self.config)

    def test_sources_refresh_before_next_compaction(self):
        self.read()
        self.path.write_text("new current instructions")
        self.compact()
        output = handle_recovery(self.event("UserPromptSubmit"), self.state, self.config)
        self.assertIn("new current instructions", output["hookSpecificOutput"]["additionalContext"])

    def test_over_budget_is_all_or_stop_not_partial_text(self):
        self.read()
        with self.assertRaises(GuardError):
            render_skills(self.state, replace(self.config, max_restore_bytes=20))
        with self.assertRaises(GuardError):
            render_skills(self.state, replace(self.config, max_skill_bytes=10))

    def test_failed_or_running_bash_read_is_not_remembered(self):
        for response in [{"exit_code": 1}, {"session_id": 123}, {"isError": True}, "Process exited with code 1"]:
            self.read(response=response)
        self.assertEqual(self.state["skills"], {})

    def test_echo_of_skill_path_does_not_activate_skill(self):
        observe_tool(self.state, "Bash", {"command": f"echo '{self.path}'"}, {"exit_code": 0}, self.root, self.config)
        self.assertFalse(self.state["skills"])

    def test_writes_and_discarded_stdout_do_not_activate_skill(self):
        for command in [f"cat > '{self.path}' <<EOF\nnew skill\nEOF", f"cat '{self.path}' > /dev/null",
                        f"sed -i 's/Task/Other/' '{self.path}'"]:
            observe_tool(self.state, "Bash", {"command": command}, {"exit_code": 0}, self.root, self.config)
        self.assertFalse(self.state["skills"])

    def test_stderr_redirection_does_not_hide_a_successful_read(self):
        observe_tool(self.state, "Bash", {"command": f"cat '{self.path}' 2>/dev/null"}, {"exit_code": 0}, self.root, self.config)
        self.assertIn(str(self.path), self.state["skills"])

    def test_cd_and_quoted_path_read(self):
        paths = skill_reads(f"cd '{self.skills}'; cat 'task/SKILL.md'", self.root)
        self.assertEqual(paths, [self.path])

    def test_canonical_path_dedup_not_name(self):
        second = self.skills / "other" / "task" / "SKILL.md"
        second.parent.mkdir(parents=True)
        second.write_text("other task body")
        alias = self.skills / "alias"
        alias.symlink_to(self.path.parent)
        self.read()
        self.read(alias / "SKILL.md")
        self.read(second)
        self.assertEqual(len(self.state["skills"]), 2)

    def test_symlink_escape_stops_without_reading_outside_source(self):
        outside = self.root / ".ssh" / "SKILL.md"
        outside.parent.mkdir()
        outside.write_text("SECRET_SENTINEL")
        self.path.unlink()
        self.path.symlink_to(outside)
        self.read()
        with self.assertRaises(GuardError) as caught:
            self.compact()
        self.assertNotIn("SECRET_SENTINEL", str(caught.exception))

    def test_non_sensitive_symlink_escape_is_also_not_silently_lost(self):
        outside = self.root / "outside" / "SKILL.md"
        outside.parent.mkdir()
        outside.write_text("not a registered root")
        self.path.unlink()
        self.path.symlink_to(outside)
        self.read()
        with self.assertRaises(GuardError):
            self.compact()

    def test_fifo_is_rejected_without_hanging(self):
        self.path.unlink()
        os.mkfifo(self.path)
        with self.assertRaises(GuardError):
            read_regular(self.path, 1000)

    def records(self, *items):
        self.transcript.write_text("".join(json.dumps(item) + "\n" for item in items))

    def native(self, role="user"):
        return {"type": "response_item", "payload": {"type": "message", "role": role,
                "content": [{"type": "input_text", "text": f"<skill>\n<name>task</name>\n<path>{self.path}</path>\n{self.body}\n</skill>"}]}}

    def test_native_skill_discovered_from_transcript(self):
        self.records(self.native())
        handle_recovery(self.event("PreCompact", transcript_path=str(self.transcript)), self.state, self.config)
        self.assertIn(str(self.path), self.state["skills"])

    def test_catalog_and_tool_output_are_not_native_activation(self):
        self.records(self.native("developer"), self.native("assistant"), self.native("tool"))
        scan_transcript(self.state, self.event("PreCompact", transcript_path=str(self.transcript)), self.config)
        self.assertFalse(self.state["skills"])

    def test_transcript_pairs_actual_call_and_success_output(self):
        self.records(
            {"type": "response_item", "payload": {"type": "function_call", "name": "exec_command", "call_id": "a", "arguments": json.dumps({"cmd": f"cat '{self.path}'"})}},
            {"type": "response_item", "payload": {"type": "function_call_output", "call_id": "a", "output": "Process exited with code 0\nFinal output:\n" + self.body}},
        )
        scan_transcript(self.state, self.event("PreCompact", transcript_path=str(self.transcript)), self.config)
        self.assertIn(str(self.path), self.state["skills"])
        self.assertFalse(self.state["calls"])

    def test_state_does_not_persist_arbitrary_command_or_output(self):
        self.records({"type": "response_item", "payload": {"type": "function_call", "name": "exec_command", "call_id": "a", "arguments": json.dumps({"cmd": "echo SECRET_SENTINEL"})}})
        scan_transcript(self.state, self.event("PreCompact", transcript_path=str(self.transcript)), self.config)
        self.assertNotIn("SECRET_SENTINEL", json.dumps(self.state))

    def test_clear_skips_old_transcript_and_resets_inventory(self):
        self.records(self.native())
        event = self.event("SessionStart", source="clear", transcript_path=str(self.transcript))
        self.read()
        handle_recovery(event, self.state, self.config)
        scan_transcript(self.state, event, self.config)
        self.assertFalse(self.state["skills"])

    def test_partial_append_is_retried_not_discarded(self):
        line = json.dumps(self.native())
        self.transcript.write_text(line[:20])
        event = self.event("PreCompact", transcript_path=str(self.transcript))
        scan_transcript(self.state, event, self.config)
        self.assertFalse(self.state["skills"])
        self.transcript.write_text(line + "\n")
        scan_transcript(self.state, event, self.config)
        self.assertIn(str(self.path), self.state["skills"])

    def test_reserved_marker_cannot_impersonate_restoration(self):
        self.read()
        self.path.write_text("[codex-skill-recovery:v1]")
        with self.assertRaises(GuardError):
            self.compact()

    def test_shared_session_id_does_not_mean_same_actor(self):
        root = self.event("PreToolUse")
        child = {**root, "agent_id": "child-a", "agent_type": "worker"}
        sibling = {**child, "agent_id": "child-b"}
        self.assertEqual(len({thread_key(root), thread_key(child), thread_key(sibling)}), 3)
        self.assertEqual(thread_key(child), thread_key({**child, "agent_type": "reviewer"}))

    def test_transcript_thread_id_survives_archive_move(self):
        self.records({"type": "session_meta", "payload": {"id": "root-thread"}}, self.native())
        before = thread_key(self.event("PreCompact", transcript_path=str(self.transcript)))
        moved = self.root / "archived.jsonl"
        self.transcript.rename(moved)
        after = thread_key(self.event("PostCompact", transcript_path=str(moved)))
        self.assertEqual(before, after)

    def test_selected_count_over_budget_remains_remembered(self):
        self.config = replace(self.config, max_skills=1)
        self.read()
        second = self.skills / "second" / "SKILL.md"
        second.parent.mkdir()
        second.write_text("second workflow")
        self.read(second)
        self.assertEqual(len(self.state["skills"]), 2)
        with self.assertRaises(GuardError):
            self.compact()
        self.config = replace(self.config, max_skills=2)
        self.compact()

    def test_unknown_config_keys_are_errors_not_silent_defaults(self):
        plugin = self.root / "plugin"
        plugin.mkdir()
        (plugin / "runtime-guards.json").write_text('{"max_skils": 42}')
        with self.assertRaises(GuardError):
            settings(plugin, self.root, home=self.root)

    def test_known_plugin_cache_layout_is_a_skill_root(self):
        cached = self.root / ".codex/plugins/cache/personal/demo/0.1.0/skills"
        cached.mkdir(parents=True)
        with patch.dict(os.environ, {"CODEX_HOME": str(self.root / ".codex")}):
            resolved = settings(self.root / "plugin", self.root, home=self.root)
        self.assertIn(cached, resolved.roots)


if __name__ == "__main__":
    unittest.main()
