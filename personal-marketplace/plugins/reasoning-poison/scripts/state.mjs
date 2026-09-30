import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function resolveStateRoot(environment = process.env) {
  if (environment.CODEX_REASONING_POISON_STATE_DIR) {
    return path.resolve(environment.CODEX_REASONING_POISON_STATE_DIR);
  }
  if (environment.PLUGIN_DATA) {
    return path.join(environment.PLUGIN_DATA, "reasoning-poison");
  }
  const stateHome =
    environment.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(stateHome, "codex-reasoning-poison");
}

export function canonicalCwd(cwd) {
  const resolved = path.resolve(requireString(cwd, "session cwd"));
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function sessionFile(event, environment = process.env) {
  const sessionId = requireString(event.session_id, "session id");
  const actorId = event.agent_id || "main";
  const digest = crypto
    .createHash("sha256")
    .update(`${sessionId}:${actorId}:${canonicalCwd(event.cwd)}`)
    .digest("hex");
  return path.join(resolveStateRoot(environment), "sessions", `${digest}.json`);
}

export function initialState() {
  return { version: 1, completedCalls: 0, intentCompletedCalls: 0, sourcesCompletedCalls: 0, injectedTotal: 0, updatedAt: 0 };
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function normalizeState(value) {
  if (value?.version !== 1) return null;
  if (!Number.isInteger(value.completedCalls) || value.completedCalls < 0) {
    return null;
  }
  if (!Number.isInteger(value.injectedTotal) || value.injectedTotal < 0) {
    return null;
  }
  const intentCompletedCalls = Object.hasOwn(value, "intentCompletedCalls")
    ? value.intentCompletedCalls
    : 0;
  if (!Number.isInteger(intentCompletedCalls) || intentCompletedCalls < 0) {
    return null;
  }
  // Spec: PS-3 (../README.md#project-sources-contract).
  const sourcesCompletedCalls = Object.hasOwn(value, "sourcesCompletedCalls")
    ? value.sourcesCompletedCalls
    : 0;
  if (!Number.isInteger(sourcesCompletedCalls) || sourcesCompletedCalls < 0) {
    return null;
  }
  if (!Number.isFinite(value.updatedAt)) return null;
  return { ...value, intentCompletedCalls, sourcesCompletedCalls };
}

// Re-execute the hook under a per-key kernel lock for the entire transaction.
// --no-fork keeps the descriptor in Node; exit/crash releases it. Never unlink
// the lock inode: that would allow competing owners. The bounded wait leaves
// room within the existing five-second hook timeout.
export function runLockedHook(file, script, input) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  fs.closeSync(fs.openSync(lock, "a", 0o600));
  const result = spawnSync("flock", [
    "--exclusive", "--no-fork", "--timeout", "3", "--conflict-exit-code", "75",
    lock, process.execPath, script, "--state-locked",
  ], { input, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 75) throw new Error("session state lock timed out after 3 seconds");
  if (result.status !== 0) {
    throw new Error(`locked hook failed (${result.signal ?? result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function readSessionState(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    const state = normalizeState(JSON.parse(raw));
    if (state) return state;
  } catch {
    // Invalid state is quarantined below and treated as a fresh session.
  }
  try {
    fs.renameSync(file, `${file}.corrupt-${crypto.randomUUID()}`);
  } catch {
    // Quarantine is best-effort; delivery still fails open as a fresh state.
  }
  return null;
}

export function writeSessionState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}
