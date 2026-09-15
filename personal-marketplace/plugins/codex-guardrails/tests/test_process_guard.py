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


def process(pid, executable, ppid=1, group=None, argv=None):
    return Process(pid, ppid, group or pid, "12345", executable,
                   tuple(argv or [executable]), Path(executable).name)


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.table = {p.pid: p for p in [
            process(1, "/sbin/init"), process(10, "/usr/bin/bash"),
            process(20, "/opt/codex", ppid=10, group=10),
            process(30, "/usr/bin/node", ppid=20, group=30, argv=["node", "server.js"]),
            process(40, "/usr/bin/pi", ppid=10, group=10),
            process(50, "/opt/claude", ppid=10, group=50),
        ]}

    def test_native_agents_and_hosting_ancestors_protected(self):
        self.assertEqual(protected_pids(self.table), {1, 10, 20, 40, 50})

    def test_deleted_native_binary_is_still_a_running_agent(self):
        self.assertTrue(is_agent(process(4, "/opt/codex (deleted)")))

    def test_runtime_flags_and_resolved_bin_symlink(self):
        argv = ["node", "--enable-source-maps", "/npm/@earendil-works/pi-coding-agent/dist/cli.js"]
        self.assertTrue(is_agent(process(4, "/usr/bin/node", argv=argv)))
        wrapped = replace(process(4, "/usr/bin/node", argv=["node", "/home/user/.local/bin/pi"]),
                          entrypoint="/npm/@earendil-works/pi-coding-agent/dist/cli.js")
        self.assertTrue(is_agent(wrapped))
        self.assertFalse(is_agent(process(4, "/usr/bin/node", argv=["node", "-e", argv[-1]])))

    def test_runtime_entrypoint_not_arbitrary_argument(self):
        self.assertTrue(is_agent(process(4, "/usr/bin/node", argv=["node", "/npm/@openai/codex/bin/codex.js"])))
        self.assertTrue(is_agent(process(4, "/usr/bin/node", argv=["node", "/npm/@earendil-works/pi-coding-agent/dist/cli.js"])))
        self.assertFalse(is_agent(process(4, "/usr/bin/node", argv=["node", "server.js", "codex", "pi-kill-guard"])))
        self.assertFalse(is_agent(process(4, "/usr/bin/python3", argv=["python3", "/repo/codex/fixture.py"])))

    def test_direct_signal_variants_denied(self):
        for command in ["kill 20", "kill -9 20", "kill -s TERM 20", "kill -- 20", "kill -TERM 20", "/bin/kill -9 50"]:
            with self.subTest(command=command):
                self.assertIn("Protected", evaluate(command, self.table))

    def test_server_descendant_is_not_blanket_protected(self):
        self.assertIsNone(evaluate("kill -TERM 30", self.table))

    def test_process_group_targets_checked(self):
        self.assertIn("Protected", evaluate("kill -- -10", self.table))
        self.assertIsNone(evaluate("kill -- -30", self.table))

    def test_broadcast_and_dynamic_targets_rejected(self):
        for command in ["kill 0", "kill -- -1", "kill $PID", "kill %1"]:
            with self.subTest(command=command), self.assertRaises(GuardError):
                evaluate(command, self.table)

    def test_non_mutating_signal_probes(self):
        for command in ["kill -0 20", "kill -s 0 20", "kill -l", "pkill -0 codex", "killall -s 0 codex", "fuser 8080/tcp"]:
            with self.subTest(command=command):
                self.assertIsNone(evaluate(command, self.table))

    def test_wrappers_and_literal_nested_shell(self):
        for command in ["sudo -n kill 20", "env TEST=x kill 20", "nice -n 5 kill 20", "command kill 20",
                        "bash -lc 'kill -9 20'", "sh -c 'echo before; kill 20'", "if true; then kill 20; fi"]:
            with self.subTest(command=command):
                self.assertIn("Protected", evaluate(command, self.table))

    def test_no_line_limit_or_universal_timeout(self):
        command = "\n".join(f"echo {i}" for i in range(1000)) + "\ntimeout 300 python3 tests.py"
        self.assertIsNone(evaluate(command, self.table))

    def test_quoted_documentation_and_heredoc_are_not_kill_calls(self):
        for command in ["echo 'kill -9 20'", "printf '%s' 'kill -9 20'", "# kill 20\necho ok",
                        "echo '&&' kill 20", "echo ';' kill 20", 'printf "%s" "kill 20; kill 40"',
                        "cat <<'EOF'\nkill -9 20\nEOF\necho done"]:
            with self.subTest(command=command):
                self.assertIsNone(evaluate(command, self.table))

    def test_shell_heredoc_is_executable(self):
        self.assertIn("Protected", evaluate("bash <<'EOF'\nkill -9 20\nEOF", self.table))

    def test_actual_kill_after_data_heredoc_is_not_hidden(self):
        self.assertIn("Protected", evaluate("cat <<EOF\nexample\nEOF\nkill 20", self.table))

    def test_quoted_fake_heredoc_does_not_hide_next_command(self):
        self.assertIn("Protected", evaluate("echo '<<EOF'\nkill 20", self.table))

    def test_concatenated_quotes_and_escapes_resolve_literal_command(self):
        self.assertIn("Protected", evaluate('ki""ll 20', self.table))
        self.assertIn("Protected", evaluate(r'k\ill 20', self.table))

    def test_input_heredoc_for_shell_c_is_data_not_another_program(self):
        self.assertIsNone(evaluate("bash -c 'cat' <<EOF\nkill 20\nEOF", self.table))

    def test_pkill_passes_regex_and_selectors_to_passive_query(self):
        queries = []
        def query(args):
            queries.append(args)
            return {20}
        self.assertIn("Protected", evaluate("pkill -TERM -fx -u 1000 'codex( worker)?$'", self.table, query))
        self.assertEqual(queries, [["-f", "-x", "-u", "1000", "--", "codex( worker)?$"]])

    def test_pkill_unrelated_regex_is_allowed(self):
        self.assertIsNone(evaluate("pkill -f 'rapidapi-client'", self.table, lambda _: {30}))

    def test_killall_names_are_literal_not_regex(self):
        queries = []
        def query(args):
            queries.append(args)
            return {30}
        self.assertIsNone(evaluate("killall 'server.js'", self.table, query))
        self.assertEqual(queries, [["-x", "--", r"server\.js"]])

    def test_killall_process_group_expands_matches(self):
        self.table[30] = replace(self.table[30], group=10)
        self.assertIn("Protected", evaluate("killall -g node", self.table, lambda _: {30}))

    def test_selector_failure_does_not_silently_allow_signal(self):
        with self.assertRaises(GuardError):
            evaluate("pkill --unsupported codex", self.table)

    def test_fuser_kill_requires_resolved_pid(self):
        self.assertIn("literal", evaluate("fuser -k 8080/tcp", self.table))

    def test_real_pgrep_query_never_sends_signal(self):
        child = subprocess.Popen(["sleep", "0.3"])
        try:
            self.assertIn(child.pid, pgrep(["-x", "--", "sleep"]))
        finally:
            self.assertEqual(child.wait(timeout=2), 0)

    def test_proc_snapshot_includes_self(self):
        self.assertIn(os.getpid(), snapshot())

    def test_pid_reuse_between_stat_reads_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            entry = Path(temporary) / "20"
            entry.mkdir()
            (entry / "exe").symlink_to("/opt/codex")
            (entry / "cmdline").write_bytes(b"codex\0")
            (entry / "comm").write_text("codex")
            original = Path.read_text
            count = 0
            def read(path, *args, **kwargs):
                nonlocal count
                if path.name == "stat":
                    count += 1
                    return "20 (a name)) S 10 10 " + "0 " * 16 + str(count)
                return original(path, *args, **kwargs)
            with patch.object(Path, "read_text", read):
                self.assertNotIn(20, snapshot(Path(temporary)))


if __name__ == "__main__":
    unittest.main()
