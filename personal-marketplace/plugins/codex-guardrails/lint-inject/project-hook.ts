import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { AutoConfig } from "./auto-config-definitions.ts";
import type { ColdLinter, DaemonDef, ResolvedPlan } from "./linters/constructor.ts";

const CONFIG_NAME = "lint-inject.config.ts";
export const HOOK_TIMEOUT_MS = 1000;
export type LintHook = (fileAbs: string, plan: ResolvedPlan) => ResolvedPlan | null | void;
export type HookResult = { plan: ResolvedPlan; hookError?: string };
const hookCache = new Map<string, { mtime: number; hook: LintHook }>();
const hookInFlight = new Map<string, Promise<LintHook>>();

export function findProjectHook(fileAbs: string): string | undefined {
  let dir = path.dirname(fileAbs);
  for (;;) {
    const candidate = path.join(dir, CONFIG_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (fs.existsSync(path.join(dir, ".git")) || parent === dir) return undefined;
    dir = parent;
  }
}

function isColdLinter(value: unknown): value is ColdLinter {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ColdLinter>;
  return typeof item.bin === "string" && typeof item.args === "function" &&
    typeof item.parse === "function" &&
    (item.perFile === undefined || typeof item.perFile === "boolean") &&
    (item.slow === undefined || typeof item.slow === "boolean") &&
    (item.configless === undefined || typeof item.configless === "boolean") &&
    (item.env === undefined || (typeof item.env === "object" && item.env !== null && !Array.isArray(item.env))) &&
    (item.autoConfig === undefined || isAutoConfig(item.autoConfig));
}

function isAutoConfig(value: unknown): value is AutoConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<AutoConfig>;
  return typeof config.file === "string" &&
    (typeof config.content === "string" || typeof config.content === "function") &&
    Array.isArray(config.configNames) && config.configNames.every((name) => typeof name === "string") &&
    (config.pkgKeys === undefined || (Array.isArray(config.pkgKeys) && config.pkgKeys.every((name) => typeof name === "string")));
}

function isDaemon(value: unknown): value is DaemonDef {
  if (!value || typeof value !== "object") return false;
  const daemon = value as Partial<DaemonDef>;
  return (daemon.bin === "tsc" || daemon.bin === "vue-tsc") &&
    (daemon.args === undefined || (Array.isArray(daemon.args) && daemon.args.every((arg) => typeof arg === "string") && daemon.args.includes("--watch"))) &&
    (daemon.parse === undefined || typeof daemon.parse === "function") &&
    (daemon.autoConfig === undefined || isAutoConfig(daemon.autoConfig));
}

function isPlan(value: unknown): value is ResolvedPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Partial<ResolvedPlan>;
  return Array.isArray(plan.cold) && plan.cold.every(isColdLinter) &&
    (plan.daemon === undefined || isDaemon(plan.daemon));
}

async function loadProjectHook(configPath: string): Promise<LintHook> {
  const mtime = fs.statSync(configPath).mtimeMs;
  const cached = hookCache.get(configPath);
  if (cached?.mtime === mtime) return cached.hook;
  const pending = hookInFlight.get(configPath);
  if (pending) return pending;
  const loading = (async () => {
    const url = `${pathToFileURL(configPath).href}?mtime=${mtime}`;
    const module = await import(url) as { hook?: unknown; default?: unknown };
    const candidate = module.hook ?? module.default;
    const hook: LintHook = typeof candidate === "function" ? candidate as LintHook : () => undefined;
    hookCache.set(configPath, { mtime, hook });
    return hook;
  })();
  hookInFlight.set(configPath, loading);
  try { return await loading; } finally { hookInFlight.delete(configPath); }
}

async function withinHookTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  operation.catch(() => {});
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout ${HOOK_TIMEOUT_MS}ms`)), HOOK_TIMEOUT_MS);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function applyProjectHook(fileAbs: string, base: ResolvedPlan): Promise<HookResult> {
  const configPath = findProjectHook(fileAbs);
  if (!configPath) return { plan: base };
  let hook: LintHook;
  try { hook = await withinHookTimeout(loadProjectHook(configPath)); }
  catch (error) {
    hookInFlight.delete(configPath);
    return { plan: base, hookError: `хук не загрузился: ${(error as Error).message}` };
  }
  const call = Promise.resolve().then(() => hook(fileAbs, base));
  try {
    const result = await withinHookTimeout(call);
    if (result === null) return { plan: { cold: [] } };
    if (result === undefined) return { plan: base };
    if (!isPlan(result)) return { plan: base, hookError: "невалидный возврат хука" };
    return { plan: result };
  } catch (error) {
    return { plan: base, hookError: `хук упал: ${(error as Error).message}` };
  }
}
