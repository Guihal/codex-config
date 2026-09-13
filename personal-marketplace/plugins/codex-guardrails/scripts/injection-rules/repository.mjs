import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEBUG_FILENAME, LOCK_POLL_MS, LOCK_STALE_MS, LOCK_WAIT_MS, STATE_VERSION } from "./constants.mjs";
import { errorMessage, StateLockError } from "./errors.mjs";
import { createSessionState } from "./state-model.mjs";

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function resolveDataDirectory(environment = process.env) {
  return environment.PLUGIN_DATA
    || environment.CODEX_GUARDRAILS_DATA_DIR
    || join(homedir(), ".codex", "plugin-data", "codex-guardrails");
}

export function statePathFor(dataDirectory, sessionId) {
  const digest = createHash("sha256").update(sessionId || "unknown-session").digest("hex");
  return join(dataDirectory, `session-${digest}.json`);
}

function removeStaleLock(lockPath, now, staleMilliseconds) {
  try {
    if (now() - statSync(lockPath).mtimeMs > staleMilliseconds) unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function acquireLock(lockPath, options) {
  const startedAt = options.now();
  while (options.now() - startedAt <= options.waitMilliseconds) {
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, `${process.pid}\n`);
      return descriptor;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      removeStaleLock(lockPath, options.now, options.staleMilliseconds);
      options.sleep(options.pollMilliseconds);
    }
  }
  throw new StateLockError(lockPath, "lock-timeout");
}

function readState(path, onWarning) {
  if (!existsSync(path)) return createSessionState();
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    if (state?.version !== STATE_VERSION || typeof state.actorsByKey !== "object") throw new Error("state-schema-invalid");
    return state;
  } catch (error) {
    onWarning(`[injection-rules] discarded invalid state ${path}: ${errorMessage(error)}`);
    return createSessionState();
  }
}

function writeState(path, state) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function transactState({ sessionId, dataDirectory, mutate, debugEvents = [], options = {} }) {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const statePath = statePathFor(dataDirectory, sessionId);
  const lockPath = `${statePath}.lock`;
  const lockOptions = {
    now: options.now ?? Date.now,
    sleep: options.sleep ?? sleep,
    waitMilliseconds: options.waitMilliseconds ?? LOCK_WAIT_MS,
    staleMilliseconds: options.staleMilliseconds ?? LOCK_STALE_MS,
    pollMilliseconds: options.pollMilliseconds ?? LOCK_POLL_MS,
  };
  const descriptor = acquireLock(lockPath, lockOptions);
  try {
    const state = readState(statePath, options.onWarning ?? (() => {}));
    const result = mutate(state);
    writeState(statePath, state);
    if (debugEvents.length) appendFileSync(join(dataDirectory, DEBUG_FILENAME), debugEvents.map((event) => JSON.stringify(event)).join("\n") + "\n");
    return result;
  } finally {
    closeSync(descriptor);
    try { unlinkSync(lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}
