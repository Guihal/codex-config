import * as fs from "node:fs";
import { buildReport, DEFAULT_TIMINGS, type ParseResult, type Timings } from "./parse.ts";
import { planFor } from "./linters/index.ts";
import { applyProjectHook } from "./project-hook.ts";
import { coldJob, runJobs, typecheckJob, type LintJob } from "./lint-job.ts";

type Item = { abs: string; editedAt: number };
type ResolvedItem = Item & Awaited<ReturnType<typeof applyProjectHook>>;

function addJob(jobs: Map<string, LintJob>, candidate: LintJob | undefined): void {
  if (!candidate) return;
  const existing = jobs.get(candidate.key);
  if (existing) {
    for (const file of candidate.files) if (!existing.files.includes(file)) existing.files.push(file);
    return;
  }
  jobs.set(candidate.key, candidate);
}

function resultFor(results: Map<string, ParseResult>, job: LintJob | undefined): ParseResult | undefined {
  return job ? results.get(job.key) : undefined;
}

export async function runColdForFiles(
  items: Item[],
  timings: Timings = DEFAULT_TIMINGS,
  onPlansResolved?: () => void,
): Promise<string | undefined> {
  const existing = items.filter((item) => fs.existsSync(item.abs) && fs.statSync(item.abs).isFile());
  if (existing.length === 0) return undefined;
  const deadline = Math.max(...existing.map((item) => item.editedAt)) + timings.budgetMs;
  const resolved: ResolvedItem[] = await Promise.all(existing.map(async (item) => ({
    ...item, ...(await applyProjectHook(item.abs, planFor(item.abs))),
  })));
  onPlansResolved?.();
  const coldJobs = new Map<string, LintJob>();
  for (const item of resolved) for (const linter of item.plan.cold) addJob(coldJobs, coldJob(item.abs, linter));
  const coldResults = await runJobs([...coldJobs.values()], timings, deadline);
  const ownColdError = (item: ResolvedItem) => item.plan.cold.some((linter) =>
    resultFor(coldResults, coldJob(item.abs, linter))?.diags.some((diag) => diag.severity === "error" && diag.absPath === item.abs));
  const typeJobs = new Map<string, LintJob>();
  for (const item of resolved) if (item.plan.daemon && !ownColdError(item)) addJob(typeJobs, typecheckJob(item.abs, item.plan.daemon));
  const typeResults = await runJobs([...typeJobs.values()], timings, deadline);
  const sections: string[] = [];
  const hookErrors = [...new Set(resolved.map((item) => item.hookError).filter(Boolean))];
  if (hookErrors.length) sections.push(`[lint-inject] hook: ${hookErrors.join("; ")}`);
  const batchEdited = new Set(existing.map((item) => item.abs));
  for (const item of resolved) for (const linter of item.plan.cold) {
    const job = coldJob(item.abs, linter);
    const result = resultFor(coldResults, job); if (!job || !result) continue;
    if (result.parseError) { sections.push(`[lint-inject] ${linter.bin}: вывод не распарсен: ${result.parseError}`); continue; }
    const report = buildReport({ editedAbs: item.abs, rootAbs: job.root, diags: result.diags, prevCounts: new Map(), batchEdited }).text;
    if (report) sections.push(`[lint-inject] ${linter.bin}:`, report);
  }
  for (const item of resolved) {
    if (!item.plan.daemon || ownColdError(item)) continue;
    const job = typecheckJob(item.abs, item.plan.daemon);
    const result = resultFor(typeResults, job); if (!job || !result) continue;
    if (result.parseError) { sections.push(`[lint-inject] ${item.plan.daemon.bin}: вывод не распарсен: ${result.parseError}`); continue; }
    const report = buildReport({ editedAbs: item.abs, rootAbs: job.root, diags: result.diags, prevCounts: new Map(), batchEdited }).text;
    if (report) sections.push(`[lint-inject] ${item.plan.daemon.bin}:`, report);
  }
  return sections.length ? sections.join("\n") : undefined;
}
