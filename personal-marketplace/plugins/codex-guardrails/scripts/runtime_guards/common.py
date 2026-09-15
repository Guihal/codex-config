"""Bounded hook IO and private, cross-process state transactions (Linux)."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import time
from typing import Iterator


class GuardError(Exception):
    """An expected failure, safe to show without source text or secret values."""


def read_regular(path: Path, limit: int) -> bytes:
    """Read a bounded regular file; never block on a FIFO or follow a final symlink."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise GuardError("File is not regular or exceeds the configured recovery budget.")
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    if len(data) > limit or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise GuardError("File changed during recovery read or exceeds the recovery budget.")
    return data


def blank_state() -> dict:
    return {"version": 1, "skills": {}, "cursor": {}, "calls": {}, "pending": None}


def validate_state(value: object) -> dict:
    if not isinstance(value, dict) or value.get("version") != 1:
        raise GuardError("Unsupported or corrupt skill-recovery state; restore its backup or clear the session.")
    for key in ("skills", "cursor", "calls"):
        if not isinstance(value.get(key), dict):
            raise GuardError("Corrupt skill-recovery state; do not continue as though recovery succeeded.")
    if value.get("pending") is not None and not isinstance(value["pending"], dict):
        raise GuardError("Corrupt skill-recovery checkpoint.")
    return value


@contextmanager
def state_transaction(data_dir: Path, session_id: str, *, reset: bool = False) -> Iterator[dict]:
    """Serialize one thread's read/modify/write; replace only after a successful operation."""
    folder = data_dir / "skill-recovery"
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = folder.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise GuardError("Skill-recovery state directory is not a private owned directory.")
    os.chmod(folder, 0o700)
    key = hashlib.sha256(session_id.encode()).hexdigest()
    path = folder / f"{key}.json"
    fd = os.open(folder / f"{key}.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a+") as lock:
        deadline = time.monotonic() + 2
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise GuardError("Skill-recovery state is busy; retry after the other hook finishes.")
                time.sleep(0.02)
        try:
            state = blank_state() if reset else validate_state(json.loads(read_regular(path, 2 * 1024 * 1024)))
        except FileNotFoundError:
            state = blank_state()
        except (UnicodeError, json.JSONDecodeError) as error:
            raise GuardError("Corrupt skill-recovery JSON; refusing to discard the remembered skills.") from error
        yield state
        encoded = json.dumps(state, ensure_ascii=False).encode()
        if len(encoded) > 2 * 1024 * 1024:
            raise GuardError("Skill-recovery state exceeded its storage budget.")
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=folder, delete=False) as stream:
                temporary = stream.name
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory_fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)


def context_output(event: str, text: str, reason: str | None = None) -> dict:
    output = {"hookEventName": event, "additionalContext": text}
    if reason:
        output.update(permissionDecision="deny", permissionDecisionReason=reason)
    return {"hookSpecificOutput": output}