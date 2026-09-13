export class RuleParseError extends Error {
  constructor(file, reason, options = {}) {
    super(`${file}: ${reason}`, options);
    this.name = "RuleParseError";
    this.file = file;
    this.reason = reason;
  }
}

export class StateLockError extends Error {
  constructor(path, reason, options = {}) {
    super(`${path}: ${reason}`, options);
    this.name = "StateLockError";
    this.path = path;
    this.reason = reason;
  }
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
