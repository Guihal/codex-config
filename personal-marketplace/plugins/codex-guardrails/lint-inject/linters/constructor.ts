import type { Diag, ParseResult } from "../parse.ts";
import type { AutoConfig } from "../auto-config-definitions.ts";

export type ColdLinter = {
  bin: string;
  args: (files: string[]) => string[];
  parse: (stdout: string, stderr: string, cwd: string, exitCode?: number, files?: string[]) => ParseResult;
  /** php -l и т.п. принимают ОДИН файл за вызов: прогон per-file, результаты мёржатся */
  perFile?: boolean;
  /** Тяжёлый project-level линтер (clippy, go vet): таймаут = бюджет батча, read не гоняется,
   *  таймаут НЕ считается мёртвым (первая компиляция может не успеть). */
  slow?: boolean;
  configless?: boolean;
  env?: Record<string, string>;
  autoConfig?: AutoConfig;
};

export type DaemonDef = {
  bin: string;
  /** Дефолт: ["--noEmit","--watch","--pretty","false","--preserveWatchOutput"]. */
  args?: string[];
  /** Дефолт: parseTscOutput. Демоны — tsc-семейство (маркеры циклов tsc-специфичны). */
  parse?: (output: string, cwd: string) => Diag[];
  autoConfig?: AutoConfig;
};

export type LinterDef = {
  name: string;
  /** Матчинг по расширению (path.extname, lowercase) — стабильный тип, не regexp. */
  exts: string[];
  /** Basename-матч (точный регистр): Dockerfile и т.п. без расширения. */
  names?: string[];
  cold?: ColdLinter[];
  daemon?: DaemonDef;
};

export type ResolvedPlan = { cold: ColdLinter[]; daemon?: DaemonDef };

/** Конструктор лантера: декларативный модуль языка. */
export function defineLinter(def: LinterDef): LinterDef {
  return def;
}
