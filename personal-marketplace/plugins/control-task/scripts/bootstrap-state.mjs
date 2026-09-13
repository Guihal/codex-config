import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveStateRoot } from "./state.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_TTL_SECONDS = 3_600;

function bootstrapDirectory() {
  return path.join(resolveStateRoot(), "bootstraps");
}

function tokenPath(token) {
  if (typeof token !== "string" || token.length < 16) {
    throw new Error("bootstrap_token is invalid");
  }
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  return path.join(bootstrapDirectory(), `${digest}.json`);
}

function ttlMilliseconds() {
  const value = Number(process.env.CODEX_CONTROL_TASK_BOOTSTRAP_TTL_SECONDS);
  return Number.isFinite(value) && value >= 60
    ? value * 1000
    : DEFAULT_TTL_SECONDS * 1000;
}

function unlinkIfPresent(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function pruneExpired(directory, now) {
  for (const entry of fs.readdirSync(directory)) {
    const file = path.join(directory, entry);
    try {
      if (now - fs.statSync(file).mtimeMs > ttlMilliseconds()) {
        unlinkIfPresent(file);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function validateRecord(value) {
  if (
    !value ||
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.taskBody !== "string" ||
    !value.taskBody.trim() ||
    !Number.isFinite(value.createdAt)
  ) {
    throw new Error("subagent bootstrap state is corrupt");
  }
  if (Date.now() - value.createdAt > ttlMilliseconds()) {
    throw new Error("subagent bootstrap token expired");
  }
  return value;
}

export function createBootstrap(taskBody) {
  const directory = bootstrapDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  pruneExpired(directory, Date.now());
  const token = crypto.randomBytes(24).toString("base64url");
  const record = {
    schemaVersion: SCHEMA_VERSION,
    taskBody,
    createdAt: Date.now(),
  };
  fs.writeFileSync(tokenPath(token), `${JSON.stringify(record)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  return token;
}

export function matchesBootstrap(token, taskBody) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(tokenPath(token), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  return validateRecord(record).taskBody === taskBody;
}

export function consumeBootstrap(token, consume) {
  const file = tokenPath(token);
  const claimed = `${file}.claim-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.renameSync(file, claimed);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("bootstrap_token is missing, expired, or already used");
    }
    throw error;
  }
  try {
    const record = validateRecord(JSON.parse(fs.readFileSync(claimed, "utf8")));
    const result = consume(record.taskBody);
    unlinkIfPresent(claimed);
    return result;
  } catch (error) {
    try {
      fs.renameSync(claimed, file);
    } catch (restoreError) {
      if (restoreError?.code !== "ENOENT") throw restoreError;
    }
    throw error;
  }
}
