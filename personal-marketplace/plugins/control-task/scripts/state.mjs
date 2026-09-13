import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ControlTaskStateError,
  initialState,
  normalizeState,
  rotateToken,
} from "./state-schema.mjs";

const LOCK_WAIT_MS = 2_000;
const STALE_LOCK_MS = 10_000;

function requireSessionId(sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new ControlTaskStateError("Codex session id is unavailable");
  }
  return sessionId;
}

export function resolveStateRoot() {
  const configured = process.env.CODEX_CONTROL_TASK_STATE_DIR;
  if (configured) return path.resolve(configured);
  const xdgState =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(xdgState, "codex-control-task");
}

function sessionPath(sessionId) {
  const digest = crypto
    .createHash("sha256")
    .update(requireSessionId(sessionId))
    .digest("hex");
  return path.join(resolveStateRoot(), "sessions", `${digest}.json`);
}

function readFile(file) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function unlinkIfPresent(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function waitForLock(lock) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      return fs.openSync(lock, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS) {
          unlinkIfPresent(lock);
        }
      } catch (statError) {
        if (statError?.code !== "ENOENT") throw statError;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  throw new ControlTaskStateError(
    "timed out waiting for the session task lock",
  );
}

function writeFile(file, state) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    unlinkIfPresent(temporary);
  }
}

export function readSessionState(sessionId) {
  return readFile(sessionPath(sessionId));
}

export function transactSessionState(sessionId, createStatus, mutate) {
  const file = sessionPath(sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  const lockFd = waitForLock(lock);
  try {
    let current;
    try {
      current = readFile(file) ?? initialState(createStatus);
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        !(error instanceof ControlTaskStateError)
      ) {
        throw error;
      }
      fs.renameSync(file, `${file}.corrupt-${crypto.randomUUID()}`);
      current = initialState("unavailable");
    }
    const next = normalizeState(mutate({ ...current }) ?? current);
    writeFile(file, next);
    return next;
  } finally {
    fs.closeSync(lockFd);
    unlinkIfPresent(lock);
  }
}

export function resetSessionState(sessionId) {
  return transactSessionState(sessionId, "uninitialized", () =>
    initialState("uninitialized"),
  );
}

export { ControlTaskStateError, rotateToken };
