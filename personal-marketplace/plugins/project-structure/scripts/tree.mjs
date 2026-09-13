import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DEPTH = 2;
export const MAX_CONFIG_DEPTH = 30;
const CONFIG_NAME = "pj-tree.conf";
const IGNORE_NAME = "project-structure.ignore";
const SAFE_MIN_TEXT = "node_modules/\n.git/\n";
const TRUNCATION = "Truncated. Use project_tree tool for full tree.";
const ASSET_IGNORE = fileURLToPath(new URL("../assets/project-structure.ignore", import.meta.url));

export class ProjectTreeError extends Error {
  constructor(message, options) { super(message, options); this.name = "ProjectTreeError"; }
}

export function parseDepthConfig(text, configPath = CONFIG_NAME, warn = console.warn) {
  let resolved;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) { warn(`[project-structure] malformed ${CONFIG_NAME} line ${index + 1} at ${configPath}; ignoring`); continue; }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key !== "depth") { warn(`[project-structure] unknown ${CONFIG_NAME} key "${key}" at ${configPath}:${index + 1}; ignoring`); continue; }
    if (!/^\d+$/.test(value)) { warn(`[project-structure] invalid depth at ${configPath}:${index + 1}; expected an integer from 0 to ${MAX_CONFIG_DEPTH}, using the last valid value or ${DEFAULT_DEPTH}`); continue; }
    const depth = Number(value);
    if (!Number.isSafeInteger(depth) || depth > MAX_CONFIG_DEPTH) { warn(`[project-structure] invalid depth at ${configPath}:${index + 1}; expected an integer from 0 to ${MAX_CONFIG_DEPTH}, using the last valid value or ${DEFAULT_DEPTH}`); continue; }
    resolved = depth;
  }
  return resolved ?? DEFAULT_DEPTH;
}

export function resolveDefaultDepth(cwd, { allowConfig = true, warn = console.warn } = {}) {
  if (!allowConfig) return DEFAULT_DEPTH;
  const configPath = path.join(cwd, CONFIG_NAME);
  try { return parseDepthConfig(fs.readFileSync(configPath, "utf8"), configPath, warn); }
  catch (error) {
    if (error?.code !== "ENOENT") warn(`[project-structure] failed to read ${CONFIG_NAME} at ${configPath}; using default depth ${DEFAULT_DEPTH}`, error);
    return DEFAULT_DEPTH;
  }
}

function globToRegex(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const close = glob.indexOf("]", i);
      if (close === -1) out += "\\[";
      else { out += glob.slice(i, close + 1).replace(/\\/g, "\\\\"); i = close; }
    } else if (/[.+^${}()|\\]/.test(c)) out += `\\${c}`;
    else out += c;
  }
  return new RegExp(`${out}$`);
}

function compilePattern(raw, warn = console.warn) {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  let body = trimmed; let negate = false; let dirOnly = false;
  if (body.startsWith("!")) { negate = true; body = body.slice(1); }
  if (body.endsWith("/")) { dirOnly = true; body = body.slice(0, -1); }
  if (body === "") return null;
  try { return { re: globToRegex(body), dirOnly, negate }; }
  catch (error) { warn("[project-structure] bad ignore pattern, skipping:", raw, error); return null; }
}

export function compileIgnoreFileContent(text, warn = console.warn) {
  return text.split(/\r?\n/).map((line) => compilePattern(line, warn)).filter(Boolean);
}

function loadIgnoreFile(file, warn = console.warn, { strict = false } = {}) {
  try { return compileIgnoreFileContent(fs.readFileSync(file, "utf8"), warn); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    if (strict) throw new ProjectTreeError(`failed to read ignore file: ${file}`, { cause:error });
    warn(`[project-structure] failed to read ignore file at ${file}`, error); return null;
  }
}

function globalPatterns(assetPath = ASSET_IGNORE, warn = console.warn) {
  const safe = compileIgnoreFileContent(SAFE_MIN_TEXT, warn);
  const loaded = loadIgnoreFile(assetPath, warn);
  if (loaded?.length) return loaded;
  warn(`[project-structure] ignore file empty or missing at ${assetPath}; using safe-min defaults (node_modules/, .git/)`);
  return safe;
}

function isIgnored(name, patterns, isDir) {
  let ignored = false;
  for (const pattern of patterns) {
    if (pattern.dirOnly && !isDir) continue;
    if (pattern.re.test(name)) ignored = !pattern.negate;
  }
  return ignored;
}

function appendBounded(lines, line, budget) {
  const separator = lines.length ? 1 : 0;
  const used = lines.reduce((sum, value) => sum + value.length, Math.max(0, lines.length - 1));
  if (used + separator + line.length <= budget) { lines.push(line); return true; }
  const markerSeparator = lines.length ? 1 : 0;
  while (lines.length) {
    const current = lines.reduce((sum, value) => sum + value.length, Math.max(0, lines.length - 1));
    if (current + markerSeparator + TRUNCATION.length <= budget) break;
    lines.pop();
  }
  if (!lines.includes(TRUNCATION) && TRUNCATION.length <= budget) lines.push(TRUNCATION);
  return false;
}

function buildTree(dir, maxDepth, prefix, lines, budget, patterns, formatName = (name) => name) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return true; }
  entries.sort((a, b) => a.isDirectory() !== b.isDirectory() ? (a.isDirectory() ? -1 : 1) : a.name.localeCompare(b.name));
  entries = entries.filter((entry) => !isIgnored(entry.name, patterns, entry.isDirectory()));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]; const last = index === entries.length - 1;
    const line = `${prefix}${last ? "└── " : "├── "}${formatName(entry.name)}${entry.isDirectory() ? "/" : ""}`;
    if (!appendBounded(lines, line, budget)) return false;
    if (entry.isDirectory() && maxDepth > 0 && !buildTree(path.join(dir, entry.name), maxDepth - 1, `${prefix}${last ? "    " : "│   "}`, lines, budget, patterns, formatName)) return false;
  }
  return true;
}

export function normalizeDepth(value, fallback = DEFAULT_DEPTH) {
  const depth = value ?? fallback;
  if (!Number.isSafeInteger(depth) || depth < 0) throw new ProjectTreeError("depth must be a non-negative safe integer");
  return depth;
}

export function resolveTreePath(requestedPath, baseDir) {
  if (requestedPath === undefined || requestedPath === null) return baseDir;
  if (typeof requestedPath !== "string" || requestedPath.trim() === "") throw new ProjectTreeError("path must be a non-empty string");
  return path.resolve(baseDir, requestedPath);
}

function escapeTreeName(name) {
  return name.replace(/`/g,"\\u0060").replace(/[\r\n]/g,(char)=>char === "\n" ? "\\n" : "\\r").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,(char)=>`\\u${char.codePointAt(0).toString(16).padStart(4,"0")}`);
}

export function getProjectTree(dir, { maxDepth = DEFAULT_DEPTH, charBudget = 12000, assetPath = ASSET_IGNORE, warn = console.warn, contextSafeNames = false } = {}) {
  const resolved = path.resolve(dir);
  let stat;
  try { stat = fs.statSync(resolved); } catch (error) { throw new ProjectTreeError(`cannot read directory: ${resolved}`, { cause: error }); }
  if (!stat.isDirectory()) throw new ProjectTreeError(`not a directory: ${resolved}`);
  const patterns = globalPatterns(assetPath, warn).concat(loadIgnoreFile(path.join(resolved, IGNORE_NAME), warn, {strict:true}) ?? []);
  const render = (budget) => {
    const lines=[]; appendBounded(lines,`${contextSafeNames?escapeTreeName(path.basename(resolved)):path.basename(resolved)}/`,budget);
    const complete=buildTree(resolved,normalizeDepth(maxDepth),"",lines,budget,patterns,contextSafeNames?escapeTreeName:(name)=>name);
    return {complete,text:lines.join("\n").slice(0,budget)};
  };
  const first=render(charBudget);
  return first.complete ? first.text : render(Math.floor(charBudget*0.8)).text;
}

function escapeContext(value) {
  return value.replace(/`/g, "\\u0060").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, (char) => `\\u${char.codePointAt(0).toString(16).padStart(4, "0")}`);
}

export function formatProjectStructureContext(tree, budget = 12000) {
  const prefix = "## Project Structure\n```\n"; const suffix = "\n```";
  const available = Math.max(0, budget - prefix.length - suffix.length);
  let escaped = escapeContext(tree);
  if (escaped.length > available) escaped = `${escaped.slice(0, Math.max(0, available - TRUNCATION.length - 1))}\n${TRUNCATION}`.slice(0, available);
  return `${prefix}${escaped}${suffix}`.slice(0, budget);
}
