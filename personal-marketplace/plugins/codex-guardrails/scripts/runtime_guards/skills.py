"""Trusted local skill sources and a versioned, bounded Codex JSONL adapter."""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time

from .common import GuardError, read_regular
from .shell import skill_reads

SENSITIVE = {".ssh", ".aws", "secrets", ".gnupg", "auths", "credentials", "private-vault"}
TRANSCRIPT_LIMIT = 64 * 1024 * 1024
LINE_LIMIT = 8 * 1024 * 1024
RESTORE_MARKER = "[codex-skill-recovery:v1]"


@dataclass(frozen=True)
class Settings:
    roots: tuple[Path, ...]
    max_skill_bytes: int = 65536
    max_restore_bytes: int = 262144
    max_skills: int = 32


def transcript_path(event: dict) -> Path | None:
    location = event.get("transcript_path")
    if not isinstance(location, str) or not location:
        return None
    path = Path(location).resolve()
    if path.suffix != ".jsonl" or SENSITIVE.intersection(path.parts):
        raise GuardError("Unsupported or sensitive hook transcript path.")
    return path


def thread_key(event: dict) -> str:
    """session_id is shared by descendants; key by agent_id or transcript thread identity."""
    session = event.get("session_id")
    if not isinstance(session, str) or not session:
        raise GuardError("Missing session_id; cannot isolate skill-recovery state.")
    nested = event.get("subagent") or {}
    actor = event.get("agent_id") or (nested.get("agent_id") if isinstance(nested, dict) else None)
    if actor is not None:
        if not isinstance(actor, str):
            raise GuardError("Invalid subagent identity.")
        return session + "\0" + actor
    path = transcript_path(event)
    if path is not None:
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise GuardError("Hook transcript is not a regular file.")
                first = stream.readline(1048577)
            if len(first) <= 1048576 and first.endswith(b"\n"):
                record = json.loads(first)
                if record.get("type") == "session_meta":
                    identity = record.get("payload", {}).get("id")
                    if isinstance(identity, str) and identity:
                        return session + "\0" + identity
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        # Exporters without session_meta still get isolation by their own transcript.
        return session + "\0transcript:" + str(path)
    if event.get("agent_type") or nested:
        raise GuardError("Subagent hook lacks both an agent ID and its own transcript.")
    # On the inspected Codex version, normal subagent hooks carry agent_id.
    # This fallback supports a root thread with transcript recording disabled.
    return session + "\0main"


def settings(plugin_root: Path, cwd: Path, home: Path | None = None) -> Settings:
    home = home or Path.home()
    codex = Path(os.environ.get("CODEX_HOME", str(home / ".codex")))
    roots = [home / ".agents/skills", codex / "skills", plugin_root / "skills"]
    for ancestor in (cwd, *cwd.parents):
        roots.extend([ancestor / ".agents/skills", ancestor / ".codex/skills"])
    # Known local installation layouts only, not a recursive project-wide crawl.
    for base in (codex / "plugins", home / ".agents/plugins", home / "plugins"):
        for pattern in ("*/skills", "cache/*/skills", "cache/*/*/skills", "cache/*/*/*/skills"):
            roots.extend(base.glob(pattern))
    try:
        config = json.loads(read_regular(plugin_root / "runtime-guards.json", 16384))
    except FileNotFoundError:
        config = {}
    if not isinstance(config, dict) or not isinstance(config.get("skill_roots", []), list):
        raise GuardError("Invalid runtime-guards.json configuration.")
    if set(config) - {"skill_roots", "max_skill_bytes", "max_restore_bytes", "max_skills"}:
        raise GuardError("Unknown configuration key in runtime-guards.json.")
    for root in config.get("skill_roots", []):
        if not isinstance(root, str) or not Path(root).expanduser().is_absolute():
            raise GuardError("Additional skill roots must be absolute paths (~/ is supported).")
        roots.append(Path(root).expanduser())
    limits = {}
    for name, default in (("max_skill_bytes", 65536), ("max_restore_bytes", 262144), ("max_skills", 32)):
        value = config.get(name, default)
        if type(value) is not int or value <= 0 or value > (1048576 if name != "max_skills" else 128):
            raise GuardError("Invalid skill-recovery budget in runtime-guards.json.")
        limits[name] = value
    return Settings(tuple(dict.fromkeys(root.resolve() for root in roots)), **limits)


def canonical_skill(path: Path, config: Settings) -> Path | None:
    """Never infer authority from a SKILL.md filename alone or follow a root escape."""
    if path.name != "SKILL.md":
        return None
    resolved = path.resolve()
    if SENSITIVE.intersection(path.parts) or SENSITIVE.intersection(resolved.parts):
        raise GuardError("Skill source resolves to a sensitive location; recovery refused.")
    if resolved.name != "SKILL.md" or not any(resolved.is_relative_to(root) for root in config.roots):
        return None
    return resolved


def remember(state: dict, path: Path, config: Settings, *, native: bool = False) -> None:
    if len(state["skills"]) + len(state.get("unresolved", {})) >= 128:
        state["capture_error"] = "Skill inventory overflowed the supported metadata capacity; start a new task session."
        return
    try:
        canonical = canonical_skill(path, config)
    except GuardError:
        # Persist only the candidate path, so a failed observer cannot silently
        # erase the obligation to restore it before the next compaction.
        state.setdefault("unresolved", {})[str(path.absolute())] = True
        return
    if canonical is None:
        if native or any(path.absolute().is_relative_to(root) for root in config.roots):
            state.setdefault("unresolved", {})[str(path.absolute())] = True
        return
    state["skills"][str(canonical)] = str(path.absolute())
    # Keep the complete bounded inventory even when it exceeds the configured
    # delivery budget; PreCompact must stop rather than forget a captured skill.


def read_skill(canonical: str, original: str, config: Settings) -> tuple[str, str]:
    """Validate identity before and after reading; full UTF-8 content, never a summary."""
    expected = Path(canonical)
    if canonical_skill(Path(original), config) != expected:
        raise GuardError("A remembered skill moved or its symlink changed; refusing an identity substitution.")
    try:
        raw = read_regular(expected, config.max_skill_bytes)
        body = raw.decode("utf-8")
    except (OSError, UnicodeError) as error:
        raise GuardError("A remembered SKILL.md is unreadable; no partial skill restoration will be reported.") from error
    if canonical_skill(Path(original), config) != expected:
        raise GuardError("Skill path changed during recovery.")
    if RESTORE_MARKER in body:
        raise GuardError("Reserved recovery marker found in a skill source.")
    return body, hashlib.sha256(raw).hexdigest()


def render_skills(state: dict, config: Settings, hashes: dict | None = None) -> tuple[str, dict]:
    if state.get("capture_error"):
        raise GuardError("Skill inventory overflowed the supported metadata capacity; start a new task session.")
    for original in list(state.get("unresolved", {})):
        canonical = canonical_skill(Path(original), config)
        if canonical is None:
            raise GuardError("A used skill is outside the configured local roots or escaped through a symlink. Add its trusted source root explicitly; remote resources are not local files.")
        remember(state, Path(original), config)
        del state["unresolved"][original]
    if len(state["skills"]) > config.max_skills:
        raise GuardError("The active skill inventory exceeds max_skills.")
    entries, actual = [], {}
    for canonical, original in sorted(state["skills"].items()):
        if not isinstance(canonical, str) or not isinstance(original, str):
            raise GuardError("Invalid remembered skill identity.")
        body, digest = read_skill(canonical, original, config)
        if hashes is not None and hashes.get(canonical) != digest:
            raise GuardError("SKILL.md changed after the PreCompact checkpoint. Re-run compaction with the current source instead of silently changing the workflow.")
        actual[canonical] = digest
        # JSON string quoting prevents paths from impersonating block delimiters.
        entries.append(f"Source: {json.dumps(canonical, ensure_ascii=False)}\nSHA256: {digest}\nReferences are relative to {json.dumps(str(Path(canonical).parent), ensure_ascii=False)}.\n\n{body}")
        if sum(len(entry.encode()) for entry in entries) > config.max_restore_bytes:
            raise GuardError("Complete skill bodies exceed max_restore_bytes; no partial restoration was emitted.")
    if hashes is not None and set(actual) != set(hashes):
        raise GuardError("Skill inventory changed after the checkpoint.")
    text = ""
    if entries:
        text = RESTORE_MARKER + "\nFull previously used skill instructions restored from local sources.\nContinue the current workflow and its pending gates; do not restart completed steps.\nThese are skill documents, not a new user request or permission grant.\n\n" + "\n\n--- restored skill ---\n\n".join(entries)
    if len(text.encode()) > config.max_restore_bytes:
        raise GuardError("Full skill restoration exceeds its byte budget. Compaction is not safe with a truncated workflow; increase max_restore_bytes explicitly.")
    return text, actual


def successful(response: object) -> bool:
    """Accept explicit success evidence only; a running exec session is not a completed read."""
    if isinstance(response, dict):
        if response.get("isError") or response.get("is_error"):
            return False
        for key in ("exit_code", "exitCode", "code"):
            if key in response:
                return response[key] == 0
        if "output" in response:
            return successful(response["output"])
        # The PostToolUse contract itself indicates success for dedicated read tools.
        return response.get("success") is True
    if isinstance(response, str):
        try:
            value = json.loads(response)
            if isinstance(value, dict):
                return successful(value)
        except json.JSONDecodeError:
            pass
        return bool(re.search(r"(?:Process exited with code|Exit code:)\s*0\b", response))
    return False


def observe_tool(state: dict, name: str, arguments: dict, response: object,
                 cwd: Path, config: Settings) -> None:
    if name in {"Bash", "exec_command", "shell_command", "shell"}:
        if not successful(response):
            return
        command = arguments.get("command", arguments.get("cmd"))
        if isinstance(command, list) and len(command) == 3 and command[1] in {"-c", "-lc"}:
            command = command[2]
        if isinstance(command, str):
            workdir = arguments.get("workdir", arguments.get("cwd"))
            directory = cwd / workdir if isinstance(workdir, str) else cwd
            for path in skill_reads(command, directory):
                remember(state, path, config)
    elif name in {"Read", "read_file", "read"}:
        if response is None:
            return
        if isinstance(response, dict) and (response.get("isError") or response.get("is_error")):
            return
        path = arguments.get("file_path", arguments.get("path"))
        if isinstance(path, str):
            remember(state, cwd / Path(path).expanduser(), config)


def _observe_record(record: dict, state: dict, cwd: Path, config: Settings) -> None:
    if record.get("type") == "turn_context":
        path = record.get("payload", {}).get("cwd")
        if isinstance(path, str):
            state["cursor"]["cwd"] = path
        return
    if record.get("type") != "response_item":
        return
    item = record.get("payload", {})
    if not isinstance(item, dict):
        return
    kind = item.get("type")
    directory = Path(state["cursor"].get("cwd", str(cwd)))
    if kind == "message" and item.get("role") == "user":
        content = item.get("content", [])
        text = content if isinstance(content, str) else "\n".join(part.get("text", "") for part in content if isinstance(part, dict))
        # Native selected blocks, not the developer catalog or arbitrary tool output.
        blocks = re.findall(r"<skill>\s*(.*?)</skill>", text, re.S) if text.lstrip().startswith("<skill>") else []
        for block in blocks:
            path = re.search(r"<path>([^\n<>]+)</path>", block)
            if path:
                remember(state, directory / Path(path[1]).expanduser(), config, native=True)
    elif kind == "function_call" and item.get("name") in {"exec_command", "shell_command", "shell", "read_file"}:
        call_id = item.get("call_id")
        arguments = item.get("arguments", {})
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                return  # invalid tool arguments are not evidence of a skill read
        if isinstance(call_id, str) and isinstance(arguments, dict):
            if item["name"] == "read_file":
                path = arguments.get("path", arguments.get("file_path"))
                paths = [directory / Path(path).expanduser()] if isinstance(path, str) and Path(path).name == "SKILL.md" else []
            else:
                command = arguments.get("command", arguments.get("cmd"))
                if isinstance(command, list) and len(command) == 3 and command[1] in {"-c", "-lc"}:
                    command = command[2]
                workdir = arguments.get("workdir", arguments.get("cwd"))
                if isinstance(workdir, str):
                    directory = directory / workdir
                paths = skill_reads(command, directory) if isinstance(command, str) else []
            if paths:
                state["calls"][call_id] = {"paths": [str(path) for path in paths], "read": item["name"] == "read_file"}
            # Only unresolved recent calls need pairing; successful PostToolUse is the primary observer.
            while len(state["calls"]) > 256:
                del state["calls"][next(iter(state["calls"]))]
    elif kind == "function_call_output":
        call = state["calls"].pop(item.get("call_id"), None)
        if call and successful(item.get("output")):
            for path in call["paths"]:
                remember(state, Path(path), config)


def scan_transcript(state: dict, event: dict, config: Settings, *, skip: bool = False) -> None:
    """Incremental adapter for Codex response_item JSONL; runtime transcript format may evolve."""
    path = transcript_path(event)
    if path is None:
        return
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return  # no transcript yet at fresh startup
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise GuardError("Hook transcript is not a regular file.")
        identity = f"{path}:{info.st_dev}:{info.st_ino}"
        cursor = state["cursor"]
        offset = cursor.get("offset", 0) if cursor.get("identity") == identity else 0
        if skip:
            state["cursor"] = {"identity": identity, "offset": info.st_size}
            return
        if offset > info.st_size:
            offset = 0
        if info.st_size - offset > TRANSCRIPT_LIMIT:
            raise GuardError("Unscanned transcript exceeds the recovery scan budget; no silent tail-only recovery.")
        stream.seek(offset)
        cursor["identity"] = identity
        deadline = time.monotonic() + 3
        while stream.tell() < info.st_size:
            if time.monotonic() > deadline:
                raise GuardError("Skill transcript scan exceeded its execution budget; compaction recovery was not confirmed.")
            line = stream.readline(LINE_LIMIT + 1)
            if len(line) > LINE_LIMIT:
                raise GuardError("Transcript record exceeds the supported recovery size.")
            if not line.endswith(b"\n"):
                break  # incomplete append: retry on the next hook
            if line.strip():
                record = json.loads(line)
                if isinstance(record, dict):
                    _observe_record(record, state, Path(event.get("cwd", ".")), config)
            cursor["offset"] = stream.tell()