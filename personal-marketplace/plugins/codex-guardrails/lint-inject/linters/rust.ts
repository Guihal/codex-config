import { defineLinter } from "./constructor.ts";
import { parseClippyJson } from "../parse.ts";

/**
 * Rust: cargo clippy (project-level, cwd = gitRoot).
 * Зависимость: rustup с компонентом clippy (или пакет `rust` в Arch — clippy в комплекте).
 * slow: первая компиляция проекта может не уложиться в холодный бюджет — таймаут = бюджет батча,
 * read-ветка не гоняет; файлы без Cargo.toml → parseError → backoff (осознанно).
 */
export const rust = defineLinter({
  name: "rust",
  exts: [".rs"],
  cold: [
    {
      bin: "cargo",
      args: () => ["clippy", "--message-format=json", "--quiet", "--no-deps"],
      parse: parseClippyJson,
      slow: true,
    },
  ],
});
