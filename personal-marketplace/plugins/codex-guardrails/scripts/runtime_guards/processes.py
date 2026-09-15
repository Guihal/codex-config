"""Accidental process-target protection. Only passive /proc and pgrep queries."""
from dataclasses import dataclass
import os
from pathlib import Path
import re
import signal
import subprocess
from typing import Callable

from .common import GuardError
from .shell import SIGNALLERS, is_dynamic, static_commands


@dataclass(frozen=True)
class Process:
    pid: int
    ppid: int
    group: int
    started: str
    executable: str
    argv: tuple[str, ...]
    comm: str
    entrypoint: str | None = None


def runtime_script(argv: tuple[str, ...]) -> str | None:
    """Locate a runtime's script operand without mistaking -e/-p code for a file."""
    index = 1
    while index < len(argv):
        value = argv[index]
        if value in {"-e", "-p", "--eval", "--print", "-"} or value.startswith(("--eval=", "--print=")):
            return None
        if value in {"-r", "--require", "--loader", "--import", "-C", "--conditions"}:
            index += 2
        elif value == "--":
            return argv[index + 1] if index + 1 < len(argv) else None
        elif value.startswith("-"):
            index += 1
        else:
            return value
    return None


def is_agent(process: Process) -> bool:
    """Match executable or runtime entry point, never arbitrary arguments or cwd."""
    executable = process.executable.removesuffix(" (deleted)")
    if Path(executable).name in {"codex", "pi", "claude"}:
        return True
    if Path(executable).name not in {"node", "bun", "deno"}:
        return False
    entry = process.entrypoint or runtime_script(process.argv)
    if entry is None:
        return False
    return bool(re.search(
        r"/(?:@openai/codex/bin/codex\.js|(?:@[^/]+/)?pi-coding-agent/(?:dist/)?cli\.js|"
        r"@anthropic-ai/claude-code/cli\.js)$", entry,
    ))


def _stat_identity(text: str) -> tuple[int, int, str]:
    fields = text[text.rindex(")") + 2:].split()
    return int(fields[1]), int(fields[2]), fields[19]


def snapshot(proc: Path = Path("/proc")) -> dict[int, Process]:
    """Fresh identity on every hook; stat/read/stat rejects observed PID reuse."""
    found = {}
    try:
        entries = list(proc.iterdir())
    except OSError as error:
        raise GuardError("Cannot inspect process targets; use an inspected literal PID after restoring /proc access.") from error
    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            before = _stat_identity((entry / "stat").read_text())
            executable = os.readlink(entry / "exe")
            argv = tuple((entry / "cmdline").read_bytes().decode(errors="replace").rstrip("\0").split("\0"))
            comm = (entry / "comm").read_text().strip()
            script = runtime_script(argv) if Path(executable.removesuffix(" (deleted)")).name in {"node", "bun", "deno"} else None
            entrypoint = None
            if script:
                directory = Path(os.readlink(entry / "cwd")) if not Path(script).is_absolute() else Path("/")
                entrypoint = str((directory / script).resolve())
            after = _stat_identity((entry / "stat").read_text())
            if before == after:
                pid = int(entry.name)
                found[pid] = Process(pid, *before, executable, argv, comm, entrypoint)
        except (FileNotFoundError, ProcessLookupError):
            continue  # exited during the snapshot
        except PermissionError:
            # Other users' processes cannot normally be signalled without escalation.
            continue
        except (OSError, ValueError, IndexError) as error:
            raise GuardError("Process identity could not be read safely.") from error
    return found


def protected_pids(processes: dict[int, Process]) -> set[int]:
    """Protect agents and their hosting ancestors, not ordinary server descendants."""
    protected = set()
    for process in processes.values():
        if not is_agent(process):
            continue
        pid = process.pid
        while pid in processes and pid not in protected:
            protected.add(pid)
            pid = processes[pid].ppid
    return protected


def pgrep(args: list[str]) -> set[int]:
    """Use the system's POSIX ERE/selector semantics, without executing the submitted command."""
    try:
        result = subprocess.run(["pgrep", *args], capture_output=True, text=True, timeout=1, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GuardError("Cannot resolve process selector with pgrep; use an inspected literal PID.") from error
    if result.returncode == 1:
        return set()
    if result.returncode != 0 or not all(line.isdigit() for line in result.stdout.splitlines()):
        raise GuardError("Unsupported or invalid process selector; use an inspected literal PID.")
    return {int(line) for line in result.stdout.splitlines()}


def _signal_flag(value: str) -> bool:
    name = value.removeprefix("-").removeprefix("SIG")
    return name.isdigit() or f"SIG{name}" in signal.__dict__


def kill_targets(args: list[str], processes: dict[int, Process]) -> set[int]:
    args = list(args)
    if args and args[0] in {"-l", "-L", "--list", "--table"}:
        return set()
    if args and args[0] in {"-s", "--signal", "-n"}:
        if len(args) < 2:
            raise GuardError("Missing signal target.")
        if args[1] == "0":
            return set()
        args = args[2:]
    elif args and args[0] == "-0":
        return set()
    elif args and args[0] != "--" and _signal_flag(args[0]) and args[0].startswith("-"):
        args = args[1:]
    if args and args[0] == "--":
        args.pop(0)
    targets = set()
    for arg in args:
        if not re.fullmatch(r"-?\d+", arg):
            raise GuardError("Opaque kill target. Inspect it and use a literal PID; do not signal a shell expansion or job group.")
        pid = int(arg)
        if pid in {0, -1}:
            raise GuardError("Broadcast/current-group kill can terminate working agents. Use an inspected literal PID.")
        if pid < -1:
            targets.update(p.pid for p in processes.values() if p.group == -pid)
        else:
            targets.add(pid)
    return targets


def selector_targets(name: str, args: list[str], query: Callable[[list[str]], set[int]]) -> tuple[set[int], bool]:
    """Translate a conservative supported pkill/killall subset into passive pgrep."""
    selectors, patterns = [], []
    regex = name == "pkill"
    group = False
    index = 0
    while index < len(args):
        arg = args[index]
        index += 1
        if is_dynamic(arg):
            raise GuardError("Dynamic process selector; inspect targets and use literal PIDs.")
        if arg == "--":
            patterns.extend(args[index:])
            break
        if arg in {"-0", "--signal=0"}:
            return set(), False
        if arg in {"-s", "--signal"} and (name == "killall" or arg == "--signal"):
            if index == len(args):
                raise GuardError("Missing signal value.")
            if args[index] == "0":
                return set(), False
            index += 1
        elif arg.startswith("--signal=") or (arg.startswith("-") and _signal_flag(arg)):
            continue
        elif name == "killall" and arg in {"-r", "--regexp"}:
            regex = True
        elif name == "killall" and arg in {"-g", "--process-group"}:
            group = True
        elif arg in {"-e", "--echo", "-q", "--quiet", "-v", "--verbose", "-w", "--wait"}:
            continue
        elif arg in {"-i", "--ignore-case", "-x", "--exact", "-f", "--full"} and name == "pkill":
            selectors.append(arg)
        elif name == "pkill" and re.fullmatch(r"-[fix]+", arg):
            selectors.extend(f"-{letter}" for letter in arg[1:])
        elif arg in {"-u", "--user"} or (name == "pkill" and arg in {"-U", "-P", "-g", "-s", "-t"}):
            if index == len(args) or is_dynamic(args[index]):
                raise GuardError("Missing or dynamic process selector value.")
            selectors.extend([arg, args[index]])
            index += 1
        elif arg.startswith("-"):
            raise GuardError("This signalling option is not covered safely; use an inspected literal PID.")
        else:
            patterns.append(arg)
    if not patterns or (name == "pkill" and len(patterns) != 1):
        raise GuardError("Process selector is ambiguous; use an inspected literal PID.")
    targets = set()
    for pattern in patterns:
        literal = re.sub(r"([.\[\]\\*^$()+?{}|])", r"\\\1", pattern)
        targets.update(query([*selectors, *([] if regex else ["-x"]), "--", pattern if regex else literal]))
    return targets, group


def evaluate(command: str, processes: dict[int, Process] | None = None,
             query: Callable[[list[str]], set[int]] = pgrep) -> str | None:
    """Return a short deny reason or None. Never execute a signal command."""
    commands = [tokens for tokens in static_commands(command) if Path(tokens[0]).name in SIGNALLERS]
    if not commands:
        return None
    processes = snapshot() if processes is None else processes
    protected = protected_pids(processes)
    for tokens in commands:
        name, args = Path(tokens[0]).name, tokens[1:]
        if name == "fuser":
            if any(arg == "--kill" or (arg.startswith("-") and "k" in arg[1:]) for arg in args):
                return "fuser -k has resource-dependent targets. Inspect them and signal a literal non-agent PID."
            continue
        if name == "kill":
            targets = kill_targets(args, processes)
        else:
            targets, group = selector_targets(name, args, query)
            if group:
                groups = {processes[pid].group for pid in targets if pid in processes}
                targets |= {pid for pid, process in processes.items() if process.group in groups}
        blocked = sorted(targets & protected)
        if blocked:
            return "Protected agent or hosting ancestor targeted (PID " + ", ".join(map(str, blocked[:8])) + "). Stop this session through its UI, not kill."
    return None