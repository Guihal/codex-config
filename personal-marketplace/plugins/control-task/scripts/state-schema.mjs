import crypto from "node:crypto";

const SCHEMA_VERSION = 1;
const STATUSES = new Set(["uninitialized", "current", "unavailable"]);

export class ControlTaskStateError extends Error {}

export function rotateToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function initialState(status) {
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    revision: 0,
    baseToken: rotateToken(),
    taskBody: null,
    reason: null,
    updatedAt: null,
    lastInjectedAt: 0,
  };
}

function isOptionalString(value) {
  return value === null || typeof value === "string";
}

export function normalizeState(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION) {
    throw new ControlTaskStateError(
      "session task state has an unsupported schema",
    );
  }
  if (!STATUSES.has(value.status)) {
    throw new ControlTaskStateError("session task state has an invalid status");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new ControlTaskStateError(
      "session task state has an invalid revision",
    );
  }
  if (typeof value.baseToken !== "string" || value.baseToken.length < 16) {
    throw new ControlTaskStateError("session task state has an invalid token");
  }
  if (!isOptionalString(value.taskBody) || !isOptionalString(value.reason)) {
    throw new ControlTaskStateError("session task state has invalid text");
  }
  if (!isOptionalString(value.updatedAt)) {
    throw new ControlTaskStateError("session task state has an invalid time");
  }
  if (!Number.isFinite(value.lastInjectedAt) || value.lastInjectedAt < 0) {
    throw new ControlTaskStateError(
      "session task state has an invalid injection time",
    );
  }
  if (value.status === "current" && !value.taskBody?.trim()) {
    throw new ControlTaskStateError("current session task has no body");
  }
  return value;
}
